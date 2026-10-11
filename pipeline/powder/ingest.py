"""Ingest: fetch SNOTEL and NWS data, falling back to the committed snapshot per source.

The output is always the same three CSV files plus `meta.json` in a "raw" directory,
whether the rows came from the live APIs or from `data/snapshot/`. `load_raw` then copies
them into the DuckDB `raw` schema with explicit types, where dbt picks them up as sources.

A government API being slow or down must never break the pipeline or CI, so each source
falls back on its own: a live SNOTEL pull can be paired with a snapshot forecast. Every
row carries `_loaded_at` (when it was fetched, not when it was copied) and `_source`, so
dbt's freshness check and the site can both tell a stale fallback from a fresh pull.
"""

from __future__ import annotations

import csv
import json
import shutil
from collections.abc import Callable, Iterable
from dataclasses import asdict, dataclass, fields
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import duckdb
import httpx

from . import nws, snotel
from .fetch import FetchError, make_client
from .paths import PIPELINE_DIR, SNAPSHOT_DIR, database_path
from .resorts import load_resorts, load_station_triplets

RAW_DIR = PIPELINE_DIR / "data" / "raw"
MOUNTAIN = ZoneInfo("America/Denver")

# file name -> (row type, source it belongs to)
FILES: dict[str, tuple[type, str]] = {
    "snotel_daily.csv": (snotel.DailyRow, "snotel"),
    "snotel_stations.csv": (snotel.Station, "snotel"),
    "nws_forecast.csv": (nws.ForecastPeriod, "nws"),
}


@dataclass(frozen=True)
class SourceReport:
    source: str  # "live" or "snapshot"
    fetched_at: str  # UTC, ISO 8601
    rows: int
    error: str | None = None  # why the live pull was abandoned, when it was


def history_window(today: date) -> tuple[date, date]:
    """From 1 September before the previous water year through today.

    A water year runs 1 October to 30 September and is named for the year it ends in.
    Starting a month early gives the rolling windows a snow-free warm-up, and going back
    a full extra year means there is always a complete season to replay, even in October.
    """
    current_start_year = today.year if today.month >= 10 else today.year - 1
    return date(current_start_year - 1, 9, 1), today


def now_utc() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def write_csv(path: Path, row_type: type, rows: Iterable[Any]) -> int:
    names = [field.name for field in fields(row_type)]
    count = 0
    with path.open("w", newline="") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(names)
        for row in rows:
            record = asdict(row)
            writer.writerow(["" if record[name] is None else record[name] for name in names])
            count += 1
    return count


def _count_rows(path: Path) -> int:
    with path.open() as handle:
        return max(sum(1 for _ in handle) - 1, 0)


def _from_snapshot(out_dir: Path, source: str, error: str | None) -> SourceReport:
    meta = json.loads((SNAPSHOT_DIR / "meta.json").read_text())[source]
    rows = 0
    for name, (_, owner) in FILES.items():
        if owner == source:
            shutil.copyfile(SNAPSHOT_DIR / name, out_dir / name)
            rows += _count_rows(out_dir / name)
    return SourceReport("snapshot", meta["fetched_at"], rows, error)


