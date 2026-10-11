"""Command line for the pipeline. Run from `pipeline/`:

uv run python -m powder ingest             # live pull, snapshot fallback, load into DuckDB
uv run python -m powder ingest --offline   # snapshot only (what CI uses)
uv run python -m powder build              # dbt build
uv run python -m powder export             # Parquet + JSON into ../public/data
uv run python -m powder run [--offline]    # all three, in order
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import ingest as ingest_module
from .paths import DBT_DIR, PUBLIC_DATA_DIR


def run_ingest(offline: bool, snapshot: bool) -> None:
    report = ingest_module.ingest(offline=offline)
    for name, item in report.items():
        note = f"  (live pull failed: {item.error})" if item.error else ""
        print(
            f"ingest  {name:<7} {item.source:<8} {item.rows:>6} rows  fetched {item.fetched_at}{note}"
        )
    if snapshot:
        ingest_module.update_snapshot()
        print("ingest  snapshot updated")
    for table, count in ingest_module.load_raw().items():
        print(f"load    raw.{table:<16} {count:>6} rows")


def run_dbt(*args: str) -> None:
    from dbt.cli.main import dbtRunner

    result = dbtRunner().invoke(
        [*args, "--project-dir", str(DBT_DIR), "--profiles-dir", str(DBT_DIR)]
    )
    if not result.success:
        raise SystemExit(1)


def run_export(out: Path) -> None:
    from .export import export

    for line in export(out):
        print(f"export  {line}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="powder", description=__doc__.splitlines()[0])
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("ingest", "run"):
        sub = commands.add_parser(name)
        sub.add_argument("--offline", action="store_true", help="use the committed snapshot only")
        sub.add_argument(
            "--update-snapshot", action="store_true", help="save a live pull as the snapshot"
        )
        if name == "run":
            sub.add_argument("--out", type=Path, default=PUBLIC_DATA_DIR)
    commands.add_parser("build")
    commands.add_parser("export").add_argument("--out", type=Path, default=PUBLIC_DATA_DIR)
    args = parser.parse_args(argv)

    if args.command in ("ingest", "run"):
        run_ingest(args.offline, args.update_snapshot)
    if args.command in ("build", "run"):
        run_dbt("build")
    if args.command in ("export", "run"):
        run_export(args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
