import json

import pytest
from fastapi import FastAPI, Response
from fastapi.testclient import TestClient

from app import demo
from app.claude_client import PipelineError
from app.http import Live, RateLimiter, get_client, respond_stream
from app.main import app, rate_limit
from tests.fakes import FakeClient, block, message

client = TestClient(app)


@pytest.fixture(autouse=True)
def fresh_state(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("ALLOW_SERVER_KEY", raising=False)
    monkeypatch.delenv("RECORD_FIXTURES", raising=False)
    rate_limit._windows.clear()
    yield
    app.dependency_overrides.clear()


def tool_turn(sql: str):
    call = block(
        "tool_use",
        id="t1",
        name="run_query",
        input={
            "sql": sql,
            "title": "Resorts",
            "chart": {"type": "table", "x": "resort_name", "y": "summit_elev_ft", "series": None},
            "note": "All resorts.",
        },
    )
    return message([block("thinking", thinking="", signature="s"), call], "tool_use")


def test_health() -> None:
    assert client.get("/health").json() == {"status": "ok"}


def test_demo_mode_replays_a_preset_without_a_key() -> None:
    fixture = demo.find_fixture("ask", "season-totals")
    assert fixture is not None
    res = client.post(
        "/api/ask",
        json={
            "demoId": "season-totals",
            "question": "Which resort got the most snow last season?",
            "attempts": [],
        },
    )
    body = res.json()
    assert res.status_code == 200 and body["ok"] is True
    assert body["meta"]["mode"] == "demo"
    # Follows the fixture, so this keeps passing once real runs are recorded.
    assert body["meta"]["placeholder"] is fixture["placeholder"]
    assert body["data"]["kind"] == "query"
    assert body["data"]["sql"] == fixture["data"]["sql"]


def test_demo_miss_is_explained() -> None:
    res = client.post("/api/ask", json={"question": "something nobody recorded"})
    assert res.status_code == 404
    assert res.json()["error"]["kind"] == "demo_miss"


def test_malformed_key_is_rejected_and_not_echoed() -> None:
    res = client.post(
        "/api/ask",
        json={"question": "deepest snow?"},
        headers={"x-anthropic-key": "definitely-not-a-key"},
    )
    assert res.status_code == 401
    assert res.json()["error"]["kind"] == "auth"
    assert "definitely-not-a-key" not in res.text


def test_unknown_route_and_wrong_method_use_the_standard_envelope() -> None:
    # Starlette raises its own HTTPException for these, not FastAPI's subclass.
    missing = client.get("/no-such-route")
    assert missing.status_code == 404
    assert missing.json() == {"ok": False, "error": {"kind": "invalid", "message": "Not Found"}}
    wrong_method = client.get("/api/ask")
    assert wrong_method.status_code == 405
    assert wrong_method.json() == {
        "ok": False,
        "error": {"kind": "invalid", "message": "Method Not Allowed"},
    }


def test_cors_allows_the_app_origin_and_no_other() -> None:
    preflight = {"Access-Control-Request-Method": "POST"}
    allowed = client.options(
        "/api/ask",
        headers={**preflight, "Origin": "http://localhost:3140"},
    )
    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-origin"] == "http://localhost:3140"
    other = client.options("/api/ask", headers={**preflight, "Origin": "https://evil.example"})
    assert other.status_code == 400
    assert "access-control-allow-origin" not in other.headers


def test_oversized_body_is_rejected() -> None:
    res = client.post("/api/ask", content=b'{"question":"' + b"a" * 20_000 + b'"}')
    assert res.status_code == 413


def test_oversized_chunked_body_is_cut_off_without_a_declared_length() -> None:
    # No Content-Length: the cap is enforced as the bytes arrive, not from the header.
    def chunks():
        yield b'{"question":"'
        for _ in range(40):
            yield b"a" * 512
        yield b'"}'

    res = client.post("/api/ask", content=chunks(), headers={"content-type": "application/json"})
    assert res.status_code == 413
    assert res.json() == {
        "ok": False,
        "error": {"kind": "too_large", "message": "Request body is too large."},
    }


def test_an_empty_key_header_is_no_key_and_gets_demo_mode() -> None:
    res = client.post(
        "/api/ask",
        json={"demoId": "season-totals", "question": "Which resort got the most snow last season?"},
        headers={"x-anthropic-key": ""},
    )
    assert res.status_code == 200
    assert res.json()["meta"]["mode"] == "demo"


@pytest.mark.parametrize(
    "payload",
    [
        {"question": "hi"},  # too short
        {"question": "x" * 401},
        {
            "question": "deepest snow?",
            "attempts": [{"sql": "select 1", "error": "e"}] * 3,
        },  # one retry too many
        {"question": "deepest snow?", "attempts": [{"sql": "", "error": "e"}]},
        {"attempts": []},
        {"demoId": "a" * 65, "question": "deepest snow?"},  # demoId capped at 64 characters
    ],
)
def test_invalid_bodies_get_the_standard_envelope(payload: dict) -> None:
    res = client.post("/api/ask", json=payload)
    assert res.status_code == 400
    assert res.json() == {
        "ok": False,
        "error": {"kind": "invalid", "message": "Request body has an invalid shape."},
    }


def test_live_path_runs_the_loop_and_reports_cost() -> None:
    fake = FakeClient(
        [tool_turn("select resort_name, summit_elev_ft from resorts order by summit_elev_ft desc")]
    )
    app.dependency_overrides[get_client] = lambda: fake
    res = client.post("/api/ask", json={"question": "List the resorts by summit elevation."})
    body = res.json()
    assert res.status_code == 200 and body["ok"] is True
    assert body["meta"]["mode"] == "live" and body["meta"]["placeholder"] is False
    assert body["meta"]["usage"]["input_tokens"] == 100
    assert body["meta"]["costUsd"] == pytest.approx((100 * 4 + 50 * 20) / 1_000_000)
    assert body["data"]["sql"].rstrip().endswith("LIMIT 5000")
    assert len(fake.requests) == 1


def test_live_refusal_maps_to_422() -> None:
    details = block("refusal", category="cyber", explanation="no")
    app.dependency_overrides[get_client] = lambda: FakeClient(
        [message([], "refusal", stop_details=details)]
    )
    res = client.post("/api/ask", json={"question": "deepest snow?"})
    assert res.status_code == 422
    assert res.json()["error"]["kind"] == "refusal"
    assert res.json()["meta"]["mode"] == "live"


def test_pipeline_errors_keep_their_message() -> None:
    app.dependency_overrides[get_client] = lambda: FakeClient([message([], "max_tokens")])
    res = client.post("/api/ask", json={"question": "deepest snow?"})
    assert res.status_code == 502
    assert "ran out of room" in res.json()["error"]["message"]
    assert PipelineError("x", 400).status == 400


def test_rate_limiter_blocks_after_the_limit() -> None:
    limiter = RateLimiter(limit=2, window_seconds=1)
    assert limiter.check("ip", now=0.0)
    assert limiter.check("ip", now=0.1)
    assert not limiter.check("ip", now=0.2)
    assert limiter.check("other", now=0.2)
    assert limiter.check("ip", now=1.5)


def test_the_endpoint_is_rate_limited() -> None:
    payload = {"demoId": "season-totals", "question": "Which resort got the most snow last season?"}
    statuses = [client.post("/api/ask", json=payload).status_code for _ in range(22)]
    assert statuses[:20] == [200] * 20 and statuses[20:] == [429, 429]


def test_request_key_prefers_a_safe_demo_id() -> None:
    assert demo.request_key({"demoId": "preset-1", "x": 1}) == "preset-1"
    unsafe = demo.request_key({"demoId": "../../etc/passwd"})
    assert unsafe != "../../etc/passwd" and len(unsafe) == 16
    assert demo.request_key({"a": 1, "b": 2}) == demo.request_key({"b": 2, "a": 1})


def test_stream_replays_recorded_events_in_order(monkeypatch: pytest.MonkeyPatch) -> None:
    fixture = {
        "placeholder": False,
        "recordedAt": "2026-10-11T00:00:00+00:00",
        "model": "claude-opus-5-5",
        "data": {"answer": "final"},
        "events": [{"at": 0, "event": {"step": 1}}, {"at": 5, "event": {"step": 2}}],
    }
    monkeypatch.setattr(demo, "find_fixture", lambda store, key: fixture)

    def live(*_: object) -> Live:
        raise AssertionError("the model must not be called in demo mode")

    stream_app = FastAPI()

    @stream_app.post("/stream")
    def stream() -> Response:
        return respond_stream("x", {"demoId": "p"}, None, live, replay_speed=100)

    res = TestClient(stream_app).post("/stream")
    assert res.headers["content-type"].startswith("text/event-stream")
    frames = [json.loads(c.removeprefix("data: ")) for c in res.text.split("\n\n") if c]
    assert [f["type"] for f in frames] == ["meta", "event", "event", "done"]
    assert frames[1]["event"] == {"step": 1}
    assert frames[3]["data"] == {"answer": "final"}
