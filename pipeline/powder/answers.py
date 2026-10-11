"""Is an "Ask the data" answer fit to be a demo fixture?

A fixture is replayed in a visitor's browser: its SQL runs in DuckDB-WASM and its chart
spec is drawn from the rows. `run_answer` does the same thing here, against the same
published tables, and refuses an answer a visitor could not use: one that returns
nothing, or asks for a chart its own columns cannot draw.

The recorder and the fixture tests both call it. That is what keeps the tests green
after real runs are recorded: a recording that would fail them is never written.
"""

from __future__ import annotations

from typing import Any

import duckdb

NUMERIC = ("TINYINT", "SMALLINT", "INTEGER", "BIGINT", "HUGEINT", "FLOAT", "DOUBLE", "DECIMAL")
TEMPORAL = ("DATE", "TIMESTAMP")


class UnfitAnswer(ValueError):
    """The query ran, but the answer would not make a usable demo."""


def run_answer(db: duckdb.DuckDBPyConnection, sql: str, chart: dict[str, Any], limit: int) -> int:
    """Run `sql` and check `chart` against the result. Returns the row count.

    A `duckdb.Error` is left to the caller: for the recorder it is not a verdict but the
    start of a retry, exactly as it is in the browser.
    """
    cursor = db.execute(sql)
    kinds = {column[0].lower(): str(column[1]).upper() for column in cursor.description}
    rows = cursor.fetchall()
    if not rows:
        raise UnfitAnswer("the query returned no rows")
    if len(rows) > limit:
        raise UnfitAnswer(f"the query returned {len(rows)} rows, over its limit of {limit}")
    for role in ("x", "y", "series"):
        column = chart.get(role)
        if column is not None and column.lower() not in kinds:
            raise UnfitAnswer(f'chart.{role} names "{column}", which the result does not have')
    if chart["type"] == "table":
        return len(rows)
    if not kinds[chart["y"].lower()].startswith(NUMERIC):
        raise UnfitAnswer(f'the y axis "{chart["y"]}" is not numeric')
    if chart["type"] == "scatter" and not kinds[chart["x"].lower()].startswith(NUMERIC + TEMPORAL):
        raise UnfitAnswer(f'a scatter plot needs a numeric or date x axis; "{chart["x"]}" is text')
    return len(rows)
