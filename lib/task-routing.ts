// 근무시간/반 담당조교 기준 결정론적 업무 자동배정(섹션5). AI는 여기 관여하지
// 않는다 — "누구에게 배정할지"는 항상 이 함수가 정한다. Notion 접근과 분리해
// 테스트 가능한 순수 함수로 둔다: 호출부(lib/notion.ts 쪽 createTasks)가
// listStaff()/listClasses()/미완료 업무 카운트를 미리 조회해 넘긴다.
import type { WorkHours } from "./format";
import { isPoolableType, isAutoAssignablePool, taskPoolOf, type TaskType } from "./tasks";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

// 근무시간표가 완전히 비어있으면(강사/원장/행정 계정처럼 요일별 제한이
// 없는 경우) 항상 근무 중인 것으로 취급 — 기존 STAFF 근무시간표 관례와 동일.
export function isStaffWorkingAt(workHours: WorkHours, date: string, time: string): boolean {
  if (!time) return true;
  if (Object.keys(workHours).length === 0) return true;
  const weekday = WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
  const range = workHours[weekday];
  if (!range) return false;
  return time >= range.start && time < range.end;
}

export type StaffCandidate = {
  id: string;
  name: string;
  role: string | null;
  workHours: WorkHours;
  openTaskCount: number;
};

export type ClassInfo = {
  id: string;
  studentIds: string[];
  assistantIds: string[];
};

export type RouteInput = {
  type: TaskType;
  studentId: string | null;
  date: string;
  time: string;
  // 업무에 명시된 반(들) — 학생관리 업무의 반 확정에 쓴다.
  classIds?: string[];
  // 선행 업무가 아직 안 끝났으면(또는 선행 업무가 있는 후속 업무면) 사람에게 보내지 않는다.
  hasPendingDependency?: boolean;
};

export type RouteResult =
  | { assigned: true; staffId: string; reason: "class_owner" | "working_now" }
  | { assigned: false; pool: boolean };

// 미완료 업무가 적은 순으로, 동률이면 id 정렬로 — 랜덤 배정 금지(섹션5).
function pickLeastBusy(candidates: StaffCandidate[]): StaffCandidate {
  return [...candidates].sort((a, b) => a.openTaskCount - b.openTaskCount || a.id.localeCompare(b.id))[0];
}

// 학생관리 업무의 반 확정: 업무에 명시된 반과 학생 소속 반(반 명단 기준)의 교집합(명시 반이
// 없으면 학생 소속 반, 학생이 없으면 명시 반)이 정확히 하나일 때만 그 반.
export function resolveTaskClass(input: Pick<RouteInput, "studentId" | "classIds">, classes: ClassInfo[]): ClassInfo | null {
  const explicit = (input.classIds ?? []).filter(Boolean);
  const byStudent = input.studentId ? classes.filter((c) => c.studentIds.includes(input.studentId as string)).map((c) => c.id) : [];
  let ids: string[];
  if (explicit.length > 0 && byStudent.length > 0) ids = explicit.filter((id) => byStudent.includes(id));
  else ids = explicit.length > 0 ? explicit : byStudent;
  const unique = Array.from(new Set(ids));
  if (unique.length !== 1) return null;
  return classes.find((c) => c.id === unique[0]) ?? null;
}

export function routeTask(input: RouteInput, ctx: { staff: StaffCandidate[]; classes: ClassInfo[] }): RouteResult {
  // 선행 업무가 있는 후속 업무는 선행 완료 전 누구에게도 보내지 않는다.
  if (input.hasPendingDependency) return { assigned: false, pool: true };

  const kind = taskPoolOf(input.type);
  // 교재편집·행정: 직원별 처리 가능 업무 정보가 없으므로 사람을 고르지 않고 Pool에 둔다.
  if (!isAutoAssignablePool(kind)) return { assigned: false, pool: true };

  // 학생관리: 반이 하나로 확정되고, 그 반의 (재직 중인) 담당조교가 정확히 1명일 때만 그 조교에게.
  // "근무 중인 아무 조교"로는 보내지 않는다 — 모호하면 학생관리 Pool.
  if (kind === "student") {
    const cls = resolveTaskClass(input, ctx.classes);
    if (!cls) return { assigned: false, pool: true };
    const active = new Set(ctx.staff.map((s) => s.id));
    const assistants = Array.from(new Set(cls.assistantIds)).filter((id) => active.has(id));
    if (assistants.length === 1) return { assigned: true, staffId: assistants[0], reason: "class_owner" };
    return { assigned: false, pool: true };
  }

  // 출력·배부: 기존 정책 유지(반 담당조교 중 근무 중 → 근무 중 조교/행정, 업무량 적은 순).
  // 자동배정 대상은 조교/행정으로 한정한다(원장/강사는 자동배정 풀에서 제외).
  const pool = ctx.staff.filter((s) => s.role === "조교" || s.role === "행정");

  if (input.studentId) {
    const owningClasses = ctx.classes.filter((c) => c.studentIds.includes(input.studentId as string));
    const assistantIds = new Set(owningClasses.flatMap((c) => c.assistantIds));
    const workingOwners = pool.filter((s) => assistantIds.has(s.id) && isStaffWorkingAt(s.workHours, input.date, input.time));
    if (workingOwners.length > 0) {
      return { assigned: true, staffId: pickLeastBusy(workingOwners).id, reason: "class_owner" };
    }
  }

  const working = pool.filter((s) => isStaffWorkingAt(s.workHours, input.date, input.time));
  if (working.length > 0) {
    return { assigned: true, staffId: pickLeastBusy(working).id, reason: "working_now" };
  }

  return { assigned: false, pool: isPoolableType(input.type) };
}
