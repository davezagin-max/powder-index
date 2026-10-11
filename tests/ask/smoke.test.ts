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
    if (model.kind === "bar" || model.kind === "line") {
      expect(model.series.length).toBeGreaterThan(0);
      expect(model.series.some((series) => series.values.some((value) => value !== null))).toBe(true);
    }
    // A hand-written sample has no excuse: the chart it asks for is the chart that gets
    // drawn, with nothing folded away. A recorded run is whatever the model really chose,
    // and the page's fallback to a table is a legitimate way to show it.
    if (fixture.placeholder) {
      expect(model.kind).toBe(outcome.data.chart!.type);
      if (model.kind === "bar" || model.kind === "line") expect(model.folded).toBe(0);
      if (model.kind === "scatter") expect(model.points.length).toBeGreaterThan(10);
    }
  });

  it("has a retry trail whose engine failures really fail in this engine", () => {
    const fixture = ASK_FIXTURES[preset.id];
    for (const step of fixture.data.trail) {
      if (step.stage !== "engine") continue;
      // Samples quote this engine's message exactly. A recording quotes the native DuckDB
      // the recorder ran, whose wording can differ from the WASM build's.
      if (fixture.placeholder) expect(() => engine.run(step.sql)).toThrowError(step.error);
      else expect(() => engine.run(step.sql)).toThrow();
    }
  });
});

// These pin the engine and the bundled data, not the fixtures, so the SQL is written out
// here: a recorded answer is free to phrase the same question differently.
describe("the engine on the bundled data", () => {
  it("ranks Snowbird's February 19 first among last season's best days", () => {
    const result = engine.run(
      "SELECT resort_name || ', ' || STRFTIME(date, '%b %-d') AS day, powder_score FROM powder_score " +
        "WHERE water_year = 2026 ORDER BY powder_score DESC, resort_name LIMIT 10",
    );
    expect(result.columns.map((column) => column.name)).toEqual(["day", "powder_score"]);
    expect(result.rows[0]).toEqual(["Snowbird, Feb 19", 90.6]);
    expect(result.rows).toHaveLength(10);
  });

  it("returns dates as ISO strings and counts as plain numbers", () => {
    const timeline = engine.run(
      "SELECT date, new_snow_24h_in, snow_depth_in, density_24h_pct FROM resort_daily " +
        "WHERE resort_name = 'Snowbird' AND date BETWEEN CAST('2026-02-12' AS DATE) AND CAST('2026-02-26' AS DATE) ORDER BY date",
    );
    expect(timeline.columns[0]).toEqual({ name: "date", kind: "date" });
    expect(timeline.rows.map((row) => row[0]).slice(0, 2)).toEqual(["2026-02-12", "2026-02-13"]);
    const peak = timeline.rows.find((row) => row[0] === "2026-02-19")!;
    expect(peak.slice(1)).toEqual([33, 88, 10.6]);

    const counts = engine.run(
      "SELECT resort_name, COUNT(*) AS powder_days FROM powder_score WHERE water_year = 2026 AND powder_score >= 55 " +
        "GROUP BY resort_name ORDER BY powder_days DESC, resort_name",
    );
    expect(counts.columns[1]).toEqual({ name: "powder_days", kind: "number" });
    expect(counts.rows[0]).toEqual(["Snowbird", 13]);
  });
});
