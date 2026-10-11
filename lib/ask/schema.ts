/**
 * The answer contract for "Ask the data". Mirrors `AskData` in `pipeline/app/ask.py`:
 * the Python function produces it, fixtures store it, and the browser validates it
 * before running anything.
 */
import { z } from "zod";

export const CHART_TYPES = ["bar", "line", "scatter", "table"] as const;

export const ChartSpecSchema = z.object({
  type: z.enum(CHART_TYPES),
  x: z.string().min(1),
  y: z.string().min(1),
  series: z.string().nullable(),
});
export type ChartSpec = z.infer<typeof ChartSpecSchema>;

export const TrailStepSchema = z.object({
  sql: z.string(),
  error: z.string(),
  /** Who refused the query: the SQL firewall on the server, or DuckDB in the browser. */
  stage: z.enum(["validator", "engine"]),
});
export type TrailStep = z.infer<typeof TrailStepSchema>;

export const AskDataSchema = z
  .object({
    kind: z.enum(["query", "declined", "rejected"]),
    question: z.string(),
    title: z.string().nullable(),
    note: z.string().nullable(),
    sql: z.string().nullable(),
    chart: ChartSpecSchema.nullable(),
    limit: z.number().int().nullable(),
    trail: z.array(TrailStepSchema),
    reason: z.string().nullable(),
  })
  .refine((data) => data.kind !== "query" || (data.sql && data.chart && data.title && data.limit !== null), {
    message: "a query answer needs sql, chart, title and limit",
  });
export type AskData = z.infer<typeof AskDataSchema>;

/** The row cap the SQL firewall enforces (MAX_ROWS in pipeline/app/sqlguard.py). */
export const VALIDATOR_ROW_CAP = 5000;

/** Times the browser may send a DuckDB error back for another try. Matches the server. */
export const MAX_ENGINE_RETRIES = 2;
