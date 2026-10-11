"use client";

import { formatDate } from "@/lib/data/dates";
import { inches, type ResortDay } from "@/lib/data/select";
import type { Dashboard, ScoreComponent } from "@/lib/data/types";
import { COMPONENT_COLOR } from "@/lib/ui/colors";
import { HistoryChart } from "./HistoryChart";
import { TierBadge } from "./TierBadge";

const PROXY_TEXT = {
  on_mountain: "On the mountain",
  nearby: "Nearby",
  regional: "Regional signal only",
} as const;

/** The reading each component was scored from, in words. */
function reading(component: ScoreComponent, day: ResortDay): string {
  switch (component.key) {
    case "fresh_24h":
      return `${inches(day.new24)} in`;
    case "fresh_72h":
      return `${inches(day.new72)} in`;
    case "density":
      return day.density72 === null ? "no storm snow" : `${day.density72}% water`;
    case "cold":
      return day.temp72 === null ? "no reading" : `${day.temp72}°F, 3-day mean`;
    case "base":
      return `${inches(day.depth)} in`;
    case "forecast":
      return day.forecast ? `${inches(day.forecast.snow72)} in expected` : "not known for a replayed day";
  }
}

function Breakdown({ data, day }: { data: Dashboard; day: ResortDay }) {
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">
        How {day.resort.name}&apos;s score of {day.score} on {formatDate(day.date, "medium")} adds up
      </caption>
      <thead>
        <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
          <th scope="col" className="pb-1.5 font-medium">
            Component
          </th>
          <th scope="col" className="pb-1.5 font-medium">
            Reading
          </th>
          <th scope="col" className="pb-1.5 text-right font-medium">
            Points
          </th>
        </tr>
      </thead>
      <tbody>
        {data.components.map((component) => {
          const part = day.components.find((c) => c.key === component.key)!;
          const share = part.max > 0 ? ((part.points ?? 0) / part.max) * 100 : 0;
          return (
            <tr key={component.key} className="border-t border-border align-top">
              <th scope="row" className="py-2 pr-3 text-left font-normal">
                <span className="flex items-center gap-2">
                  <span aria-hidden className="size-2.5 shrink-0 rounded-[2px]" style={{ background: COMPONENT_COLOR[component.key] }} />
                  {component.label}
                </span>
                {/* Meter: the track is the most this component could add that day. */}
                <span aria-hidden className="mt-1.5 block h-1.5 w-full max-w-40 overflow-hidden rounded-full bg-surface-2">
                  <span className="block h-full rounded-full" style={{ width: `${share}%`, background: COMPONENT_COLOR[component.key] }} />
                </span>
              </th>
              <td className="py-2 pr-3 text-muted">{reading(component, day)}</td>
              <td className="tabular py-2 text-right">
                {part.points === null ? (
                  <span className="text-muted">–</span>
                ) : (
                  <>
                    <span className="font-semibold">{part.points.toFixed(1)}</span>
                    <span className="text-muted"> / {part.max.toFixed(1)}</span>
                  </>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr className="border-t border-border">
          <th scope="row" className="pt-2 text-left font-semibold">
            Powder score
          </th>
          <td />
          <td className="tabular pt-2 text-right">
            <span className="font-semibold">{day.score.toFixed(1)}</span>
            <span className="text-muted"> / 100</span>
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-muted">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

/** Everything about one resort: how the day's score adds up, where the numbers come from, and its season. */
export function ResortDetail({
  data,
  day,
  index,
  onDateChange,
  onSelect,
}: {
  data: Dashboard;
  day: ResortDay;
  index: number;
  onDateChange: (index: number) => void;
  onSelect: (resortId: string) => void;
}) {
  const { resort } = day;
  return (
    <section id="resort" aria-labelledby="resort-heading" className="rounded-lg border border-border bg-surface p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted">
            Rank {day.rank} of {data.resorts.length} on {formatDate(day.date, "medium")}
          </p>
          <h2 id="resort-heading" className="text-xl font-semibold tracking-tight">
            {resort.name}
          </h2>
          <p className="text-sm text-muted">{resort.area}</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-3xl font-semibold leading-none tracking-tight">{day.score.toFixed(0)}</p>
            <TierBadge tier={day.tier} className="mt-1" />
          </div>
          <div>
            <label htmlFor="resort-select" className="sr-only">
              Resort
            </label>
            <select
              id="resort-select"
              value={resort.id}
              onChange={(event) => onSelect(event.target.value)}
              className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
            >
              {data.resorts.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-x-10 gap-y-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <Breakdown data={data} day={day} />
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
            <Fact label="Base elevation">{resort.baseFt.toLocaleString("en-US")} ft</Fact>
            <Fact label="Summit">{resort.summitFt.toLocaleString("en-US")} ft</Fact>
            <Fact label="Season so far">{inches(day.season)} in</Fact>
            <Fact label="Snow water">{day.swe === null ? "–" : `${day.swe} in`}</Fact>
            <Fact label="Last 24 h">{day.temp24 === null ? "–" : `${day.temp24}°F mean`}</Fact>
            <Fact label="Station fit">{PROXY_TEXT[resort.proxy]}</Fact>
          </dl>
          <div className="rounded-md bg-surface-2 p-3 text-sm">
            <p className="font-medium">Measured at</p>
            <ul className="mt-1 flex flex-col gap-1 text-muted">
              {resort.stations.map((station) => (
                <li key={station.id}>
                  <span className="text-fg">{station.name}</span> SNOTEL, {station.elevFt.toLocaleString("en-US")} ft,{" "}
                  {station.distanceKm} km away
                  {resort.stations.length > 1 && `, weight ${Math.round(station.weight * 100)}%`}. {station.rationale}.
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted">
              A station is a stand-in for the resort, not its own stake. New snow is settled depth at midnight, so it
              reads lower than a resort&apos;s cleared-board total.
            </p>
          </div>
          {day.forecast && (
            <div className="text-sm">
              <p className="font-medium">National Weather Service forecast, next 72 hours</p>
              <p className="tabular mt-1 text-muted">
                {[day.forecast.day1, day.forecast.day2, day.forecast.day3]
                  .map((value, i) => `day ${i + 1}: ${inches(value)} in`)
                  .join(" · ")}
                {day.forecast.tempMin72 !== null && ` · low ${Math.round(day.forecast.tempMin72)}°F`}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 min-w-0 border-t border-border pt-5">
        <HistoryChart data={data} resort={resort} index={index} onChange={onDateChange} />
      </div>
    </section>
  );
}
