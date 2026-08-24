import { parseNaturalLanguageInput, resolveRelativeDate } from "@/lib/anthropic";
import {
  listClasses,
  listStaff,
  searchStudents,
  createAdminInboxEntry,
  createScheduleEntry,
  createCounselingEntry,
  updateStudentInfo,
  createMinimalStudent,
} from "@/lib/notion";
import { todayKST } from "@/lib/date";
import { stripClassSuffix } from "@/lib/format";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

type StudentInfo = Awaited<ReturnType<typeof searchStudents>>[number];

// 이 문장들은 애초에 DB②에 없는 신입생 얘기라, 학생 매칭 자체를 건너뛴다 —
// 신입생 문의에서 이름을 억지로 fuzzy-match하면 엉뚱한 기존 학생에 잘못
// 붙을 위험이 있다.
const NEW_STUDENT_KEYWORDS = ["신입생", "신규생", "첫등원"];

// "/보강 박서재 내일 5시"처럼 맨 앞에 카테고리를 슬래시로 직접 지정하면,
// AI 분류(어느 tool을 쓸지) 단계를 완전히 건너뛰고 그 tool을 강제 호출한다
// — 잘못된 카테고리로 분류될 걱정 없이 정확한 위치에 저장된다. 나머지(학생
// 이름/날짜/시간 등) 추출은 그대로 AI가 맡는다. 자연어 입력 박스와 Slack
// 채널이 이 표를 공유한다 — 하나만 고치면 둘 다 바뀐다.
export const SLASH_COMMANDS: Record<
  string,
  {
    tool: "log_admin_inbox" | "log_schedule_entry" | "log_counseling" | "log_student_action";
    scheduleType?: "보강" | "재시" | "신입생상담" | "레벨체크";
    inboxType?: "결석예정" | "긴급상담요청" | "신규생문의" | "기타";
  }
> = {
  보강: { tool: "log_schedule_entry", scheduleType: "보강" },
  재시: { tool: "log_schedule_entry", scheduleType: "재시" },
  신입생상담: { tool: "log_schedule_entry", scheduleType: "신입생상담" },
  레벨체크: { tool: "log_schedule_entry", scheduleType: "레벨체크" },
  상담: { tool: "log_counseling" },
  조치: { tool: "log_student_action" },
  행정실: { tool: "log_admin_inbox" },
  결석: { tool: "log_admin_inbox", inboxType: "결석예정" },
  긴급상담: { tool: "log_admin_inbox", inboxType: "긴급상담요청" },
};

function candidateLabel(s: StudentInfo, classNameById: Map<string, string>): string {
  const classNames = (s.classIds ?? []).map((id) => classNameById.get(id)).filter((n): n is string => !!n);
  const classLabel = classNames.length > 0 ? classNames.join("·") : "반 미배정";
  return `${s.name} - ${s.school || "학교미상"} ${s.grade ?? ""} / ${classLabel}`.replace(/\s+/g, " ").trim();
}

// 이름이 여러 명이면 학교 -> 학년 -> 반 순서로, 입력 문장에 언급된 단서를 이용해
// 좁혀나간다. 어느 단계에서든 필터링 결과가 빈 집합이 되면(그 단서가 문장에
// 없거나 후보 중 아무도 해당 안 되는 경우) 그 단계는 건너뛰고 이전 집합을 유지한다.
function narrowCandidates(text: string, candidates: StudentInfo[], classNameById: Map<string, string>): StudentInfo[] {
  let pool = candidates;
  if (pool.length > 1) {
    const bySchool = pool.filter((s) => s.school && text.includes(s.school));
    if (bySchool.length > 0) pool = bySchool;
  }
  if (pool.length > 1) {
    const byGrade = pool.filter((s) => s.grade && text.includes(s.grade));
    if (byGrade.length > 0) pool = byGrade;
  }
  if (pool.length > 1) {
    const byClass = pool.filter((s) =>
      (s.classIds ?? []).some((id) => {
        const cn = classNameById.get(id);
        return !!cn && text.includes(cn);
      })
    );
    if (byClass.length > 0) pool = byClass;
  }
  return pool;
}

type StudentResolution =
  | { kind: "resolved"; studentId: string }
  | { kind: "not_found"; name: string }
  | { kind: "ambiguous"; candidates: StudentInfo[] }
  | { kind: "no_name" };

