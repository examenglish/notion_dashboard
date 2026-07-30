// Seed data named classes like "중2 A반 (5)" to keep them unique; the
// trailing "(n)" is bookkeeping only and shouldn't show up in the UI.
export function stripClassSuffix(name: string): string {
  return name.replace(/\s*\(\d+\)\s*$/, "");
}
