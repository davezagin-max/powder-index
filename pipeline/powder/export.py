"""Export the marts for the site: Parquet for DuckDB-WASM, JSON for the dashboard.

resort_daily.parquet, powder_score.parquet, resorts.parquet
    The three tables "Ask the data" queries in the browser.
dashboard.json
    Everything the dashboard draws, as columnar arrays on one shared date axis.
manifest.json
    A few hundred bytes: when this was generated and from what. The site fetches it
    first to decide whether the published data is newer than its bundled copy.
schema.json
    Table and column documentation taken from dbt, so the model prompt, the SQL
    validator's allowlist, and the dbt docs can never drift apart.
lineage.json
    The dbt DAG (sources, seeds, models, edges, test counts) for the lineage diagram.
"""

from __future__ import annotations

import json
import math
from collections.abc import Iterator
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import duckdb

from .paths import ASK_SCHEMA_PATH, DBT_DIR, PUBLIC_DATA_DIR, database_path

TABLES = ("resorts", "resort_daily", "powder_score")
ORDER = {
    "resorts": "resort_id",
    "resort_daily": "resort_id, date",
    "powder_score": "resort_id, date",
}

# dashboard series name -> (table alias, column)
SERIES: dict[str, tuple[str, str]] = {
    "score": ("s", "powder_score"),
    "rank": ("s", "rank"),
    "new24": ("d", "new_snow_24h_in"),
    "new72": ("d", "new_snow_72h_in"),
    "depth": ("d", "snow_depth_in"),
    "swe": ("d", "swe_in"),
    "season": ("d", "season_snowfall_in"),
    "density72": ("d", "density_72h_pct"),
    "temp24": ("d", "temp_avg_24h_f"),
    "temp72": ("d", "temp_avg_72h_f"),
    "pFresh24": ("s", "fresh_24h_points"),
    "pFresh72": ("s", "fresh_72h_points"),
    "pDensity": ("s", "density_points"),
    "pCold": ("s", "cold_points"),
    "pBase": ("s", "base_points"),
}
BEST_DAY_COUNT = 6
BEST_DAY_SPACING = 3  # days between picks, so one storm cycle is not listed twice


