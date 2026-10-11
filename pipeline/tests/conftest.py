from collections.abc import Iterator
from pathlib import Path

import duckdb
import pytest

PUBLIC_DATA = Path(__file__).resolve().parent.parent.parent / "public" / "data"
TABLES = ("resorts", "resort_daily", "powder_score")


@pytest.fixture(scope="session")
def marts() -> Iterator[duckdb.DuckDBPyConnection]:
    """An in-memory DuckDB holding the three published tables, loaded from the same
    Parquet files the browser loads into DuckDB-WASM."""
    db = duckdb.connect()
    for table in TABLES:
        db.execute(
            f"create table {table} as select * from read_parquet('{(PUBLIC_DATA / f'{table}.parquet').as_posix()}')"
        )
    yield db
    db.close()
