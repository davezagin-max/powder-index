import type { ComponentKey } from "@/lib/data/types";

/**
 * Chart colors by role, as CSS variables so light and dark each get their own steps.
 *
 * The six score components take the first six slots of the categorical palette in the
 * order they are stacked. That order is the one validated for adjacent-pair separation
 * under color-vision deficiency, which is what matters when segments touch.
 */
export const COMPONENT_COLOR: Record<ComponentKey, string> = {
  fresh_24h: "var(--s1)",
  fresh_72h: "var(--s2)",
  density: "var(--s3)",
  cold: "var(--s4)",
  base: "var(--s5)",
  forecast: "var(--s6)",
};

/** Categorical slots in fixed order. A series keeps its slot; a ninth is never generated. */
export const SERIES_COLORS = [
  "var(--s1)",
  "var(--s2)",
  "var(--s3)",
  "var(--s4)",
  "var(--s5)",
  "var(--s6)",
  "var(--s7)",
  "var(--s8)",
];
export const OTHER_COLOR = "var(--s-other)";

/** Tiers are ordered, so they use one hue from light to dark. */
export const TIER_COLOR: Record<string, string> = {
  off: "var(--tier-off)",
  firm: "var(--tier-firm)",
  soft: "var(--tier-soft)",
  powder: "var(--tier-powder)",
  epic: "var(--tier-epic)",
};

export function tierColor(tier: string): string {
  return TIER_COLOR[tier] ?? TIER_COLOR.off;
}
