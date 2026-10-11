import { formatNumber } from "@/lib/chart/scale";
import type { Cell, QueryResult } from "@/lib/duck/result";

const MAX_ROWS = 200;

function show(cell: Cell, kind: string): string {
  if (cell === null) return "–";
  if (typeof cell === "number") return kind === "number" ? formatNumber(cell) : String(cell);
  if (typeof cell === "boolean") return cell ? "yes" : "no";
  return cell;
}

/** The rows as a table. This is also the accessible equivalent of every chart. */
export function ResultTable({ result, caption }: { result: QueryResult; caption: string }) {
  const rows = result.rows.slice(0, MAX_ROWS);
  return (
    <div className="flex flex-col gap-2">
      <div className="max-h-96 overflow-auto rounded-md border border-border" tabIndex={0} role="region" aria-label={caption}>
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 bg-surface-2 text-left text-xs text-muted">
            <tr>
              {result.columns.map((column) => (
                <th key={column.name} scope="col" className={`whitespace-nowrap px-3 py-2 font-medium ${column.kind === "number" ? "text-right" : ""}`}>
                  {column.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r} className="border-t border-border">
                {row.map((cell, c) => (
                  <td key={c} className={`whitespace-nowrap px-3 py-1.5 ${result.columns[c].kind === "number" ? "tabular text-right" : ""}`}>
                    {show(cell, result.columns[c].kind)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result.rows.length > MAX_ROWS && (
        <p className="text-xs text-muted">
          Showing the first {MAX_ROWS} of {result.rows.length.toLocaleString("en-US")} rows.
        </p>
      )}
    </div>
  );
}
