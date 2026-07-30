// Seed data named classes like "중2 A반 (5)" to keep them unique; the
// trailing "(n)" is bookkeeping only and shouldn't show up in the UI.
export function stripClassSuffix(name: string): string {
  return name.replace(/\s*\(\d+\)\s*$/, "");
}

// Deterministic color per class name, so the same 반 always renders the
// same badge color across the app without needing a stored color field.
const CLASS_COLORS = [
  "#2f6fed", "#22c55e", "#f59e0b", "#e5484d", "#8b5cf6",
  "#0ea5e9", "#d946ef", "#14b8a6", "#f97316", "#64748b",
];

export function classColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return CLASS_COLORS[hash % CLASS_COLORS.length];
}

// Muted, toned-down chart palette (slate blue / sage green / warm gray
// family) shared by the dashboard's donut charts and the per-class summary
// card, kept separate from classColor()'s saturated badge palette above.
export const CHART_COLORS = {
  slateBlue: "#6b7fa8",
  sageGreen: "#84a186",
  warmGray: "#a89f91",
  dustyRose: "#b98277",
  mutedAmber: "#c7a468",
  mutedTeal: "#6f9d94",
};
