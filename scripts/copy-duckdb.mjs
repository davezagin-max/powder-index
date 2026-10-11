#!/usr/bin/env node
/**
 * Copies the DuckDB-WASM engine out of node_modules into public/duckdb/ so the app
 * serves it from its own origin: no CDN in the data path, and a worker can only be
 * started from a same-origin script. The files are about 75 MB and are not committed;
 * `pnpm dev` and `pnpm build` run this first. Browsers download one .wasm (about 7 MB
 * compressed) and only when a visitor first runs a query.
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const dist = path.dirname(require.resolve("@duckdb/duckdb-wasm/dist/duckdb-browser.mjs"));
const out = path.join(process.cwd(), "public", "duckdb");
mkdirSync(out, { recursive: true });

const files = [
  "duckdb-mvp.wasm",
  "duckdb-eh.wasm",
  "duckdb-browser-mvp.worker.js",
  "duckdb-browser-eh.worker.js",
];
let copied = 0;
for (const file of files) {
  const from = path.join(dist, file);
  const to = path.join(out, file);
  if (existsSync(to) && statSync(to).size === statSync(from).size) continue;
  copyFileSync(from, to);
  copied += 1;
}
if (copied) console.log(`copy-duckdb: copied ${copied} file(s) to public/duckdb/`);
