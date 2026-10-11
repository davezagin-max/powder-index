"use client";

import { formatDate, seasonLabel, waterYear } from "@/lib/data/dates";
import { dayIndex } from "@/lib/data/select";
import type { Dashboard } from "@/lib/data/types";

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <path
        d={direction === "left" ? "M10 3 5 8l5 5" : "M6 3l5 5-5 5"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const control =
  "inline-flex h-9 items-center justify-center rounded-md border border-border bg-surface text-sm hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40";

/**
 * Picks the report date. It is October for half the year as far as snow goes, so the
 * best days of the last full season are one click away.
 */
export function DateBar({
  data,
  index,
  onChange,
}: {
  data: Dashboard;
  index: number;
  onChange: (index: number) => void;
}) {
  const last = data.dates.length - 1;
  const date = data.dates[index];
  const isLatest = index === last;
  const season = data.bestDays[0] ? seasonLabel(waterYear(data.bestDays[0].date)) : null;

  return (
    <section aria-label="Report date" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-muted">
            {isLatest ? "Latest morning report" : "Replaying the morning of"}
          </p>
          <h2 className="text-xl font-semibold tracking-tight sm:text-2xl" aria-live="polite">
            {formatDate(date, "long")}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={`${control} w-9`}
            onClick={() => onChange(index - 1)}
            disabled={index === 0}
            aria-label="Previous day"
          >
            <Chevron direction="left" />
          </button>
          <label className="sr-only" htmlFor="report-date">
            Report date
          </label>
          <input
            id="report-date"
            type="date"
            value={date}
            min={data.dates[0]}
            max={data.dates[last]}
            onChange={(event) => {
              const next = dayIndex(data, event.target.value);
              if (next >= 0) onChange(next);
            }}
            className={`${control} tabular px-2.5`}
          />
          <button
            type="button"
            className={`${control} w-9`}
            onClick={() => onChange(index + 1)}
            disabled={isLatest}
            aria-label="Next day"
          >
            <Chevron direction="right" />
          </button>
          <button type="button" className={`${control} px-3`} onClick={() => onChange(last)} disabled={isLatest}>
            Latest
          </button>
        </div>
      </div>

      {data.bestDays.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p id="best-days-label" className="text-xs text-muted">
            Jump to a powder day{season ? ` from winter ${season}` : ""}
          </p>
          <ul aria-labelledby="best-days-label" className="flex flex-wrap gap-2">
            {data.bestDays.map((day) => {
              const target = dayIndex(data, day.date);
              const active = target === index;
              return (
                <li key={day.date}>
                  <button
                    type="button"
                    onClick={() => onChange(target)}
                    aria-pressed={active}
                    className={`flex items-baseline gap-2 rounded-md border px-3 py-1.5 text-left text-sm transition-colors ${
                      active
                        ? "border-accent bg-accent text-accent-fg"
                        : "border-border bg-surface hover:border-accent hover:bg-accent-soft"
                    }`}
                  >
                    <span className="font-semibold">{formatDate(day.date, "short")}</span>
                    <span className={`text-xs ${active ? "" : "text-muted"}`}>
                      {day.topResortName} {Math.round(day.topScore)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
