"""The "Ask the data" API: one endpoint, POST /api/ask.

Deployed as a Vercel Python function (see `api/ask.py` at the repo root). Locally:

    cd pipeline && uv run uvicorn app.main:app --port 8140

and `pnpm dev` proxies /api/ask to it. Nothing else in the project needs this server:
the dashboard reads static files, and demo mode replays fixtures in the browser.
"""

from __future__ import annotations

import asyncio
import threading

import anthropic
from fastapi import Depends, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

from .ask import AskBody, answer_question
from .http import Live, RateLimiter, create_app, get_client, respond_json

app = create_app(
    "Powder Index: Ask the data",
    max_body_bytes=16 * 1024,
    default_origins=("http://localhost:3140", "http://127.0.0.1:3140"),
)
rate_limit = RateLimiter(limit=20, window_seconds=60)


@app.post("/api/ask", dependencies=[Depends(rate_limit)])
async def ask(
    body: AskBody, request: Request, client: anthropic.Anthropic | None = Depends(get_client)
) -> JSONResponse:
    """Demo mode replays a fixture by `demoId`. With a key, runs the model/validator loop.

    The loop can make up to three model calls on the visitor's key. If they navigate
    away or cancel, a watcher notices the dropped connection and the loop stops before
    its next call instead of finishing work nobody will see.
    """
    gone = threading.Event()

    async def watch() -> None:
        while not gone.is_set():
            if await request.is_disconnected():
                gone.set()
                return
            await asyncio.sleep(0.2)

    def live(live_client: anthropic.Anthropic) -> Live:
        return answer_question(live_client, body, is_cancelled=gone.is_set)

    watcher = asyncio.create_task(watch()) if client is not None else None
    try:
        return await run_in_threadpool(
            respond_json, "ask", body.model_dump(exclude_none=True), client, live
        )
    finally:
        if watcher is not None:
            watcher.cancel()
