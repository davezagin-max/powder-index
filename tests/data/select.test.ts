import { describe, expect, it } from "vitest";
import bundled from "@/public/data/dashboard.json";
import { addDays, daysBetween, formatDate, isIsoDate, seasonLabel, waterYear } from "@/lib/data/dates";
import {
  bestDaysSeason,
  clampIndex,
  dayIndex,
  inches,
  ranking,
  resortDay,
  seasons,
  seriesMax,
  summarize,
  tierFor,
  trailing,
} from "@/lib/data/select";
import { DashboardSchema } from "@/lib/data/types";

const data = DashboardSchema.parse(bundled);
const storm = dayIndex(data, "2026-02-19");
const latest = data.dates.length - 1;

describe("the bundled dashboard data", () => {
  it("matches the schema the page expects", () => {
    expect(data.resorts).toHaveLength(12);
    expect(data.dates[0]).toBe(data.firstDate);
    expect(data.dates.at(-1)).toBe(data.asOf);
    expect(data.dates.length).toBeGreaterThanOrEqual(365);
  });

  it("is rejected when a series is shorter than the date axis", () => {
    const broken = structuredClone(bundled);
    broken.resorts[0].series.score.pop();
    expect(DashboardSchema.safeParse(broken).success).toBe(false);
  });

  it("carries weights that sum to one and tiers in descending order", () => {
    expect(data.components.reduce((sum, c) => sum + c.weight, 0)).toBeCloseTo(1, 10);
    const thresholds = data.tiers.map((tier) => tier.minScore);
    expect(thresholds).toEqual([...thresholds].sort((a, b) => b - a));
  });
});

describe("dayIndex", () => {
  it("finds a date by arithmetic and rejects dates off the axis", () => {
    expect(data.dates[storm]).toBe("2026-02-19");
    expect(dayIndex(data, data.firstDate)).toBe(0);
    expect(dayIndex(data, data.asOf)).toBe(latest);
    expect(dayIndex(data, "2020-01-01")).toBe(-1);
    expect(dayIndex(data, addDays(data.asOf, 1))).toBe(-1);
    expect(clampIndex(data, -5)).toBe(0);
    expect(clampIndex(data, 99_999)).toBe(latest);
  });
});

