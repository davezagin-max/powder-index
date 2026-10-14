"use client";

import { useState } from "react";
import { useWidth } from "@/components/chart/useWidth";
import { readableColumn, type ChartModel, type Series } from "@/lib/chart/model";
import { extent, fitBandLabels, formatNumber, linePath, linear, niceTicks } from "@/lib/chart/scale";
import { formatDate, toIso } from "@/lib/data/dates";
import { OTHER_COLOR, SERIES_COLORS } from "@/lib/ui/colors";

type BarModel = Extract<ChartModel, { kind: "bar" }>;
type LineModel = Extract<ChartModel, { kind: "line" }>;
type ScatterModel = Extract<ChartModel, { kind: "scatter" }>;

const colorOf = (series: Series, index: number) =>
  series.name === "Other" ? OTHER_COLOR : SERIES_COLORS[index % SERIES_COLORS.length];

/** A legend is shown whenever there are two or more series; one series is named by the title. */
function Legend({ series, mark }: { series: Series[]; mark: "line" | "box" }) {
  if (series.length < 2) return null;
  return (
    <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {series.map((item, index) => (
        <li key={item.name} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className={mark === "line" ? "h-0.5 w-3.5 rounded-full" : "size-2.5 rounded-[2px]"}
            style={{ background: colorOf(item, index) }}
          />
          {item.name}
        </li>
      ))}
    </ul>
  );
}

function Tip({ left, top, width, children }: { left: number; top: number; width: number; children: React.ReactNode }) {
  const box = 176;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-10 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs shadow-md"
      style={{ left: Math.min(Math.max(left + 12, 0), Math.max(width - box, 0)), top, width: box }}
    >
      {children}
    </div>
  );
}

function axisLabel(model: LineModel | ScatterModel, value: number, text?: string): string {
  if (model.xKind === "date") return formatDate(toIso(value), "short");
  if (model.kind === "line" && model.xKind === "category") return text ?? "";
  return formatNumber(value);
}

