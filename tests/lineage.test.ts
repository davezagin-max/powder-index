import { describe, expect, it } from "vitest";
import lineage from "@/public/data/lineage.json";
import { layoutLineage, nodeDepths } from "@/lib/lineage";

const name = new Map(lineage.nodes.map((node) => [node.id, node.name]));

describe("lineage layout", () => {
  const depths = nodeDepths(lineage.nodes, lineage.edges);
  const byName = new Map(lineage.nodes.map((node) => [node.name, depths.get(node.id)!]));

  it("puts every node one column past its deepest parent", () => {
    for (const edge of lineage.edges) {
      expect(depths.get(edge.to)!, `${name.get(edge.from)} -> ${name.get(edge.to)}`).toBeGreaterThan(depths.get(edge.from)!);
    }
    expect(byName.get("snotel_daily")).toBe(0);
    expect(byName.get("resort_stations")).toBe(0);
    expect(byName.get("stg_snotel__daily")).toBe(1);
    expect(byName.get("int_station_days")).toBe(2);
    expect(byName.get("int_station_new_snow")).toBe(3);
    expect(byName.get("int_resort_days")).toBe(4);
    expect(byName.get("resort_daily")).toBe(5);
    expect(byName.get("powder_score")).toBe(6);
  });

  it("places every node exactly once, raw sources first", () => {
    const columns = layoutLineage(lineage.nodes, lineage.edges);
    expect(columns.flat()).toHaveLength(lineage.nodes.length);
    expect(new Set(columns.flat().map((node) => node.id)).size).toBe(lineage.nodes.length);
    expect(columns[0].slice(0, 3).map((node) => node.name)).toEqual(["nws_forecast", "snotel_daily", "snotel_stations"]);
    expect(columns.at(-1)!.map((node) => node.name)).toEqual(["powder_score"]);
  });

  it("orders a column by where its parents sit", () => {
    const nodes = ["a", "b", "x", "y"].map((id) => ({ id, name: id, layer: "seed", tests: 0 }));
    // y hangs off the first parent and x off the second, so y is drawn above x.
    const columns = layoutLineage(nodes, [
      { from: "a", to: "y" },
      { from: "b", to: "x" },
    ]);
    expect(columns.map((column) => column.map((node) => node.id))).toEqual([
      ["a", "b"],
      ["y", "x"],
    ]);
  });

  it("refuses a cycle instead of looping forever", () => {
    const nodes = ["a", "b"].map((id) => ({ id, name: id, layer: "seed", tests: 0 }));
    expect(() => nodeDepths(nodes, [{ from: "a", to: "b" }, { from: "b", to: "a" }])).toThrowError(/cycle/);
  });
});
