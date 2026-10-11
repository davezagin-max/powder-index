/** The plain-data result of a query, independent of DuckDB and Arrow. */
export type Cell = string | number | boolean | null;
export type ColumnKind = "number" | "date" | "text" | "boolean";

export interface Column {
  name: string;
  kind: ColumnKind;
}

export interface QueryResult {
  columns: Column[];
  rows: Cell[][];
  /** Milliseconds the engine spent on the query. */
  elapsedMs: number;
}

/** Case-insensitive column lookup, the way DuckDB resolves names. */
export function columnIndex(result: QueryResult, name: string): number {
  const wanted = name.toLowerCase();
  return result.columns.findIndex((column) => column.name.toLowerCase() === wanted);
}
