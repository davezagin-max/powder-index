/**
 * One "Ask the data" run, from question to rows.
 *
 *   demo (no key):  preset fixture -> run its SQL in DuckDB -> done. No network.
 *   live (key):     POST /api/ask -> run the SQL -> on a DuckDB error, POST again with
 *                   the failed SQL and the error, at most MAX_ENGINE_RETRIES times.
 *
 * The network call and the SQL engine are passed in, so the whole loop, including
 * cancellation, is tested without a browser.
 */
import type { ApiMeta, ApiResponse, ErrorKind } from "@/lib/api";
import { ZERO_USAGE, addUsage } from "@/lib/config";
import { findFixture, type FixtureStore } from "@/lib/demo";
import type { QueryResult } from "@/lib/duck/result";
import { AskDataSchema, MAX_ENGINE_RETRIES, type AskData, type TrailStep } from "./schema";

export interface AskRequest {
  demoId?: string;
  question: string;
  attempts: { sql: string; error: string }[];
}

export type AskPhase =
  | { phase: "asking"; attempt: number }
  | { phase: "running"; sql: string }
  | { phase: "retrying"; attempt: number; error: string };

export type AskOutcome =
  /** The query ran. `result` holds the rows. */
  | { status: "answered"; data: AskData; result: QueryResult; trail: TrailStep[]; meta: ApiMeta }
  /** Claude said the data cannot answer this. */
  | { status: "declined"; data: AskData; trail: TrailStep[]; meta: ApiMeta }
  /** Every attempt was refused by the validator or by DuckDB. */
  | { status: "failed"; reason: string; trail: TrailStep[]; meta: ApiMeta | null }
  | { status: "error"; kind: ErrorKind; message: string; meta: ApiMeta | null }
  | { status: "cancelled" };

export interface AskDeps {
  apiKey: string | null;
  fixtures: FixtureStore<AskData>;
  /** POST /api/ask. Must honor `signal`. */
  post: (body: AskRequest, signal: AbortSignal) => Promise<ApiResponse<unknown>>;
  /** Run validated SQL. Rejects with the engine's message when the query fails. */
  execute: (sql: string) => Promise<QueryResult>;
  signal: AbortSignal;
  onPhase?: (phase: AskPhase) => void;
}

/** The first line of an engine error: the part worth showing and sending back. */
export function engineMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const line = text.trim().split("\n")[0] ?? "";
  return (line || "The query failed.").slice(0, 500);
}

function addMeta(total: ApiMeta | null, next: ApiMeta | undefined): ApiMeta | null {
  if (!next) return total;
  if (!total) return next;
  return { ...next, usage: addUsage(total.usage, next.usage), costUsd: total.costUsd + next.costUsd };
}

const NO_META: ApiMeta = {
  mode: "live",
  placeholder: false,
  recordedAt: null,
  model: null,
  usage: ZERO_USAGE,
  costUsd: 0,
};

export async function runAsk(question: string, demoId: string | undefined, deps: AskDeps): Promise<AskOutcome> {
  const { signal } = deps;
  if (signal.aborted) return { status: "cancelled" };

  // Demo mode: replay the bundled answer. The SQL still runs for real.
  if (!deps.apiKey) {
    const fixture = demoId ? findFixture(deps.fixtures, demoId) : null;
    if (!fixture) {
      return {
        status: "error",
        kind: "demo_miss",
        message: "Your own questions need an Anthropic key. Pick a preset, or add your key.",
        meta: null,
      };
    }
    const data = fixture.data;
    const meta: ApiMeta = {
      mode: "demo",
      placeholder: fixture.placeholder,
      recordedAt: fixture.recordedAt,
      model: fixture.model,
      usage: fixture.usage,
      costUsd: fixture.costUsd,
    };
    if (data.kind !== "query" || !data.sql) return { status: "declined", data, trail: data.trail, meta };
    deps.onPhase?.({ phase: "running", sql: data.sql });
    try {
      const result = await deps.execute(data.sql);
      if (signal.aborted) return { status: "cancelled" };
      return { status: "answered", data, result, trail: data.trail, meta };
    } catch (error) {
      if (signal.aborted) return { status: "cancelled" };
      return { status: "failed", reason: engineMessage(error), trail: data.trail, meta };
    }
  }

  // Live: the model writes SQL; a DuckDB error goes back to it, at most twice.
  const attempts: AskRequest["attempts"] = [];
  let meta: ApiMeta | null = null;
  let trail: TrailStep[] = [];
  for (;;) {
    deps.onPhase?.({ phase: "asking", attempt: attempts.length + 1 });
    const response = await deps.post({ ...(demoId ? { demoId } : {}), question, attempts }, signal);
    // Checked after every await: once the visitor cancels, nothing more is sent.
    if (signal.aborted) return { status: "cancelled" };
    meta = addMeta(meta, response.meta);
    if (!response.ok) {
      return { status: "error", kind: response.error.kind, message: response.error.message, meta };
    }
    const parsed = AskDataSchema.safeParse(response.data);
    if (!parsed.success) {
      return { status: "error", kind: "server", message: "The server sent an answer this page does not understand.", meta };
    }
    const data = parsed.data;
    trail = data.trail;
    if (data.kind === "declined") return { status: "declined", data, trail, meta: meta ?? NO_META };
    if (data.kind === "rejected" || !data.sql) {
      return { status: "failed", reason: data.reason ?? "The query was rejected.", trail, meta };
    }

    deps.onPhase?.({ phase: "running", sql: data.sql });
    try {
      const result = await deps.execute(data.sql);
      if (signal.aborted) return { status: "cancelled" };
      return { status: "answered", data, result, trail, meta: meta ?? NO_META };
    } catch (error) {
      if (signal.aborted) return { status: "cancelled" };
      const message = engineMessage(error);
      const failed: TrailStep = { sql: data.sql, error: message, stage: "engine" };
      if (attempts.length >= MAX_ENGINE_RETRIES) {
        return {
          status: "failed",
          reason: `DuckDB rejected the query ${attempts.length + 1} times. Try rephrasing the question.`,
          trail: [...trail, failed],
          meta,
        };
      }
      attempts.push({ sql: data.sql, error: message });
      deps.onPhase?.({ phase: "retrying", attempt: attempts.length + 1, error: message });
    }
  }
}