async function resolveStudentForIntent(
  text: string,
  name: string | undefined,
  students: StudentInfo[],
  classNameById: Map<string, string>,
  opts: { selectedStudentId?: string; confirmNewStudent?: boolean; forceNewStudent?: boolean; school?: string }
): Promise<StudentResolution> {
  if (opts.selectedStudentId) return { kind: "resolved", studentId: opts.selectedStudentId };

  if (opts.forceNewStudent) {
    if (!name) return { kind: "no_name" };
    const studentId = await createMinimalStudent(name, opts.school);
    return { kind: "resolved", studentId };
  }

  let candidates: StudentInfo[];
  if (name) {
    const exact = students.filter((s) => s.name === name);
    candidates = exact.length > 0 ? exact : students.filter((s) => s.name.includes(name) || name.includes(s.name));
  } else {
    candidates = students.filter((s) => s.name.length >= 2 && text.includes(s.name));
  }

  if (candidates.length === 0) {
    if (!name) return { kind: "no_name" };
    if (opts.confirmNewStudent) {
      const studentId = await createMinimalStudent(name, opts.school);
      return { kind: "resolved", studentId };
    }
    return { kind: "not_found", name };
  }
  if (candidates.length === 1) return { kind: "resolved", studentId: candidates[0].id };

  const narrowed = narrowCandidates(text, candidates, classNameById);
  if (narrowed.length === 1) return { kind: "resolved", studentId: narrowed[0].id };
  return { kind: "ambiguous", candidates: narrowed };
}

export type NlCommandResult =
  | { kind: "saved"; message: string }
  | { kind: "clarify"; message: string }
  | { kind: "not_found"; message: string; name: string }
  | { kind: "ambiguous"; message: string; candidates: { id: string; label: string }[] }
  | { kind: "missing_name"; message: string }
  | { kind: "ai_error"; message: string }
  | { kind: "save_error"; message: string };

