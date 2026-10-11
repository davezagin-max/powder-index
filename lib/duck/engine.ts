/**
 * DuckDB-WASM in the visitor's browser. Loaded on demand: nothing here is fetched until
 * the first query, so the dashboard's first load pays nothing for it.
 *
 * The engine files are served from this app's own origin (see scripts/copy-duckdb.mjs).
 * The three Parquet files are fetched once, copied into in-memory tables, and then the
 * engine is locked down so it cannot open any other file or URL.
 */
import type { AsyncDuckDB, AsyncDuckDBConnection } from "@duckdb/duckdb-wasm";
import { BUNDLED_DATA_URL } from "@/lib/data/load";
import type { QueryResult } from "./result";
import { tableToResult } from "./rows";
import { HARDENING, QUERY_CONFIG, TABLES, loadStatements } from "./setup";

export const QUERY_TIMEOUT_MS = 10_000;
export type EngineStage = "engine" | "data";

interface Engine {
  db: AsyncDuckDB;
  connection: AsyncDuckDBConnection;
  worker: Worker;
}

let engine: Promise<Engine> | null = null;
let engineDataUrl: string | null = null;

async function fetchTables(dataUrl: string): Promise<Uint8Array[]> {
  return Promise.all(
    TABLES.map(async (table) => {
      const response = await fetch(`${dataUrl}/${table}.parquet`);
      if (!response.ok) throw new Error(`Could not load ${table}.parquet (HTTP ${response.status}).`);
      return new Uint8Array(await response.arrayBuffer());
    }),
  );
}

async function start(dataUrl: string, onStage?: (stage: EngineStage) => void): Promise<Engine> {
  onStage?.("engine");
  const duckdb = await import("@duckdb/duckdb-wasm");
  const asset = (file: string) => new URL(`/duckdb/${file}`, window.location.origin).href;
  const bundle = await duckdb.selectBundle({
    mvp: { mainModule: asset("duckdb-mvp.wasm"), mainWorker: asset("duckdb-browser-mvp.worker.js") },
    eh: { mainModule: asset("duckdb-eh.wasm"), mainWorker: asset("duckdb-browser-eh.worker.js") },
  });
  const worker = new Worker(bundle.mainWorker!);
  try {
    const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
    await db.instantiate(bundle.mainModule);
    await db.open({ query: QUERY_CONFIG });
    onStage?.("data");
    let files: Uint8Array[];
    try {
      files = await fetchTables(dataUrl);
    } catch (error) {
      // The published copy can lag or be unreachable; the bundled snapshot always exists.
      if (dataUrl === BUNDLED_DATA_URL) throw error;
      files = await fetchTables(BUNDLED_DATA_URL);
    }
    for (const [index, table] of TABLES.entries()) {
      await db.registerFileBuffer(`${table}.parquet`, files[index]);
    }
    const connection = await db.connect();
    for (const sql of loadStatements()) await connection.query(sql);
    for (const sql of HARDENING) await connection.query(sql);
    return { db, connection, worker };
  } catch (error) {
    worker.terminate();
    throw error;
  }
}

function ensure(dataUrl: string, onStage?: (stage: EngineStage) => void): Promise<Engine> {
  if (!engine || engineDataUrl !== dataUrl) {
    const previous = engine;
    void previous?.then((old) => old.worker.terminate()).catch(() => {});
    engineDataUrl = dataUrl;
    const starting = start(dataUrl, onStage);
    engine = starting;
    // A failed start must not poison every later attempt.
    starting.catch(() => {
      if (engine === starting) engine = null;
    });
  }
  return engine;
}

/**
 * Runs one validated query and returns plain rows.
 *
 * The validator bounds what a query may touch, not how long it may run: a three-way
 * self-join is a perfectly legal SELECT. So a query that outlives the timeout has its
 * worker terminated (the engine restarts on the next query) and the error reads like
 * any other engine error, which sends it back to the model as feedback.
 */
export async function runQuery(
  dataUrl: string,
  sql: string,
  options: { onStage?: (stage: EngineStage) => void; timeoutMs?: number } = {},
): Promise<QueryResult> {
  const timeoutMs = options.timeoutMs ?? QUERY_TIMEOUT_MS;
  const running = ensure(dataUrl, options.onStage);
  const current = await running;
  const started = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      current.worker.terminate();
      if (engine === running) engine = null;
      reject(new Error(`Query stopped after ${timeoutMs / 1000} seconds. Write a query that does less work.`));
    }, timeoutMs);
  });
  try {
    const table = await Promise.race([current.connection.query(sql), timedOut]);
    return tableToResult(table, performance.now() - started);
  } finally {
    clearTimeout(timer);
  }
}
