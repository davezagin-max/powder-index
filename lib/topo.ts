/**
 * Contour lines by marching squares, for the topographic background texture.
 *
 * `contourSegments` finds, for one elevation, every place a grid cell's edge crosses
 * it and joins the crossings inside each cell. `stitch` chains those short segments
 * into long polylines so each contour is one smooth SVG path rather than hundreds of
 * disconnected dashes. The height field is a sum of sine waves that is periodic over
 * the tile, so the texture repeats with no visible seam.
 */

export type Point = [number, number];
export type Field = (x: number, y: number) => number;

/** Linear interpolation of where `level` falls between two corner values. */
function cross(level: number, a: number, b: number): number {
  return (level - a) / (b - a);
}

type Segment = [Point, Point];

/**
 * Marching squares over a grid of corner values. Returns each segment twice over:
 * its two end points, and the identity of the two grid edges those points sit on.
 * Saddle cells (opposite corners above, the other two below) are resolved with the
 * cell's center value, which keeps neighboring contours from crossing.
 */
function march(values: number[][], level: number): { segments: Segment[]; edges: [string, string][] } {
  const rows = values.length - 1;
  const cols = values[0].length - 1;
  const segments: Segment[] = [];
  const edges: [string, string][] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tl = values[r][c];
      const tr = values[r][c + 1];
      const br = values[r + 1][c + 1];
      const bl = values[r + 1][c];
      const code = (tl > level ? 8 : 0) | (tr > level ? 4 : 0) | (br > level ? 2 : 0) | (bl > level ? 1 : 0);
      if (code === 0 || code === 15) continue;
      // Each crossing point, paired with the grid edge it lies on. A horizontal edge is
      // named by its left corner, a vertical edge by its top corner.
      const top = { point: [c + cross(level, tl, tr), r] as Point, edge: `h${r},${c}` };
      const right = { point: [c + 1, r + cross(level, tr, br)] as Point, edge: `v${r},${c + 1}` };
      const bottom = { point: [c + cross(level, bl, br), r + 1] as Point, edge: `h${r + 1},${c}` };
      const left = { point: [c, r + cross(level, tl, bl)] as Point, edge: `v${r},${c}` };
      const add = (a: typeof top, b: typeof top) => {
        segments.push([a.point, b.point]);
        edges.push([a.edge, b.edge]);
      };
      switch (code) {
        case 1:
        case 14:
          add(left, bottom);
          break;
        case 2:
        case 13:
          add(bottom, right);
          break;
        case 3:
        case 12:
          add(left, right);
          break;
        case 4:
        case 11:
          add(top, right);
          break;
        case 6:
        case 9:
          add(top, bottom);
          break;
        case 7:
        case 8:
          add(left, top);
          break;
        default: {
          // 5 and 10: a saddle.
          const centerAbove = (tl + tr + br + bl) / 4 > level;
          if ((code === 5) === centerAbove) {
            add(left, top);
            add(bottom, right);
          } else {
            add(left, bottom);
            add(top, right);
          }
        }
      }
    }
  }
  return { segments, edges };
}

/** Line segments of the `level` contour over a grid of unit cells. */
export function contourSegments(values: number[][], level: number): Segment[] {
  return march(values, level).segments;
}

const key = (p: Point) => `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)}`;

/**
 * Chains segments that share an end into polylines. A closed loop repeats its first point.
 *
 * Ends are matched by `keys` when given, otherwise by coordinates. The contour code
 * passes grid-edge identities: every edge is shared by exactly two cells, so each key
 * joins at most two segments and the chain is unambiguous. Matching on coordinates
 * alone breaks when a contour passes exactly through a grid corner, where four edges
 * meet at one point.
 */
