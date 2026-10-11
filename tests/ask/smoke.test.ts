/**
 * Smoke test of the main path in demo mode: for every preset, replay the bundled answer
 * through the real run loop, execute its SQL in the same DuckDB-WASM engine the browser
 * uses, against the same Parquet files, and build the chart the page would draw.
 * No key, no network, no server.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildChartModel } from "@/lib/chart/model";
import { ASK_FIXTURES, ASK_HAS_PLACEHOLDERS, PRESETS } from "@/lib/ask/presets";
import { runAsk } from "@/lib/ask/run";
import { AskDataSchema } from "@/lib/ask/schema";
import { startEngine, type TestEngine } from "../helpers/duck";

let engine: TestEngine;
beforeAll(async () => {
  engine = await startEngine();
});
afterAll(() => engine?.close());

describe("presets and fixtures", () => {
  it("line up one to one, six to eight of them", () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(6);
    expect(PRESETS.length).toBeLessThanOrEqual(8);
    expect(new Set(PRESETS.map((preset) => preset.id))).toEqual(new Set(Object.keys(ASK_FIXTURES)));
    for (const preset of PRESETS) expect(ASK_FIXTURES[preset.id].data.question).toBe(preset.question);
  });

  it("match the answer schema and label samples honestly", () => {
    for (const [id, fixture] of Object.entries(ASK_FIXTURES)) {
      expect(AskDataSchema.safeParse(fixture.data).success, id).toBe(true);
      // A placeholder claims no recording time and no spend; a recording has both.
      if (fixture.placeholder) {
        expect(fixture.recordedAt, id).toBeNull();
        expect(fixture.costUsd, id).toBe(0);
      } else {
        expect(fixture.recordedAt, id).toBeTruthy();
      }
    }
    expect(ASK_HAS_PLACEHOLDERS).toBe(Object.values(ASK_FIXTURES).some((fixture) => fixture.placeholder));
  });
});

describe.each(PRESETS)("preset $id", (preset) => {
  it("answers in demo mode with real rows and a drawable chart", async () => {
    const post = vi.fn();
    const outcome = await runAsk(preset.question, preset.id, {
      apiKey: null,
      fixtures: ASK_FIXTURES,
      post,
      execute: engine.execute,
      signal: new AbortController().signal,
    });
    expect(post).not.toHaveBeenCalled();
    expect(outcome.status).toBe("answered");
    if (outcome.status !== "answered") return;

    const fixture = ASK_FIXTURES[preset.id];
    expect(outcome.meta.mode).toBe("demo");
    expect(outcome.meta.placeholder).toBe(fixture.placeholder);
    expect(outcome.result.rows.length).toBeGreaterThan(0);
    expect(outcome.result.rows.length).toBeLessThanOrEqual(outcome.data.limit!);

    const model = buildChartModel(outcome.result, outcome.data.chart!);
    // The chart the answer asked for is the chart that gets drawn: no silent fallback.
    expect(model.kind).toBe(outcome.data.chart!.type);
    if (model.kind === "bar" || model.kind === "line") {
      expect(model.series.length).toBeGreaterThan(0);
      expect(model.series.some((series) => series.values.some((value) => value !== null))).toBe(true);
      expect(model.folded).toBe(0);
    }
    if (model.kind === "scatter") expect(model.points.length).toBeGreaterThan(10);
  });

  it("has a retry trail whose engine failures really fail in this engine", () => {
    for (const step of ASK_FIXTURES[preset.id].data.trail) {
      if (step.stage !== "engine") continue;
      expect(() => engine.run(step.sql)).toThrowError(step.error);
    }
  });
});

describe("the headline answers", () => {
  it("rank Snowbird's February 19 first among the best days", () => {
    const result = engine.run(ASK_FIXTURES["best-days"].data.sql!);
    expect(result.columns.map((column) => column.name)).toEqual(["day", "powder_score"]);
    expect(result.rows[0]).toEqual(["Snowbird, Feb 19", 90.6]);
    expect(result.rows).toHaveLength(10);
  });

  it("return dates as ISO strings and counts as plain numbers", () => {
    const timeline = engine.run(ASK_FIXTURES["storm-timeline"].data.sql!);
    expect(timeline.columns[0]).toEqual({ name: "date", kind: "date" });
    expect(timeline.rows.map((row) => row[0]).slice(0, 2)).toEqual(["2026-02-12", "2026-02-13"]);
    const peak = timeline.rows.find((row) => row[0] === "2026-02-19")!;
    expect(peak.slice(1)).toEqual([33, 88, 10.6]);

    const counts = engine.run(ASK_FIXTURES["powder-day-count"].data.sql!);
    expect(counts.columns[1]).toEqual({ name: "powder_days", kind: "number" });
    expect(typeof counts.rows[0][1]).toBe("number");
  });
});
