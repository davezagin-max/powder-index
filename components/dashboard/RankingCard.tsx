"use client";

import { Sparkline } from "@/components/chart/Sparkline";
import { formatDate } from "@/lib/data/dates";
import { inches, trailing, type ResortDay } from "@/lib/data/select";
import { ScoreBar } from "./ScoreBar";
import { TierBadge } from "./TierBadge";

const PROXY_NOTE = {
  on_mountain: "station on the mountain",
  nearby: "station nearby",
  regional: "regional stations",
} as const;

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted">{label}</dt>
      <dd className="tabular text-sm font-semibold">
        {value}
        {value !== "–" && <span className="font-normal text-muted">{unit}</span>}
      </dd>
    </div>
  );
}

/** One resort on one day. The whole card is a button that opens its history below. */
export function RankingCard({
  day,
  index,
  selected,
  onSelect,
}: {
  day: ResortDay;
  index: number;
  selected: boolean;
  onSelect: (resortId: string) => void;
}) {
  const { resort } = day;
  const spark = trailing(resort.series.score, index, 30);
  const breakdown = day.components
    .filter((c) => (c.points ?? 0) > 0)
    .map((c) => `${c.label} ${c.points}`)
    .join(", ");
  return (
    <button
      type="button"
      onClick={() => onSelect(resort.id)}
      aria-pressed={selected}
      aria-label={`Rank ${day.rank}: ${resort.name}, powder score ${day.score}, ${day.tier.label}. ${
        breakdown ? `Points: ${breakdown}. ` : ""
      }${inches(day.new24)} inches in 24 hours, base ${inches(day.depth)} inches. Show history.`}
      className={`flex w-full flex-col gap-3 rounded-lg border bg-surface p-4 text-left transition-colors ${
        selected ? "border-accent ring-1 ring-accent" : "border-border hover:border-accent"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="tabular mt-0.5 w-5 shrink-0 text-right text-sm font-medium text-muted">{day.rank}</span>
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold leading-tight">{resort.name}</h3>
            <p className="truncate text-xs text-muted">
              {resort.area} · {PROXY_NOTE[resort.proxy]}
            </p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-2xl font-semibold leading-none tracking-tight">{day.score.toFixed(0)}</p>
          <TierBadge tier={day.tier} className="mt-1" />
        </div>
      </div>

      <ScoreBar components={day.components} />

      <div className="flex items-end justify-between gap-3">
        <dl className="grid grid-cols-3 gap-x-4">
          <Stat label="24 h" value={inches(day.new24)} unit="″" />
          <Stat label="72 h" value={inches(day.new72)} unit="″" />
          <Stat label="Base" value={inches(day.depth)} unit="″" />
        </dl>
        {day.forecast ? (
          <p className="text-right text-xs text-muted">
            <span className="tabular block text-sm font-semibold text-fg">{inches(day.forecast.snow72)}″</span>
            forecast, 72 h
          </p>
        ) : (
          <span title={`Powder score, 30 days to ${formatDate(day.date, "short")}`}>
            <Sparkline values={spark} max={100} />
          </span>
        )}
      </div>
    </button>
  );
}
