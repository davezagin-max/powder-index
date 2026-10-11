/**
 * The shape of `dashboard.json`, written by `pipeline/powder/export.py`.
 *
 * It is validated at runtime, not just typed: the same file is fetched from GitHub
 * Pages after each daily pipeline run, and a newer pipeline could publish a shape this
 * build does not understand. A file that fails here is ignored in favor of the bundled one.
 */
import { z } from "zod";

const numbers = z.array(z.number());
const gaps = z.array(z.number().nullable());

export const COMPONENT_KEYS = ["fresh_24h", "fresh_72h", "density", "cold", "base", "forecast"] as const;
export type ComponentKey = (typeof COMPONENT_KEYS)[number];

const Series = z.object({
  score: numbers,
  rank: numbers,
  new24: numbers,
  new72: numbers,
  depth: gaps,
  swe: gaps,
  season: numbers,
  density72: gaps,
  temp24: gaps,
  temp72: gaps,
  pFresh24: numbers,
  pFresh72: numbers,
  pDensity: numbers,
  pCold: numbers,
  pBase: numbers,
});
export type SeriesKey = keyof z.infer<typeof Series>;

const Station = z.object({
  id: z.string(),
  name: z.string(),
  lat: z.number(),
  lon: z.number(),
  elevFt: z.number(),
  distanceKm: z.number(),
  weight: z.number(),
  rationale: z.string(),
});

const Forecast = z.object({
  date: z.string(),
  updatedAt: z.string(),
  snow72: z.number(),
  day1: z.number(),
  day2: z.number(),
  day3: z.number(),
  precip72: z.number().nullable(),
  tempMin72: z.number().nullable(),
  tempMax72: z.number().nullable(),
  points: z.number().nullable(),
});

const Resort = z.object({
  id: z.string(),
  name: z.string(),
  area: z.string(),
  lat: z.number(),
  lon: z.number(),
  baseFt: z.number(),
  summitFt: z.number(),
  stationNames: z.string(),
  nearestStationKm: z.number(),
  stationElevFt: z.number(),
  proxy: z.enum(["on_mountain", "nearby", "regional"]),
  stations: z.array(Station).min(1),
  forecast: Forecast.nullable(),
  series: Series,
});

const Component = z.object({
  key: z.enum(COMPONENT_KEYS),
  label: z.string(),
  weight: z.number(),
  zeroAt: z.number(),
  fullAt: z.number(),
  unit: z.string(),
  inputColumn: z.string(),
  description: z.string(),
});

const Tier = z.object({ tier: z.string(), label: z.string(), minScore: z.number() });

const BestDay = z.object({
  date: z.string(),
  topScore: z.number(),
  topResortId: z.string(),
  topResortName: z.string(),
  maxNew24: z.number(),
  powderResorts: z.number(),
});

const Source = z.object({ mode: z.enum(["live", "snapshot"]), fetchedAt: z.string() });

export const DashboardSchema = z
  .object({
    generatedAt: z.string(),
    asOf: z.string(),
    firstDate: z.string(),
    sources: z.object({ snotel: Source, nws: Source }),
    dates: z.array(z.string()).min(1),
    resorts: z.array(Resort).min(1),
    components: z.array(Component).length(COMPONENT_KEYS.length),
    tiers: z.array(Tier).min(1),
    bestDays: z.array(BestDay),
  })
  .refine(
    (data) =>
      data.resorts.every((resort) =>
        Object.values(resort.series).every((values) => values.length === data.dates.length),
      ),
    { message: "every series must have one value per date" },
  );

export type Dashboard = z.infer<typeof DashboardSchema>;
export type Resort = z.infer<typeof Resort>;
export type Station = z.infer<typeof Station>;
export type Forecast = z.infer<typeof Forecast>;
export type ScoreComponent = z.infer<typeof Component>;
export type Tier = z.infer<typeof Tier>;
export type BestDay = z.infer<typeof BestDay>;

export const ManifestSchema = z.object({ generatedAt: z.string(), asOf: z.string() });
