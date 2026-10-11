/** SQL with light highlighting. The validator emits keywords and functions in capitals. */
const TOKEN = /('(?:[^']|'')*')|(\b\d+(?:\.\d+)?\b)|(\b[A-Z][A-Z_]+\b)/g;

export function SqlBlock({ sql, label }: { sql: string; label: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of sql.matchAll(TOKEN)) {
    const at = match.index;
    if (at > last) parts.push(sql.slice(last, at));
    const [text, string, number] = match;
    parts.push(
      <span key={at} className={string ? "text-success" : number ? "text-warn" : "font-semibold text-accent"}>
        {text}
      </span>,
    );
    last = at + text.length;
  }
  if (last < sql.length) parts.push(sql.slice(last));
  return (
    <pre
      tabIndex={0}
      aria-label={label}
      className="max-h-[30rem] overflow-auto rounded-md border border-border bg-surface-2 p-3 font-mono text-[12.5px] leading-relaxed"
    >
      <code>{parts}</code>
    </pre>
  );
}
