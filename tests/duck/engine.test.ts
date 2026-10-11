import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startEngine, type TestEngine } from "../helpers/duck";

let engine: TestEngine;
beforeAll(async () => {
  engine = await startEngine();
});
afterAll(() => engine?.close());

describe("row conversion", () => {
  it("types columns from the Arrow schema, not from the first value", () => {
    const result = engine.run(`
      SELECT NULL::DATE AS d, NULL::DOUBLE AS n, NULL::VARCHAR AS t, NULL::BOOLEAN AS b
      UNION ALL SELECT DATE '2026-02-19', 1.5, 'x', TRUE
    `);
    expect(result.columns).toEqual([
      { name: "d", kind: "date" },
      { name: "n", kind: "number" },
      { name: "t", kind: "text" },
      { name: "b", kind: "boolean" },
    ]);
    expect(result.rows).toEqual([
      [null, null, null, null],
      ["2026-02-19", 1.5, "x", true],
    ]);
  });

  it("turns BIGINT, HUGEINT and DECIMAL into plain numbers", () => {
    const result = engine.run(`
      SELECT COUNT(*) AS n, SUM(station_count) AS total, CAST(12.345 AS DECIMAL(10, 2)) AS price,
             AVG(base_elev_ft) AS mean_base, MAX(summit_elev_ft) AS top
      FROM resorts
    `);
    expect(result.columns.every((column) => column.kind === "number")).toBe(true);
    const [n, total, price, meanBase, top] = result.rows[0];
    expect(n).toBe(12);
    expect(total).toBe(15);
    expect(price).toBeCloseTo(12.35, 5);
    expect(meanBase).toBeCloseTo(7646.58, 1);
    expect(top).toBe(11068);
  });

  it("formats timestamps and keeps text as text", () => {
    const result = engine.run("SELECT TIMESTAMP '2026-02-19 06:30:00' AS at, 'Alta' AS name, DATE '2025-10-01' + 141 AS later");
    expect(result.rows[0]).toEqual(["2026-02-19 06:30:00", "Alta", "2026-02-19"]);
  });
});

describe("the loaded tables", () => {
  it("hold the three marts", () => {
    expect(engine.run("SELECT COUNT(*) AS n FROM resorts").rows[0][0]).toBe(12);
    const daily = engine.run("SELECT COUNT(*) AS n, COUNT(DISTINCT resort_id) AS resorts FROM resort_daily").rows[0];
    expect(daily[1]).toBe(12);
    expect(engine.run("SELECT COUNT(*) AS n FROM powder_score").rows[0][0]).toBe(daily[0]);
  });
});

describe("hardening", () => {
  it("leaves the engine unable to open a file or a URL", () => {
    expect(() => engine.run("SELECT * FROM read_parquet('resorts.parquet')")).toThrowError(/disabled|Permission/i);
    expect(() => engine.run("SELECT * FROM read_csv('https://example.com/x.csv')")).toThrowError(/disabled|Permission/i);
    expect(() => engine.run("SELECT * FROM 'https://example.com/x.parquet'")).toThrowError();
  });

  it("cannot be switched back on", () => {
    expect(() => engine.run("SET enable_external_access = true")).toThrowError(/locked|Cannot change/i);
    expect(() => engine.run("SET autoload_known_extensions = true")).toThrowError(/locked|Cannot change/i);
    // Still off afterwards.
    expect(() => engine.run("SELECT * FROM read_parquet('resorts.parquet')")).toThrowError();
  });

  it("still answers ordinary queries", () => {
    expect(engine.run("SELECT resort_name FROM resorts ORDER BY summit_elev_ft DESC LIMIT 1").rows).toEqual([["Alta"]]);
  });
});
