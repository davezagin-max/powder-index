"""NRCS SNOTEL daily data from the AWDB REST API.

Verified against the live service on 2026-10-11:
  GET https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/data
      ?stationTriplets=766:UT:SNTL,...&elements=SNWD,WTEQ,...&duration=DAILY
      &beginDate=YYYY-MM-DD&endDate=YYYY-MM-DD&periodRef=START

`periodRef` matters. Snow depth and SWE are instantaneous midnight readings, and with the
default (`END`) the value dated D is the reading at the END of day D. We ask for `START`,
so the value dated D is the reading at 00:00 on D: the morning report for D. Daily
temperature statistics (TAVG, TMIN, TMAX) describe calendar day D under either setting.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any

import httpx

from .fetch import get_json

BASE_URL = "https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1"

# element code -> (column name, unit the API must report)
ELEMENTS: dict[str, tuple[str, str]] = {
    "SNWD": ("snwd_in", "in"),  # snow depth
    "WTEQ": ("wteq_in", "in"),  # snow water equivalent
    "TOBS": ("tobs_f", "degF"),  # air temperature at the midnight observation
    "TAVG": ("tavg_f", "degF"),  # daily mean air temperature
    "TMIN": ("tmin_f", "degF"),
    "TMAX": ("tmax_f", "degF"),
}
COLUMNS = [column for column, _ in ELEMENTS.values()]


@dataclass(frozen=True)
class DailyRow:
    station_triplet: str
    date: str  # ISO date
    snwd_in: float | None = None
    wteq_in: float | None = None
    tobs_f: float | None = None
    tavg_f: float | None = None
    tmin_f: float | None = None
    tmax_f: float | None = None


@dataclass(frozen=True)
class Station:
    station_triplet: str
    station_name: str
    latitude: float
    longitude: float
    elevation_ft: float
    county: str


def parse_daily(payload: Any) -> list[DailyRow]:
    """Pivot the API's per-element series into one row per station and date.

    Raises ValueError when the payload has the wrong shape or an element comes back in
    an unexpected unit, so a silent upstream change cannot poison the marts.
    """
    if not isinstance(payload, list):
        raise ValueError("SNOTEL data payload is not a list of stations")
    table: dict[tuple[str, str], dict[str, float | None]] = {}
    for station in payload:
        triplet = station["stationTriplet"]
        for series in station.get("data", []):
            element = series["stationElement"]
            code = element["elementCode"]
            if code not in ELEMENTS:
                continue
            column, unit = ELEMENTS[code]
            if element.get("storedUnitCode") != unit:
                raise ValueError(
                    f"{triplet} {code} is in {element.get('storedUnitCode')!r}, expected {unit!r}"
                )
            for point in series.get("values", []):
                value = point.get("value")
                day = str(point["date"])[:10]
                date.fromisoformat(day)  # reject a malformed date early
                table.setdefault((triplet, day), {})[column] = (
                    None if value is None else float(value)
                )
    return [
        DailyRow(triplet, day, **values)  # type: ignore[arg-type]
        for (triplet, day), values in sorted(table.items())
    ]


def parse_stations(payload: Any) -> list[Station]:
    if not isinstance(payload, list):
        raise ValueError("SNOTEL station payload is not a list")
    return [
        Station(
            station_triplet=item["stationTriplet"],
            station_name=item["name"],
            latitude=float(item["latitude"]),
            longitude=float(item["longitude"]),
            elevation_ft=float(item["elevation"]),
            county=item.get("countyName") or "",
        )
        for item in sorted(payload, key=lambda item: item["stationTriplet"])
    ]


def fetch_daily(
    client: httpx.Client, triplets: list[str], begin: date, end: date, *, chunk: int = 5, **kw: Any
) -> list[DailyRow]:
    """Daily rows for every station, requested a few stations at a time."""
    rows: list[DailyRow] = []
    for start in range(0, len(triplets), chunk):
        payload = get_json(
            client,
            f"{BASE_URL}/data",
            params={
                "stationTriplets": ",".join(triplets[start : start + chunk]),
                "elements": ",".join(ELEMENTS),
                "duration": "DAILY",
                "beginDate": begin.isoformat(),
                "endDate": end.isoformat(),
                "periodRef": "START",
                "returnFlags": "false",
            },
            **kw,
        )
        rows.extend(parse_daily(payload))
    missing = set(triplets) - {row.station_triplet for row in rows}
    if missing:
        raise ValueError(f"SNOTEL returned no data for: {', '.join(sorted(missing))}")
    return rows


def fetch_stations(client: httpx.Client, triplets: list[str], **kw: Any) -> list[Station]:
    payload = get_json(
        client,
        f"{BASE_URL}/stations",
        params={"stationTriplets": ",".join(triplets), "returnStationElements": "false"},
        **kw,
    )
    stations = parse_stations(payload)
    missing = set(triplets) - {station.station_triplet for station in stations}
    if missing:
        raise ValueError(f"SNOTEL has no station metadata for: {', '.join(sorted(missing))}")
    return stations
