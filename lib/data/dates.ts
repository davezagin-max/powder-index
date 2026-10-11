/**
 * Calendar dates as `YYYY-MM-DD` strings. Everything is done in UTC so a date never
 * shifts by a day in the visitor's time zone (the classic `new Date("2026-02-19")` bug).
 */
const DAY_MS = 86_400_000;

export function parseDate(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

export function toIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return toIso(parseDate(iso) + days * DAY_MS);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parseDate(to) - parseDate(from)) / DAY_MS);
}

/** A water year runs 1 October to 30 September and is named for the year it ends in. */
export function waterYear(iso: string): number {
  const [year, month] = iso.split("-").map(Number);
  return month >= 10 ? year + 1 : year;
}

/** "2025-26" for water year 2026. */
export function seasonLabel(year: number): string {
  return `${year - 1}-${String(year % 100).padStart(2, "0")}`;
}

const FORMATS = {
  long: { weekday: "long", month: "long", day: "numeric", year: "numeric" },
  medium: { month: "short", day: "numeric", year: "numeric" },
  short: { month: "short", day: "numeric" },
  month: { month: "short" },
  monthYear: { month: "short", year: "2-digit" },
} satisfies Record<string, Intl.DateTimeFormatOptions>;

const formatters = new Map<string, Intl.DateTimeFormat>();

export function formatDate(iso: string, style: keyof typeof FORMATS = "medium"): string {
  let formatter = formatters.get(style);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", { ...FORMATS[style], timeZone: "UTC" });
    formatters.set(style, formatter);
  }
  return formatter.format(parseDate(iso));
}

/** True for a well-formed, real calendar date. */
export function isIsoDate(text: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && toIso(parseDate(text)) === text;
}