def ingest(
    *,
    offline: bool = False,
    out_dir: Path = RAW_DIR,
    today: date | None = None,
    client: httpx.Client | None = None,
    sleep: Callable[[float], None] | None = None,
) -> dict[str, SourceReport]:
    """Write the raw files for both sources and return where each one came from."""
    out_dir.mkdir(parents=True, exist_ok=True)
    today = today or datetime.now(MOUNTAIN).date()
    begin, end = history_window(today)
    kw: dict[str, Any] = {"sleep": sleep} if sleep else {}
    owned = client is None
    client = client or make_client()
    report: dict[str, SourceReport] = {}
    try:
        if offline:
            report["snotel"] = _from_snapshot(out_dir, "snotel", None)
            report["nws"] = _from_snapshot(out_dir, "nws", None)
            return report

        triplets = load_station_triplets()
        try:
            daily = snotel.fetch_daily(client, triplets, begin, end, **kw)
            stations = snotel.fetch_stations(client, triplets, **kw)
            rows = write_csv(out_dir / "snotel_daily.csv", snotel.DailyRow, daily)
            write_csv(out_dir / "snotel_stations.csv", snotel.Station, stations)
            report["snotel"] = SourceReport("live", now_utc(), rows)
        except (FetchError, ValueError, KeyError) as error:
            report["snotel"] = _from_snapshot(out_dir, "snotel", str(error))

        try:
            periods = nws.fetch_forecast(client, load_resorts(), **kw)
            rows = write_csv(out_dir / "nws_forecast.csv", nws.ForecastPeriod, periods)
            report["nws"] = SourceReport("live", now_utc(), rows)
        except (FetchError, ValueError, KeyError) as error:
            report["nws"] = _from_snapshot(out_dir, "nws", str(error))
        return report
    finally:
        if owned:
            client.close()
        if report:
            (out_dir / "meta.json").write_text(
                json.dumps({name: asdict(item) for name, item in report.items()}, indent=2) + "\n"
            )


def update_snapshot(raw_dir: Path = RAW_DIR) -> None:
    """Promote the raw files to the committed snapshot. Refuses anything not fetched live."""
    meta = json.loads((raw_dir / "meta.json").read_text())
    stale = [name for name, item in meta.items() if item["source"] != "live"]
    if stale:
        raise RuntimeError(
            f"Not updating the snapshot: {', '.join(stale)} did not come from a live pull."
        )
    SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    for name in FILES:
        shutil.copyfile(raw_dir / name, SNAPSHOT_DIR / name)
    slim = {name: {"fetched_at": item["fetched_at"]} for name, item in meta.items()}
    (SNAPSHOT_DIR / "meta.json").write_text(json.dumps(slim, indent=2) + "\n")


_COLUMNS = {
    "snotel_daily.csv": {
        "station_triplet": "VARCHAR",
        "date": "DATE",
        "snwd_in": "DOUBLE",
        "wteq_in": "DOUBLE",
        "tobs_f": "DOUBLE",
        "tavg_f": "DOUBLE",
        "tmin_f": "DOUBLE",
        "tmax_f": "DOUBLE",
    },
    "snotel_stations.csv": {
        "station_triplet": "VARCHAR",
        "station_name": "VARCHAR",
        "latitude": "DOUBLE",
        "longitude": "DOUBLE",
        "elevation_ft": "DOUBLE",
        "county": "VARCHAR",
    },
    "nws_forecast.csv": {
        "resort_id": "VARCHAR",
        "grid_id": "VARCHAR",
        "element": "VARCHAR",
        "valid_start": "TIMESTAMP",
        "duration_hours": "DOUBLE",
        "value": "DOUBLE",
        "forecast_updated_at": "TIMESTAMP",
    },
}


def load_raw(raw_dir: Path = RAW_DIR, db_path: Path | None = None) -> dict[str, int]:
    """Replace the `raw` schema in DuckDB with the contents of the raw files."""
    db_path = db_path or database_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    meta = json.loads((raw_dir / "meta.json").read_text())
    counts: dict[str, int] = {}
    with duckdb.connect(str(db_path)) as db:
        db.execute("create schema if not exists raw")
        for name, columns in _COLUMNS.items():
            table = name.removesuffix(".csv")
            source = meta[FILES[name][1]]
            db.execute(
                f"""
                create or replace table raw.{table} as
                select *, cast(? as timestamp) as _loaded_at, cast(? as varchar) as _source
                from read_csv(?, header = true, columns = {columns!r}, nullstr = '',
                              timestampformat = '%Y-%m-%dT%H:%M:%SZ')
                """,
                [source["fetched_at"].removesuffix("Z"), source["source"], str(raw_dir / name)],
            )
            counts[table] = db.execute(f"select count(*) from raw.{table}").fetchone()[0]  # type: ignore[index]
    return counts
