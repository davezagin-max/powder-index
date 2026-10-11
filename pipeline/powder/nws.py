"""National Weather Service gridpoint forecast from api.weather.gov.

Verified against the live service on 2026-10-11. Two steps per resort:
  GET https://api.weather.gov/points/{lat},{lon}      -> properties.forecastGridData
  GET https://api.weather.gov/gridpoints/{office}/{x},{y}

The API rejects requests without a descriptive User-Agent. Gridpoint series come as
`{"validTime": "2026-10-13T12:00:00+00:00/PT6H", "value": 99.1}`: a start instant and an
ISO 8601 duration. We keep the raw periods and let dbt prorate them into a 72-hour total.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import httpx

from .fetch import get_json
from .resorts import Resort

BASE_URL = "https://api.weather.gov"

# gridpoint property -> unit the API must report
ELEMENTS: dict[str, str] = {
    "snowfallAmount": "wmoUnit:mm",
    "quantitativePrecipitation": "wmoUnit:mm",
    "temperature": "wmoUnit:degC",
}

_DURATION = re.compile(r"^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$")


@dataclass(frozen=True)
class ForecastPeriod:
    resort_id: str
    grid_id: str
    element: str
    valid_start: str  # UTC, ISO 8601
    duration_hours: float
    value: float
    forecast_updated_at: str  # UTC, ISO 8601


def parse_duration_hours(text: str) -> float:
    """Hours in an ISO 8601 duration such as PT6H, P1DT6H or PT30M."""
    match = _DURATION.match(text)
    if not match or not any(match.groups()):
        raise ValueError(f"Unsupported ISO 8601 duration: {text!r}")
    days, hours, minutes = (int(part or 0) for part in match.groups())
    return days * 24 + hours + minutes / 60


def _utc(text: str) -> str:
    return datetime.fromisoformat(text).astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_gridpoint(resort_id: str, payload: Any) -> list[ForecastPeriod]:
    """Flatten the series we use into one row per element and period."""
    try:
        props = payload["properties"]
        grid_id = f"{props['gridId']}/{props['gridX']},{props['gridY']}"
        updated = _utc(props["updateTime"])
    except (KeyError, TypeError) as error:
        raise ValueError(f"NWS gridpoint payload for {resort_id} is missing {error}") from error
    periods: list[ForecastPeriod] = []
    for element, unit in ELEMENTS.items():
        series = props.get(element)
        if not series or not series.get("values"):
            raise ValueError(f"NWS gridpoint for {resort_id} has no {element} series")
        if series.get("uom") != unit:
            raise ValueError(f"NWS {element} is in {series.get('uom')!r}, expected {unit!r}")
        for point in series["values"]:
            if point.get("value") is None:
                continue
            start, _, duration = point["validTime"].partition("/")
            periods.append(
                ForecastPeriod(
                    resort_id=resort_id,
                    grid_id=grid_id,
                    element=element,
                    valid_start=_utc(start),
                    duration_hours=parse_duration_hours(duration),
                    value=float(point["value"]),
                    forecast_updated_at=updated,
                )
            )
    return periods


def fetch_forecast(client: httpx.Client, resorts: list[Resort], **kw: Any) -> list[ForecastPeriod]:
    """Forecast periods for every resort. Any failure fails the whole source, so a run
    never mixes fresh forecasts for some resorts with none for others."""
    periods: list[ForecastPeriod] = []
    headers = {"Accept": "application/geo+json"}
    for resort in resorts:
        point = get_json(
            client,
            f"{BASE_URL}/points/{resort.latitude:.4f},{resort.longitude:.4f}",
            headers=headers,
            **kw,
        )
        try:
            grid_url = point["properties"]["forecastGridData"]
        except (KeyError, TypeError) as error:
            raise ValueError(f"NWS points lookup for {resort.resort_id} has no grid URL") from error
        if not str(grid_url).startswith(f"{BASE_URL}/gridpoints/"):
            raise ValueError(f"Unexpected NWS grid URL for {resort.resort_id}")
        grid = get_json(client, grid_url, headers=headers, **kw)
        periods.extend(parse_gridpoint(resort.resort_id, grid))
    return periods
