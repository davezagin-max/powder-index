"use client";

import { useMemo, useState } from "react";
import { useWidth } from "@/components/chart/useWidth";
import { areaPath, linePath, linear, niceTicks } from "@/lib/chart/scale";
import { formatDate } from "@/lib/data/dates";
import { inches, seriesMax } from "@/lib/data/select";
import type { Dashboard, Resort } from "@/lib/data/types";

const MARGIN = { left: 34, right: 10 };
const PANELS = [
  { key: "score", title: "Powder score", height: 96 },
  { key: "new24", title: "New snow in 24 hours (in)", height: 84 },
  { key: "depth", title: "Snow depth (in)", height: 96 },
] as const;
const TITLE = 26;
const GAP = 14;
const AXIS = 22;
/** Top edge of each panel's plot area, stacked with a title above and a gap below. */
const TOPS = PANELS.map((_, i) => PANELS.slice(0, i).reduce((sum, p) => sum + TITLE + p.height + GAP, TITLE));
const PLOT_BOTTOM = TOPS[TOPS.length - 1] + PANELS[PANELS.length - 1].height;
const HEIGHT = PLOT_BOTTOM + AXIS;

/**
 * A resort's season as three small charts on one time axis: score, new snow, and
 * depth. They are three panels rather than one because their units differ, and two
 * y-scales on one plot would suggest relationships that are artifacts of the scaling.
 * Depth and new snow use the same ceiling for every resort so resorts can be compared.
 */
