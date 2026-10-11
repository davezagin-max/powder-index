import { describe, expect, it } from "vitest";
import lineage from "@/public/data/lineage.json";
import { edgePath, layoutLineage, nodeColumns, nodeDepths, type LineageNode } from "@/lib/lineage";

const name = new Map(lineage.nodes.map((node) => [node.id, node.name]));
const node = (id: string, layer = "staging"): LineageNode => ({ id, name: id, layer, tests: 0 });

describe("columns", () => {
  const depths = nodeDepths(lineage.nodes, lineage.edges);
  const columns = nodeColumns(lineage.nodes, lineage.edges);
  const depthOf = new Map(lineage.nodes.map((n) => [n.name, depths.get(n.id)!]));
  const columnOf = new Map(lineage.nodes.map((n) => [n.name, columns.get(n.id)!]));

  it("puts every model one column past its deepest parent", () => {
    for (const edge of lineage.edges) {
      expect(columns.get(edge.to)!, `${name.get(edge.from)} -> ${name.get(edge.to)}`).toBeGreaterThan(columns.get(edge.from)!);
    }
    expect(columnOf.get("snotel_daily")).toBe(0);
    expect(columnOf.get("stg_snotel__daily")).toBe(1);
    expect(columnOf.get("int_station_days")).toBe(2);
    expect(columnOf.get("int_station_new_snow")).toBe(3);
    expect(columnOf.get("int_resort_days")).toBe(4);
    expect(columnOf.get("resort_daily")).toBe(5);
    expect(columnOf.get("powder_score")).toBe(6);
  });

  it("pulls each seed right, to just before its first consumer", () => {
    // By depth alone every seed is in the first column.
    for (const seed of ["powder_score_weights", "powder_tiers", "resort_list", "resort_stations"]) {
      expect(depthOf.get(seed), seed).toBe(0);
    }
    // The weights and tiers feed only powder_score; the resort seeds feed a model in column 2.
    expect(columnOf.get("powder_score_weights")).toBe(columnOf.get("powder_score")! - 1);
    expect(columnOf.get("powder_tiers")).toBe(columnOf.get("powder_score")! - 1);
    expect(columnOf.get("resort_list")).toBe(columnOf.get("int_resort_station_weights")! - 1);
    expect(columnOf.get("resort_stations")).toBe(columnOf.get("int_resort_station_weights")! - 1);
  });

  it("leaves raw sources in the first column even when their consumer is far away", () => {
    const columns = nodeColumns(
      [node("raw", "source"), node("seed", "seed"), node("a"), node("b"), node("c")],
      [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "raw", to: "c" },
        { from: "seed", to: "c" },
      ],
    );
    expect(columns.get("raw")).toBe(0);
    expect(columns.get("seed")).toBe(1);
    expect(columns.get("c")).toBe(2);
  });

  it("refuses a cycle instead of looping forever", () => {
    expect(() => nodeDepths([node("a"), node("b")], [{ from: "a", to: "b" }, { from: "b", to: "a" }])).toThrowError(/cycle/);
  });
});

describe("layout of the real dbt project", () => {
  const layout = layoutLineage(lineage.nodes, lineage.edges);

  it("places every node exactly once, raw sources first", () => {
    expect(layout.columns.flat()).toHaveLength(lineage.nodes.length);
    expect(layout.position.size).toBe(lineage.nodes.length);
    expect(layout.columns[0].map((n) => n.name)).toEqual(["nws_forecast", "snotel_daily", "snotel_stations"]);
    expect(layout.columns.at(-1)!.map((n) => n.name)).toEqual(["powder_score"]);
    expect(layout.edges).toHaveLength(lineage.edges.length);
  });

  it("gives every node and every edge crossing its own cell, so no edge hides behind a box", () => {
    const taken = new Map<string, string>();
    const claim = (column: number, row: number, who: string) => {
      const cell = `${column}:${row}`;
      expect(taken.get(cell), `${who} and ${taken.get(cell)} share cell ${cell}`).toBeUndefined();
      taken.set(cell, who);
    };
    for (const [id, at] of layout.position) claim(at.column, at.row, name.get(id)!);
    for (const edge of layout.edges) {
      const label = `${name.get(edge.from)} -> ${name.get(edge.to)}`;
      expect(edge.rows, label).toHaveLength(layout.position.get(edge.to)!.column - edge.column + 1);
      // The ends are the two nodes; everything between is a pass-through lane.
      expect(edge.rows[0], label).toBe(layout.position.get(edge.from)!.row);
      expect(edge.rows.at(-1), label).toBe(layout.position.get(edge.to)!.row);
      edge.rows.slice(1, -1).forEach((row, i) => claim(edge.column + 1 + i, row, label));
    }
    expect(layout.rowCount).toBe(Math.max(...[...taken.keys()].map((cell) => Number(cell.split(":")[1]))) + 1);
  });

  it("routes the forecast around the snow models instead of through them", () => {
    const forecast = layout.edges.find((edge) => name.get(edge.from) === "int_resort_forecast" && name.get(edge.to) === "resort_daily")!;
    expect(forecast.rows).toHaveLength(4);
    const newSnow = layout.position.get(lineage.nodes.find((n) => n.name === "int_station_new_snow")!.id)!;
    expect(forecast.rows[newSnow.column - forecast.column]).not.toBe(newSnow.row);
  });
});

describe("layout rules", () => {
  it("orders a column by where its parents sit", () => {
    // y hangs off the first parent and x off the second, so y is drawn above x.
    const layout = layoutLineage(
      [node("a", "source"), node("b", "source"), node("x"), node("y")],
      [
        { from: "a", to: "y" },
        { from: "b", to: "x" },
      ],
    );
    expect(layout.columns.map((column) => column.map((n) => n.id))).toEqual([
      ["a", "b"],
      ["y", "x"],
    ]);
  });

  it("gives an edge that skips a column a lane in the column it crosses", () => {
    const layout = layoutLineage(
      [node("a", "source"), node("b"), node("c")],
      [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "a", to: "c" },
      ],
    );
    const long = layout.edges.find((edge) => edge.from === "a" && edge.to === "c")!;
    // b is in row 0 of the middle column, so the long edge passes below it.
    expect(layout.position.get("b")).toEqual({ column: 1, row: 0 });
    expect(long.rows).toEqual([0, 1, 0]);
    expect(layout.rowCount).toBe(2);
  });

  it("handles an empty graph", () => {
    expect(layoutLineage([], [])).toMatchObject({ columns: [], edges: [], rowCount: 0 });
  });
});

describe("edgePath", () => {
  const box = { width: 100, height: 40, gapX: 20, gapY: 10 };

  it("draws a neighbor-to-neighbor edge as one curve between the facing sides", () => {
    expect(edgePath({ from: "a", to: "b", column: 0, rows: [0, 1] }, box)).toBe("M100,20C110,20 110,70 120,70");
  });

  it("runs straight across a pass-through slot", () => {
    const path = edgePath({ from: "a", to: "c", column: 0, rows: [0, 1, 0] }, box);
    expect(path).toBe("M100,20C110,20 110,70 120,70H220C230,70 230,20 240,20");
  });
});