// ---------------------------------------------------------------------------------------
// One series of bars: horizontal rows, because category labels are words, not ticks.
// ---------------------------------------------------------------------------------------
function BarRows({ model }: { model: BarModel }) {
  const values = model.series[0].values;
  const range = extent([0, ...values]) ?? [0, 1];
  const ticks = niceTicks(range[0], range[1], 4);
  const position = linear([ticks[0], ticks[ticks.length - 1]], [0, 100]);
  const zero = position(0);
  return (
    <div className="flex flex-col gap-1.5">
      <ul className="grid grid-cols-[fit-content(42%)_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 text-sm">
        {model.categories.map((category, index) => {
          const value = values[index];
          const end = value === null ? zero : position(value);
          const positive = (value ?? 0) >= 0;
          return (
            <li key={category} className="contents">
              <span className="truncate text-right" title={category}>
                {category}
              </span>
              <span className="relative h-3.5">
                <span className="absolute inset-y-0 w-px bg-axis" style={{ left: `${zero}%` }} />
                <span
                  className="absolute inset-y-0"
                  title={`${category}: ${value === null ? "no value" : formatNumber(value)}`}
                  style={{
                    left: `${Math.min(zero, end)}%`,
                    width: `${Math.abs(end - zero)}%`,
                    background: "var(--s1)",
                    borderRadius: positive ? "0 4px 4px 0" : "4px 0 0 4px",
                  }}
                />
              </span>
              <span className="tabular text-right font-medium">{value === null ? "–" : formatNumber(value)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Several series: grouped columns.
// ---------------------------------------------------------------------------------------
function GroupedBars({ model, width }: { model: BarModel; width: number }) {
  const margin = { left: 40, right: 8, top: 8, bottom: 26 };
  const height = 280;
  const range = extent([0, ...model.series.flatMap((s) => s.values)]) ?? [0, 1];
  const ticks = niceTicks(range[0], range[1], 4);
  const y = linear([ticks[0], ticks[ticks.length - 1]], [height - margin.bottom, margin.top]);
  const band = (width - margin.left - margin.right) / model.categories.length;
  const gap = 2;
  const bar = Math.min(24, Math.max(3, (band * 0.8 - gap * (model.series.length - 1)) / model.series.length));
  const group = bar * model.series.length + gap * (model.series.length - 1);
  // On a phone six month names do not fit side by side; shorten or thin them out.
  const labels = fitBandLabels(model.categories, band);
  return (
    <>
      <Legend series={model.series} mark="box" />
      <svg width={width} height={height} role="img" aria-label={`Grouped bar chart of ${readableColumn(model.yLabel)} by ${readableColumn(model.xLabel)}. The table view has the same numbers.`} className="block">
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} stroke={tick === 0 ? "var(--axis)" : "var(--grid)"} strokeWidth={1} />
            <text x={margin.left - 6} y={y(tick) + 3.5} textAnchor="end" className="chart-text tabular">
              {formatNumber(tick)}
            </text>
          </g>
        ))}
        {model.categories.map((category, c) => {
          const left = margin.left + band * c + (band - group) / 2;
          return (
            <g key={category}>
              {model.series.map((series, s) => {
                const value = series.values[c];
                if (value === null) return null;
                const top = Math.min(y(value), y(0));
                const size = Math.abs(y(value) - y(0));
                const x = left + s * (bar + gap);
                const r = Math.min(4, bar / 2, size);
                // Rounded at the data end, square on the baseline.
                const path =
                  value >= 0
                    ? `M${x},${top + size}V${top + r}q0,${-r} ${r},${-r}h${bar - 2 * r}q${r},0 ${r},${r}V${top + size}Z`
                    : `M${x},${top}V${top + size - r}q0,${r} ${r},${r}h${bar - 2 * r}q${r},0 ${r},${-r}V${top}Z`;
                return (
                  <path key={series.name} d={path} fill={colorOf(series, s)}>
                    <title>{`${category}, ${series.name}: ${formatNumber(value)}`}</title>
                  </path>
                );
              })}
              {labels[c] !== null && (
                <text x={margin.left + band * c + band / 2} y={height - 8} textAnchor="middle" className="chart-text">
                  {labels[c]}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </>
  );
}

// ---------------------------------------------------------------------------------------
// Lines, with a crosshair that reads every series at the nearest x.
// ---------------------------------------------------------------------------------------
function Lines({ model, width }: { model: LineModel; width: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const margin = { left: 40, right: 12, top: 8, bottom: 26 };
  const height = 300;
  const range = extent(model.series.flatMap((s) => s.values)) ?? [0, 1];
  const ticks = niceTicks(Math.min(0, range[0]), range[1], 4);
  const y = linear([ticks[0], ticks[ticks.length - 1]], [height - margin.bottom, margin.top]);
  const x = linear([model.x[0], model.x[model.x.length - 1]], [margin.left, width - margin.right]);
  const labels = Math.max(2, Math.min(7, Math.floor((width - margin.left) / 90)));
  const every = Math.max(1, Math.ceil(model.x.length / labels));

  const nearest = (clientX: number, target: Element) => {
    const px = clientX - target.getBoundingClientRect().left;
    let best = 0;
    for (let i = 1; i < model.x.length; i++) {
      if (Math.abs(x(model.x[i]) - px) < Math.abs(x(model.x[best]) - px)) best = i;
    }
    return best;
  };

  return (
    <>
      <Legend series={model.series} mark="line" />
      <div className="relative">
        <svg width={width} height={height} role="img" aria-label={`Line chart of ${readableColumn(model.yLabel)} over ${readableColumn(model.xLabel)}. The table view has the same numbers.`} className="block">
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} stroke={tick === 0 ? "var(--axis)" : "var(--grid)"} strokeWidth={1} />
              <text x={margin.left - 6} y={y(tick) + 3.5} textAnchor="end" className="chart-text tabular">
                {formatNumber(tick)}
              </text>
            </g>
          ))}
          {model.x.map((value, i) =>
            i % every === 0 ? (
              <text key={i} x={x(value)} y={height - 8} textAnchor={i === 0 ? "start" : "middle"} className="chart-text">
                {axisLabel(model, value, model.xText[i])}
              </text>
            ) : null,
          )}
          {model.series.map((series, s) => (
            <path
              key={series.name}
              d={linePath(series.values.map((value, i) => ({ x: x(model.x[i]), y: value === null ? null : y(value) })))}
              fill="none"
              stroke={colorOf(series, s)}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {hover !== null && (
            <g>
              <line x1={x(model.x[hover])} x2={x(model.x[hover])} y1={margin.top} y2={height - margin.bottom} stroke="var(--muted)" strokeWidth={1} />
              {model.series.map((series, s) =>
                series.values[hover] === null ? null : (
                  <circle key={series.name} cx={x(model.x[hover])} cy={y(series.values[hover]!)} r={4} fill={colorOf(series, s)} stroke="var(--surface)" strokeWidth={2} />
                ),
              )}
            </g>
          )}
        </svg>
        <div
          className="absolute inset-0 cursor-crosshair touch-pan-y"
          onPointerMove={(event) => setHover(nearest(event.clientX, event.currentTarget))}
          onPointerLeave={() => setHover(null)}
        />
        {hover !== null && (
          <Tip left={x(model.x[hover])} top={margin.top} width={width}>
            <p className="font-medium">{model.xKind === "date" ? formatDate(model.xText[hover].slice(0, 10), "medium") : model.xText[hover]}</p>
            <ul className="tabular mt-1 flex flex-col gap-0.5">
              {model.series.map((series, s) => (
                <li key={series.name} className="flex items-center gap-2">
                  <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: colorOf(series, s) }} />
                  <span className="font-semibold">{series.values[hover] === null ? "–" : formatNumber(series.values[hover]!)}</span>
                  <span className="truncate text-muted">{series.name || readableColumn(model.yLabel)}</span>
                </li>
              ))}
            </ul>
          </Tip>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------
// Scatter, with a nearest-point readout so nobody has to hit an 8px dot dead center.
// ---------------------------------------------------------------------------------------
function Scatter({ model, width }: { model: ScatterModel; width: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const margin = { left: 40, right: 12, top: 8, bottom: 40 };
  const height = 320;
  const xRange = extent(model.points.map((p) => p.x)) ?? [0, 1];
  const yRange = extent(model.points.map((p) => p.y)) ?? [0, 1];
  const xTicks = model.xKind === "date" ? null : niceTicks(xRange[0], xRange[1], 5);
  const yTicks = niceTicks(Math.min(0, yRange[0]), yRange[1], 4);
  const xDomain: [number, number] = xTicks ? [xTicks[0], xTicks[xTicks.length - 1]] : xRange;
  const x = linear(xDomain, [margin.left, width - margin.right]);
  const y = linear([yTicks[0], yTicks[yTicks.length - 1]], [height - margin.bottom, margin.top]);
  const xLabels = xTicks ?? [0, 0.25, 0.5, 0.75, 1].map((t) => xRange[0] + t * (xRange[1] - xRange[0]));

  const nearest = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - box.left;
    const py = event.clientY - box.top;
    let best = -1;
    let bestDistance = 28 ** 2;
    model.points.forEach((point, i) => {
      const distance = (x(point.x) - px) ** 2 + (y(point.y) - py) ** 2;
      if (distance < bestDistance) {
        best = i;
        bestDistance = distance;
      }
    });
    return best < 0 ? null : best;
  };
  const active = hover === null ? null : model.points[hover];

  return (
    <div className="relative">
      <svg width={width} height={height} role="img" aria-label={`Scatter plot of ${readableColumn(model.yLabel)} against ${readableColumn(model.xLabel)}, ${model.points.length} points. The table view has the same numbers.`} className="block">
        {yTicks.map((tick) => (
          <g key={tick}>
            <line x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} stroke={tick === 0 ? "var(--axis)" : "var(--grid)"} strokeWidth={1} />
            <text x={margin.left - 6} y={y(tick) + 3.5} textAnchor="end" className="chart-text tabular">
              {formatNumber(tick)}
            </text>
          </g>
        ))}
        {xLabels.map((tick) => (
          <text key={tick} x={x(tick)} y={height - margin.bottom + 15} textAnchor="middle" className="chart-text tabular">
            {axisLabel(model, tick)}
          </text>
        ))}
        <text x={(margin.left + width - margin.right) / 2} y={height - 6} textAnchor="middle" className="chart-text">
          {readableColumn(model.xLabel)}
        </text>
        {model.points.map((point, i) => (
          <circle key={i} cx={x(point.x)} cy={y(point.y)} r={4} fill="var(--s1)" fillOpacity={0.8} stroke="var(--surface)" strokeWidth={1.5} />
        ))}
        {active && <circle cx={x(active.x)} cy={y(active.y)} r={6} fill="var(--s1)" stroke="var(--fg)" strokeWidth={1.5} />}
      </svg>
      <div className="absolute inset-0" onPointerMove={(event) => setHover(nearest(event))} onPointerLeave={() => setHover(null)} />
      {active && (
        <Tip left={x(active.x)} top={Math.max(y(active.y) - 64, 0)} width={width}>
          {active.label && <p className="truncate font-medium">{active.label}</p>}
          <dl className="tabular mt-0.5 grid grid-cols-[auto_1fr] gap-x-2 text-muted">
            <dt className="truncate">{readableColumn(model.yLabel)}</dt>
            <dd className="text-right font-semibold text-fg">{formatNumber(active.y)}</dd>
            <dt className="truncate">{readableColumn(model.xLabel)}</dt>
            <dd className="text-right font-semibold text-fg">{axisLabel(model, active.x)}</dd>
          </dl>
        </Tip>
      )}
    </div>
  );
}

/** Draws whatever `buildChartModel` decided could honestly be drawn. */
export function ResultChart({ model }: { model: Exclude<ChartModel, { kind: "table" }> }) {
  const [ref, width] = useWidth<HTMLDivElement>(680);
  const folded =
    model.kind === "scatter"
      ? model.dropped > 0
        ? `Showing the first ${model.points.length.toLocaleString("en-US")} points; ${model.dropped.toLocaleString("en-US")} more are in the table.`
        : null
      : model.folded > 0
        ? model.kind === "bar"
          ? `The ${model.folded} smallest groups are combined into Other.`
          : `Showing the ${model.series.length} largest series; ${model.folded} more are in the table.`
        : null;
  return (
    <div ref={ref} className="w-full min-w-0 overflow-hidden">
      {/* The measure: the y axis of every chart type, named in words, with the query's column name on hover. */}
      <p className="mb-1.5 text-xs text-muted" title={model.yLabel}>
        {readableColumn(model.yLabel)}
      </p>
      {model.kind === "bar" && (model.series.length === 1 ? <BarRows model={model} /> : <GroupedBars model={model} width={width} />)}
      {model.kind === "line" && <Lines model={model} width={width} />}
      {model.kind === "scatter" && <Scatter model={model} width={width} />}
      {folded && <p className="mt-2 text-xs text-muted">{folded}</p>}
    </div>
  );
}
