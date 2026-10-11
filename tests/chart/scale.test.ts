import { describe, expect, it } from "vitest";
import { areaPath, extent, formatNumber, linePath, linear, niceTicks } from "@/lib/chart/scale";

describe("linear", () => {
  it("maps a domain onto a range, including an inverted one", () => {
    const y = linear([0, 100], [200, 0]);
    expect([y(0), y(50), y(100)]).toEqual([200, 100, 0]);
    expect(y(150)).toBe(-100);
  });

  it("centers everything when the domain has no width", () => {
    expect(linear([5, 5], [0, 100])(5)).toBe(50);
  });
});

describe("niceTicks", () => {
  it("steps by 1, 2 or 5 times a power of ten and covers the data", () => {
    expect(niceTicks(0, 93)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(niceTicks(0, 33)).toEqual([0, 10, 20, 30, 40]);
    expect(niceTicks(0, 7)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(4.2, 19.6)).toEqual([0, 5, 10, 15, 20]);
    expect(niceTicks(-12, 38)).toEqual([-20, -10, 0, 10, 20, 30, 40]);
  });

  it("has no floating-point crumbs", () => {
    expect(niceTicks(0, 0.5)).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5]);
    expect(niceTicks(0.02, 0.31, 4)).toEqual([0, 0.1, 0.2, 0.3, 0.4]);
  });

  it("copes with a flat or empty range", () => {
    expect(niceTicks(0, 0)).toEqual([0, 1]);
    const flat = niceTicks(50, 50);
    expect(flat[0]).toBeLessThanOrEqual(50);
    expect(flat.at(-1)!).toBeGreaterThanOrEqual(50);
    expect(niceTicks(NaN, 3)).toEqual([0, 1]);
  });
});

describe("paths", () => {
  it("breaks a line at a gap instead of bridging it", () => {
    const points = [
      { x: 0, y: 10 },
      { x: 10, y: 20 },
      { x: 20, y: null },
      { x: 30, y: 5 },
      { x: 40, y: 0 },
    ];
    expect(linePath(points)).toBe("M0,10L10,20M30,5L40,0");
  });

  it("closes one area per unbroken run", () => {
    const points = [
      { x: 0, y: 10 },
      { x: 10, y: 20 },
      { x: 20, y: null },
      { x: 30, y: 5 },
    ];
    expect(areaPath(points, 100)).toBe("M0,100L0,10L10,20L10,100ZM30,100L30,5L30,100Z");
    expect(areaPath([], 100)).toBe("");
  });
});

describe("extent and formatNumber", () => {
  it("ignores gaps", () => {
    expect(extent([3, null, 9, undefined, -2, NaN])).toEqual([-2, 9]);
    expect(extent([null, undefined])).toBeNull();
  });

  it("keeps as many decimals as the size of the number deserves", () => {
    expect([formatNumber(1284), formatNumber(12.54), formatNumber(0.074), formatNumber(244), formatNumber(7)]).toEqual([
      "1,284",
      "12.5",
      "0.07",
      "244",
      "7",
    ]);
  });
});