// 자연어 입력 박스(app/api/nl-input/route.ts)와 Slack 채널(lib/slack.ts)이
// 공유하는 핵심 로직. 세션/HTTP 관련 처리(로그인 확인, /to do list, 학생
// 재선택 라운드트립 UI)는 각 호출부에 남겨두고, "문장 → AI 분류 → 학생
// 매칭 → 해당 DB 저장"까지만 여기서 담당한다.
export async function runNaturalLanguageCommand(
  text: string,
  opts: {
    staffName?: string;
    transcript?: string;
    forceTool?: "log_admin_inbox" | "log_schedule_entry" | "log_counseling" | "log_student_action";
    forcedScheduleType?: "보강" | "재시" | "신입생상담" | "레벨체크";
    forcedInboxType?: "결석예정" | "긴급상담요청" | "신규생문의" | "기타";
    selectedStudentId?: string;
    confirmNewStudent?: boolean;
    forceNewStudent?: boolean;
  }
): Promise<NlCommandResult> {
  const today = todayKST();

  if (!opts.forceTool && NEW_STUDENT_KEYWORDS.some((k) => text.includes(k))) {
    await createAdminInboxEntry({
      type: "신규생문의",
      studentId: null,
      content: text,
      startDate: today,
      enteredBy: opts.staffName,
    });
    return { kind: "saved", message: "행정실에 저장했습니다: 신규생문의" };
  }

  const [allStudents, classes, staff] = await Promise.all([searchStudents(""), listClasses(), listStaff()]);
  const activeStudents = allStudents.filter((s) => s.status === "재원" || !s.status);
  const classNameById = new Map(classes.map((c) => [c.id, stripClassSuffix(c.name)]));
  const weekday = WEEKDAYS[new Date(`${today}T00:00:00Z`).getUTCDay()];

  let parsed;
  try {
    parsed = await parseNaturalLanguageInput(
      text,
      {
        today,
        weekday,
        students: activeStudents.map((s) => `${s.name}(${s.school || "학교미상"})`),
        classes: classes.map((c) => stripClassSuffix(c.name)),
        staff: staff.map((s) => s.name),
      },
      opts.forceTool
    );
  } catch {
    return { kind: "ai_error", message: "AI 처리 중 오류가 발생했습니다." };
  }

  if (parsed.kind === "clarify") return { kind: "clarify", message: parsed.message };

  if (opts.forcedScheduleType && parsed.kind === "log_schedule_entry") parsed.input.type = opts.forcedScheduleType;
  if (opts.forcedInboxType && parsed.kind === "log_admin_inbox") parsed.input.type = opts.forcedInboxType;

  const input = parsed.input;
  const regexDate = resolveRelativeDate(text, today);
  const nameById = new Map(activeStudents.map((s) => [s.id, s.name]));
  const resolveOpts = {
    selectedStudentId: opts.selectedStudentId,
    confirmNewStudent: opts.confirmNewStudent,
    forceNewStudent: opts.forceNewStudent,
    school: input.studentSchool || undefined,
  };

  async function resolveOrReturn(name: string | undefined): Promise<{ studentId: string | null } | NlCommandResult> {
    const resolution = await resolveStudentForIntent(text, name, activeStudents, classNameById, resolveOpts);
    if (resolution.kind === "resolved") return { studentId: resolution.studentId };
    if (resolution.kind === "no_name") return { studentId: null };
    if (resolution.kind === "not_found") {
      return {
        kind: "not_found",
        name: resolution.name,
        message: `"${resolution.name}" 학생을 찾을 수 없습니다.`,
      };
    }
    return {
      kind: "ambiguous",
      message: "동명이인이 있어 확인이 필요합니다.",
      candidates: resolution.candidates.map((s) => ({ id: s.id, label: candidateLabel(s, classNameById) })),
    };
  }

  try {
    if (parsed.kind === "log_admin_inbox") {
      const result = await resolveOrReturn(input.studentName);
      if ("kind" in result) return result;
      const studentId = result.studentId;
      const studentName = studentId ? nameById.get(studentId) ?? input.studentName : undefined;
      await createAdminInboxEntry({
        type: input.type,
        studentId,
        content: input.content,
        startDate: regexDate ?? input.startDate ?? today,
        endDate: input.endDate || undefined,
        enteredBy: opts.staffName,
      });
      return { kind: "saved", message: `행정실에 저장했습니다: ${input.type}${studentName ? " · " + studentName : ""}` };
    }

    if (parsed.kind === "log_schedule_entry") {
      const result = await resolveOrReturn(input.studentName);
      if ("kind" in result) return result;
      const studentId = result.studentId;
      if (!studentId) return { kind: "missing_name", message: "학생 이름을 확인할 수 없습니다." };
      const date = regexDate ?? input.date ?? today;
      await createScheduleEntry({
        type: input.type,
        studentId,
        date,
        time: input.time || "",
        note: input.note || "",
        ownerName: input.ownerName || undefined,
      });
      return {
        kind: "saved",
        message: `${input.type} 일정으로 저장했습니다: ${nameById.get(studentId) ?? input.studentName} (${date})`,
      };
    }

    if (parsed.kind === "log_counseling") {
      const result = await resolveOrReturn(input.studentName);
      if ("kind" in result) return result;
      const studentId = result.studentId;
      if (!studentId) return { kind: "missing_name", message: "학생 이름을 확인할 수 없습니다." };
      const date = regexDate ?? input.date ?? today;
      await createCounselingEntry({
        studentId,
        counselor: input.counselor || "",
        date,
        transcript: opts.transcript ?? "",
        summary: input.summary,
        followUp: input.followUp || "",
        enteredBy: opts.staffName,
      });
      return { kind: "saved", message: `상담일지에 저장했습니다: ${nameById.get(studentId) ?? input.studentName} (${date})` };
    }

    if (parsed.kind === "log_student_action") {
      const result = await resolveOrReturn(input.studentName);
      if ("kind" in result) return result;
      const studentId = result.studentId;
      if (!studentId) return { kind: "missing_name", message: "학생 이름을 확인할 수 없습니다." };
      await updateStudentInfo({
        studentId,
        action: input.action,
        actionOwner: input.actionOwner || undefined,
        actionAlarmDate: regexDate ?? input.actionAlarmDate ?? today,
      });
      return { kind: "saved", message: `학생 조치사항을 저장했습니다: ${nameById.get(studentId) ?? input.studentName}` };
    }

    return { kind: "clarify", message: "요청을 이해하지 못했습니다. 다시 입력해 주세요." };
  } catch {
    return { kind: "save_error", message: "저장 중 오류가 발생했습니다." };
  }
}
