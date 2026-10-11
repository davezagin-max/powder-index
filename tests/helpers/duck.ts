/**
 * The same DuckDB-WASM engine the browser uses, started in Node for tests. It loads the
 * same Parquet files with the same setup SQL, so a query that passes here behaves the
 * same in a visitor's tab. (The browser talks to the engine through a worker; Node can
 * call it directly, which is the only difference.)
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { DuckDBBindings, DuckDBConnection } from "@duckdb/duckdb-wasm/blocking";
import { tableToResult } from "@/lib/duck/rows";
import type { QueryResult } from "@/lib/duck/result";
import { HARDENING, QUERY_CONFIG, TABLES, loadStatements } from "@/lib/duck/setup";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, "..", "..");

export interface TestEngine {
  connection: DuckDBConnection;
  run: (sql: string) => QueryResult;
  execute: (sql: string) => Promise<QueryResult>;
  close: () => void;
}

export async function startEngine({ harden = true } = {}): Promise<TestEngine> {
  const duckdb = require("@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs");
  const dist = path.dirname(require.resolve("@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs"));
  const bundles = {
    mvp: { mainModule: path.join(dist, "duckdb-mvp.wasm"), mainWorker: path.join(dist, "duckdb-node-mvp.worker.cjs") },
    eh: { mainModule: path.join(dist, "duckdb-eh.wasm"), mainWorker: path.join(dist, "duckdb-node-eh.worker.cjs") },
  };
  const db: DuckDBBindings = await duckdb.createDuckDB(bundles, new duckdb.VoidLogger(), duckdb.NODE_RUNTIME);
  await db.instantiate(() => {});
  db.open({ query: QUERY_CONFIG });
  for (const table of TABLES) {
    const bytes = readFileSync(path.join(ROOT, "public", "data", `${table}.parquet`));
    db.registerFileBuffer(`${table}.parquet`, new Uint8Array(bytes));
  }
  const connection = db.connect();
  for (const sql of loadStatements()) connection.query(sql);
  if (harden) for (const sql of HARDENING) connection.query(sql);
  const run = (sql: string): QueryResult => {
    const started = performance.now();
    // The Arrow instance comes from the engine's copy of apache-arrow; the shapes match.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return tableToResult(connection.query(sql) as any, performance.now() - started);
  };
  return { connection, run, execute: async (sql) => run(sql), close: () => connection.close() };
}
