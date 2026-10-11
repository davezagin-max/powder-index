/** Small chart math: scales, ticks, and SVG path builders. No dependencies. */

export type Scale = (value: number) => number;

/** Maps `domain` onto `range` linearly. A zero-width domain maps to the range midpoint. */
export function linear(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  if (d1 === d0) return () => (r0 + r1) / 2;
  const slope = (r1 - r0) / (d1 - d0);
  return (value) => r0 + (value - d0) * slope;
}

/**
 * Round tick values covering [min, max], about `target` of them, stepping by 1, 2 or 5
 * times a power of ten. The first tick is at or below min and the last at or above max,
 * so the outer ticks can serve as the axis domain.
 */
export function niceTicks(min: number, max: number, target = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) {
    if (min === 0) return [0, 1];
    const pad = Math.abs(min) * 0.1;
    min -= pad;
    max += pad;
  }
  const rough = (max - min) / Math.max(1, target);
  const power = 10 ** Math.floor(Math.log10(rough));
  const fraction = rough / power;
  const step = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power;
  const first = Math.floor(min / step) * step;
  const last = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let i = 0; first + i * step <= last + step / 1e6; i++) {
    // Multiplying an integer index avoids 0.1 + 0.2 drift across many steps.
    ticks.push(Number((first + i * step).toPrecision(12)));
  }
  return ticks;
}

export function extent(values: Iterable<number | null | undefined>): [number, number] | null {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (value === null || value === undefined || Number.isNaN(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return min === Infinity ? null : [min, max];
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toString();

/** An SVG path through the points. A null y breaks the line instead of bridging the gap. */
export function linePath(points: { x: number; y: number | null }[]): string {
  let path = "";
  let pen = false;
  for (const point of points) {
    if (point.y === null) {
      pen = false;
      continue;
    }
    path += `${pen ? "L" : "M"}${fmt(point.x)},${fmt(point.y)}`;
    pen = true;
  }
  return path;
}

/** A filled area between the line and `baseline`, one closed shape per unbroken run. */
export function areaPath(points: { x: number; y: number | null }[], baseline: number): string {
  let path = "";
  let run: { x: number; y: number }[] = [];
  const flush = () => {
    if (run.length > 0) {
      const first = run[0];
      const last = run[run.length - 1];
      path += `M${fmt(first.x)},${fmt(baseline)}`;
      for (const p of run) path += `L${fmt(p.x)},${fmt(p.y)}`;
      path += `L${fmt(last.x)},${fmt(baseline)}Z`;
    }
    run = [];
  };
  for (const point of points) {
    if (point.y === null) flush();
    else run.push({ x: point.x, y: point.y });
  }
  flush();
  return path;
}

/**
 * Category labels for a band axis, cut to what fits. Each band is `band` pixels wide and
 * a label is about `charPx` per character, so the answer is arithmetic, not measurement:
 *
 *   1. every label in full, when the longest one fits its band;
 *   2. else each label's first word ("Nov 2025" becomes "Nov"), when that fits and
 *      still tells the bands apart;
 *   3. else the full labels, but only every nth, spaced so neighbors cannot touch.
 *
 * A skipped label is null. The caller still draws every bar and keeps the full text in
 * the tooltip and the table, so nothing is lost, only left unprinted.
 */
export function fitBandLabels(labels: string[], band: number, charPx = 6.2, gapPx = 8): (string | null)[] {
  if (labels.length === 0) return [];
  const widest = (texts: string[]) => Math.max(...texts.map((text) => text.length)) * charPx + gapPx;
  if (widest(labels) <= band) return labels;
  const short = labels.map((label) => label.trim().split(/\s+/)[0] ?? label);
  if (new Set(short).size === labels.length && widest(short) <= band) return short;
  const every = Math.max(2, Math.ceil(widest(labels) / Math.max(band, 1)));
  return labels.map((label, index) => (index % every === 0 ? label : null));
}

/** Compact number for axes and tooltips: 1,284 · 12.5 · 0.07. */
export function formatNumber(value: number): string {
  const abs = Math.abs(value);
  const digits = abs >= 100 || Number.isInteger(value) ? 0 : abs >= 1 ? 1 : 2;
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}
