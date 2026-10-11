"""Record real Claude runs for every preset in fixtures/presets.json.

    pnpm record                                   # from the repo root, or:
    cd pipeline && uv run python scripts/record.py [--budget 0.5] [--only storm]

Starts the Ask API with RECORD_FIXTURES=1 and ALLOW_SERVER_KEY=1, then plays the part of
the browser for each preset: post the question, run the SQL that comes back in DuckDB
against the published Parquet, and if the database rejects it, post again with the
error, up to two times. Each response overwrites the fixture of the same `demoId` in
fixtures/ask.json, so the last one (with the full retry trail) is what remains.

A recording is kept only if a visitor could use it: the query runs, returns rows, and
its chart can be drawn from them (`powder.answers.run_answer`, the same check the
fixture tests make). Otherwise the fixture that was there before is put back, so a bad
run can never replace a working demo answer or break the tests.

The key is read from the environment or a `.env` file one or two directories up, and
is never printed. Stops when the budget is reached.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import duckdb
import httpx

ROOT = Path(__file__).resolve().parent.parent
REPO = ROOT.parent
sys.path.insert(0, str(ROOT))

from app.ask import MAX_ENGINE_RETRIES  # noqa: E402
from powder.answers import UnfitAnswer, run_answer  # noqa: E402

FIXTURES = REPO / "fixtures"
PUBLIC_DATA = REPO / "public" / "data"
TABLES = ("resorts", "resort_daily", "powder_score")


def load_env() -> None:
    for candidate in (REPO / ".env.local", REPO / ".env", REPO.parent / ".env"):
        if os.environ.get("ANTHROPIC_API_KEY") or not candidate.exists():
            continue
        for line in candidate.read_text().splitlines():
            name, _, value = line.partition("=")
            if name.strip() == "ANTHROPIC_API_KEY" and value.strip():
                os.environ["ANTHROPIC_API_KEY"] = value.strip().strip("\"'")


def open_marts() -> duckdb.DuckDBPyConnection:
    db = duckdb.connect()
    for table in TABLES:
        db.execute(
            f"create table {table} as select * from read_parquet('{(PUBLIC_DATA / f'{table}.parquet').as_posix()}')"
        )
    return db


def record_preset(
    http: httpx.Client, db: duckdb.DuckDBPyConnection, base: str, preset: dict[str, Any]
) -> tuple[bool, float, dict[str, int], str]:
    """Returns (succeeded, dollars spent, token usage, one-line outcome)."""
    attempts: list[dict[str, str]] = []
    spent = 0.0
    usage: dict[str, int] = {}
    while True:
        response = http.post(base + preset["route"], json={**preset["body"], "attempts": attempts})
        payload = response.json()
        meta = payload.get("meta") or {}
        spent += meta.get("costUsd") or 0
        for name, count in (meta.get("usage") or {}).items():
            usage[name] = usage.get(name, 0) + count
        if not payload.get("ok"):
            return (
                False,
                spent,
                usage,
                (payload.get("error") or {}).get("message", f"HTTP {response.status_code}"),
            )
        if meta.get("mode") != "live":
            return False, spent, usage, "the API answered from a fixture; is the key set?"
        data = payload["data"]
        if data["kind"] != "query":
            return False, spent, usage, f"{data['kind']}: {data.get('reason')}"
        try:
            rows = run_answer(db, data["sql"], data["chart"], data["limit"])
        except UnfitAnswer as problem:
            return False, spent, usage, f"not usable as a demo answer: {problem}"
        except duckdb.Error as error:
            message = str(error).strip().splitlines()[0]
            if len(attempts) >= MAX_ENGINE_RETRIES:
                return (
                    False,
                    spent,
                    usage,
                    f"still failing after {MAX_ENGINE_RETRIES} retries: {message}",
                )
            attempts.append({"sql": data["sql"], "error": message})
            continue
        trail = [step["stage"] for step in data["trail"]]
        return (
            True,
            spent,
            usage,
            f"{rows} rows, {data['chart']['type']} chart, trail {trail or 'none'}",
        )


def read_fixture(demo_id: str) -> dict[str, Any] | None:
    return json.loads((FIXTURES / "ask.json").read_text()).get(demo_id)


def restore_fixture(demo_id: str, before: dict[str, Any] | None) -> None:
    """Undo whatever the API recorded for a preset whose run did not hold up."""
    path = FIXTURES / "ask.json"
    store = json.loads(path.read_text())
    if before is None:
        store.pop(demo_id, None)
    else:
        store[demo_id] = before
    path.write_text(json.dumps(dict(sorted(store.items())), indent=2) + "\n")


def patch_totals(demo_id: str, spent: float, usage: dict[str, int]) -> None:
    """A run that needed retries spans several requests; store the total, not the last one."""
    path = FIXTURES / "ask.json"
    store = json.loads(path.read_text())
    if demo_id in store and not store[demo_id].get("placeholder"):
        store[demo_id]["costUsd"] = spent
        store[demo_id]["usage"] = {**store[demo_id]["usage"], **usage}
        path.write_text(json.dumps(store, indent=2) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--budget", type=float, default=2.0)
    parser.add_argument("--port", type=int, default=8140)
    parser.add_argument("--only", default="")
    args = parser.parse_args()

    load_env()
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print(
            "ANTHROPIC_API_KEY is not set. Add it to ~/portfolio/.env, then re-run.",
            file=sys.stderr,
        )
        return 1

    presets = [
        p
        for p in json.loads((FIXTURES / "presets.json").read_text())
        if args.only in p["route"] or args.only in str(p["body"].get("demoId", ""))
    ]
    if not presets:
        print("No presets matched.", file=sys.stderr)
        return 1

    server = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app", "--port", str(args.port)],
        cwd=ROOT,
        env={**os.environ, "RECORD_FIXTURES": "1", "ALLOW_SERVER_KEY": "1"},
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    base = f"http://127.0.0.1:{args.port}"
    try:
        with httpx.Client(timeout=300) as http:
            for _ in range(120):
                try:
                    http.get(f"{base}/health", timeout=1)
                    break
                except httpx.TransportError:
                    time.sleep(0.25)
            else:
                print(f"The API did not start on port {args.port}.", file=sys.stderr)
                return 1
            db = open_marts()
            total, failed = 0.0, 0
            for preset in presets:
                demo_id = preset["body"]["demoId"]
                if total >= args.budget:
                    print(
                        f"Budget of ${args.budget:.2f} reached. Stopping before: {demo_id}",
                        file=sys.stderr,
                    )
                    failed += 1
                    break
                before = read_fixture(demo_id)
                ok, spent, usage, outcome = record_preset(http, db, base, preset)
                total += spent
                if ok:
                    patch_totals(demo_id, spent, usage)
                    print(f"recorded  {demo_id:<22} ${spent:.4f}  {outcome}")
                else:
                    failed += 1
                    restore_fixture(demo_id, before)
                    print(
                        f"FAILED    {demo_id:<22} ${spent:.4f}  {outcome} (kept the previous fixture)",
                        file=sys.stderr,
                    )
        print(f"\nTotal spent: ${total:.4f} across {len(presets)} preset(s). Failures: {failed}.")
        print("Now run `pnpm test` and `cd pipeline && uv run pytest -q` to check the recordings.")
        return 1 if failed else 0
    finally:
        server.terminate()


if __name__ == "__main__":
    raise SystemExit(main())
