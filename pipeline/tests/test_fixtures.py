"""Every demo fixture must be a genuine output of the real pipeline: the stored SQL is
exactly what the validator emits, it runs against the published Parquet, the chart
columns exist, and every failed attempt in a retry trail really fails the way it says."""

import json
from pathlib import Path

import duckdb
import pytest

from app.ask import AskBody, AskData, check_chart
from app.sqlguard import SqlRejected, validate_sql

FIXTURES = Path(__file__).resolve().parent.parent.parent / "fixtures"
STORE: dict = json.loads((FIXTURES / "ask.json").read_text())
PRESETS: list = json.loads((FIXTURES / "presets.json").read_text())
NUMERIC = ("TINYINT", "SMALLINT", "INTEGER", "BIGINT", "HUGEINT", "FLOAT", "DOUBLE", "DECIMAL")


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

    cursor = marts.execute(data.sql)
    kinds = {column[0].lower(): str(column[1]).upper() for column in cursor.description}
    rows = cursor.fetchall()
    assert 0 < len(rows) <= query.limit
    for role in ("x", "y", "series"):
        column = getattr(data.chart, role)
        assert column is None or column.lower() in kinds, f"chart.{role}"
    if data.chart.type != "table":
        assert kinds[data.chart.y.lower()].startswith(NUMERIC), "the y axis must be numeric"
    if data.chart.type == "scatter":
        assert kinds[data.chart.x.lower()].startswith(NUMERIC)
    assert len(data.title) <= 80 and (data.note is None or len(data.note) <= 240)


@pytest.mark.parametrize("key", sorted(STORE))
def test_every_trail_step_fails_the_way_it_says(key: str, marts: duckdb.DuckDBPyConnection) -> None:
    data = AskData.model_validate(STORE[key]["data"])
    assert len(data.trail) <= 4
    for step in data.trail:
        if step.stage == "validator":
            with pytest.raises(SqlRejected) as rejected:
                validate_sql(step.sql)
            assert str(rejected.value) == step.error
        else:
            # It got past the firewall, and then DuckDB said no.
            assert validate_sql(step.sql).sql == step.sql
            with pytest.raises(duckdb.Error) as failed:
                marts.execute(step.sql).fetchall()
            assert str(failed.value).strip().splitlines()[0] == step.error


def test_at_least_one_fixture_shows_the_retry_trail() -> None:
    stages = {step["stage"] for fixture in STORE.values() for step in fixture["data"]["trail"]}
    # Only a requirement while the samples are hand-written: a recorded run has whatever
    # trail really happened, which may be none.
    if all(fixture["placeholder"] for fixture in STORE.values()):
        assert stages == {"validator", "engine"}
