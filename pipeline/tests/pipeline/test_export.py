"""Runs the whole pipeline offline (snapshot -> DuckDB -> dbt build -> export) into a temp
directory and checks it against the files the site ships. This is the proof that the
bundled data is reproducible from the committed snapshot, and that the dbt tests pass."""

import json
import math
from datetime import date, datetime
from pathlib import Path

import duckdb
import pytest

from powder import export as export_module
from powder import ingest
from powder.paths import ASK_SCHEMA_PATH, DBT_DIR, PUBLIC_DATA_DIR


def test_best_days_are_spaced_so_one_storm_is_listed_once() -> None:
    candidates = [
        {"date": "2026-02-19", "topScore": 90.6},
        {"date": "2026-02-21", "topScore": 84.5},  # same storm cycle: skipped
        {"date": "2026-03-06", "topScore": 83.4},
        {"date": "2026-03-07", "topScore": 74.3},  # skipped
        {"date": "2026-02-16", "topScore": 60.0},  # three days before the first pick: allowed
    ]
    picked = export_module.pick_best_days(candidates, count=3, spacing=3)
    assert [p["date"] for p in picked] == ["2026-02-19", "2026-03-06", "2026-02-16"]


def test_values_are_made_json_safe() -> None:
    clean = export_module._clean
    assert clean(12.0) == 12 and isinstance(clean(12.0), int)
    assert clean(10.6499) == 10.65
    assert clean(float("nan")) is None
    assert clean(date(2026, 2, 19)) == "2026-02-19"
    assert clean(datetime(2026, 10, 11, 20, 1, 52)) == "2026-10-11T20:01:52Z"
    assert clean(None) is None and clean("alta") == "alta"


