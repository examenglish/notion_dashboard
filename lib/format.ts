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
