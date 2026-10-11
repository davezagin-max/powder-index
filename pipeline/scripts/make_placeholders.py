"""Write the hand-written placeholder fixtures for "Ask the data".

    cd pipeline && uv run python scripts/make_placeholders.py

There is no API key in this repo's history, so until `pnpm record` replaces them, demo
mode replays the answers defined below. They are written by hand, not by a model, and
every fixture says so (`"placeholder": true`); the UI labels them as samples.

What keeps them honest is that nothing here is typed into the fixture directly. Each
answer is pushed through the same code the live path uses:

  - the SQL goes through `validate_sql`, and the fixture stores the regenerated text;
  - the chart spec goes through `check_chart`;
  - the query is executed in DuckDB against the published Parquet and must return rows;
  - every failed attempt in a retry trail is really run, and the error stored is the
    one the validator or DuckDB actually produced.

A fixture that has since been recorded for real (placeholder false) is left alone.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import duckdb

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.ask import AskData, Chart, TrailStep, check_chart  # noqa: E402
from app.config import OPUS, Usage  # noqa: E402
from app.sqlguard import SqlRejected, validate_sql  # noqa: E402

FIXTURES = ROOT.parent / "fixtures"
PUBLIC_DATA = ROOT.parent / "public" / "data"

# Each preset: the question, the answer a careful analyst would write, and optionally
# the wrong turns that came first (to show the self-correction trail).
PRESETS: list[dict[str, Any]] = [
    {
        "id": "best-days",
        "question": "What were the ten best powder days last season?",
        "title": "Ten best powder days, winter 2025-26",
        "note": "Highest powder scores of water year 2026, one bar per resort and day.",
        "chart": {"type": "bar", "x": "day", "y": "powder_score", "series": None},
        "sql": """
            select resort_name || ', ' || strftime(date, '%b %-d') as day, powder_score
            from powder_score
            where water_year = 2026
            order by powder_score desc, resort_name
            limit 10
        """,
    },
    {
        "id": "season-totals",
        "question": "Which resort got the most snow last season?",
        "title": "Season snowfall by resort, winter 2025-26",
        "note": "Total estimated new snow for water year 2026. Station estimates read lower than a resort's own stake.",
        "chart": {"type": "bar", "x": "resort_name", "y": "season_snowfall_in", "series": None},
        "sql": """
            select resort_name, max(season_snowfall_in) as season_snowfall_in
            from resort_daily
            where water_year = 2026
            group by resort_name
            order by season_snowfall_in desc, resort_name
        """,
    },
    {
        "id": "depth-race",
        "question": "How did the snowpack build at Alta, Snowbird and Brighton over the winter?",
        "title": "Snow depth through winter 2025-26",
        "note": "Daily snow depth at the stations for three Cottonwood resorts, November through May.",
        "chart": {"type": "line", "x": "date", "y": "snow_depth_in", "series": "resort_name"},
        "sql": """
            select date, resort_name, snow_depth_in
            from resort_daily
            where resort_name in ('Alta', 'Snowbird', 'Brighton')
              and date between date '2025-11-01' and date '2026-05-31'
            order by date, resort_name
        """,
    },
    {
        "id": "cold-smoke",
        "question": "Is colder snow really lighter?",
        "title": "Storm-day snow density against air temperature",
        "note": "Each point is a resort day with at least 4 inches of new snow; density is percent water.",
        "chart": {"type": "scatter", "x": "temp_avg_24h_f", "y": "density_24h_pct", "series": None},
        "sql": """
            select temp_avg_24h_f, density_24h_pct, resort_name, date
            from resort_daily
            where new_snow_24h_in >= 4
              and density_24h_pct is not null
              and temp_avg_24h_f is not null
            order by temp_avg_24h_f
        """,
    },
    {
        "id": "monthly-cottonwoods",
        "question": "How much snow fell each month in the Cottonwood canyons?",
        "title": "Monthly snowfall in the Cottonwoods, winter 2025-26",
        "note": "New snow summed by month for the four Cottonwood resorts in water year 2026.",
        "chart": {"type": "bar", "x": "month", "y": "snowfall_in", "series": "resort_name"},
        "sql": """
            select strftime(date_trunc('month', d.date), '%b %Y') as month,
                   d.resort_name,
                   round(sum(d.new_snow_24h_in), 1) as snowfall_in
            from resort_daily as d
            join resorts as r on d.resort_id = r.resort_id
            where r.area like '%Cottonwood%'
              and d.water_year = 2026
              and d.date between date '2025-11-01' and date '2026-04-30'
            group by date_trunc('month', d.date), d.resort_name
            order by date_trunc('month', d.date), d.resort_name
        """,
    },
    {
        "id": "february-storm",
        "question": "Rank every resort for the February 19 storm.",
        "title": "The morning of February 19, 2026",
        "note": "Each resort's report for 19 February 2026, joined to its powder score.",
        "chart": {"type": "table", "x": "resort_name", "y": "powder_score", "series": None},
        "sql": """
            select s.rank, s.resort_name, d.new_snow_24h_in, d.new_snow_72h_in,
                   d.density_72h_pct, d.temp_avg_24h_f, s.powder_score, s.tier
            from powder_score as s
            join resort_daily as d on s.resort_id = d.resort_id and s.date = d.date
            where s.date = date '2026-02-19'
            order by s.rank
        """,
    },
    {
        "id": "powder-day-count",
        "question": "How many powder days did each resort have last season?",
        "title": "Powder days by resort, winter 2025-26",
        "note": "Days in water year 2026 with a powder score of 55 or more (tiers 'powder' and 'epic').",
        "chart": {"type": "bar", "x": "resort_name", "y": "powder_days", "series": None},
        "sql": """
            select resort_name, count(*) as powder_days
            from powder_score
            where water_year = 2026 and powder_score >= 55
            group by resort_name
            order by powder_days desc, resort_name
        """,
        # Two plausible wrong turns: a schema prefix (the firewall refuses it), then a
        # column that does not exist (DuckDB refuses it).
        "trail": [
            """
            select resort_name, count(*) as powder_days
            from marts.powder_score
            where season = 2026 and score >= 55
            group by resort_name
            order by powder_days desc
            """,
            """
            select resort_name, count(*) as powder_days
            from powder_score
            where season = 2026 and powder_score >= 55
            group by resort_name
            order by powder_days desc
            """,
        ],
    },
    {
        "id": "storm-timeline",
        "question": "Show the mid-February storm cycle at Snowbird day by day.",
        "title": "Snowbird, February 12 to 26, 2026",
        "note": "New snow in the 24 hours before each morning's reading at the Snowbird station.",
        "chart": {"type": "line", "x": "date", "y": "new_snow_24h_in", "series": None},
        "sql": """
            select date, new_snow_24h_in, snow_depth_in, density_24h_pct
            from resort_daily
            where resort_name = 'Snowbird'
              and date between date '2026-02-12' and date '2026-02-26'
            order by date
        """,
    },
]


def marts() -> duckdb.DuckDBPyConnection:
    db = duckdb.connect()
    for table in ("resorts", "resort_daily", "powder_score"):
        db.execute(
            f"create table {table} as select * from read_parquet('{(PUBLIC_DATA / f'{table}.parquet').as_posix()}')"
        )
    return db


def engine_error(error: duckdb.Error) -> str:
    """The first line of DuckDB's message: the part that is the same in every build."""
    return str(error).strip().splitlines()[0]


