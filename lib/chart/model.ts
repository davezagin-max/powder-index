/**
 * Turns query rows plus the model's chart spec into something drawable.
 *
 * The model picks a chart before any rows exist, so its choice is a request, not a
 * guarantee. This module decides what can honestly be drawn: a y column that is not
 * numeric, a missing column, or more marks than a chart can carry all fall back to a
 * table, with the reason shown. Rows are never dropped silently.
 */
import type { ChartSpec } from "@/lib/ask/schema";
import { parseDate } from "@/lib/data/dates";
import { columnIndex, type Cell, type QueryResult } from "@/lib/duck/result";

/** The validated categorical palette has eight slots. A ninth series is never invented. */
export const MAX_SERIES = 8;
export const MAX_BARS = 60;
export const MAX_POINTS = 3000;
const OTHER = "Other";

const UNIT_SUFFIX: [RegExp, string][] = [
  [/_in$/, " (inches)"],
  [/_pct$/, " (%)"],
  [/_f$/, " (°F)"],
];

/**
 * A column name as a reader would say it: `season_snowfall_in` becomes "Season snowfall
 * (inches)". Display only; the SQL under every chart keeps the real name.
 */
export function readableColumn(name: string): string {
  let unit = "";
  let base = name;
  for (const [pattern, label] of UNIT_SUFFIX) {
    if (pattern.test(base)) {
      base = base.replace(pattern, "");
      unit = label;
      break;
    }
  }
  const words = base.replace(/_+/g, " ").replace(/(\d+)h\b/g, "$1 h").trim();
  if (!words) return name;
  return words.charAt(0).toUpperCase() + words.slice(1) + unit;
}

export interface Series {
  name: string;
  /** y per x position; null where this series has no row. */
  values: (number | null)[];
}

export type ChartModel =
  | { kind: "bar"; xLabel: string; yLabel: string; categories: string[]; series: Series[]; folded: number }
  | {
      kind: "line";
      xLabel: string;
      yLabel: string;
      xKind: "date" | "number" | "category";
      /** Numeric x positions (ms for dates, index for categories), ascending. */
      x: number[];
      xText: string[];
      series: Series[];
      folded: number;
    }
  | {
      kind: "scatter";
      xLabel: string;
      yLabel: string;
      xKind: "date" | "number";
      points: { x: number; y: number; label: string }[];
      dropped: number;
    }
  | { kind: "table"; reason: string | null };

const table = (reason: string | null): ChartModel => ({ kind: "table", reason });

function text(cell: Cell): string {
  return cell === null ? "(none)" : String(cell);
}

/**
 * Splits rows into at most MAX_SERIES named groups. With more, the largest by total
 * are kept and `folded` says how many were not. Bars sum the rest into an "Other"
 * group (which takes one of the eight slots); lines leave them out, because adding
 * unrelated series into one line would draw something that is not in the data.
 */
function groupSeries(
  rows: Cell[][],
  seriesAt: number,
  yAt: number,
  withOther: boolean,
): { keep: string[]; folded: number; nameOf: (row: Cell[]) => string } {
  if (seriesAt < 0) return { keep: [""], folded: 0, nameOf: () => "" };
  const totals = new Map<string, number>();
  for (const row of rows) {
    const name = text(row[seriesAt]);
    totals.set(name, (totals.get(name) ?? 0) + Math.abs(Number(row[yAt]) || 0));
  }
  const names = [...totals.keys()];
  if (names.length <= MAX_SERIES) return { keep: names, folded: 0, nameOf: (row) => text(row[seriesAt]) };
  const kept = new Set(
    [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, withOther ? MAX_SERIES - 1 : MAX_SERIES)
      .map(([name]) => name),
  );
  // Keep first-appearance order so a series keeps its color when the data is re-sorted.
  const keep = [...names.filter((name) => kept.has(name)), ...(withOther ? [OTHER] : [])];
  return {
    keep,
    folded: names.length - kept.size,
    nameOf: (row) => (kept.has(text(row[seriesAt])) ? text(row[seriesAt]) : OTHER),
  };
}

