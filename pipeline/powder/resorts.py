"""Resorts and their station mapping, read from the dbt seeds so there is one source of truth."""

from __future__ import annotations

import csv
from dataclasses import dataclass

from .paths import SEED_DIR


@dataclass(frozen=True)
class Resort:
    resort_id: str
    name: str
    latitude: float
    longitude: float


def load_resorts() -> list[Resort]:
    with (SEED_DIR / "resort_list.csv").open(newline="") as handle:
        return [
            Resort(
                row["resort_id"],
                row["resort_name"],
                float(row["latitude"]),
                float(row["longitude"]),
            )
            for row in csv.DictReader(handle)
        ]


def load_station_triplets() -> list[str]:
    """Every station any resort maps to, de-duplicated, in seed order."""
    with (SEED_DIR / "resort_stations.csv").open(newline="") as handle:
        seen: dict[str, None] = {}
        for row in csv.DictReader(handle):
            seen.setdefault(row["station_triplet"], None)
    return list(seen)