describe("ranking", () => {
  const days = ranking(data, storm);

  it("orders resorts by the pipeline's rank on the best day of the season", () => {
    expect(days.map((day) => day.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(days[0].resort.id).toBe("snowbird");
    expect(days[0].score).toBe(90.6);
    expect(days[0].tier.tier).toBe("epic");
    expect(days[0].new24).toBe(33);
    expect(days[0].depth).toBe(88);
  });

  it("breaks the score into parts that add up to it exactly", () => {
    for (const day of days) {
      const total = day.components.reduce((sum, c) => sum + (c.points ?? 0), 0);
      expect(total).toBeCloseTo(day.score, 5);
    }
  });

  it("marks the forecast as unknown on a replayed day and rescales the other weights", () => {
    const snowbird = days[0];
    expect(snowbird.forecast).toBeNull();
    const forecast = snowbird.components.find((c) => c.key === "forecast")!;
    expect(forecast.points).toBeNull();
    expect(forecast.max).toBe(0);
    // 35% of the weight over the 90% that is known.
    expect(snowbird.components.find((c) => c.key === "fresh_24h")!.max).toBe(38.9);
    expect(snowbird.components.reduce((sum, c) => sum + c.max, 0)).toBeCloseTo(100, 0);
  });

  it("attaches the forecast only on the day it was made", () => {
    const alta = data.resorts.find((resort) => resort.id === "alta")!;
    const today = resortDay(data, alta, latest);
    expect(today.forecast?.date).toBe(data.asOf);
    expect(today.components.find((c) => c.key === "forecast")!.max).toBe(10);
    expect(today.components.find((c) => c.key === "fresh_24h")!.max).toBe(35);
    expect(resortDay(data, alta, latest - 1).forecast).toBeNull();
  });

  it("never ranks two resorts the same on any day", () => {
    for (let index = 0; index < data.dates.length; index += 17) {
      const ranks = ranking(data, index).map((day) => day.rank);
      expect(new Set(ranks).size).toBe(data.resorts.length);
    }
  });
});

describe("summarize", () => {
  it("recognizes a storm day", () => {
    const summary = summarize(ranking(data, storm));
    expect(summary.offSeason).toBe(false);
    expect(summary.withSnow).toBe(12);
    expect(summary.bestNew24).toEqual({ resort: "Snowbird", inches: 33 });
    expect(summary.bestForecast).toBeNull();
  });

  it("recognizes bare ground in the first September of the data", () => {
    const summary = summarize(ranking(data, 0));
    expect(summary.offSeason).toBe(true);
    expect(summary.withSnow).toBe(0);
    expect(summary.bestNew24).toBeNull();
  });
});

describe("helpers", () => {
  it("picks the highest tier a score clears", () => {
    expect(tierFor(data.tiers, 90.6).tier).toBe("epic");
    expect(tierFor(data.tiers, 75).tier).toBe("epic");
    expect(tierFor(data.tiers, 74.9).tier).toBe("powder");
    expect(tierFor(data.tiers, 15).tier).toBe("firm");
    expect(tierFor(data.tiers, 0).tier).toBe("off");
  });

  it("takes a trailing window that shortens at the start", () => {
    expect(trailing([1, 2, 3, 4, 5], 4, 3)).toEqual([3, 4, 5]);
    expect(trailing([1, 2, 3, 4, 5], 1, 3)).toEqual([1, 2]);
  });

  it("finds the water years in the data", () => {
    const found = seasons(data);
    expect(found.map((season) => season.waterYear)).toEqual([2025, 2026, 2027]);
    expect(data.dates[found[1].start]).toBe("2025-10-01");
    expect(data.dates[found[1].end]).toBe("2026-09-30");
  });

  it("names the season of the best days only when they share one", () => {
    expect(bestDaysSeason(data.bestDays)).toBe(2026);
    const nextWinter = { ...data.bestDays[0], date: "2027-01-14" };
    expect(bestDaysSeason([...data.bestDays, nextWinter])).toBeNull();
    // 30 September and 1 October are different water years.
    expect(bestDaysSeason([{ ...nextWinter, date: "2026-09-30" }, { ...nextWinter, date: "2026-10-01" }])).toBeNull();
    expect(bestDaysSeason([])).toBeNull();
  });

  it("reports the tallest value across resorts", () => {
    expect(seriesMax(data, "depth")).toBe(93);
    expect(seriesMax(data, "new24")).toBe(33);
  });

  it("formats inches without a trailing zero", () => {
    expect([inches(33), inches(4.5), inches(0), inches(null), inches(12.04)]).toEqual(["33", "4.5", "0", "–", "12"]);
  });
});

describe("dates", () => {
  it("does date arithmetic in UTC", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(daysBetween("2025-10-01", "2026-02-19")).toBe(141);
  });

  it("names water years for the year they end in", () => {
    expect(waterYear("2025-09-30")).toBe(2025);
    expect(waterYear("2025-10-01")).toBe(2026);
    expect(waterYear("2026-02-19")).toBe(2026);
    expect(seasonLabel(2026)).toBe("2025-26");
  });

  it("formats without shifting the day in any time zone", () => {
    expect(formatDate("2026-02-19", "long")).toBe("Thursday, February 19, 2026");
    expect(formatDate("2026-02-19", "short")).toBe("Feb 19");
    expect(formatDate("2026-01-01", "medium")).toBe("Jan 1, 2026");
  });

  it("validates ISO dates", () => {
    expect(isIsoDate("2026-02-19")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-2-19")).toBe(false);
    expect(isIsoDate("yesterday")).toBe(false);
  });
});
