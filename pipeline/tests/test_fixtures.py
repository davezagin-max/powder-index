"""Every demo fixture must be a genuine output of the real pipeline: the stored SQL is
exactly what the validator emits, it runs against the published Parquet, the chart
columns exist, and every failed attempt in a retry trail really fails.

These tests read each fixture's own `placeholder` flag and never assume it. They pass
for today's hand-written samples and keep passing once `pnpm record` replaces them with
real runs: the recorder only keeps a run that clears the same checks made here."""

import json
from pathlib import Path

import duckdb
import pytest

from app.ask import AskBody, AskData, check_chart
from app.sqlguard import SqlRejected, validate_sql
from powder.answers import UnfitAnswer, run_answer

FIXTURES = Path(__file__).resolve().parent.parent.parent / "fixtures"
STORE: dict = json.loads((FIXTURES / "ask.json").read_text())
PRESETS: list = json.loads((FIXTURES / "presets.json").read_text())


def test_presets_and_fixtures_line_up_one_to_one() -> None:
    assert 6 <= len(PRESETS) <= 8
    assert [p["body"]["demoId"] for p in PRESETS] == sorted(
        {p["body"]["demoId"] for p in PRESETS}, key=[p["body"]["demoId"] for p in PRESETS].index
    )
    assert {p["body"]["demoId"] for p in PRESETS} == set(STORE)
    for preset in PRESETS:
        assert preset["route"] == "/api/ask"
        body = AskBody.model_validate(preset["body"])
        assert body.attempts == []
        assert STORE[preset["body"]["demoId"]]["data"]["question"] == body.question


@pytest.mark.parametrize("key", sorted(STORE))
def test_fixture_metadata_is_honest(key: str) -> None:
    fixture = STORE[key]
    assert fixture["model"] == "claude-opus-5-5"
    if fixture["placeholder"]:
        # A hand-written sample claims no recording time and no spend.
        assert fixture["recordedAt"] is None
        assert fixture["costUsd"] == 0 and set(fixture["usage"].values()) == {0}
    else:
        assert fixture["recordedAt"]
        assert fixture["usage"]["output_tokens"] > 0 and fixture["costUsd"] > 0


@pytest.mark.parametrize("key", sorted(STORE))
def test_fixture_is_a_real_pipeline_output(key: str, marts: duckdb.DuckDBPyConnection) -> None:
    data = AskData.model_validate(STORE[key]["data"])
    assert data.kind == "query" and data.sql and data.chart and data.title

    # The stored SQL is a fixed point of the validator: it is what the live path emits.
    query = validate_sql(data.sql)
    assert query.sql == data.sql
    assert query.limit == data.limit and not query.limit_changed
    check_chart(data.chart.model_dump(), query)

    # It runs, returns rows, and its chart can be drawn from them.
    assert 0 < run_answer(marts, data.sql, data.chart.model_dump(), query.limit) <= query.limit
    assert len(data.title) <= 80 and (data.note is None or len(data.note) <= 240)


def test_an_answer_nobody_could_use_is_refused(marts: duckdb.DuckDBPyConnection) -> None:
    """The gate the recorder relies on to keep a bad run out of the fixtures."""
    bar = {"type": "bar", "x": "resort_name", "y": "summit_elev_ft", "series": None}
    assert run_answer(marts, "SELECT resort_name, summit_elev_ft FROM resorts", bar, 5000) == 12
    with pytest.raises(UnfitAnswer, match="no rows"):
        run_answer(marts, "SELECT resort_name, summit_elev_ft FROM resorts WHERE FALSE", bar, 5000)
    with pytest.raises(UnfitAnswer, match="over its limit"):
        run_answer(marts, "SELECT resort_name, summit_elev_ft FROM resorts", bar, 5)
    with pytest.raises(UnfitAnswer, match="not numeric"):
        run_answer(marts, "SELECT resort_name, area FROM resorts", {**bar, "y": "area"}, 5000)
    with pytest.raises(UnfitAnswer, match="does not have"):
        run_answer(marts, "SELECT resort_name FROM resorts", bar, 5000)
    with pytest.raises(UnfitAnswer, match="scatter"):
        run_answer(
            marts,
            "SELECT resort_name, summit_elev_ft FROM resorts",
            {**bar, "type": "scatter"},
            5000,
        )
    # A table has no axes to satisfy, and a database error is the caller's to handle.
    table = {"type": "table", "x": "resort_name", "y": "area", "series": None}
    assert run_answer(marts, "SELECT resort_name, area FROM resorts", table, 5000) == 12
    with pytest.raises(duckdb.Error):
        run_answer(marts, "SELECT nope FROM resorts", bar, 5000)


@pytest.mark.parametrize("key", sorted(STORE))
def test_every_trail_step_really_fails(key: str, marts: duckdb.DuckDBPyConnection) -> None:
    data = AskData.model_validate(STORE[key]["data"])
    sample = STORE[key]["placeholder"]
    assert len(data.trail) <= 4
    for step in data.trail:
        if step.stage == "validator":
            if not sample:
                # A recorded rejection cannot be replayed from the SQL alone: it may have
                # been about the chart spec, or the SQL may have been clipped for storage.
                assert step.sql and step.error
                continue
            # A hand-written step must quote the validator word for word.
            with pytest.raises(SqlRejected) as rejected:
                validate_sql(step.sql)
            assert str(rejected.value) == step.error
        else:
            # It got past the firewall, and then DuckDB said no.
            assert validate_sql(step.sql).sql == step.sql
            with pytest.raises(duckdb.Error) as failed:
                marts.execute(step.sql).fetchall()
            if sample:
                assert str(failed.value).strip().splitlines()[0] == step.error


def test_at_least_one_fixture_shows_the_retry_trail() -> None:
    stages = {step["stage"] for fixture in STORE.values() for step in fixture["data"]["trail"]}
    # Only a requirement while the samples are hand-written: a recorded run has whatever
    # trail really happened, which may be none.
    if all(fixture["placeholder"] for fixture in STORE.values()):
        assert stages == {"validator", "engine"}
