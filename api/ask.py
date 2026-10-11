"""Vercel Python function for POST /api/ask.

Vercel serves any ASGI `app` exported from a file under `api/`. The application itself
lives in `pipeline/app`, next to its tests; this file only puts that package on the
import path. `.vercelignore` keeps the rest of `pipeline/` (dbt, the ingest code, the
data snapshot) out of the deployment, so the function ships with four dependencies.

Locally the same app runs under uvicorn on port 8140 (`pnpm dev:api`) and `next dev`
proxies /api/ask to it.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "pipeline"))

from app.main import app  # noqa: E402

__all__ = ["app"]
