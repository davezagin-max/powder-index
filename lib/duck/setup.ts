/** SQL shared by the browser engine and the Node engine the tests run. */

export const TABLES = ["resorts", "resort_daily", "powder_score"] as const;

/** Cast BIGINT and DECIMAL to doubles so COUNT(*) and SUM() arrive as plain numbers. */
export const QUERY_CONFIG = { castBigIntToDouble: true, castDecimalToDouble: true } as const;

/** Copy each registered Parquet file into an in-memory table of the same name. */
export function loadStatements(): string[] {
  return TABLES.map((table) => `CREATE TABLE ${table} AS SELECT * FROM read_parquet('${table}.parquet')`);
}

/**
 * Run after the tables are loaded. The SQL firewall on the server is the real control;
 * this is the second lock. With external access off the engine cannot open a file or a
 * URL at all, extensions cannot be fetched, and the last line stops any later statement
 * from turning those settings back on.
 */
export const HARDENING = [
  "SET enable_external_access = false",
  "SET autoinstall_known_extensions = false",
  "SET autoload_known_extensions = false",
  "SET lock_configuration = true",
];
