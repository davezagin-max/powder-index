import httpx
import pytest

from powder.fetch import FetchError, backoff_seconds, get_json


def client_for(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_retries_a_503_then_succeeds_and_backs_off_exponentially() -> None:
    calls: list[int] = []
    waits: list[float] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(503) if len(calls) < 3 else httpx.Response(200, json={"ok": True})

    assert get_json(client_for(handler), "https://example.test/x", sleep=waits.append) == {
        "ok": True
    }
    assert len(calls) == 3
    # 1 s then 2 s, each with up to 0.25 s of jitter.
    assert 1.0 <= waits[0] <= 1.25
    assert 2.0 <= waits[1] <= 2.25


def test_a_404_is_not_retried() -> None:
    calls: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(404)

    with pytest.raises(FetchError, match="HTTP 404"):
        get_json(client_for(handler), "https://example.test/x", sleep=lambda _: None)
    assert len(calls) == 1


def test_gives_up_after_the_last_retry_and_says_why() -> None:
    calls: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        raise httpx.ConnectTimeout("too slow")

    with pytest.raises(FetchError, match=r"failed after 3 attempts \(ConnectTimeout"):
        get_json(client_for(handler), "https://example.test/x", retries=2, sleep=lambda _: None)
    assert len(calls) == 3


def test_retry_after_header_overrides_the_backoff() -> None:
    waits: list[float] = []
    responses = iter(
        [httpx.Response(429, headers={"retry-after": "7"}), httpx.Response(200, json=[1])]
    )

    assert get_json(
        client_for(lambda _: next(responses)), "https://example.test/x", sleep=waits.append
    ) == [1]
    assert waits == [7.0]


def test_a_non_json_body_counts_as_a_failure() -> None:
    with pytest.raises(FetchError, match="not JSON"):
        get_json(
            client_for(lambda _: httpx.Response(200, text="<html>maintenance</html>")),
            "https://example.test/x",
            retries=1,
            sleep=lambda _: None,
        )


def test_backoff_doubles_and_is_capped() -> None:
    assert [backoff_seconds(n) for n in (1, 2, 3, 4)] == [1.0, 2.0, 4.0, 8.0]
    assert backoff_seconds(10) == 20.0
