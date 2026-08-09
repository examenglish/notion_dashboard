// 학년별 기본 Lv — 초1=0.1 ~ 초6=0.6, 중1=1 ~ 중3=3, 고1=4 ~ 고3=6.
// 학생마스터의 "레벨Lv" 속성이 비어있으면(= 그 학년 평균 수준) 이 표의
// 값을 그대로 쓰고, 실제 레벨이 학년보다 높거나 낮으면 그 학생만 "레벨Lv"에
// override 값을 저장해 이 기본값을 벗어난다.
export const GRADE_DEFAULT_LEVEL: Record<string, number> = {
  초1: 0.1,
  초2: 0.2,
  초3: 0.3,
  초4: 0.4,
  초5: 0.5,
  초6: 0.6,
  중1: 1,
  중2: 2,
  중3: 3,
  고1: 4,
  고2: 5,
  고3: 6,
};

export function defaultLevelForGrade(grade: string | null): number | null {
  if (!grade) return null;
  return GRADE_DEFAULT_LEVEL[grade] ?? null;
}

// 학생별로 실제 적용되는 Lv — 직접 설정한 override가 있으면 그 값, 없으면
// 학년 기본값, 학년도 없으면 null(미분류).
export function effectiveLevel(grade: string | null, levelOverride: number | null): number | null {
  if (levelOverride !== null && levelOverride !== undefined) return levelOverride;
  return defaultLevelForGrade(grade);
}

export function formatLevel(level: number | null): string {
  if (level === null || level === undefined) return "-";
  return `Lv${level}`;
}

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

export const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"];

// 반의 담당교사가 요일마다, 심지어 같은 날 안에서도 교시마다 다를 수 있어
// (예: 월요일 1교시는 김선생, 2교시는 이선생, 3교시는 박선생),
// "월=1:김선생,2:이선생,3:박선생;수=1:김선생" 형태로 압축해 저장한다.
// 지정하지 않은 요일/교시는 반 전체 담당교사(담당교사 필드, teachers)를
// 그대로 따르는 것으로 취급한다 — 모든 교시가 같은 교사면 굳이 이 필드를
// 채우지 않아도 된다. 교시 번호는 문자열 키("1","2","3")로 둬 순서 상관없이
// 특정 교시만 지정(예: 2교시만)할 수 있게 한다.
export type DayTeachers = Record<string, Record<string, string>>;

export function parseDayTeachers(raw: string): DayTeachers {
  const result: DayTeachers = {};
  if (!raw) return result;
  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const day = trimmed.slice(0, eq).trim();
    const periods: Record<string, string> = {};
    for (const entry of trimmed.slice(eq + 1).split(",")) {
      const colon = entry.indexOf(":");
      if (colon < 0) continue;
      const period = entry.slice(0, colon).trim();
      const teacher = entry.slice(colon + 1).trim();
      if (period && teacher) periods[period] = teacher;
    }
    if (day && Object.keys(periods).length > 0) result[day] = periods;
  }
  return result;
}

export function serializeDayTeachers(dayTeachers: DayTeachers): string {
  return Object.entries(dayTeachers)
    .map(([day, periods]) => {
      const entries = Object.entries(periods)
        .filter(([, name]) => name)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([period, name]) => `${period}:${name}`)
        .join(",");
      return entries ? `${day}=${entries}` : "";
    })
    .filter(Boolean)
    .join(";");
}

// 반도 조교 근무시간과 같은 이유로 요일별 시간이 다를 수 있어(월 16~18시,
// 수 18~20시 등) "시간" 필드를 WorkHours 포맷으로 저장한다. 아직 이 포맷으로
// 저장되지 않은(=모든 요일에 공통 시간 하나였던 옛) 반은 parseWorkHours가
// 빈 맵을 돌려주므로, 그 경우엔 기존처럼 "요일 시간" 한 줄로 보여준다.
export function formatClassSchedule(days: string[], rawTime: string): string {
  const hours = parseWorkHours(rawTime);
  const structuredDays = WEEKDAYS.filter((d) => hours[d]);
  if (structuredDays.length > 0) {
    return structuredDays.map((d) => `${d} ${hours[d].start}-${hours[d].end}`).join(" · ");
  }
  if (days.length > 0 && rawTime) return `${days.join("·")} ${rawTime}`;
  if (days.length > 0) return days.join("·");
  return rawTime;
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
