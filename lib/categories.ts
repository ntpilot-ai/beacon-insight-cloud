/**
 * Canonical category vocabulary — single source of truth for display.
 *
 * Storage and comparison everywhere (DB columns, acks, snapshots, Pulse
 * internals) use canonical snake_case. This module is the ONLY place
 * snake_case is mapped to a human label or a colour. Do not put Title Case
 * category literals in filters, comparisons, or equality paths — only here.
 */

export type Category =
  | "academic_integrity"
  | "self_harm"
  | "violence"
  | "bullying"
  | "inappropriate_content"
  | "substance"
  | "radicalization"
  | "jailbreak"
  | "general";

export const CATEGORY_LABEL: Record<string, string> = {
  academic_integrity:    "Academic Integrity",
  self_harm:             "Self-harm",
  violence:              "Violence",
  bullying:              "Bullying",
  inappropriate_content: "Inappropriate Content",
  substance:             "Substance",
  radicalization:        "Radicalisation",
  jailbreak:             "Jailbreak",
  general:               "General",
};

export const CATEGORY_COLOR: Record<string, string> = {
  academic_integrity:    "#0F766E",
  self_harm:             "#DC2626",
  violence:              "#B45309",
  bullying:              "#0369A1",
  inappropriate_content: "#DB2777",
  substance:             "#D97706",
  radicalization:        "#9333EA",
  jailbreak:             "#7C3AED",
  general:               "#64748b",
};

const FALLBACK_COLOR = "#64748b";

// Human label for a canonical category. Falls back to the raw value so an
// unmapped/legacy string is still readable rather than blank.
export function categoryLabel(category?: string | null): string {
  if (!category) return "";
  return CATEGORY_LABEL[category] ?? category;
}

export function categoryColor(category?: string | null): string {
  if (!category) return FALLBACK_COLOR;
  return CATEGORY_COLOR[category] ?? FALLBACK_COLOR;
}
