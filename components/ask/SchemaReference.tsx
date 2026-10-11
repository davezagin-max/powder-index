import schema from "@/public/data/schema.json";

/**
 * The tables a question can draw on. The text comes from dbt's model documentation by
 * way of the pipeline's export, the same source the model's prompt is built from.
 */
export function SchemaReference() {
  return (
    <details className="mt-3 rounded-md border border-border text-sm">
      <summary className="cursor-pointer px-3 py-2 font-medium">
        What can I ask about? {schema.tables.length} tables,{" "}
        {schema.tables.reduce((sum, table) => sum + table.columns.length, 0)} columns
      </summary>
      <div className="flex flex-col gap-5 border-t border-border p-3">
        {schema.tables.map((table) => (
          <div key={table.name}>
            <h3 className="font-mono text-sm font-semibold">{table.name}</h3>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">{table.description}</p>
            <dl className="mt-2 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
              {table.columns.map((column) => (
                <div key={column.name} className="min-w-0">
                  <dt className="font-mono">
                    {column.name} <span className="text-muted">{column.type.toLowerCase()}</span>
                  </dt>
                  <dd className="text-muted">{column.description}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </details>
  );
}