@pytest.fixture(scope="module")
def built(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """One offline pipeline run shared by the tests below."""
    from dbt.cli.main import dbtRunner

    work = tmp_path_factory.mktemp("pipeline")
    db_path = work / "powder.duckdb"
    ingest.ingest(offline=True, out_dir=work / "raw")
    ingest.load_raw(work / "raw", db_path)
    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setenv("POWDER_DB", str(db_path))
    try:
        result = dbtRunner().invoke(
            ["build", "--project-dir", str(DBT_DIR), "--profiles-dir", str(DBT_DIR), "--quiet"]
        )
        assert result.success, "dbt build failed: run `uv run python -m powder build` to see why"
        out = work / "out"
        list(export_module.export(out, db_path))
    finally:
        monkeypatch.undo()
    return out


def close(a: object, b: object, tolerance: float) -> bool:
    if a is None or b is None:
        return a is b
    return math.isclose(float(a), float(b), abs_tol=tolerance)  # type: ignore[arg-type]


def test_bundled_dashboard_matches_a_fresh_build_from_the_snapshot(built: Path) -> None:
    fresh = json.loads((built / "dashboard.json").read_text())
    bundled = json.loads((PUBLIC_DATA_DIR / "dashboard.json").read_text())
    for key in ("asOf", "firstDate", "dates", "components", "tiers", "sources"):
        assert fresh[key] == bundled[key], key
    assert fresh["sources"]["snotel"]["mode"] == "snapshot"
    assert [r["id"] for r in fresh["resorts"]] == [r["id"] for r in bundled["resorts"]]
    assert [d["date"] for d in fresh["bestDays"]] == [d["date"] for d in bundled["bestDays"]]
    for new, old in zip(fresh["resorts"], bundled["resorts"], strict=True):
        assert new["stations"] == old["stations"]
        assert set(new["series"]) == set(old["series"])
        for name, values in new["series"].items():
            assert len(values) == len(fresh["dates"])
            # Floating-point sums can differ by one rounding step between machines.
            tolerance = 0 if name == "rank" else 0.11
            mismatched = [
                i
                for i, (a, b) in enumerate(zip(values, old["series"][name], strict=True))
                if not close(a, b, tolerance)
            ]
            assert not mismatched, f"{new['id']}.{name} differs at index {mismatched[:3]}"


def test_dashboard_shape_and_headline_numbers(built: Path) -> None:
    data = json.loads((built / "dashboard.json").read_text())
    assert len(data["resorts"]) == 12
    assert data["dates"][0] == data["firstDate"] and data["dates"][-1] == data["asOf"]
    assert len(data["dates"]) >= 365
    assert math.isclose(sum(c["weight"] for c in data["components"]), 1.0)
    assert [t["tier"] for t in data["tiers"]] == ["epic", "powder", "soft", "firm", "off"]
    # The storm of 17-18 February 2026: 33 inches at the Snowbird station by the 19th.
    snowbird = next(r for r in data["resorts"] if r["id"] == "snowbird")
    day = data["dates"].index("2026-02-19")
    assert snowbird["series"]["new24"][day] == 33
    assert snowbird["series"]["depth"][day] == 88
    assert snowbird["series"]["rank"][day] == 1
    assert data["bestDays"][0]["date"] == "2026-02-19"
    assert data["bestDays"][0]["topResortId"] == "snowbird"
    # Every score is the sum of its parts (the forecast only exists on the last day).
    for resort in data["resorts"]:
        s = resort["series"]
        for i in range(len(data["dates"]) - 1):
            parts = (
                s["pFresh24"][i]
                + s["pFresh72"][i]
                + s["pDensity"][i]
                + s["pCold"][i]
                + s["pBase"][i]
            )
            assert math.isclose(parts, s["score"][i], abs_tol=0.051), (
                resort["id"],
                data["dates"][i],
            )
    # Two-station resorts carry both stations with weights that sum to one.
    solitude = next(r for r in data["resorts"] if r["id"] == "solitude")
    assert [s["name"] for s in solitude["stations"]] == ["Brighton", "Mill-D North"]
    assert math.isclose(sum(s["weight"] for s in solitude["stations"]), 1.0, abs_tol=0.002)


def test_parquet_files_hold_the_marts(built: Path) -> None:
    manifest = json.loads((built / "manifest.json").read_text())
    with duckdb.connect() as db:
        for table in ("resorts", "resort_daily", "powder_score"):
            count = db.execute(
                f"select count(*) from read_parquet('{(built / f'{table}.parquet').as_posix()}')"
            ).fetchone()
            assert count == (manifest["rows"][table],)
        kinds = dict(
            db.execute(
                f"select column_name, column_type from (describe select * from read_parquet('{(built / 'resort_daily.parquet').as_posix()}'))"
            ).fetchall()
        )
    assert (
        kinds["date"] == "DATE"
        and kinds["snow_depth_in"] == "DOUBLE"
        and kinds["water_year"] == "INTEGER"
    )
    assert manifest["rows"]["resorts"] == 12
    assert manifest["rows"]["resort_daily"] == manifest["rows"]["powder_score"]


def test_committed_schema_files_match_dbt(built: Path) -> None:
    fresh = json.loads((built / "schema.json").read_text())
    assert json.loads(ASK_SCHEMA_PATH.read_text()) == fresh, (
        "run `uv run python -m powder run --offline`"
    )
    assert json.loads((PUBLIC_DATA_DIR / "schema.json").read_text()) == fresh
    assert [t["name"] for t in fresh["tables"]] == ["resorts", "resort_daily", "powder_score"]
    assert all(column["description"] for table in fresh["tables"] for column in table["columns"])


def test_lineage_runs_from_sources_to_marts(built: Path) -> None:
    lineage = json.loads((built / "lineage.json").read_text())
    layers = {node["name"]: node["layer"] for node in lineage["nodes"]}
    assert layers["snotel_daily"] == "source" and layers["stg_snotel__daily"] == "staging"
    assert layers["int_station_new_snow"] == "intermediate" and layers["powder_score"] == "marts"
    names = {node["id"]: node["name"] for node in lineage["nodes"]}
    edges = {(names[e["from"]], names[e["to"]]) for e in lineage["edges"]}
    assert ("snotel_daily", "stg_snotel__daily") in edges
    assert ("int_station_new_snow", "int_resort_days") in edges
    assert ("resort_daily", "powder_score") in edges
    assert ("powder_score_weights", "powder_score") in edges
    assert next(n for n in lineage["nodes"] if n["name"] == "powder_score")["tests"] >= 10


def test_lineage_counts_each_test_once(built: Path) -> None:
    """A test that touches two tables shows on both boxes but is one test in the total."""
    lineage = json.loads((built / "lineage.json").read_text())
    manifest = json.loads((DBT_DIR / "target" / "manifest.json").read_text())
    data_tests = sum(1 for node in manifest["nodes"].values() if node["resource_type"] == "test")
    assert lineage["testCount"] == data_tests + len(manifest["unit_tests"])
    assert lineage["testCount"] >= 80
    # Summing the boxes double-counts relationships tests, so it must come out higher.
    assert sum(node["tests"] for node in lineage["nodes"]) > lineage["testCount"]
    # The diagram on the site is drawn from the committed copy; it must be this one.
    assert json.loads((PUBLIC_DATA_DIR / "lineage.json").read_text()) == lineage, (
        "run `uv run python -m powder run --offline`"
    )
