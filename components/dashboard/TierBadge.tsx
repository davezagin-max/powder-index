import type { Tier } from "@/lib/data/types";
import { tierColor } from "@/lib/ui/colors";

/** Tier as a swatch plus its name: the color is never the only signal. */
export function TierBadge({ tier, className = "" }: { tier: Tier; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium text-muted ${className}`}>
      <span aria-hidden className="size-2.5 rounded-full" style={{ background: tierColor(tier.tier) }} />
      {tier.label}
    </span>
  );
}
