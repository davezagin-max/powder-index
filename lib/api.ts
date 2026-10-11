/**
 * The response envelope shared with the Python API (`pipeline/app/http.py`).
 * Types only: this app has no Node route handlers. The one Claude-backed endpoint,
 * /api/ask, is a Python function, so the route wrappers of the shared kit live there.
 */
import type { Usage } from "./config";

export type ErrorKind =
  | "invalid"
  | "too_large"
  | "rate_limit"
  | "auth"
  | "refusal"
  | "demo_miss"
  | "server";

export interface ApiMeta {
  mode: "live" | "demo";
  /** Demo data is a hand-written sample, not a recorded model run. */
  placeholder: boolean;
  recordedAt: string | null;
  model: string | null;
  usage: Usage;
  costUsd: number;
}

export type ApiResponse<D> =
  | { ok: true; data: D; meta: ApiMeta }
  | { ok: false; error: { kind: ErrorKind; message: string }; meta?: ApiMeta };