def failed_step(db: duckdb.DuckDBPyConnection, sql: str) -> TrailStep:
    """Run a wrong attempt for real and record who refused it and why."""
    raw = "\n".join(line.strip() for line in sql.strip().splitlines())
    try:
        query = validate_sql(raw)
    except SqlRejected as rejection:
        return TrailStep(sql=raw, error=str(rejection), stage="validator")
    try:
        db.execute(query.sql).fetchall()
    except duckdb.Error as error:
        return TrailStep(sql=query.sql, error=engine_error(error), stage="engine")
    raise SystemExit(f"A trail step was expected to fail but ran fine:\n{raw}")


def build(db: duckdb.DuckDBPyConnection, preset: dict[str, Any]) -> AskData:
    query = validate_sql(preset["sql"])
    chart: Chart = check_chart(preset["chart"], query)
    cursor = db.execute(query.sql)
    columns = [column[0].lower() for column in cursor.description]
    rows = cursor.fetchall()
    if not rows:
        raise SystemExit(f"{preset['id']}: the query returned no rows")
    for role in ("x", "y", "series"):
        column = getattr(chart, role)
        if column is not None and column.lower() not in columns:
            raise SystemExit(
                f"{preset['id']}: chart.{role} names a column the result does not have"
            )
    return AskData(
        kind="query",
        question=preset["question"],
        title=preset["title"],
        note=preset["note"],
        sql=query.sql,
        chart=chart,
        limit=query.limit,
        trail=[failed_step(db, sql) for sql in preset.get("trail", [])],
    )


def main() -> None:
    db = marts()
    path = FIXTURES / "ask.json"
    store: dict[str, Any] = json.loads(path.read_text()) if path.exists() else {}
    for preset in PRESETS:
        existing = store.get(preset["id"])
        if existing and not existing.get("placeholder", False):
            print(f"kept      {preset['id']}  (recorded {existing.get('recordedAt')})")
            continue
        data = build(db, preset)
        store[preset["id"]] = {
            "label": preset["id"],
            "placeholder": True,
            "recordedAt": None,
            "model": OPUS,
            "usage": Usage().as_dict(),
            "costUsd": 0,
            "data": data.model_dump(),
        }
        steps = f"  trail: {[step.stage for step in data.trail]}" if data.trail else ""
        print(f"wrote     {preset['id']}{steps}")
    wanted = {preset["id"] for preset in PRESETS}
    store = {key: value for key, value in sorted(store.items()) if key in wanted}
    FIXTURES.mkdir(exist_ok=True)
    path.write_text(json.dumps(store, indent=2) + "\n")
    presets = [
        {
            "route": "/api/ask",
            "body": {"demoId": p["id"], "question": p["question"], "attempts": []},
        }
        for p in PRESETS
    ]
    (FIXTURES / "presets.json").write_text(json.dumps(presets, indent=2) + "\n")
    print(
        f"{len(store)} fixtures in fixtures/ask.json, {len(presets)} presets in fixtures/presets.json"
    )


if __name__ == "__main__":
    main()
