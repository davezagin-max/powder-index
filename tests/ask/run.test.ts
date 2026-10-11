import { describe, expect, it, vi } from "vitest";
import type { ApiMeta, ApiResponse } from "@/lib/api";
import type { FixtureStore } from "@/lib/demo";
import type { QueryResult } from "@/lib/duck/result";
import { engineMessage, runAsk, type AskDeps, type AskPhase, type AskRequest } from "@/lib/ask/run";
import type { AskData } from "@/lib/ask/schema";

const ROWS: QueryResult = { columns: [{ name: "n", kind: "number" }], rows: [[12]], elapsedMs: 3 };

function answer(sql: string, extra: Partial<AskData> = {}): AskData {
  return {
    kind: "query",
    question: "How many resorts?",
    title: "Resorts",
    note: null,
    sql,
    chart: { type: "table", x: "n", y: "n", series: null },
    limit: 5000,
    trail: [],
    reason: null,
    ...extra,
  };
}

function live(data: AskData, costUsd = 0.01): ApiResponse<unknown> {
  const meta: ApiMeta = {
    mode: "live",
    placeholder: false,
    recordedAt: null,
    model: "claude-opus-5-5",
    usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    costUsd,
  };
  return { ok: true, data, meta };
}

const FIXTURES: FixtureStore<AskData> = {
  "count-resorts": {
    label: "count-resorts",
    placeholder: true,
    recordedAt: null,
    model: "claude-opus-5-5",
    usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    costUsd: 0,
    data: answer("SELECT COUNT(*) AS n FROM resorts LIMIT 5000"),
  },
};

function deps(overrides: Partial<AskDeps> = {}): AskDeps & { post: ReturnType<typeof vi.fn>; execute: ReturnType<typeof vi.fn> } {
  return {
    apiKey: "sk-ant-test-key-0000000000",
    fixtures: FIXTURES,
    post: vi.fn(async () => live(answer("SELECT 1 AS n LIMIT 5000"))),
    execute: vi.fn(async () => ROWS),
    signal: new AbortController().signal,
    ...overrides,
  } as AskDeps & { post: ReturnType<typeof vi.fn>; execute: ReturnType<typeof vi.fn> };
}

describe("demo mode (no key)", () => {
  it("replays a preset without touching the network, and still runs the SQL", async () => {
    const d = deps({ apiKey: null });
    const outcome = await runAsk("How many resorts?", "count-resorts", d);
    expect(d.post).not.toHaveBeenCalled();
    expect(d.execute).toHaveBeenCalledWith("SELECT COUNT(*) AS n FROM resorts LIMIT 5000");
    expect(outcome.status).toBe("answered");
    if (outcome.status !== "answered") return;
    expect(outcome.result).toBe(ROWS);
    // The label follows the fixture: a hand-written sample is never presented as a run.
    expect(outcome.meta).toMatchObject({ mode: "demo", placeholder: true, recordedAt: null, costUsd: 0 });
  });

  it("explains that a free-form question needs a key", async () => {
    const d = deps({ apiKey: null });
    const outcome = await runAsk("What about Jackson Hole?", undefined, d);
    expect(outcome).toMatchObject({ status: "error", kind: "demo_miss" });
    expect(d.post).not.toHaveBeenCalled();
    expect(d.execute).not.toHaveBeenCalled();
  });

  it("does not resolve inherited property names as presets", async () => {
    const outcome = await runAsk("x", "constructor", deps({ apiKey: null }));
    expect(outcome.status).toBe("error");
  });
});