export function stitch(segments: Segment[], keys?: [string, string][]): Point[][] {
  const endKeys: [string, string][] = keys ?? segments.map(([a, b]) => [key(a), key(b)]);
  const ends = new Map<string, number[]>();
  endKeys.forEach((pair, index) => {
    for (const end of pair) {
      const list = ends.get(end);
      if (list) list.push(index);
      else ends.set(end, [index]);
    }
  });
  const used = new Array<boolean>(segments.length).fill(false);
  /** The unused segment touching `end`, with its far point and far key. */
  const next = (end: string): { point: Point; end: string } | null => {
    for (const index of ends.get(end) ?? []) {
      if (used[index]) continue;
      used[index] = true;
      const near = endKeys[index][0] === end ? 0 : 1;
      return { point: segments[index][1 - near], end: endKeys[index][1 - near] };
    }
    return null;
  };
  const lines: Point[][] = [];
  for (let start = 0; start < segments.length; start++) {
    if (used[start]) continue;
    used[start] = true;
    const line: Point[] = [...segments[start]];
    let tail = endKeys[start][1];
    for (let step = next(tail); step; step = next(tail)) {
      line.push(step.point);
      tail = step.end;
    }
    let head = endKeys[start][0];
    for (let step = next(head); step; step = next(head)) {
      line.unshift(step.point);
      head = step.end;
    }
    lines.push(line);
  }
  return lines;
}

/** Samples `field` on a grid and returns every contour polyline, scaled to pixels. */
export function contourLines(
  field: Field,
  size: { width: number; height: number; cell: number },
  levels: number[],
): { level: number; lines: Point[][] }[] {
  const cols = Math.round(size.width / size.cell);
  const rows = Math.round(size.height / size.cell);
  const values: number[][] = [];
  for (let r = 0; r <= rows; r++) {
    const row: number[] = [];
    for (let c = 0; c <= cols; c++) row.push(field((c / cols) * size.width, (r / rows) * size.height));
    values.push(row);
  }
  const sx = size.width / cols;
  const sy = size.height / rows;
  return levels.map((level) => ({
    level,
    lines: (() => {
      const { segments, edges } = march(values, level);
      return stitch(segments, edges).map((line) => line.map(([x, y]): Point => [x * sx, y * sy]));
    })(),
  }));
}

/** A smooth SVG path through a polyline: quadratic curves through the segment midpoints. */
export function smoothPath(line: Point[]): string {
  if (line.length < 2) return "";
  const f = (n: number) => (Math.round(n * 10) / 10).toString();
  const closed = line.length > 2 && key(line[0]) === key(line[line.length - 1]);
  const points = closed ? line.slice(0, -1) : line;
  const mid = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  if (closed) {
    const start = mid(points[points.length - 1], points[0]);
    let d = `M${f(start[0])},${f(start[1])}`;
    for (let i = 0; i < points.length; i++) {
      const m = mid(points[i], points[(i + 1) % points.length]);
      d += `Q${f(points[i][0])},${f(points[i][1])} ${f(m[0])},${f(m[1])}`;
    }
    return `${d}Z`;
  }
  let d = `M${f(points[0][0])},${f(points[0][1])}`;
  for (let i = 1; i < points.length - 1; i++) {
    const m = mid(points[i], points[i + 1]);
    d += `Q${f(points[i][0])},${f(points[i][1])} ${f(m[0])},${f(m[1])}`;
  }
  const last = points[points.length - 1];
  return `${d}L${f(last[0])},${f(last[1])}`;
}

/**
 * A rolling height field that tiles exactly: every term has a whole number of waves
 * across the tile in both directions.
 */
export function tileableTerrain(size: number): Field {
  const k = (2 * Math.PI) / size;
  return (x, y) =>
    Math.sin(k * x + 0.6) * Math.cos(k * y - 0.4) +
    0.55 * Math.sin(2 * k * x - k * y + 1.9) +
    0.4 * Math.cos(k * x + 2 * k * y + 0.3) +
    0.22 * Math.sin(3 * k * x + 2 * k * y - 1.1) +
    0.15 * Math.cos(2 * k * x - 3 * k * y + 2.4);
}
