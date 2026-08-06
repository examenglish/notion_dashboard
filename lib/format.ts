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

// 조교 근무시간이 요일마다 다를 수 있어(예: 월은 14~18시, 수는 16~20시),
// Notion에 새 요일별 속성을 여러 개 만드는 대신 리치텍스트 한 필드에
// "월=14:00-18:00;수=16:00-20:00" 형태로 압축해 저장한다. 서버(lib/notion.ts)와
// 클라이언트(StaffPicker/StaffScheduleForm) 양쪽에서 그대로 쓸 수 있도록
// 이 공용 파일에 둔다.
export type WorkHours = Record<string, { start: string; end: string }>;

export function parseWorkHours(raw: string): WorkHours {
  const result: WorkHours = {};
  if (!raw) return result;
  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const day = trimmed.slice(0, eq).trim();
    const range = trimmed.slice(eq + 1).trim();
    const dash = range.indexOf("-");
    if (!day || dash < 0) continue;
    const start = range.slice(0, dash).trim();
    const end = range.slice(dash + 1).trim();
    if (!start || !end) continue;
    result[day] = { start, end };
  }
  return result;
}

export function serializeWorkHours(hours: WorkHours): string {
  return Object.entries(hours)
    .filter(([, v]) => v.start && v.end)
    .map(([day, v]) => `${day}=${v.start}-${v.end}`)
    .join(";");
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
