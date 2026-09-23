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
};

export type RouteResult =
  | { assigned: true; staffId: string; reason: "class_owner" | "working_now" }
  | { assigned: false; pool: boolean };

// 미완료 업무가 적은 순으로, 동률이면 id 정렬로 — 랜덤 배정 금지(섹션5).
function pickLeastBusy(candidates: StaffCandidate[]): StaffCandidate {
  return [...candidates].sort((a, b) => a.openTaskCount - b.openTaskCount || a.id.localeCompare(b.id))[0];
}

export function routeTask(input: RouteInput, ctx: { staff: StaffCandidate[]; classes: ClassInfo[] }): RouteResult {
  // 직원별 처리 가능 업무 정보가 없는 전문 Pool(교재편집)은 사람을 고르지 않고 Pool에 둔다.
  if (!isAutoAssignablePool(taskPoolOf(input.type))) return { assigned: false, pool: true };

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
