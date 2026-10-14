import { describe, expect, it } from "vitest";
import { MAX_SERIES, buildChartModel, readableColumn } from "@/lib/chart/model";
import type { Cell, Column, QueryResult } from "@/lib/duck/result";

function result(columns: Column[], rows: Cell[][]): QueryResult {
  return { columns, rows, elapsedMs: 1 };
}
const text = (name: string): Column => ({ name, kind: "text" });
const number = (name: string): Column => ({ name, kind: "number" });
const date = (name: string): Column => ({ name, kind: "date" });

describe("bar charts", () => {
  const snowfall = result(
    [text("resort_name"), number("season_snowfall_in")],
    [
      ["Snowbird", 244],
      ["Alta", 238.5],
      ["Sundance", 106.5],
    ],
  );

  it("keeps the query's row order, because the query sorted the bars", () => {
    const model = buildChartModel(snowfall, { type: "bar", x: "resort_name", y: "season_snowfall_in", series: null });
    expect(model).toMatchObject({
      kind: "bar",
      categories: ["Snowbird", "Alta", "Sundance"],
      series: [{ name: "", values: [244, 238.5, 106.5] }],
      folded: 0,
    });
  });

  it("finds columns without regard to case, as DuckDB does", () => {
    const model = buildChartModel(snowfall, { type: "bar", x: "RESORT_NAME", y: "Season_Snowfall_In", series: null });
    expect(model.kind).toBe("bar");
  });

  it("groups bars by a series column and leaves a gap where a group has no row", () => {
    const monthly = result(
      [text("month"), text("resort_name"), number("snowfall_in")],
      [
        ["Dec 2025", "Alta", 40],
        ["Dec 2025", "Brighton", 22],
        ["Jan 2026", "Alta", 55],
      ],
    );
    const model = buildChartModel(monthly, { type: "bar", x: "month", y: "snowfall_in", series: "resort_name" });
    expect(model).toMatchObject({
      kind: "bar",
      categories: ["Dec 2025", "Jan 2026"],
      series: [
        { name: "Alta", values: [40, 55] },
        { name: "Brighton", values: [22, null] },
      ],
    });
  });

  it("falls back to a table when there are too many bars to read", () => {
    const rows = Array.from({ length: 80 }, (_, i): Cell[] => [`day ${i}`, i]);
    const model = buildChartModel(result([text("day"), number("n")], rows), { type: "bar", x: "day", y: "n", series: null });
    expect(model).toEqual({ kind: "table", reason: "That is 80 bars, too many to read. Showing the table instead." });
  });
});

describe("line charts", () => {
  it("sorts dates and gives every series a value slot per date", () => {
    const depth = result(
      [date("date"), text("resort_name"), number("snow_depth_in")],
      [
        ["2026-02-19", "Alta", 79],
        ["2026-02-18", "Alta", 54],
        ["2026-02-18", "Snowbird", 55],
        ["2026-02-19", "Snowbird", 88],
        ["2026-02-20", "Snowbird", 82],
      ],
    );
    const model = buildChartModel(depth, { type: "line", x: "date", y: "snow_depth_in", series: "resort_name" });
    expect(model).toMatchObject({
      kind: "line",
      xKind: "date",
      xText: ["2026-02-18", "2026-02-19", "2026-02-20"],
      series: [
        { name: "Alta", values: [54, 79, null] },
        { name: "Snowbird", values: [55, 88, 82] },
      ],
    });
    if (model.kind !== "line") throw new Error("expected a line");
    expect(model.x[1] - model.x[0]).toBe(86_400_000);
  });

  it("keeps the eight largest series and reports how many it left out", () => {
    const rows: Cell[][] = [];
    for (let s = 0; s < 12; s++) {
      rows.push(["2026-01-01", `resort ${s}`, s + 1], ["2026-01-02", `resort ${s}`, s + 2]);
    }
    const model = buildChartModel(result([date("date"), text("resort"), number("v")], rows), {
      type: "line",
      x: "date",
      y: "v",
      series: "resort",
    });
    if (model.kind !== "line") throw new Error("expected a line");
    // A line never draws an "Other" series: summing unrelated lines would invent data.
    expect(model.series).toHaveLength(MAX_SERIES);
    expect(model.series.map((s) => s.name)).toEqual(["resort 4", "resort 5", "resort 6", "resort 7", "resort 8", "resort 9", "resort 10", "resort 11"]);
    expect(model.folded).toBe(4);
  });

  it("folds the smallest bar groups into Other, which takes the eighth slot", () => {
    const rows: Cell[][] = [];
    for (let s = 0; s < 10; s++) rows.push(["Jan", `resort ${s}`, s + 1]);
    const model = buildChartModel(result([text("month"), text("resort"), number("v")], rows), {
      type: "bar",
      x: "month",
      y: "v",
      series: "resort",
    });
    if (model.kind !== "bar") throw new Error("expected bars");
    expect(model.series.map((s) => s.name)).toEqual(["resort 3", "resort 4", "resort 5", "resort 6", "resort 7", "resort 8", "resort 9", "Other"]);
    expect(model.series.at(-1)!.values).toEqual([1 + 2 + 3]);
    expect(model.folded).toBe(3);
  });

  it("places text categories in the order the query returned them", () => {
    const model = buildChartModel(result([text("month"), number("v")], [["Nov", 3], ["Dec", 9], ["Jan", 7]]), {
      type: "line",
      x: "month",
      y: "v",
      series: null,
    });
    expect(model).toMatchObject({ kind: "line", xKind: "category", x: [0, 1, 2], xText: ["Nov", "Dec", "Jan"] });
  });
});

