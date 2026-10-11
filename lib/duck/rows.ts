/**
 * Arrow table -> plain rows.
 *
 * DuckDB-WASM hands back Apache Arrow, whose JavaScript values are awkward to render:
 * DATE arrives as a millisecond number, BIGINT as a BigInt, DECIMAL as a scaled integer
 * array. The engine is opened with casts that turn BIGINT and DECIMAL into doubles;
 * this module handles the rest by looking at each column's Arrow type, never at the
 * first value (a column whose first row is null would otherwise lose its type).
 */
import { DataType, type Table } from "apache-arrow";
import type { Cell, Column, ColumnKind, QueryResult } from "./result";

function kindOf(type: DataType): ColumnKind {
  if (DataType.isDate(type) || DataType.isTimestamp(type)) return "date";
  if (DataType.isInt(type) || DataType.isFloat(type) || DataType.isDecimal(type)) return "number";
  if (DataType.isBool(type)) return "boolean";
  return "text";
}

function toMillis(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "bigint") return Number(value);
  return typeof value === "number" ? value : null;
}

function convert(value: unknown, type: DataType): Cell {
  if (value === null || value === undefined) return null;
  if (DataType.isDate(type)) {
    const ms = toMillis(value);
    return ms === null ? String(value) : new Date(ms).toISOString().slice(0, 10);
  }
  if (DataType.isTimestamp(type)) {
    const ms = toMillis(value);
    return ms === null ? String(value) : new Date(ms).toISOString().slice(0, 19).replace("T", " ");
  }
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean" || typeof value === "string") return value;
  if (DataType.isInt(type) || DataType.isFloat(type) || DataType.isDecimal(type)) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  // Lists, structs, intervals: show something readable rather than "[object Object]".
  try {
    return JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? Number(v) : v));
  } catch {
    return String(value);
  }
}

export function tableToResult(table: Table, elapsedMs = 0): QueryResult {
  const fields = table.schema.fields;
  const columns: Column[] = fields.map((field) => ({ name: field.name, kind: kindOf(field.type) }));
  const vectors = fields.map((_, index) => table.getChildAt(index));
  const rows: Cell[][] = [];
  for (let r = 0; r < table.numRows; r++) {
    rows.push(fields.map((field, c) => convert(vectors[c]?.get(r), field.type)));
  }
  return { columns, rows, elapsedMs };
}