describe("live mode", () => {
  it("asks once and runs the SQL that comes back", async () => {
    const phases: AskPhase[] = [];
    const d = deps({ onPhase: (phase) => phases.push(phase) });
    const outcome = await runAsk("How many resorts?", undefined, d);
    expect(outcome.status).toBe("answered");
    expect(d.post).toHaveBeenCalledTimes(1);
    expect(d.post.mock.calls[0][0]).toEqual({ question: "How many resorts?", attempts: [] });
    expect(phases.map((p) => p.phase)).toEqual(["asking", "running"]);
  });

  it("sends a DuckDB error back and accepts the corrected query", async () => {
    const bad = "SELECT season FROM resort_daily LIMIT 5000";
    const good = "SELECT water_year FROM resort_daily LIMIT 5000";
    const post = vi
      .fn<AskDeps["post"]>()
      .mockResolvedValueOnce(live(answer(bad), 0.01))
      .mockResolvedValueOnce(live(answer(good, { trail: [{ sql: bad, error: 'Binder Error: Referenced column "season" not found', stage: "engine" }] }), 0.02));
    const execute = vi
      .fn<AskDeps["execute"]>()
      .mockRejectedValueOnce(new Error('Binder Error: Referenced column "season" not found\n\nLINE 1: SELECT season'))
      .mockResolvedValueOnce(ROWS);
    const phases: AskPhase[] = [];
    const outcome = await runAsk("Which seasons?", "seasons", deps({ post, execute, onPhase: (p) => phases.push(p) }));

    expect(outcome.status).toBe("answered");
    const second = post.mock.calls[1][0] as AskRequest;
    expect(second).toEqual({
      demoId: "seasons",
      question: "Which seasons?",
      attempts: [{ sql: bad, error: 'Binder Error: Referenced column "season" not found' }],
    });
    expect(phases.map((p) => p.phase)).toEqual(["asking", "running", "retrying", "asking", "running"]);
    if (outcome.status !== "answered") return;
    expect(outcome.trail).toHaveLength(1);
    // Cost and tokens cover both requests.
    expect(outcome.meta.costUsd).toBeCloseTo(0.03, 10);
    expect(outcome.meta.usage.input_tokens).toBe(200);
  });

  it("gives up after two retries and keeps the whole trail", async () => {
    const post = vi.fn<AskDeps["post"]>(async (body) =>
      live(
        answer(`SELECT broken_${body.attempts.length} FROM resorts LIMIT 5000`, {
          trail: body.attempts.map((a) => ({ ...a, stage: "engine" as const })),
        }),
      ),
    );
    const execute = vi.fn<AskDeps["execute"]>(async () => {
      throw new Error("Binder Error: no such column");
    });
    const outcome = await runAsk("Hopeless?", undefined, deps({ post, execute }));
    expect(post).toHaveBeenCalledTimes(3);
    expect(execute).toHaveBeenCalledTimes(3);
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.reason).toBe("DuckDB rejected the query 3 times. Try rephrasing the question.");
    expect(outcome.trail.map((step) => step.sql)).toEqual([
      "SELECT broken_0 FROM resorts LIMIT 5000",
      "SELECT broken_1 FROM resorts LIMIT 5000",
      "SELECT broken_2 FROM resorts LIMIT 5000",
    ]);
    expect(outcome.meta?.costUsd).toBeCloseTo(0.03, 10);
  });

  it("stops making model calls the moment the visitor cancels", async () => {
    const controller = new AbortController();
    const post = vi.fn<AskDeps["post"]>(async () => live(answer("SELECT nope FROM resorts LIMIT 5000")));
    const execute = vi.fn<AskDeps["execute"]>(async () => {
      controller.abort(); // the visitor hits Stop while the first query is running
      throw new Error("Binder Error: no such column");
    });
    const outcome = await runAsk("Cancelled?", undefined, deps({ post, execute, signal: controller.signal }));
    expect(outcome).toEqual({ status: "cancelled" });
    expect(post).toHaveBeenCalledTimes(1); // no retry was sent on the visitor's key
  });

  it("does nothing at all when already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const d = deps({ signal: controller.signal });
    expect(await runAsk("x", undefined, d)).toEqual({ status: "cancelled" });
    expect(d.post).not.toHaveBeenCalled();
  });

  it("drops a response that arrives after cancelling", async () => {
    const controller = new AbortController();
    const post = vi.fn<AskDeps["post"]>(async () => {
      controller.abort();
      return live(answer("SELECT 1 AS n LIMIT 5000"));
    });
    const d = deps({ post, signal: controller.signal });
    expect(await runAsk("x", undefined, d)).toEqual({ status: "cancelled" });
    expect(d.execute).not.toHaveBeenCalled();
  });

  it("passes the abort signal to the request", async () => {
    const controller = new AbortController();
    const d = deps({ signal: controller.signal });
    await runAsk("x", undefined, d);
    expect(d.post.mock.calls[0][1]).toBe(controller.signal);
  });

  it("reports a declined question and a query the validator kept rejecting", async () => {
    const declined = answer("", { kind: "declined", sql: null, chart: null, title: null, limit: null, reason: "No lift ticket prices here." });
    const outcome = await runAsk("Ticket prices?", undefined, deps({ post: vi.fn(async () => live(declined)) }));
    expect(outcome).toMatchObject({ status: "declined", data: { reason: "No lift ticket prices here." } });

    const rejected = answer("", {
      kind: "rejected",
      sql: null,
      chart: null,
      title: null,
      limit: null,
      reason: "Claude's SQL was rejected by the validator 3 times.",
      trail: [{ sql: "select * from read_csv('x')", error: "Function read_csv() is not allowed.", stage: "validator" }],
    });
    const d = deps({ post: vi.fn(async () => live(rejected)) });
    const failed = await runAsk("Read a file", undefined, d);
    expect(failed).toMatchObject({ status: "failed", reason: "Claude's SQL was rejected by the validator 3 times." });
    expect(d.execute).not.toHaveBeenCalled();
  });

  it("surfaces API errors with what was spent", async () => {
    const error: ApiResponse<unknown> = { ok: false, error: { kind: "auth", message: "Anthropic rejected that API key." } };
    const outcome = await runAsk("x", undefined, deps({ post: vi.fn(async () => error) }));
    expect(outcome).toEqual({ status: "error", kind: "auth", message: "Anthropic rejected that API key.", meta: null });
  });

  it("refuses to run SQL from a response of the wrong shape", async () => {
    const d = deps({ post: vi.fn(async () => live({ kind: "query", sql: "SELECT 1" } as unknown as AskData)) });
    const outcome = await runAsk("x", undefined, d);
    expect(outcome).toMatchObject({ status: "error", kind: "server" });
    expect(d.execute).not.toHaveBeenCalled();
  });
});

describe("engineMessage", () => {
  it("keeps the first line of an engine error", () => {
    expect(engineMessage(new Error("Binder Error: nope\n\nLINE 1: select nope\n               ^"))).toBe("Binder Error: nope");
    expect(engineMessage("plain string")).toBe("plain string");
    expect(engineMessage(new Error(""))).toBe("The query failed.");
    expect(engineMessage(new Error("x".repeat(900)))).toHaveLength(500);
  });
});