def _clean(value: Any) -> Any:
    """JSON-ready: dates to ISO strings, whole floats to ints, NaN to null."""
    if isinstance(value, datetime):
        return value.replace(tzinfo=UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        return int(value) if value.is_integer() else round(value, 3)
    return value


def _rows(
    db: duckdb.DuckDBPyConnection, sql: str, params: list[Any] | None = None
) -> list[dict[str, Any]]:
    cursor = db.execute(sql, params or [])
    names = [column[0] for column in cursor.description]
    return [dict(zip(names, map(_clean, row), strict=True)) for row in cursor.fetchall()]


def pick_best_days(
    candidates: list[dict[str, Any]], count: int, spacing: int
) -> list[dict[str, Any]]:
    """Greedy pick of the highest-scoring dates that are at least `spacing` days apart.

    `candidates` must be sorted best first. Without the spacing rule the list would be
    the same storm three days running.
    """
    picked: list[dict[str, Any]] = []
    for candidate in candidates:
        day = date.fromisoformat(candidate["date"])
        if all(abs((day - date.fromisoformat(p["date"])).days) >= spacing for p in picked):
            picked.append(candidate)
        if len(picked) == count:
            break
    return picked


def build_dashboard(db: duckdb.DuckDBPyConnection, generated_at: str) -> dict[str, Any]:
    dates = [
        row["date"]
        for row in _rows(db, "select distinct date from marts.resort_daily order by date")
    ]
    select = ", ".join(
        f"list({alias}.{column} order by d.date) as {name}"
        for name, (alias, column) in SERIES.items()
    )
    series = {
        row.pop("resort_id"): row
        for row in _rows(
            db,
            f"""
            select d.resort_id, count(*) as day_count, {select}
            from marts.resort_daily d
            join marts.powder_score s on d.resort_id = s.resort_id and d.date = s.date
            group by d.resort_id
            """,
        )
    }
    stations: dict[str, list[dict[str, Any]]] = {}
    for row in _rows(
        db,
        """
        select resort_id, station_triplet as id, station_name as name, station_latitude as lat,
               station_longitude as lon, station_elev_ft as "elevFt", distance_km as "distanceKm",
               round(weight, 3) as weight, rationale
        from intermediate.int_resort_station_weights
        order by resort_id, weight desc
        """,
    ):
        stations.setdefault(row.pop("resort_id"), []).append(row)
    forecasts = {
        row.pop("resort_id"): row
        for row in _rows(
            db,
            """
            select f.resort_id, f.forecast_date as date, f.forecast_updated_at_utc as "updatedAt",
                   f.forecast_snow_72h_in as snow72, f.forecast_snow_day_1_in as day1,
                   f.forecast_snow_day_2_in as day2, f.forecast_snow_day_3_in as day3,
                   f.forecast_precip_72h_in as precip72, f.forecast_temp_min_72h_f as "tempMin72",
                   f.forecast_temp_max_72h_f as "tempMax72", s.forecast_points as points
            from intermediate.int_resort_forecast f
            join marts.powder_score s on f.resort_id = s.resort_id and f.forecast_date = s.date
            """,
        )
    }
    resorts = []
    for row in _rows(
        db,
        """
        select resort_id as id, resort_name as name, area, latitude as lat, longitude as lon,
               base_elev_ft as "baseFt", summit_elev_ft as "summitFt", station_names as "stationNames",
               nearest_station_km as "nearestStationKm", station_elev_ft as "stationElevFt",
               proxy_quality as proxy
        from marts.resorts order by resort_name
        """,
    ):
        resort_series = series[row["id"]]
        if resort_series.pop("day_count") != len(dates):
            raise RuntimeError(
                f"{row['id']} does not cover every date; the shared axis would be wrong"
            )
        row["stations"] = stations[row["id"]]
        row["forecast"] = forecasts.get(row["id"])
        row["series"] = {
            name: [_clean(v) for v in values] for name, values in resort_series.items()
        }
        resorts.append(row)

    best = pick_best_days(
        _rows(
            db,
            """
            select s.date, max(s.powder_score) as "topScore",
                   arg_max(s.resort_id, s.powder_score) as "topResortId",
                   arg_max(s.resort_name, s.powder_score) as "topResortName",
                   max(d.new_snow_24h_in) as "maxNew24",
                   cast(count(*) filter (where s.tier in ('epic', 'powder')) as integer) as "powderResorts"
            from marts.powder_score s
            join marts.resort_daily d on s.resort_id = d.resort_id and s.date = d.date
            group by s.date
            order by max(s.powder_score) desc, s.date
            limit 60
            """,
        ),
        BEST_DAY_COUNT,
        BEST_DAY_SPACING,
    )
    sources = {
        row["name"]: {"mode": row["mode"], "fetchedAt": row["fetched_at"]}
        for row in _rows(
            db,
            """
            select 'snotel' as name, max(_source) as mode, max(_loaded_at) as fetched_at from raw.snotel_daily
            union all
            select 'nws', max(_source), max(_loaded_at) from raw.nws_forecast
            """,
        )
    }
    return {
        "generatedAt": generated_at,
        "asOf": dates[-1],
        "firstDate": dates[0],
        "sources": sources,
        "dates": dates,
        "resorts": resorts,
        "components": _rows(
            db,
            """
            select component as key, label, weight, zero_at as "zeroAt", full_at as "fullAt", unit,
                   input_column as "inputColumn", description
            from seeds.powder_score_weights order by weight desc, component
            """,
        ),
        "tiers": _rows(
            db,
            'select tier, label, min_score as "minScore" from seeds.powder_tiers order by sort_order',
        ),
        "bestDays": best,
    }


def _dbt_manifest() -> dict[str, Any]:
    path = DBT_DIR / "target" / "manifest.json"
    if not path.exists():
        raise RuntimeError(
            "dbt has not run yet: target/manifest.json is missing. Run `python -m powder build`."
        )
    return json.loads(path.read_text())


def build_schema(db: duckdb.DuckDBPyConnection, manifest: dict[str, Any]) -> dict[str, Any]:
    """Tables, columns, types, and descriptions for the three marts, straight from dbt."""
    nodes = {
        node["name"]: node
        for node in manifest["nodes"].values()
        if node["resource_type"] == "model"
    }
    tables = []
    for table in TABLES:
        node = nodes[table]
        columns = []
        for name, kind in db.execute(
            "select column_name, data_type from information_schema.columns "
            "where table_schema = 'marts' and table_name = ? order by ordinal_position",
            [table],
        ).fetchall():
            description = " ".join(node["columns"].get(name, {}).get("description", "").split())
            if not description:
                raise RuntimeError(
                    f"{table}.{name} has no description in dbt; the model prompt needs one"
                )
            columns.append({"name": name, "type": kind, "description": description})
        tables.append(
            {
                "name": table,
                "description": " ".join(node["description"].split()),
                "columns": columns,
            }
        )
    return {
        "tables": tables,
        "resorts": _rows(
            db,
            "select resort_id as id, resort_name as name from marts.resorts order by resort_name",
        ),
        "firstDate": _rows(db, "select min(date) as d from marts.resort_daily")[0]["d"],
    }


def build_lineage(manifest: dict[str, Any]) -> dict[str, Any]:
    """The dbt DAG, reduced to what a diagram needs."""
    kept: dict[str, dict[str, Any]] = {}
    for unique_id, node in {**manifest["sources"], **manifest["nodes"]}.items():
        kind = node["resource_type"]
        if kind not in ("source", "seed", "model"):
            continue
        layer = kind if kind != "model" else node["fqn"][1]  # staging / intermediate / marts
        kept[unique_id] = {"id": unique_id, "name": node["name"], "layer": layer, "tests": 0}
    edges: set[tuple[str, str]] = set()
    for unique_id, node in manifest["nodes"].items():
        parents = [p for p in node.get("depends_on", {}).get("nodes", []) if p in kept]
        if node["resource_type"] == "model":
            edges.update((parent, unique_id) for parent in parents)
        elif node["resource_type"] == "test":
            for parent in parents:
                kept[parent]["tests"] += 1
    for unit_test in manifest.get("unit_tests", {}).values():
        for parent in unit_test.get("depends_on", {}).get("nodes", []):
            if parent in kept and kept[parent]["name"] == unit_test.get("model"):
                kept[parent]["tests"] += 1
    return {
        "nodes": sorted(kept.values(), key=lambda n: (n["layer"], n["name"])),
        "edges": [{"from": a, "to": b} for a, b in sorted(edges)],
    }


def _write_json(path: Path, payload: Any, *, pretty: bool = False) -> str:
    text = json.dumps(payload, indent=2) if pretty else json.dumps(payload, separators=(",", ":"))
    path.write_text(text + "\n")
    return f"{path.name:<24} {path.stat().st_size / 1024:>7.1f} KB"


def export(out_dir: Path = PUBLIC_DATA_DIR, db_path: Path | None = None) -> Iterator[str]:
    """Write every published file into `out_dir`. Yields one summary line per file."""
    out_dir.mkdir(parents=True, exist_ok=True)
    generated_at = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    manifest = _dbt_manifest()
    # Not read_only: when dbt ran earlier in this process it still holds a read-write
    # handle on the file, and DuckDB refuses to mix the two modes. Nothing here writes.
    with duckdb.connect(str(db_path or database_path())) as db:
        row_counts = {}
        for table in TABLES:
            path = out_dir / f"{table}.parquet"
            # Snappy and Parquet v1: readable by every DuckDB-WASM release.
            db.execute(
                f"copy (select * from marts.{table} order by {ORDER[table]}) "
                f"to '{path.as_posix()}' (format parquet, compression snappy)"
            )
            row_counts[table] = db.execute(f"select count(*) from marts.{table}").fetchone()[0]  # type: ignore[index]
            yield f"{path.name:<24} {path.stat().st_size / 1024:>7.1f} KB  {row_counts[table]} rows"

        dashboard = build_dashboard(db, generated_at)
        yield _write_json(out_dir / "dashboard.json", dashboard)
        schema = build_schema(db, manifest)
        yield _write_json(out_dir / "schema.json", schema, pretty=True)
        if out_dir.resolve() == PUBLIC_DATA_DIR.resolve():
            # The Ask function reads its own committed copy; a test keeps the two identical.
            yield _write_json(ASK_SCHEMA_PATH, schema, pretty=True) + "  (pipeline/app)"
        yield _write_json(out_dir / "lineage.json", build_lineage(manifest), pretty=True)
        yield _write_json(
            out_dir / "manifest.json",
            {
                "generatedAt": generated_at,
                "asOf": dashboard["asOf"],
                "firstDate": dashboard["firstDate"],
                "sources": dashboard["sources"],
                "rows": row_counts,
                "files": [f"{table}.parquet" for table in TABLES]
                + ["dashboard.json", "schema.json", "lineage.json"],
            },
            pretty=True,
        )