export function HistoryChart({
  data,
  resort,
  index,
  onChange,
}: {
  data: Dashboard;
  resort: Resort;
  index: number;
  onChange: (index: number) => void;
}) {
  const [ref, width] = useWidth<HTMLDivElement>(760);
  const [hover, setHover] = useState<number | null>(null);
  const count = data.dates.length;
  const plotWidth = Math.max(width - MARGIN.left - MARGIN.right, 50);
  const x = linear([0, count - 1], [MARGIN.left, MARGIN.left + plotWidth]);
  const step = plotWidth / (count - 1);

  const ceilings = useMemo(
    () => ({ score: 100, new24: seriesMax(data, "new24"), depth: seriesMax(data, "depth") }),
    [data],
  );
  const months = useMemo(
    () =>
      data.dates
        .map((date, i) => ({ date, i }))
        .filter(({ date }) => date.endsWith("-01")),
    [data.dates],
  );

  const layout = PANELS.map((panel, i) => {
    const y0 = TOPS[i];
    const ticks = panel.key === "score" ? [0, 50, 100] : niceTicks(0, ceilings[panel.key], 3);
    return { ...panel, y0, ticks, y: linear([0, ticks[ticks.length - 1]], [y0 + panel.height, y0]) };
  });
  const height = HEIGHT;
  const plotBottom = PLOT_BOTTOM;

  const indexAt = (clientX: number, target: Element) => {
    const box = target.getBoundingClientRect();
    return Math.min(count - 1, Math.max(0, Math.round((clientX - box.left - MARGIN.left) / step)));
  };
  const shown = hover ?? index;
  const tooltipLeft = Math.min(Math.max(x(shown) - 78, 0), Math.max(width - 156, 0));

  return (
    <div
      ref={ref}
      className="relative w-full min-w-0 overflow-hidden rounded-sm"
      tabIndex={0}
      role="group"
      aria-label={`History for ${resort.name}. Use the left and right arrow keys to move the report date; hold Shift to move a week.`}
      onKeyDown={(event) => {
        const jump = event.shiftKey ? 7 : 1;
        if (event.key === "ArrowLeft") onChange(Math.max(0, index - jump));
        else if (event.key === "ArrowRight") onChange(Math.min(count - 1, index + jump));
        else if (event.key === "Home") onChange(0);
        else if (event.key === "End") onChange(count - 1);
        else return;
        event.preventDefault();
      }}
    >
      <svg width={width} height={height} className="block" aria-hidden>
        {months.map(({ date, i }) => (
          <g key={date}>
            <line x1={x(i)} x2={x(i)} y1={TITLE} y2={plotBottom} stroke="var(--grid)" strokeWidth={1} />
            {(step * 30 > 34 || Number(date.slice(5, 7)) % 2 === 0) && (
              <text x={x(i) + 3} y={plotBottom + 14} className="chart-text">
                {formatDate(date, date.slice(5, 7) === "01" ? "monthYear" : "month")}
              </text>
            )}
          </g>
        ))}

        {layout.map((panel) => {
          const values = resort.series[panel.key];
          const baseline = panel.y(0);
          return (
            <g key={panel.key}>
              <text x={0} y={panel.y0 - 12} className="chart-text-strong">
                {panel.title}
              </text>
              {panel.ticks.map((tick) => (
                <g key={tick}>
                  <line x1={MARGIN.left} x2={MARGIN.left + plotWidth} y1={panel.y(tick)} y2={panel.y(tick)} stroke={tick === 0 ? "var(--axis)" : "var(--grid)"} strokeWidth={1} />
                  <text x={MARGIN.left - 6} y={panel.y(tick) + 3.5} textAnchor="end" className="chart-text tabular">
                    {tick}
                  </text>
                </g>
              ))}
              {panel.key === "new24" ? (
                values.map((value, i) =>
                  value && value > 0 ? (
                    <rect key={i} x={x(i) - Math.max(step * 0.35, 0.75)} width={Math.max(step * 0.7, 1.5)} y={panel.y(value)} height={baseline - panel.y(value)} fill="var(--s1)" />
                  ) : null,
                )
              ) : (
                <>
                  <path d={areaPath(values.map((value, i) => ({ x: x(i), y: value === null ? null : panel.y(value) })), baseline)} fill="var(--s1)" opacity={0.12} />
                  <path d={linePath(values.map((value, i) => ({ x: x(i), y: value === null ? null : panel.y(value) })))} fill="none" stroke="var(--s1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                </>
              )}
              <circle cx={x(shown)} cy={panel.y(values[shown] ?? 0)} r={4} fill="var(--s1)" stroke="var(--surface)" strokeWidth={2} />
            </g>
          );
        })}

        {/* The report date, and a lighter line for the hovered day. */}
        <line x1={x(index)} x2={x(index)} y1={TITLE - 4} y2={plotBottom} stroke="var(--fg)" strokeWidth={1} />
        {hover !== null && hover !== index && (
          <line x1={x(hover)} x2={x(hover)} y1={TITLE - 4} y2={plotBottom} stroke="var(--muted)" strokeWidth={1} />
        )}
      </svg>

      {/* One pointer surface for all three panels: aim at a date, not at a 2px line. */}
      <div
        className="absolute left-0 top-0 w-full cursor-crosshair touch-pan-y"
        style={{ height }}
        onPointerMove={(event) => setHover(indexAt(event.clientX, event.currentTarget))}
        onPointerLeave={() => setHover(null)}
        onClick={(event) => onChange(indexAt(event.clientX, event.currentTarget))}
      />

      <div
        className="pointer-events-none absolute w-[156px] rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs shadow-sm"
        style={{ left: tooltipLeft, top: height + 4 }}
        aria-hidden
      >
        <p className="font-medium">{formatDate(data.dates[shown], "medium")}</p>
        <dl className="tabular mt-1 grid grid-cols-[1fr_auto] gap-x-3 text-muted">
          <dt>Score</dt>
          <dd className="font-semibold text-fg">{resort.series.score[shown].toFixed(0)}</dd>
          <dt>New snow, 24 h</dt>
          <dd className="font-semibold text-fg">{inches(resort.series.new24[shown])}″</dd>
          <dt>Depth</dt>
          <dd className="font-semibold text-fg">{inches(resort.series.depth[shown])}″</dd>
        </dl>
      </div>
      {/* Reserve room for the readout so it never covers what follows. */}
      <div style={{ height: 84 }} />
    </div>
  );
}
