"""Where the pipeline reads and writes. Everything is relative to `pipeline/`."""

from __future__ import annotations

import os
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = PIPELINE_DIR.parent
DBT_DIR = PIPELINE_DIR / "dbt"
SEED_DIR = DBT_DIR / "seeds"
SNAPSHOT_DIR = PIPELINE_DIR / "data" / "snapshot"
PUBLIC_DATA_DIR = REPO_DIR / "public" / "data"
ASK_SCHEMA_PATH = PIPELINE_DIR / "app" / "schema.json"


def database_path() -> Path:
    """The DuckDB file dbt builds into. `POWDER_DB` overrides it (tests use a temp file)."""
    return Path(os.environ.get("POWDER_DB") or PIPELINE_DIR / "data" / "powder.duckdb")
