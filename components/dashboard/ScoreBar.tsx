import type { ComponentPoints } from "@/lib/data/select";
import { COMPONENT_COLOR } from "@/lib/ui/colors";

/**
 * The score as one stacked bar on a 0 to 100 track: each segment is the points one
 * component contributed, so the filled length is the score itself. Segments are
 * separated by a gap in the surface color rather than outlined.
 */
export function ScoreBar({ components, height = 10 }: { components: ComponentPoints[]; height?: number }) {
  const parts = components.filter((c) => (c.points ?? 0) > 0);
  return (
    <div
      className="flex w-full overflow-hidden rounded-[3px] bg-surface-2"
      style={{ height, gap: 2 }}
      aria-hidden
    >
      {parts.map((part) => (
        <div
          key={part.key}
          style={{ width: `${part.points}%`, background: COMPONENT_COLOR[part.key] }}
        />
      ))}
    </div>
  );
}

/** Color key for the score components. Always shown beside any stacked bar. */
export function ScoreLegend({
  labels,
  lead,
  className = "",
}: {
  labels: { key: ComponentPoints["key"]; label: string }[];
  /** A short label read before the keys, such as "Points from". */
  lead?: string;
  className?: string;
}) {
  return (
    <ul aria-label={lead} className={`flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted ${className}`}>
      {lead && (
        <li aria-hidden className="font-medium text-fg">
          {lead}
        </li>
      )}
      {labels.map((item) => (
        <li key={item.key} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-[2px]" style={{ background: COMPONENT_COLOR[item.key] }} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
