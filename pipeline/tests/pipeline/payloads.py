"""Trimmed copies of real API responses (fetched 2026-10-11), kept small for the tests."""

from __future__ import annotations

from typing import Any


def snotel_series(code: str, unit: str, values: list[tuple[str, float | None]]) -> dict[str, Any]:
    return {
        "stationElement": {
            "elementCode": code,
            "ordinal": 1,
            "durationName": "DAILY",
            "dataPrecision": 1,
            "storedUnitCode": unit,
            "originalUnitCode": unit,
            "derivedData": False,
        },
        "values": [
            {"date": day} if value is None else {"date": day, "value": value}
            for day, value in values
        ],
    }


# Snowbird, the mornings of 18 and 19 February 2026: 33 inches overnight.
SNOTEL_DAILY: list[dict[str, Any]] = [
    {
        "stationTriplet": "766:UT:SNTL",
        "data": [
            snotel_series("SNWD", "in", [("2026-02-18", 55), ("2026-02-19", 88)]),
            snotel_series("WTEQ", "in", [("2026-02-18", 16.6), ("2026-02-19", 20.1)]),
            snotel_series("TOBS", "degF", [("2026-02-18", 21.9), ("2026-02-19", 7.7)]),
            snotel_series("TAVG", "degF", [("2026-02-18", 16.0), ("2026-02-19", None)]),
            snotel_series("PREC", "in", [("2026-02-18", 24.0), ("2026-02-19", 26.7)]),
        ],
    }
]

SNOTEL_STATIONS: list[dict[str, Any]] = [
    {
        "stationTriplet": "766:UT:SNTL",
        "stationId": "766",
        "stateCode": "UT",
        "networkCode": "SNTL",
        "name": "Snowbird",
        "countyName": "Salt Lake",
        "elevation": 9170.0,
        "latitude": 40.56914,
        "longitude": -111.65852,
        "dataTimeZone": -8.0,
    }
]

NWS_POINT: dict[str, Any] = {
    "properties": {
        "gridId": "SLC",
        "gridX": 108,
        "gridY": 167,
        "forecastGridData": "https://api.weather.gov/gridpoints/SLC/108,167",
    }
}

NWS_GRID: dict[str, Any] = {
    "properties": {
        "updateTime": "2026-10-11T18:31:39+00:00",
        "gridId": "SLC",
        "gridX": 108,
        "gridY": 167,
        "snowfallAmount": {
            "uom": "wmoUnit:mm",
            "values": [
                {"validTime": "2026-10-13T06:00:00+00:00/PT6H", "value": 10.2},
                {"validTime": "2026-10-13T12:00:00+00:00/PT6H", "value": 99.1},
            ],
        },
        "quantitativePrecipitation": {
            "uom": "wmoUnit:mm",
            "values": [{"validTime": "2026-10-11T12:00:00+00:00/PT6H", "value": 11.684}],
        },
        "temperature": {
            "uom": "wmoUnit:degC",
            "values": [
                {"validTime": "2026-10-11T12:00:00-06:00/PT2H", "value": 5},
                {"validTime": "2026-10-11T16:00:00+00:00/P1DT1H", "value": None},
            ],
        },
    }
}
