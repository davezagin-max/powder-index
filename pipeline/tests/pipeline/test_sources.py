import copy
from datetime import date

import httpx
import pytest

from powder import nws, snotel
from powder.resorts import Resort, load_resorts, load_station_triplets

from .payloads import NWS_GRID, NWS_POINT, SNOTEL_DAILY, SNOTEL_STATIONS


def test_snotel_series_are_pivoted_to_one_row_per_station_day() -> None:
    rows = snotel.parse_daily(SNOTEL_DAILY)
    assert [(row.date, row.snwd_in, row.wteq_in, row.tobs_f, row.tavg_f) for row in rows] == [
        ("2026-02-18", 55.0, 16.6, 21.9, 16.0),
        ("2026-02-19", 88.0, 20.1, 7.7, None),  # today's daily mean does not exist yet
    ]
    # Elements we did not ask for (PREC) are ignored, and the ones not returned stay null.
    assert rows[0].tmin_f is None


def test_snotel_rejects_a_unit_change() -> None:
    payload = copy.deepcopy(SNOTEL_DAILY)
    payload[0]["data"][0]["stationElement"]["storedUnitCode"] = "cm"
    with pytest.raises(ValueError, match="SNWD is in 'cm', expected 'in'"):
        snotel.parse_daily(payload)


def test_snotel_rejects_a_payload_that_is_not_a_station_list() -> None:
    with pytest.raises(ValueError, match="not a list"):
        snotel.parse_daily({"error": "service unavailable"})


def test_snotel_request_asks_for_start_of_day_readings_in_chunks() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        triplets = request.url.params["stationTriplets"].split(",")
        return httpx.Response(
            200, json=[{**SNOTEL_DAILY[0], "stationTriplet": t} for t in triplets]
        )

    client = httpx.Client(transport=httpx.MockTransport(handler))
    rows = snotel.fetch_daily(
        client,
        ["1:UT:SNTL", "2:UT:SNTL", "3:UT:SNTL"],
        date(2025, 9, 1),
        date(2026, 10, 11),
        chunk=2,
    )
    assert len(requests) == 2
    params = requests[0].url.params
    assert params["periodRef"] == "START"
    assert params["duration"] == "DAILY"
    assert params["elements"] == "SNWD,WTEQ,TOBS,TAVG,TMIN,TMAX"
    assert (params["beginDate"], params["endDate"]) == ("2025-09-01", "2026-10-11")
    assert {row.station_triplet for row in rows} == {"1:UT:SNTL", "2:UT:SNTL", "3:UT:SNTL"}


def test_snotel_fails_when_a_station_is_missing_from_the_response() -> None:
    client = httpx.Client(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json=SNOTEL_DAILY))
    )
    with pytest.raises(ValueError, match="no data for: 999:UT:SNTL"):
        snotel.fetch_daily(
            client, ["766:UT:SNTL", "999:UT:SNTL"], date(2026, 2, 18), date(2026, 2, 19)
        )


def test_station_metadata_is_parsed() -> None:
    (station,) = snotel.parse_stations(SNOTEL_STATIONS)
    assert (station.station_name, station.elevation_ft, station.county) == (
        "Snowbird",
        9170.0,
        "Salt Lake",
    )


@pytest.mark.parametrize(
    ("text", "hours"),
    [
        ("PT6H", 6),
        ("PT1H", 1),
        ("P1D", 24),
        ("P1DT6H", 30),
        ("P7DT13H", 181),
        ("PT30M", 0.5),
        ("PT2H30M", 2.5),
    ],
)
def test_iso_durations_become_hours(text: str, hours: float) -> None:
    assert nws.parse_duration_hours(text) == hours


@pytest.mark.parametrize("text", ["", "P", "6H", "PT", "P1M", "PT6S"])
def test_unsupported_durations_are_rejected(text: str) -> None:
    with pytest.raises(ValueError):
        nws.parse_duration_hours(text)


def test_gridpoint_periods_are_flattened_to_utc_rows() -> None:
    periods = nws.parse_gridpoint("alta", NWS_GRID)
    snow = [p for p in periods if p.element == "snowfallAmount"]
    assert [(p.valid_start, p.duration_hours, p.value) for p in snow] == [
        ("2026-10-13T06:00:00Z", 6, 10.2),
        ("2026-10-13T12:00:00Z", 6, 99.1),
    ]
    assert snow[0].grid_id == "SLC/108,167"
    assert snow[0].forecast_updated_at == "2026-10-11T18:31:39Z"
    # A local-time start is converted to UTC, and a null value is dropped.
    assert [(p.valid_start, p.value) for p in periods if p.element == "temperature"] == [
        ("2026-10-11T18:00:00Z", 5.0)
    ]


def test_gridpoint_rejects_a_unit_change_and_a_missing_series() -> None:
    wrong_unit = copy.deepcopy(NWS_GRID)
    wrong_unit["properties"]["snowfallAmount"]["uom"] = "wmoUnit:cm"
    with pytest.raises(ValueError, match="expected 'wmoUnit:mm'"):
        nws.parse_gridpoint("alta", wrong_unit)
    missing = copy.deepcopy(NWS_GRID)
    del missing["properties"]["temperature"]
    with pytest.raises(ValueError, match="no temperature series"):
        nws.parse_gridpoint("alta", missing)


def test_forecast_fetch_follows_the_grid_url_and_sends_a_user_agent() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=NWS_POINT if "/points/" in request.url.path else NWS_GRID)

    from powder.fetch import make_client

    client = make_client()
    client._transport = httpx.MockTransport(handler)  # keep the real default headers
    periods = nws.fetch_forecast(client, [Resort("alta", "Alta", 40.5884, -111.6386)])
    assert [request.url.path for request in seen] == [
        "/points/40.5884,-111.6386",
        "/gridpoints/SLC/108,167",
    ]
    assert all("powder-index" in request.headers["user-agent"] for request in seen)
    assert {p.resort_id for p in periods} == {"alta"}


def test_forecast_fetch_refuses_a_grid_url_on_another_host() -> None:
    point = {"properties": {"forecastGridData": "https://evil.example/gridpoints/SLC/1,1"}}
    client = httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, json=point)))
    with pytest.raises(ValueError, match="Unexpected NWS grid URL"):
        nws.fetch_forecast(client, [Resort("alta", "Alta", 40.5884, -111.6386)])


def test_seeds_define_twelve_resorts_and_every_mapped_station_once() -> None:
    resorts = load_resorts()
    triplets = load_station_triplets()
    assert len(resorts) == 12
    assert len({resort.resort_id for resort in resorts}) == 12
    assert len(triplets) == len(set(triplets)) == 13
    assert all(triplet.endswith(":UT:SNTL") for triplet in triplets)
