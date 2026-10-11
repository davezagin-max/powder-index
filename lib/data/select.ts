/**
 * Pure selectors over the dashboard data. The pipeline computes every number; these
 * functions only look values up and arrange them for display. Nothing here re-derives
 * a score, so the page cannot disagree with the marts.
 */
import { daysBetween, waterYear } from "./dates";
import type { ComponentKey, Dashboard, Forecast, Resort, ScoreComponent, Tier } from "./types";

const POINT_SERIES = {
  fresh_24h: "pFresh24",
  fresh_72h: "pFresh72",
  density: "pDensity",
  cold: "pCold",
  base: "pBase",
} as const;

export interface ComponentPoints {
  key: ComponentKey;
  label: string;
  /** Points this component contributes to the score, or null when it is unknown. */
  points: number | null;
  /** The most it could have contributed that day. */
  max: number;
}

export interface ResortDay {
  resort: Resort;
  date: string;
  score: number;
  rank: number;
  tier: Tier;
  new24: number;
  new72: number;
  depth: number | null;
  swe: number | null;
  density72: number | null;
  temp24: number | null;
  temp72: number | null;
  season: number;
  /** Only set on the day the forecast was made. */
  forecast: Forecast | null;
  components: ComponentPoints[];
}

/** Index of `date` on the shared axis, or -1. Dates are contiguous, so this is arithmetic. */
export function dayIndex(data: Dashboard, date: string): number {
  const index = daysBetween(data.dates[0], date);
  return data.dates[index] === date ? index : -1;
}

export function clampIndex(data: Dashboard, index: number): number {
  return Math.min(Math.max(index, 0), data.dates.length - 1);
}

/** The highest tier whose threshold the score clears. */
export function tierFor(tiers: Tier[], score: number): Tier {
  const sorted = [...tiers].sort((a, b) => b.minScore - a.minScore);
  return sorted.find((tier) => score >= tier.minScore) ?? sorted[sorted.length - 1];
}

export function resortDay(data: Dashboard, resort: Resort, index: number): ResortDay {
  const date = data.dates[index];
  const s = resort.series;
  const forecast = resort.forecast && resort.forecast.date === date ? resort.forecast : null;
  const forecastWeight = data.components.find((c) => c.key === "forecast")?.weight ?? 0;
  const known = forecast ? 1 : 1 - forecastWeight;
  const components = data.components.map((component: ScoreComponent): ComponentPoints => {
    const points =
      component.key === "forecast"
        ? (forecast?.points ?? null)
        : s[POINT_SERIES[component.key]][index];
    const available = component.key !== "forecast" || forecast !== null;
    return {
      key: component.key,
      label: component.label,
      points,
      max: available ? round1((100 * component.weight) / known) : 0,
    };
  });
  return {
    resort,
    date,
    score: s.score[index],
    rank: s.rank[index],
    tier: tierFor(data.tiers, s.score[index]),
    new24: s.new24[index],
    new72: s.new72[index],
    depth: s.depth[index],
    swe: s.swe[index],
    density72: s.density72[index],
    temp24: s.temp24[index],
    temp72: s.temp72[index],
    season: s.season[index],
    forecast,
    components,
  };
}

/** Every resort on one day, best first (the pipeline's rank, ties already broken). */
export function ranking(data: Dashboard, index: number): ResortDay[] {
  return data.resorts.map((resort) => resortDay(data, resort, index)).sort((a, b) => a.rank - b.rank);
}

export interface DaySummary {
  /** Resorts with snow on the ground (more than an inch). */
  withSnow: number;
  total: number;
  bestNew24: { resort: string; inches: number } | null;
  bestForecast: { resort: string; inches: number } | null;
  /** No snowpack to speak of anywhere: the off-season state. */
  offSeason: boolean;
}

export function summarize(days: ResortDay[]): DaySummary {
  const withSnow = days.filter((day) => (day.depth ?? 0) > 1).length;
  const byNew = [...days].sort((a, b) => b.new24 - a.new24)[0];
  const forecasts = days
    .filter((day) => day.forecast !== null)
    .sort((a, b) => (b.forecast?.snow72 ?? 0) - (a.forecast?.snow72 ?? 0));
  const topForecast = forecasts[0];
  return {
    withSnow,
    total: days.length,
    bestNew24: byNew && byNew.new24 > 0 ? { resort: byNew.resort.name, inches: byNew.new24 } : null,
    bestForecast:
      topForecast?.forecast && topForecast.forecast.snow72 > 0
        ? { resort: topForecast.resort.name, inches: topForecast.forecast.snow72 }
        : null,
    // An inch or less everywhere is bare ground, even if a dusting fell overnight.
    offSeason: withSnow === 0,
  };
}

/** The last `length` values ending at `index` (shorter at the start of the data). */
export function trailing<T>(values: T[], index: number, length: number): T[] {
  return values.slice(Math.max(0, index - length + 1), index + 1);
}

export interface Season {
  waterYear: number;
  start: number;
  end: number;
}

/** Index ranges of each water year present in the data. */
export function seasons(data: Dashboard): Season[] {
  const found: Season[] = [];
  data.dates.forEach((date, index) => {
    const year = waterYear(date);
    const last = found[found.length - 1];
    if (last && last.waterYear === year) last.end = index;
    else found.push({ waterYear: year, start: index, end: index });
  });
  return found;
}

/** The shared y-axis ceiling for a series across all resorts, so cards are comparable. */
export function seriesMax(data: Dashboard, key: "depth" | "new24" | "score"): number {
  let max = 0;
  for (const resort of data.resorts) {
    for (const value of resort.series[key]) if (value !== null && value > max) max = value;
  }
  return max;
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Inches with at most one decimal and no trailing ".0": 33, 4.5, 0. */
export function inches(value: number | null): string {
  if (value === null) return "–";
  return String(round1(value));
}
