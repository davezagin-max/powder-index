"""HTTP GET with a timeout and retries, for government APIs that are sometimes slow or down.

Retries cover what is worth retrying: connection errors, timeouts, 429, and 5xx. A 4xx
other than 429 is a bug in the request, so it fails at once. The wait doubles each time
(with jitter) and honors `Retry-After` when the server sends one.
"""

from __future__ import annotations

import random
import time
from collections.abc import Callable
from typing import Any

import httpx

USER_AGENT = "powder-index/0.1 (+https://github.com/davezagin-max/powder-index)"
RETRY_STATUS = frozenset({408, 425, 429, 500, 502, 503, 504})


class FetchError(RuntimeError):
    """A request that still failed after every retry."""


def backoff_seconds(attempt: int, *, base: float = 1.0, cap: float = 20.0) -> float:
    """Wait before retry number `attempt` (1-based): base * 2^(attempt-1), capped."""
    return min(cap, base * 2 ** (attempt - 1))


def get_json(
    client: httpx.Client,
    url: str,
    *,
    params: dict[str, str] | None = None,
    headers: dict[str, str] | None = None,
    retries: int = 3,
    sleep: Callable[[float], None] = time.sleep,
) -> Any:
    """GET `url` and decode JSON, retrying transient failures up to `retries` times."""
    last = "no attempt made"
    wait = 0.0
    for attempt in range(retries + 1):
        if attempt:
            sleep(wait)
        wait = backoff_seconds(attempt + 1) + random.uniform(0, 0.25)
        try:
            response = client.get(url, params=params, headers=headers)
        except httpx.TransportError as error:  # timeouts, DNS, refused, reset
            last = f"{type(error).__name__}: {error}"
            continue
        if response.status_code in RETRY_STATUS:
            last = f"HTTP {response.status_code}"
            retry_after = response.headers.get("retry-after", "")
            if retry_after.isdigit():
                wait = min(float(retry_after), 60.0)
            continue
        if response.status_code >= 400:
            raise FetchError(f"{url} returned HTTP {response.status_code}")
        try:
            return response.json()
        except ValueError:
            last = "response was not JSON"
            continue
    raise FetchError(f"{url} failed after {retries + 1} attempts ({last})")


def make_client(timeout: float = 30.0) -> httpx.Client:
    """A client with a hard timeout and the descriptive User-Agent api.weather.gov requires."""
    return httpx.Client(
        timeout=httpx.Timeout(timeout, connect=10.0),
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        follow_redirects=True,
    )