export function buildChartModel(result: QueryResult, spec: ChartSpec): ChartModel {
  if (spec.type === "table") return table(null);
  if (result.rows.length === 0) return table(null);

  const xAt = columnIndex(result, spec.x);
  const yAt = columnIndex(result, spec.y);
  const seriesAt = spec.series ? columnIndex(result, spec.series) : -1;
  if (xAt < 0) return table(`The chart asked for a column named "${spec.x}", which the result does not have.`);
  if (yAt < 0) return table(`The chart asked for a column named "${spec.y}", which the result does not have.`);
  if (spec.series && seriesAt < 0) {
    return table(`The chart asked for a column named "${spec.series}", which the result does not have.`);
  }
  if (result.columns[yAt].kind !== "number") {
    return table(`"${result.columns[yAt].name}" is not numeric, so it cannot be a y axis.`);
  }
  const xColumn = result.columns[xAt];
  const xLabel = xColumn.name;
  const yLabel = result.columns[yAt].name;
  const rows = result.rows.filter((row) => row[yAt] !== null && row[xAt] !== null);
  if (rows.length === 0) return table("Every row has an empty x or y value.");

  if (spec.type === "scatter") {
    if (xColumn.kind !== "number" && xColumn.kind !== "date") {
      return table(`A scatter plot needs a numeric x axis; "${xLabel}" is text.`);
    }
    const labelAt = seriesAt >= 0 ? seriesAt : result.columns.findIndex((c, i) => c.kind === "text" && i !== xAt);
    const points = rows.slice(0, MAX_POINTS).map((row) => ({
      x: xColumn.kind === "date" ? parseDate(String(row[xAt]).slice(0, 10)) : Number(row[xAt]),
      y: Number(row[yAt]),
      label: labelAt >= 0 ? text(row[labelAt]) : "",
    }));
    return { kind: "scatter", xLabel, yLabel, xKind: xColumn.kind, points, dropped: rows.length - points.length };
  }

  const groups = groupSeries(rows, seriesAt, yAt, spec.type === "bar");

  if (spec.type === "bar") {
    const categories: string[] = [];
    const position = new Map<string, number>();
    for (const row of rows) {
      const key = text(row[xAt]);
      if (!position.has(key)) {
        position.set(key, categories.length);
        categories.push(key);
      }
    }
    if (categories.length * groups.keep.length > MAX_BARS) {
      return table(`That is ${categories.length * groups.keep.length} bars, too many to read. Showing the table instead.`);
    }
    const series = groups.keep.map((name) => ({ name, values: categories.map((): number | null => null) }));
    const slot = new Map(groups.keep.map((name, index) => [name, index]));
    for (const row of rows) {
      const values = series[slot.get(groups.nameOf(row))!].values;
      const at = position.get(text(row[xAt]))!;
      // Several rows can land on one bar (the folded "Other" group); they add up.
      values[at] = (values[at] ?? 0) + Number(row[yAt]);
    }
    return { kind: "bar", xLabel, yLabel, categories, series, folded: groups.folded };
  }

  // Line.
  const xKind = xColumn.kind === "date" ? "date" : xColumn.kind === "number" ? "number" : "category";
  const keyOf = (row: Cell[]) => text(row[xAt]);
  const numeric = (row: Cell[]): number =>
    xKind === "date" ? parseDate(String(row[xAt]).slice(0, 10)) : xKind === "number" ? Number(row[xAt]) : 0;
  const order = new Map<string, { at: number; value: number; label: string }>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!order.has(key)) order.set(key, { at: order.size, value: numeric(row), label: key });
  }
  const sorted = [...order.values()];
  // Dates and numbers are placed by value; categories keep the order the query returned.
  if (xKind !== "category") sorted.sort((a, b) => a.value - b.value);
  const index = new Map(sorted.map((entry, i) => [entry.label, i]));
  if (sorted.length < 2) return table("A line needs at least two points.");
  const series = groups.keep.map((name) => ({ name, values: sorted.map((): number | null => null) }));
  const slot = new Map(groups.keep.map((name, i) => [name, i]));
  for (const row of rows) {
    const at = slot.get(groups.nameOf(row));
    if (at === undefined) continue;
    const point = index.get(keyOf(row))!;
    // Two rows at one point cannot both be drawn. Keeping the last would drop the other
    // without a word, so the table, which has every row, is shown instead.
    if (series[at].values[point] !== null) {
      return table(
        `Two rows share the same ${readableColumn(xLabel)} and series, so a line cannot show both. Showing the table instead.`,
      );
    }
    series[at].values[point] = Number(row[yAt]);
  }
  return {
    kind: "line",
    xLabel,
    yLabel,
    xKind,
    x: sorted.map((entry, i) => (xKind === "category" ? i : entry.value)),
    xText: sorted.map((entry) => entry.label),
    series,
    folded: groups.folded,
  };
}
