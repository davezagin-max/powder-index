"use client";

import { useWidth } from "@/components/chart/useWidth";
import { contains, projection } from "@/lib/geo";
import type { ResortDay } from "@/lib/data/select";
import { tierColor } from "@/lib/ui/colors";
import { LABELS, LAKES, ROADS, TOWNS, VIEWS, type LatLon, type MapView } from "@/lib/ui/map-features";

function Frame({
  view,
  days,
  selectedId,
  onSelect,
}: {
  view: MapView;
  days: ResortDay[];
  selectedId: string;
  onSelect: (resortId: string) => void;
}) {
  const [ref, width] = useWidth<HTMLDivElement>(view.id === "north" ? 250 : 300);
  const map = projection(view.bounds, width);
  const at = ([lat, lon]: LatLon) => map.project(lat, lon);
  const line = (points: LatLon[]) => points.map((p) => at(p).map((n) => n.toFixed(1)).join(",")).join(" ");
  const inView = days.filter((day) => contains(view.bounds, day.resort.lat, day.resort.lon));
  const central = VIEWS.find((v) => v.id === "central")!.bounds;
  // In the regional view the six clustered resorts collapse into the inset's outline.
  const drawn = view.id === "north" ? inView.filter((day) => !contains(central, day.resort.lat, day.resort.lon)) : inView;
  const scalePx = view.scaleKm * map.pxPerKm;
  const clip = `clip-${view.id}`;

  return (
    <figure className="flex min-w-0 flex-col gap-1.5">
      <figcaption className="text-xs font-medium text-muted">{view.title}</figcaption>
      <div ref={ref} className="overflow-hidden rounded-md border border-border">
        <svg width={width} height={Math.round(map.height)} role="group" aria-label={`Map: ${view.title}`} className="block">
          <defs>
            <clipPath id={clip}>
              <rect width={width} height={map.height} />
            </clipPath>
          </defs>
          <rect width={width} height={map.height} fill="var(--land)" />
          <g clipPath={`url(#${clip})`}>
            {LAKES.map((lake) => (
              <polygon key={lake.name} points={line(lake.outline)} fill="var(--water)" />
            ))}
            {ROADS.map((road, index) => (
              <polyline key={index} points={line(road)} fill="none" stroke="var(--axis)" strokeWidth={1} strokeLinejoin="round" />
            ))}
            {TOWNS.filter((town) => town.view === view.id).map((town) => {
              const [x, y] = at(town.at);
              return (
                <g key={town.name}>
                  <rect x={x - 2.5} y={y - 2.5} width={5} height={5} fill="var(--muted)" />
                  <text x={x + town.label.dx} y={y + town.label.dy} textAnchor={town.label.anchor} className="chart-text">
                    {town.name}
                  </text>
                </g>
              );
            })}

            {view.id === "north" &&
              (() => {
                const [x0, y0] = map.project(central.north, central.west);
                const [x1, y1] = map.project(central.south, central.east);
                return (
                  <g>
                    <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth={1} />
                    <text x={(x0 + x1) / 2} y={y1 + 13} textAnchor="middle" className="chart-text">
                      six resorts (inset)
                    </text>
                  </g>
                );
              })()}

            {/* Stations and the line tying each to the resort it stands in for. */}
            {drawn.flatMap((day) =>
              day.resort.stations.map((station) => {
                const [rx, ry] = map.project(day.resort.lat, day.resort.lon);
                const [sx, sy] = map.project(station.lat, station.lon);
                return (
                  <g key={`${day.resort.id}-${station.id}`}>
                    <line x1={rx} y1={ry} x2={sx} y2={sy} stroke="var(--axis)" strokeWidth={1} />
                    <path d={`M${sx},${sy - 4.5}l4,7h-8z`} fill="var(--surface)" stroke="var(--muted)" strokeWidth={1}>
                      <title>{`${station.name} SNOTEL, ${station.elevFt.toLocaleString("en-US")} ft, ${station.distanceKm} km from ${day.resort.name}`}</title>
                    </path>
                  </g>
                );
              }),
            )}

            {drawn.map((day) => {
              const [x, y] = map.project(day.resort.lat, day.resort.lon);
              const label = LABELS[day.resort.id] ?? { dx: 12, dy: 4, anchor: "start" as const };
              const selected = day.resort.id === selectedId;
              // The selection ring is wider than the dot, so the label steps out of its way.
              const reach = Math.hypot(label.dx, label.dy) || 1;
              const dx = label.dx + (selected ? (5 * label.dx) / reach : 0);
              const dy = label.dy + (selected ? (5 * label.dy) / reach : 0);
              return (
                <g
                  key={day.resort.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selected}
                  aria-label={`${day.resort.name}: powder score ${day.score}, ${day.tier.label}. Show history.`}
                  onClick={() => onSelect(day.resort.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect(day.resort.id);
                    }
                  }}
                  className="cursor-pointer outline-none [&:focus-visible>circle:first-of-type]:stroke-[var(--accent)]"
                >
                  {/* A generous transparent target: the dot itself is too small to hit. */}
                  <circle cx={x} cy={y} r={16} fill="transparent" stroke="transparent" strokeWidth={2} />
                  {selected && <circle cx={x} cy={y} r={11.5} fill="none" stroke="var(--accent)" strokeWidth={2} />}
                  <circle cx={x} cy={y} r={7} fill={tierColor(day.tier.tier)} stroke="var(--surface)" strokeWidth={2} />
                  <text x={x + dx} y={y + dy} textAnchor={label.anchor} className="chart-text-strong" style={{ paintOrder: "stroke", stroke: "var(--land)", strokeWidth: 3 }}>
                    {day.resort.name}
                    <tspan className="chart-text" dx={5} style={{ paintOrder: "stroke", stroke: "var(--land)", strokeWidth: 3 }}>
                      {day.score.toFixed(0)}
                    </tspan>
                  </text>
                </g>
              );
            })}
          </g>
          <g transform={`translate(${width - scalePx - 10}, ${map.height - 12})`}>
            <line x1={0} x2={scalePx} y1={0} y2={0} stroke="var(--muted)" strokeWidth={1.5} />
            <text x={scalePx / 2} y={-4} textAnchor="middle" className="chart-text">
              {view.scaleKm} km
            </text>
          </g>
        </svg>
      </div>
    </figure>
  );
}

/**
 * Three framed views instead of one map: half the resorts sit within 15 km of each
 * other and two are 300 km south of the rest, so no single scale shows them all.
 */
export function ResortMap({
  days,
  selectedId,
  onSelect,
}: {
  days: ResortDay[];
  selectedId: string;
  onSelect: (resortId: string) => void;
}) {
  const [central, north, south] = VIEWS;
  return (
    <div className="flex flex-col gap-4">
      <Frame view={central} days={days} selectedId={selectedId} onSelect={onSelect} />
      <div className="grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] items-start gap-4">
        <Frame view={north} days={days} selectedId={selectedId} onSelect={onSelect} />
        <Frame view={south} days={days} selectedId={selectedId} onSelect={onSelect} />
      </div>
      <p className="text-xs leading-relaxed text-muted">
        Dots are resorts, colored by tier, with the day&apos;s score. Triangles are the SNOTEL stations that stand in
        for them. Positions are exact; roads and lakes are sketched for orientation.
      </p>
    </div>
  );
}