describe("scatter plots", () => {
  it("uses numeric x and y and labels points from the first text column", () => {
    const model = buildChartModel(
      result([number("temp_avg_24h_f"), number("density_24h_pct"), text("resort_name")], [[8.8, 8, "Eagle Point"], [31.2, 17.5, "Sundance"]]),
      { type: "scatter", x: "temp_avg_24h_f", y: "density_24h_pct", series: null },
    );
    expect(model).toEqual({
      kind: "scatter",
      xLabel: "temp_avg_24h_f",
      yLabel: "density_24h_pct",
      xKind: "number",
      points: [
        { x: 8.8, y: 8, label: "Eagle Point" },
        { x: 31.2, y: 17.5, label: "Sundance" },
      ],
      dropped: 0,
    });
  });

  it("refuses a text x axis", () => {
    const model = buildChartModel(result([text("resort"), number("v")], [["Alta", 1]]), { type: "scatter", x: "resort", y: "v", series: null });
    expect(model).toEqual({ kind: "table", reason: 'A scatter plot needs a numeric x axis; "resort" is text.' });
  });
});

describe("falling back to a table", () => {
  const rows = result([text("resort_name"), text("tier"), number("score")], [["Alta", "epic", 85.9]]);

  it("happens when the model asked for a table, with no excuse needed", () => {
    expect(buildChartModel(rows, { type: "table", x: "resort_name", y: "score", series: null })).toEqual({ kind: "table", reason: null });
  });

  it("explains a missing column", () => {
    expect(buildChartModel(rows, { type: "bar", x: "resort", y: "score", series: null })).toEqual({
      kind: "table",
      reason: 'The chart asked for a column named "resort", which the result does not have.',
    });
    expect(buildChartModel(rows, { type: "bar", x: "resort_name", y: "score", series: "area" }).kind).toBe("table");
  });

  it("explains a y axis that is not numeric", () => {
    expect(buildChartModel(rows, { type: "bar", x: "resort_name", y: "tier", series: null })).toEqual({
      kind: "table",
      reason: '"tier" is not numeric, so it cannot be a y axis.',
    });
  });

  it("handles an empty result and rows with nothing to plot", () => {
    expect(buildChartModel(result([text("a"), number("b")], []), { type: "bar", x: "a", y: "b", series: null })).toEqual({ kind: "table", reason: null });
    expect(buildChartModel(result([text("a"), number("b")], [["x", null]]), { type: "bar", x: "a", y: "b", series: null })).toEqual({
      kind: "table",
      reason: "Every row has an empty x or y value.",
    });
  });
});

describe("readableColumn", () => {
  it("names the measure in words, with its unit", () => {
    expect(readableColumn("season_snowfall_in")).toBe("Season snowfall (inches)");
    expect(readableColumn("density_24h_pct")).toBe("Density 24 h (%)");
    expect(readableColumn("temp_avg_72h_f")).toBe("Temp avg 72 h (°F)");
    expect(readableColumn("new_snow_24h_in")).toBe("New snow 24 h (inches)");
  });

  it("leaves unit-less names as words and never returns an empty label", () => {
    expect(readableColumn("powder_days")).toBe("Powder days");
    expect(readableColumn("month")).toBe("Month");
    expect(readableColumn("_in")).toBe("_in");
  });
});
