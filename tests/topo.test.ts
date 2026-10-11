import { describe, expect, it } from "vitest";
import { haversineKm, contains, projection } from "@/lib/geo";
import { contourLines, contourSegments, smoothPath, stitch, tileableTerrain, type Point } from "@/lib/topo";

describe("marching squares", () => {
  it("draws the contour of a cone as a circle of the right radius", () => {
    const cone = (x: number, y: number) => 50 - Math.hypot(x - 50, y - 50);
    const [{ lines }] = contourLines(cone, { width: 100, height: 100, cell: 2 }, [20]);
    expect(lines).toHaveLength(1);
    const ring = lines[0];
    // Closed: the last point is the first again.
    expect(ring[0][0]).toBeCloseTo(ring.at(-1)![0], 6);
    expect(ring[0][1]).toBeCloseTo(ring.at(-1)![1], 6);
    for (const [x, y] of ring) expect(Math.hypot(x - 50, y - 50)).toBeCloseTo(30, 0);
  });

  it("returns nothing for a level the field never reaches", () => {
    const flat = [
      [1, 1, 1],
      [1, 1, 1],
    ];
    expect(contourSegments(flat, 5)).toEqual([]);
    expect(contourSegments(flat, 0)).toEqual([]);
  });

  it("interpolates the crossing point along a cell edge", () => {
    const [[a, b]] = contourSegments(
      [
        [0, 0],
        [10, 10],
      ],
      2.5,
    );
    expect([a, b]).toEqual([
      [0, 0.25],
      [1, 0.25],
    ]);
  });

  it("splits a saddle into two segments that do not cross", () => {
    const saddle = [
      [1, 0],
      [0, 1],
    ];
    const segments = contourSegments(saddle, 0.5);
    expect(segments).toHaveLength(2);
    const points = new Set(segments.flat().map(([x, y]) => `${x},${y}`));
    expect(points.size).toBe(4);
  });
});

describe("stitch", () => {
  it("chains shuffled segments into one line and closes a loop", () => {
    const open: [Point, Point][] = [
      [[2, 0], [3, 0]],
      [[0, 0], [1, 0]],
      [[2, 0], [1, 0]],
    ];
    expect(stitch(open)).toEqual([[[0, 0], [1, 0], [2, 0], [3, 0]]]);
    const loop: [Point, Point][] = [
      [[0, 0], [1, 0]],
      [[1, 0], [1, 1]],
      [[1, 1], [0, 0]],
    ];
    const [ring] = stitch(loop);
    expect(ring).toHaveLength(4);
    expect(ring[0]).toEqual(ring[3]);
  });

  it("keeps separate contours separate", () => {
    const two: [Point, Point][] = [
      [[0, 0], [1, 0]],
      [[5, 5], [6, 5]],
    ];
    expect(stitch(two)).toHaveLength(2);
  });
});

describe("the background texture", () => {
  it("repeats exactly across the tile, so it has no seam", () => {
    const field = tileableTerrain(480);
    for (const [x, y] of [[0, 0], [37, 211], [479, 5]] as Point[]) {
      expect(field(x + 480, y)).toBeCloseTo(field(x, y), 9);
      expect(field(x, y + 480)).toBeCloseTo(field(x, y), 9);
    }
  });

  it("produces smooth paths that start with a move and stay inside the tile", () => {
    const contours = contourLines(tileableTerrain(480), { width: 480, height: 480, cell: 12 }, [-0.6, 0, 0.6]);
    const paths = contours.flatMap((contour) => contour.lines.map(smoothPath)).filter(Boolean);
    expect(paths.length).toBeGreaterThan(3);
    for (const path of paths) {
      expect(path.startsWith("M")).toBe(true);
      const numbers = path.match(/-?\d+(\.\d+)?/g)!.map(Number);
      expect(Math.min(...numbers)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...numbers)).toBeLessThanOrEqual(480);
    }
    expect(smoothPath([[0, 0]])).toBe("");
    expect(smoothPath([[0, 0], [10, 10]])).toBe("M0,0L10,10");
  });
});

describe("map projection", () => {
  const wasatch = { south: 40.2, north: 42.1, west: -112.3, east: -111.2 };

  it("squeezes longitude by the cosine of the latitude", () => {
    const p = projection(wasatch, 300);
    // 1.1 degrees of longitude at about 41 N is roughly 92 km; 1.9 degrees of latitude is 211 km.
    expect(p.height / p.width).toBeCloseTo(211.5 / 92.4, 1);
    expect(p.project(42.1, -112.3)).toEqual([0, 0]);
    const [x, y] = p.project(40.2, -111.2);
    expect(x).toBeCloseTo(300, 6);
    expect(y).toBeCloseTo(p.height, 6);
  });

  it("agrees with the pipeline on the distance from Alta to its station", () => {
    expect(haversineKm(40.5884, -111.6386, 40.59124, -111.63775)).toBeCloseTo(0.32, 2);
    expect(haversineKm(41.216, -111.8569, 41.37603, -111.94405)).toBeCloseTo(19.23, 1);
  });

  it("knows what is inside the frame", () => {
    expect(contains(wasatch, 40.5884, -111.6386)).toBe(true);
    expect(contains(wasatch, 37.7021, -112.8499)).toBe(false);
  });
});
