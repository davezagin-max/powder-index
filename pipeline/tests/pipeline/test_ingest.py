import json
from datetime import date
from pathlib import Path

import duckdb
import httpx
import pytest

from powder import ingest
from powder.resorts import load_resorts, load_station_triplets

from .payloads import NWS_GRID, NWS_POINT, SNOTEL_DAILY, SNOTEL_STATIONS


@pytest.mark.parametrize(
    ("today", "begin"),
    [
        (
            date(2026, 10, 11),
            date(2025, 9, 1),
        ),  # October: the season that just ended is the "previous" one
        (date(2026, 9, 30), date(2024, 9, 1)),  # last day of water year 2026
        (date(2027, 2, 1), date(2025, 9, 1)),  # mid-winter: this season plus all of the last
    ],
)
def test_history_window_always_includes_a_full_previous_season(today: date, begin: date) -> None:
    assert ingest.history_window(today) == (begin, today)
    assert (today - begin).days >= 365


def live_handler(*, snotel_ok: bool = True, nws_ok: bool = True):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "wcc.sc.egov.usda.gov":
            if not snotel_ok:
                return httpx.Response(503)
            triplets = request.url.params["stationTriplets"].split(",")
            if request.url.path.endswith("/stations"):
                return httpx.Response(
                    200, json=[{**SNOTEL_STATIONS[0], "stationTriplet": t} for t in triplets]
                )
            return httpx.Response(
                200, json=[{**SNOTEL_DAILY[0], "stationTriplet": t} for t in triplets]
            )
        if not nws_ok:
            raise httpx.ConnectError("api.weather.gov is unreachable")
        return httpx.Response(200, json=NWS_POINT if "/points/" in request.url.path else NWS_GRID)

    return httpx.Client(transport=httpx.MockTransport(handler))


def read_meta(directory: Path) -> dict:
    return json.loads((directory / "meta.json").read_text())


def test_offline_ingest_copies_the_committed_snapshot(tmp_path: Path) -> None:
    report = ingest.ingest(offline=True, out_dir=tmp_path)
    assert {name: item.source for name, item in report.items()} == {
        "snotel": "snapshot",
        "nws": "snapshot",
    }
    assert (tmp_path / "snotel_daily.csv").read_text() == (
        ingest.SNAPSHOT_DIR / "snotel_daily.csv"
    ).read_text()
    snapshot_meta = json.loads((ingest.SNAPSHOT_DIR / "meta.json").read_text())
    # The fetch time travels with the data, so a stale snapshot reads as stale downstream.
    assert read_meta(tmp_path)["snotel"]["fetched_at"] == snapshot_meta["snotel"]["fetched_at"]
    assert report["snotel"].rows > 4000


def test_live_ingest_writes_fresh_rows_for_both_sources(tmp_path: Path) -> None:
    report = ingest.ingest(
        out_dir=tmp_path, client=live_handler(), today=date(2026, 2, 19), sleep=lambda _: None
    )
    assert {name: item.source for name, item in report.items()} == {"snotel": "live", "nws": "live"}
    assert report["snotel"].rows == 2 * len(load_station_triplets())
    assert report["nws"].rows == 4 * len(load_resorts())
    assert report["snotel"].error is None
    header = (tmp_path / "snotel_daily.csv").read_text().splitlines()[0]
    assert header == "station_triplet,date,snwd_in,wteq_in,tobs_f,tavg_f,tmin_f,tmax_f"


def test_each_source_falls_back_on_its_own(tmp_path: Path) -> None:
    waits: list[float] = []
    report = ingest.ingest(
        out_dir=tmp_path,
        client=live_handler(snotel_ok=False),
        today=date(2026, 2, 19),
        sleep=waits.append,
    )
    assert report["snotel"].source == "snapshot"
    assert "HTTP 503" in (report["snotel"].error or "")
    assert report["nws"].source == "live"
    assert len(waits) == 3  # it retried before giving up
    meta = read_meta(tmp_path)
    assert meta["snotel"]["source"] == "snapshot" and meta["nws"]["source"] == "live"


def test_a_dead_network_still_produces_a_complete_raw_directory(tmp_path: Path) -> None:
    report = ingest.ingest(
        out_dir=tmp_path,
        client=live_handler(snotel_ok=False, nws_ok=False),
        today=date(2026, 2, 19),
        sleep=lambda _: None,
    )
    assert {item.source for item in report.values()} == {"snapshot"}
    assert "ConnectError" in (report["nws"].error or "")
    assert all((tmp_path / name).exists() for name in ingest.FILES)


def test_snapshot_is_only_updated_from_a_fully_live_pull(tmp_path: Path) -> None:
    ingest.ingest(
        out_dir=tmp_path,
        client=live_handler(nws_ok=False),
        today=date(2026, 2, 19),
        sleep=lambda _: None,
    )
    with pytest.raises(RuntimeError, match="nws did not come from a live pull"):
        ingest.update_snapshot(tmp_path)


def test_load_raw_types_the_columns_and_stamps_every_row(tmp_path: Path) -> None:
    ingest.ingest(offline=True, out_dir=tmp_path)
    db_path = tmp_path / "test.duckdb"
    counts = ingest.load_raw(tmp_path, db_path)
    assert counts["snotel_stations"] == 13
    with duckdb.connect(str(db_path), read_only=True) as db:
        types = dict(
            db.execute(
                "select column_name, data_type from information_schema.columns "
                "where table_schema = 'raw' and table_name = 'snotel_daily'"
            ).fetchall()
        )
        assert types["date"] == "DATE"
        assert types["snwd_in"] == "DOUBLE"
        assert types["_loaded_at"] == "TIMESTAMP"
        sources, loaded = db.execute(
            "select list(distinct _source), count(distinct _loaded_at) from raw.nws_forecast"
        ).fetchone()  # type: ignore[misc]
        assert sources == ["snapshot"] and loaded == 1
        # Snowbird's 19 February reading, straight from the snapshot.
        assert db.execute(
            "select snwd_in, wteq_in from raw.snotel_daily where station_triplet = '766:UT:SNTL' and date = '2026-02-19'"
        ).fetchone() == (88.0, 20.1)
        assert db.execute(
            "select typeof(valid_start) from raw.nws_forecast limit 1"
        ).fetchone() == ("TIMESTAMP",)
