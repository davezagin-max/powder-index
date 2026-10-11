import { linePath, linear } from "@/lib/chart/scale";

/** A tiny trend line with the last point marked. Decorative: the numbers are beside it. */
export function Sparkline({
  values,
  max,
  width = 96,
  height = 24,
  className = "",
}: {
  values: number[];
  max: number;
  width?: number;
  height?: number;
  className?: string;
}) {
  if (values.length < 2) return null;
  const x = linear([0, values.length - 1], [2, width - 4]);
  const y = linear([0, Math.max(max, 1)], [height - 3, 3]);
  const points = values.map((value, index) => ({ x: x(index), y: y(value) }));
  const last = points[points.length - 1];
  return (
    <svg width={width} height={height} aria-hidden className={className}>
      <path d={linePath(points)} fill="none" stroke="var(--axis)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last.x} cy={last.y} r={3} fill="var(--accent)" stroke="var(--surface)" strokeWidth={1.5} />
    </svg>
  );
}
