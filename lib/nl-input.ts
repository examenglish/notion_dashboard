import {
  parseNaturalLanguageInput,
  parseCreateTasksInput,
  parseUnifiedInput,
  parsePendingAnswer,
  resolveRelativeDate,
  type UnifiedIntent,
  type IntentClass,
} from "@/lib/anthropic";
import {
  createAdminInboxEntry,
  createScheduleEntry,
  createCounselingEntry,
  updateStudentInfo,
  createMinimalStudent,
  createTasks,
  getNlRoster,
  getAttendanceOnDate,
  saveClassProgressFromText,
  listClassProgressPeriods,
  saveStudentLearningRecord,
  linkLearningRecordTask,
  type ProgressEditMode,
  type LineChange,
  type LearningRecordType,
  listRecentLearningRecords,
  updateLearningRecord,
  cancelLearningRecord,
  getLinkedTask,
  cancelTaskForRecord,
  retargetTaskStudent,
  findClassProgressRow,
  listRecentClassProgressByUser,
  correctClassProgressRow,
  mergeProgressText,
  getActiveLearningRecord,
  getClassProgressRowById,
  listExamAiHistoryRows,
  getTodaySchedule,
  listMyTasks,
} from "@/lib/notion";
import { createHash, createHmac, timingSafeEqual } from "crypto";
import { todayKST } from "@/lib/date";
import { stripClassSuffix } from "@/lib/format";
import { TASK_TYPE_LABELS, TASK_TYPE_LABEL_LIST, taskTypeFromLabel, type NewTaskInput } from "@/lib/tasks";
import { mark } from "@/lib/timing";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

type StudentInfo = Awaited<ReturnType<typeof getNlRoster>>["students"][number];

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

// "/보강 박서재 내일 5시" 같은 슬래시 명령 파싱 — /api/nl-input과 /api/ai-input
// 둘 다 이 로직이 필요해서(응답 매핑은 각자 다르므로 그건 각 라우트에 남기고)
// 파싱 자체만 여기로 뽑아 중복을 막는다.
export function parseSlashCommand(text: string): {
  isSlashCommand: boolean;
  rest: string;
  forceTool?: (typeof SLASH_COMMANDS)[string]["tool"];
  forcedScheduleType?: (typeof SLASH_COMMANDS)[string]["scheduleType"];
  forcedInboxType?: (typeof SLASH_COMMANDS)[string]["inboxType"];
} {
  const slashMatch = text.match(/^\/\s*(\S+)\s+([\s\S]+)$/);
  const cmd = slashMatch ? SLASH_COMMANDS[slashMatch[1]] : undefined;
  if (!slashMatch || !cmd) return { isSlashCommand: false, rest: text };
  return {
    isSlashCommand: true,
    rest: slashMatch[2].trim(),
    forceTool: cmd.tool,
    forcedScheduleType: cmd.scheduleType,
    forcedInboxType: cmd.inboxType,
  };
}

// "/to do list ..." — AI 분류를 거치지 않는 결정론적 개인 할일 명령.
export function matchToDoListShortcut(text: string): string | null {
  const m = text.match(/^\/\s*to\s*do\s*list\b\s*([\s\S]*)$/i);
  return m ? m[1].trim() : null;
}

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

// intent.className(LLM이 뽑은 반 이름 문자열)을 실제 반 id로 resolve한다.
// classes는 이미 branch_id로 스코프된 getNlRoster() 결과이므로 이 매칭도
// 자동으로 그 지점 반으로만 좁혀진다(다른 지점 반은 애초에 목록에 없음).
// 정확히 일치하는 반이 없으면 부분 일치(접두/포함)로 완화해 찾는다 —
// LLM이 접미사(반/조 등)를 붙이거나 뗀 형태로 돌려줄 수 있어서다.
function resolveClassIds(className: string | undefined, classes: { id: string; name: string }[]): string[] {
  const trimmed = className?.trim();
  if (!trimmed) return [];
  const exact = classes.filter((c) => stripClassSuffix(c.name) === trimmed);
  if (exact.length > 0) return exact.map((c) => c.id);
  const partial = classes.filter((c) => {
    const cn = stripClassSuffix(c.name);
    return cn.includes(trimmed) || trimmed.includes(cn);
  });
  return partial.map((c) => c.id);
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
  mark("legacy:start");
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

  mark("legacy:before_getNlRoster");
  const { students: allStudents, classes, staff } = await getNlRoster();
  mark("legacy:after_getNlRoster");
  const activeStudents = allStudents.filter((s) => s.status === "재원" || !s.status);
  const classNameById = new Map(classes.map((c) => [c.id, stripClassSuffix(c.name)]));
  const weekday = WEEKDAYS[new Date(`${today}T00:00:00Z`).getUTCDay()];

  let parsed;
  mark("legacy:before_llm");
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
    mark("legacy:after_llm");
  } catch {
    mark("legacy:after_llm_error");
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

  mark("legacy:before_save_section");
  try {
    if (parsed.kind === "log_admin_inbox") {
      const result = await resolveOrReturn(input.studentName);
      if ("kind" in result) return result;
      const studentId = result.studentId;
      const studentName = studentId ? nameById.get(studentId) ?? input.studentName : undefined;
      mark("legacy:before_write");
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
      mark("legacy:before_write");
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
      mark("legacy:before_write");
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
      mark("legacy:before_write");
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

// ---------------------------------------------------------------------------
// AI 업무운영 시스템(섹션3) — "한 문장 → 여러 업무" 생성 전용 경로.
// 위 runNaturalLanguageCommand는 그대로 두고 완전히 별도 함수로 둔다 — 기존
// 대시보드 입력창/Slack 슬래시태그가 이 함수를 호출하는 일은 없다(전용
// 엔드포인트 app/api/tasks/from-text/route.ts에서만 사용).
// ---------------------------------------------------------------------------
export type CreateTasksCommandResult =
  | {
      kind: "created";
      tasks: { id: string; typeLabel: string; studentName: string; ownerName: string | null; pool: boolean }[];
      warnings: string[];
    }
  | { kind: "clarify"; message: string }
  | { kind: "ai_error"; message: string }
  | { kind: "save_error"; message: string };

export async function runCreateTasksCommand(
  text: string,
  opts: { staffName?: string; parentTaskId?: string | null } = {}
): Promise<CreateTasksCommandResult> {
  mark("ct:start");
  const today = todayKST();
  mark("ct:before_getNlRoster");
  const { students: allStudents, classes, staff } = await getNlRoster();
  mark("ct:after_getNlRoster");
  const activeStudents = allStudents.filter((s) => s.status === "재원" || !s.status);
  const classNameById = new Map(classes.map((c) => [c.id, stripClassSuffix(c.name)]));
  const weekday = WEEKDAYS[new Date(`${today}T00:00:00Z`).getUTCDay()];

  let parsed;
  mark("ct:before_llm");
  try {
    parsed = await parseCreateTasksInput(
      text,
      {
        today,
        weekday,
        students: activeStudents.map((s) => `${s.name}(${s.school || "학교미상"})`),
        classes: classes.map((c) => stripClassSuffix(c.name)),
        staff: staff.map((s) => s.name),
      },
      TASK_TYPE_LABEL_LIST
    );
    mark("ct:after_llm");
  } catch {
    mark("ct:after_llm_error");
    return { kind: "ai_error", message: "AI 처리 중 오류가 발생했습니다." };
  }
  if (parsed.kind === "clarify") { mark("ct:clarify"); return { kind: "clarify", message: parsed.message }; }
  if (parsed.tasks.length === 0) return { kind: "clarify", message: "업무를 파악하지 못했습니다. 다시 입력해 주세요." };

  const regexDate = resolveRelativeDate(text, today);
  const warnings: string[] = [];
  const inputs: NewTaskInput[] = [];

  for (const draft of parsed.tasks) {
    const type = taskTypeFromLabel(draft.type);
    if (!type) {
      warnings.push(`"${draft.type}"은(는) 알 수 없는 업무 유형이라 건너뛰었습니다.`);
      continue;
    }

    let studentId: string | null = null;
    let forcePool = false;
    if (draft.studentName) {
      const resolution = await resolveStudentForIntent(text, draft.studentName, activeStudents, classNameById, {
        school: draft.studentSchool || undefined,
      });
      if (resolution.kind === "resolved") {
        studentId = resolution.studentId;
      } else {
        // 어느 학생인지 특정 못 하면 아무 조교에게나 자동배정하지 않고
        // 공용업무풀로 보낸다(누구든 열어서 학생을 직접 확인하도록).
        forcePool = true;
        warnings.push(`"${draft.studentName}" 학생을 정확히 찾지 못해 공용업무풀에 등록했습니다 — 확인 후 담당자를 지정해주세요.`);
      }
    }

    inputs.push({
      type,
      studentId,
      content: draft.content || "",
      date: draft.date || regexDate || today,
      time: draft.time || "",
      priority: draft.priority,
      parentTaskId: opts.parentTaskId ?? undefined,
      forcePool,
    });
  }

  if (inputs.length === 0) return { kind: "clarify", message: "등록할 수 있는 업무가 없습니다." };

  try {
    mark("ct:before_createTasks_write");
    // allStudents는 getNlRoster() 안에서 studentNameMap()과 똑같이
    // searchStudents("")로 채워진 것이라, 이 Map은 createTasks가 내부에서
    // studentNameMap()을 다시 불렀을 때와 결과가 동일하다 — 그래서
    // 중복 조회 없이 그대로 재사용해도 동작이 안 바뀐다.
    const studentNames = new Map(allStudents.map((s) => [s.id, s.name]));
    const created = await createTasks(inputs, { staff, classes, studentNames });
    mark("ct:after_createTasks_write");
    const staffNameById = new Map(staff.map((s) => [s.id, s.name]));
    const nameById = new Map(activeStudents.map((s) => [s.id, s.name]));
    return {
      kind: "created",
      tasks: created.map((c, i) => ({
        id: c.id,
        typeLabel: TASK_TYPE_LABELS[c.type],
        studentName: inputs[i].studentId ? nameById.get(inputs[i].studentId as string) ?? "" : "",
        ownerName: c.ownerId ? staffNameById.get(c.ownerId) ?? null : null,
        pool: c.pool,
      })),
      warnings,
    };
  } catch {
    return { kind: "save_error", message: "저장 중 오류가 발생했습니다." };
  }
}

// ---------------------------------------------------------------------------
// 통합 자연어 입력 오케스트레이터(2026-09-19, staff.md PART 8) —
// app/api/ai-input의 자유 텍스트 경로 전용. 기존 waterfall(runCreateTasksCommand
// 시도 → clarify면 runNaturalLanguageCommand로 재시도, LLM 2회)을 대체한다.
// parseUnifiedInput 한 번으로 문장을 여러 intent로 나눈 뒤, intent별로
// 기존 저장 함수(createAdminInboxEntry 등, 안 건드림)나 postgres-primary
// createTasks, 신규 조회 전용 getAttendanceOnDate로 개별 라우팅한다.
// intent 하나가 실패해도 catch로 격리해 나머지는 계속 처리하고, 전체
// 요청이 500으로 죽지 않게 한다(2026-09-19 "암기확인" 500 사고 재발 방지).
//
// 알려진 단순화(의도적, 위험 낮음): schedule/counseling/student_action은
// 학생 1명 매칭만 지원(원래도 단일학생 기록), 이름이 명단에 없어도 여기서는
// (신입생 확인/동명이인 후보선택 같은) 대화형 라운드트립 없이 바로 실패로
// 표시한다 — 그런 경우는 기존 단일 카테고리 입력(슬래시 명령)을 쓰도록
// 안내한다. resolveRelativeDate 기반 전역 날짜 보정도 이 경로에는 적용
// 안 함(intent별 date 필드를 그대로 신뢰) — 여러 intent가 서로 다른 날짜를
// 언급할 수 있어 문장 전체에 획일 적용하면 오히려 틀릴 수 있어서다.
// ---------------------------------------------------------------------------

export type UnifiedOutcome = {
  route: string;
  label: string;
  status: "완료" | "확인필요" | "실패";
  message: string;
  // 실행에 꼭 필요한 정보가 부족할 때 — 화면이 이 값을 보관했다가 다음 답변과
  // 함께 /api/ai-input { pending }으로 돌려보낸다(continuePendingInput).
  pending?: PendingAction;
  // 이 결과가 확정한 반/날짜/교시 — 화면이 다음 입력의 반 문맥으로 재사용한다.
  context?: ClassContext;
};

// 직전 입력의 반 문맥(화면이 보관했다가 다음 요청에 함께 보낸다). 같은 날짜일 때만
// 쓰고, 학생이 그 반 소속이 아니면 쓰지 않는다(다른 반에 잘못 기록 방지).
export type ClassContext = { classId: string; className: string; date: string; period: string };

// ---------------------------------------------------------------------------
// 대화형 보완(pending action). 무거운 대화 세션 없이, 이미 구조화한 draft와
// "실행에 꼭 필요한데 비어있는 항목(missing)"만 클라이언트가 들고 있다가
// 다음 답변과 함께 돌려준다. 원칙:
//  - 필수(missing)만 묻는다: 반/학생 특정 불가, 업무 종류 불명, 지정 담당자
//    불명, 진도·과제 둘 다 없음. 담당자 미지정(→업무풀), 마감시간 없음,
//    과제 없음(진도만 있는 수업) 같은 선택(optional) 항목은 묻지 않는다.
//  - 여러 개가 부족하면 한 번에 묻고, 일부만 답하면 받은 건 유지하고 남은 것만 다시 묻는다.
//  - 답변은 전체 명령으로 재해석하지 않는다(부족 항목 1개면 LLM 없이 그대로 사용).
// ---------------------------------------------------------------------------
export type PendingField =
  | "class"
  | "student"
  | "owner"
  | "taskType"
  | "content"
  | "period"
  // 정정(correction) 전용
  | "target"
  | "operation"
  | "change"
  | "pass"
  | "task"
  | "newStudent"
  | "field";
export type MissingInfo = { key: string; field: PendingField; question: string; candidates?: { id: string; label: string }[]; ref?: string };
type Choice = { id: string; label: string };

export type ClassProgressDraft = {
  kind: "class_progress";
  className: string;
  classId: string | null;
  date: string;
  progress: string;
  homework: string;
  period: string;
  mode?: ProgressEditMode;
  enteredBy?: string;
  rawText?: string;
};
export type StudentRecordDraft = {
  kind: "student_record";
  studentName: string;
  studentId: string | null;
  className: string;
  classId: string | null;
  // 반이 직전 입력 문맥에서 온 것이면, 학생이 그 반 소속이 아닐 때 추측하지 않고 버린다.
  classFromContext?: boolean;
  date: string;
  period: string;
  recordType: LearningRecordType;
  assessmentName: string;
  score: number | null;
  maxScore: number | null;
  passed: boolean | null;
  retestRequired: boolean | null;
  completed: boolean | null;
  note: string;
  followUp: string;
  actionRequested: boolean;
  taskType: string;
  instruction: string;
  enteredBy?: string;
  rawText: string;
};
export type TaskDraft = {
  kind: "task";
  taskType: string;
  instruction: string;
  material: string;
  quantity: number | null;
  date: string;
  time: string;
  priority?: "긴급" | "보통";
  classIds: string[];
  students: { id: string; name: string }[];
  unresolved: string[];
  ambiguous: { name: string; candidates: Choice[] }[];
  ownerName: string;
  ownerId: string | null;
  ownerToPool?: boolean;
  createdBy?: string;
};
// 이미 입력한 기록의 자연어 정정(수정/취소). 대상은 DB에서 찾고(최근 24시간), 하나로
// 확정되고 바꿀 내용이 분명할 때만 실행한다. 선택된 대상 id는 "slr:<학생기록 id>" 또는
// "cp:<class_progress id>" — 실행 직전에 DB에서 다시 읽어 확인한다.
export type CorrectionDraft = {
  kind: "correction";
  target: "student_record" | "class_progress" | "recent";
  operation: "modify" | "cancel" | "unknown";
  studentNames: string[];
  className: string;
  classId: string | null;
  period: string;
  date: string;
  recordType: string;
  assessmentName: string;
  oldScore: number | null;
  selectedId: string | null;
  selectedLabel: string;
  newScore: number | null;
  newMaxScore: number | null;
  newPassed: boolean | null;
  newRetestRequired: boolean | null;
  newCompleted: boolean | null;
  newStudentName: string;
  newStudentId: string | null;
  newPeriod: string;
  field: "progress" | "homework" | "";
  fromText: string;
  toText: string;
  passDecision: "pass" | "fail" | "keep" | null;
  taskDecision: "cancel" | "keep" | null;
  // 대상 없음 등 실행 불가 사유(되묻지 않고 그대로 안내)
  error: string;
  enteredBy?: string;
  rawText: string;
};

export type AnyDraft = ClassProgressDraft | TaskDraft | StudentRecordDraft | CorrectionDraft;
export type PendingAction = { draft: AnyDraft; missing: MissingInfo[]; question: string; attempts: number };

type Roster = Awaited<ReturnType<typeof getNlRoster>>;
const POOL_ANSWER = /업무풀|풀로|아무나|미지정|없음/;
const norm = (v: string) => v.replace(/\s+/g, "").toLowerCase();

// draft를 보고 비어있는 필수 항목을 채울 수 있으면 채우고(결정론적 매칭),
// 그래도 비어있는 것만 missing으로 돌려준다.
async function checkDraft(draft: AnyDraft, roster: Roster): Promise<MissingInfo[]> {
  const missing: MissingInfo[] = [];
  if (draft.kind === "class_progress") {
    if (!draft.classId) {
      const found = resolveClassCandidates(draft.className, roster.classes);
      if (found.length === 1) {
        draft.classId = found[0].id;
        draft.className = found[0].name;
      } else if (found.length > 1) {
        missing.push({
          key: "class",
          field: "class",
          question: `"${draft.className}"에 해당하는 반이 여러 개입니다(${found.map((c) => c.name).join(", ")}). 어느 반인가요?`,
          candidates: found.map((c) => ({ id: c.id, label: c.name })),
        });
      } else {
        missing.push({
          key: "class",
          field: "class",
          question: draft.className ? `"${draft.className}" 반을 찾지 못했습니다. 어느 반인가요?` : "어느 반의 수업인가요?",
        });
      }
    }
    // 교시: 그날 이 반이 여러 교시로 나뉘는데 교시를 안 밝혔으면 필수로 묻는다
    // (교시 없이 저장하면 교시별 기록과 섞인다). 판단 근거는 반 시간표(요일별
    // 담당교사)의 교시 수가 2개 이상이거나, 그날 이미 교시별로 저장된 기록이
    // 있는 경우. 교시가 하나뿐인 반은 묻지 않고 기존처럼 저장한다.
    if (draft.classId && !draft.period) {
      const scheduled = scheduledPeriods(draft.classId, draft.date, roster);
      const existing = await listClassProgressPeriods(draft.classId, draft.date);
      if (scheduled.length >= 2 || existing.length > 0) {
        let periods = Array.from(new Set([...scheduled, ...existing])).sort((a, b) => parseInt(a) - parseInt(b));
        // 기존 교시 기록이 하나뿐이면 다음 교시도 고를 수 있게 한다.
        if (periods.length < 2) periods = [...periods, `${Math.max(...periods.map((p) => parseInt(p))) + 1}교시`];
        missing.push({
          key: "period",
          field: "period",
          question: `${draft.date === todayKST() ? "오늘" : draft.date} ${draft.className} 수업은 여러 교시가 있습니다. 어느 교시인가요?`,
          candidates: periods.map((p) => ({ id: p, label: p })),
        });
      }
    }
    if (!draft.progress && !draft.homework) {
      missing.push({ key: "content", field: "content", question: "오늘 수업 진도(또는 과제)는 무엇인가요?" });
    }
    return missing;
  }

  if (draft.kind === "student_record") return checkStudentRecordDraft(draft, roster);
  if (draft.kind === "correction") return checkCorrectionDraft(draft, roster);

  if (!taskTypeFromLabel(draft.taskType)) {
    missing.push({ key: "taskType", field: "taskType", question: `어떤 작업인가요? (예: ${TASK_TYPE_LABEL_LIST.slice(0, 6).join(", ")} …)` });
  }
  draft.ambiguous.forEach((a, i) => {
    missing.push({
      key: `student${i}`,
      field: "student",
      ref: a.name,
      question: `${a.name} 학생이 여러 명입니다(${a.candidates.map((c) => c.label).join(" / ")}). 어느 학생인가요?`,
      candidates: a.candidates,
    });
  });
  if (draft.ownerName && !draft.ownerId && !draft.ownerToPool) {
    const owner = resolveStaffByName(draft.ownerName, roster.staff);
    if (owner && owner !== "ambiguous") {
      draft.ownerId = owner.id;
      draft.ownerName = owner.name;
    } else {
      const cands = staffCandidates(draft.ownerName, roster.staff);
      missing.push({
        key: "owner",
        field: "owner",
        question:
          owner === "ambiguous"
            ? `"${draft.ownerName}"에 해당하는 직원이 여러 명입니다. 누구에게 맡길까요?`
            : `"${draft.ownerName}" 직원을 찾지 못했습니다. 누구에게 맡길까요? ("업무풀"이라고 답하면 조교 업무풀로 보냅니다)`,
        candidates: cands.length > 0 ? cands : undefined,
      });
    }
  }
  return missing;
}

// 교시는 "N교시" 형태로만 인식한다("1교시"/"1 교시" → "1교시", 수업기록 화면
// InputClient의 교시 값과 동일 형식). 되묻기 답변에서는 숫자만("2") 와도 허용.
export function normalizePeriod(raw: string | undefined | null, allowBareNumber = false): string {
  const v = (raw ?? "").trim();
  const m = v.match(/(\d+)\s*교시/) ?? (allowBareNumber ? v.match(/^(\d+)$/) : null);
  return m && Number(m[1]) > 0 ? `${Number(m[1])}교시` : "";
}

// 반 시간표(요일별담당교사 "월=1:김쌤,2:이쌤")에서 그 날짜 요일의 교시 목록.
function scheduledPeriods(classId: string, date: string, roster: Roster): string[] {
  const cls = roster.classes.find((c) => c.id === classId);
  const weekday = WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
  const byPeriod = cls?.dayTeachers?.[weekday] ?? {};
  return Object.keys(byPeriod)
    .map((p) => normalizePeriod(p, true))
    .filter(Boolean)
    .sort((a, b) => parseInt(a) - parseInt(b));
}

// 직전 입력 반 문맥은 같은 날짜 + 지금도 존재하는 반일 때만 쓴다.
function usableContext(ctx: ClassContext | null | undefined, date: string, roster: Roster): ClassContext | null {
  if (!ctx || !ctx.classId || ctx.date !== date) return null;
  return roster.classes.some((c) => c.id === ctx.classId) ? ctx : null;
}

function studentInClass(studentId: string, classId: string, roster: Roster): boolean {
  const cls = roster.classes.find((c) => c.id === classId);
  const st = roster.students.find((x) => x.id === studentId);
  return !!cls?.studentIds.includes(studentId) || !!st?.classIds?.includes(classId);
}

function classIdsOfStudent(studentId: string, roster: Roster): string[] {
  const st = roster.students.find((x) => x.id === studentId);
  const ids = new Set<string>(st?.classIds ?? []);
  for (const c of roster.classes) if (c.studentIds.includes(studentId)) ids.add(c.id);
  return Array.from(ids).filter((id) => roster.classes.some((c) => c.id === id));
}

// 학생 기록: 반(명시) → 학생 → 반(학생 소속) 순으로 확정. 학생 A 기록이 학생 B에게
// 가지 않도록 동명이인·반 불일치는 추측하지 않고 되묻는다. 명단에 없는 학생은 만들지 않는다.
function checkStudentRecordDraft(draft: StudentRecordDraft, roster: Roster): MissingInfo[] {
  const missing: MissingInfo[] = [];
  const classNameById = new Map(roster.classes.map((c) => [c.id, stripClassSuffix(c.name)]));
  if (!draft.classId && draft.className) {
    const found = resolveClassCandidates(draft.className, roster.classes);
    if (found.length === 1) {
      draft.classId = found[0].id;
      draft.className = found[0].name;
    } else {
      missing.push({
        key: "class",
        field: "class",
        question: found.length > 1 ? `"${draft.className}"에 해당하는 반이 여러 개입니다. 어느 반인가요?` : `"${draft.className}" 반을 찾지 못했습니다. 어느 반인가요?`,
        candidates: found.length > 1 ? found.map((c) => ({ id: c.id, label: c.name })) : undefined,
      });
      return missing;
    }
  }

  if (!draft.studentId) {
    const active = roster.students.filter((x) => x.status === "재원" || !x.status);
    const name = draft.studentName.trim();
    const exact = active.filter((x) => x.name === name);
    let cands = exact.length > 0 ? exact : active.filter((x) => !!name && (x.name.includes(name) || name.includes(x.name)));
    if (draft.classId) {
      const inClass = cands.filter((x) => studentInClass(x.id, draft.classId!, roster));
      if (inClass.length > 0) cands = inClass;
      else if (draft.classFromContext) {
        // 직전 입력의 반 문맥은 추측일 뿐 — 그 반 학생이 아니면 문맥을 버리고 학생 소속 반으로 판단한다.
        draft.classId = null;
        draft.className = "";
        draft.period = "";
        draft.classFromContext = false;
      }
    }
    if (cands.length > 1) {
      const narrowed = narrowCandidates(draft.rawText, cands, classNameById);
      if (narrowed.length >= 1) cands = narrowed;
    }
    if (cands.length === 1 && (!draft.classId || studentInClass(cands[0].id, draft.classId, roster))) {
      draft.studentId = cands[0].id;
      draft.studentName = cands[0].name;
    } else if (cands.length === 1) {
      missing.push({
        key: "student",
        field: "student",
        ref: name,
        question: `${cands[0].name} 학생은 ${draft.className} 소속이 아닙니다(${candidateLabel(cands[0], classNameById)}). 이 학생이 맞나요?`,
        candidates: [{ id: cands[0].id, label: candidateLabel(cands[0], classNameById) }],
      });
    } else if (cands.length > 1) {
      missing.push({
        key: "student",
        field: "student",
        ref: name,
        question: `${name} 학생이 여러 명입니다(${cands.map((c) => candidateLabel(c, classNameById)).join(" / ")}). 어느 학생인가요?`,
        candidates: cands.map((c) => ({ id: c.id, label: candidateLabel(c, classNameById) })),
      });
    } else {
      missing.push({ key: "student", field: "student", ref: name, question: `명단에서 "${name}" 학생을 찾지 못했습니다. 학생 이름을 다시 알려주세요.` });
    }
  }

  if (draft.studentId && !draft.classId) {
    const ids = classIdsOfStudent(draft.studentId, roster);
    if (ids.length === 1) {
      draft.classId = ids[0];
      draft.className = classNameById.get(ids[0]) ?? "";
    } else if (ids.length > 1) {
      missing.push({
        key: "class",
        field: "class",
        question: `${draft.studentName} 학생이 여러 반에 있습니다. 어느 반 수업 기록인가요?`,
        candidates: ids.map((id) => ({ id, label: classNameById.get(id) ?? id })),
      });
    }
  }
  return missing;
}

function staffCandidates(name: string, staff: { id: string; name: string; role?: string | null }[]): Choice[] {
  const n = name.trim().replace(/(쌤|선생님|조교님|조교|님)$/, "");
  return staff
    .filter((s) => n && (s.name.includes(n) || n.includes(s.name)))
    .map((s) => ({ id: s.id, label: `${s.name}${s.role ? ` (${s.role})` : ""}` }));
}

function buildQuestion(draft: AnyDraft, missing: MissingInfo[]): string {
  const prefix =
    draft.kind === "class_progress" && draft.progress && missing.every((m) => m.field !== "content")
      ? `오늘 진도는 "${draft.progress}"(으)로 확인했습니다. `
      : "";
  if (missing.length === 1) return prefix + missing[0].question;
  const what =
    draft.kind === "class_progress"
      ? "진도를 저장하려면"
      : draft.kind === "student_record"
        ? "학생 기록을 저장하려면"
        : draft.kind === "correction"
          ? "기록을 정정하려면"
          : "업무를 등록하려면";
  const marks = ["①", "②", "③", "④", "⑤"];
  return `${prefix}${what} ${missing.length}가지 정보가 더 필요합니다.\n${missing.map((m, i) => `${marks[i] ?? `${i + 1}.`} ${m.question}`).join("\n")}`;
}

function pendingOutcome(draft: AnyDraft, missing: MissingInfo[], attempts: number, note = ""): UnifiedOutcome {
  const question = buildQuestion(draft, missing);
  return {
    route: draft.kind,
    label:
      draft.kind === "class_progress"
        ? draft.className || "반 진도"
        : draft.kind === "student_record"
          ? draft.studentName || "학생 기록"
          : draft.kind === "correction"
            ? draft.selectedLabel || "기록 정정"
            : draft.taskType || "업무",
    status: "확인필요",
    message: note ? `${note}\n${question}` : question,
    pending: { draft, missing, question, attempts },
  };
}

// 답변 값 하나를 missing 항목 하나에 적용한다. 적용됐으면 true.
function applyValue(draft: AnyDraft, m: MissingInfo, value: string, roster: Roster, choiceId?: string): boolean {
  const v = value.trim();
  const pick = (cands: Choice[] | undefined): Choice | null => {
    if (!cands || cands.length === 0) return null;
    if (choiceId) return cands.find((c) => c.id === choiceId) ?? null;
    const hits = cands.filter((c) => norm(c.label).includes(norm(v)) || norm(v).includes(norm(c.label)));
    return hits.length === 1 ? hits[0] : null;
  };
  if (!v && !choiceId) return false;
  if (draft.kind === "correction") return applyCorrectionValue(draft, m, v, roster, choiceId, pick);
  switch (m.field) {
    case "class": {
      if (draft.kind !== "class_progress" && draft.kind !== "student_record") return false;
      const chosen = pick(m.candidates);
      const found = chosen ? [{ id: chosen.id, name: chosen.label }] : resolveClassCandidates(v, roster.classes);
      const inCands = m.candidates ? found.filter((f) => m.candidates!.some((c) => c.id === f.id)) : found;
      const final = inCands.length === 1 ? inCands : found.length === 1 ? found : [];
      if (final.length !== 1) return false;
      draft.classId = final[0].id;
      draft.className = final[0].name;
      if (draft.kind === "student_record") draft.classFromContext = false;
      return true;
    }
    case "content": {
      if (draft.kind !== "class_progress") return false;
      draft.progress = v;
      return true;
    }
    case "period": {
      if (draft.kind !== "class_progress") return false;
      const p = normalizePeriod(choiceId ?? v, true);
      if (!p) return false;
      draft.period = p;
      return true;
    }
    case "taskType": {
      if (draft.kind !== "task") return false;
      const exact = taskTypeFromLabel(v);
      const hits = exact ? [v] : TASK_TYPE_LABEL_LIST.filter((l) => v.includes(l) || l.includes(v));
      if (hits.length !== 1) return false;
      draft.taskType = hits[0];
      return true;
    }
    case "student": {
      if (draft.kind === "student_record") {
        let chosen = pick(m.candidates);
        if (!chosen && m.candidates) {
          const infos = roster.students.filter((st) => m.candidates!.some((c) => c.id === st.id));
          const classNameById = new Map(roster.classes.map((c) => [c.id, stripClassSuffix(c.name)]));
          const narrowed = narrowCandidates(v, infos, classNameById);
          if (narrowed.length === 1) chosen = m.candidates.find((c) => c.id === narrowed[0].id) ?? null;
        }
        if (chosen) {
          draft.studentId = chosen.id;
          draft.studentName = roster.students.find((st) => st.id === chosen!.id)?.name ?? draft.studentName;
          return true;
        }
        // 명단에서 못 찾아 이름을 다시 받은 경우 — 새 이름으로 다시 확정 시도(checkDraft).
        if (!m.candidates && v) {
          draft.studentName = v;
          return true;
        }
        return false;
      }
      if (draft.kind !== "task") return false;
      const idx = draft.ambiguous.findIndex((a) => a.name === m.ref);
      if (idx < 0) return false;
      let chosen = pick(m.candidates);
      if (!chosen && m.candidates) {
        // "고2B"/"금정고"처럼 반·학교·학년 단서로 답한 경우 — 기존 동명이인 좁히기 규칙 재사용.
        const infos = roster.students.filter((st) => m.candidates!.some((c) => c.id === st.id));
        const classNameById = new Map(roster.classes.map((c) => [c.id, stripClassSuffix(c.name)]));
        const narrowed = narrowCandidates(v, infos, classNameById);
        if (narrowed.length === 1) chosen = m.candidates.find((c) => c.id === narrowed[0].id) ?? null;
      }
      if (!chosen) return false;
      const name = roster.students.find((st) => st.id === chosen!.id)?.name ?? draft.ambiguous[idx].name;
      draft.students.push({ id: chosen.id, name });
      draft.ambiguous.splice(idx, 1);
      return true;
    }
    case "owner": {
      if (draft.kind !== "task") return false;
      if (!choiceId && POOL_ANSWER.test(v)) {
        draft.ownerToPool = true;
        draft.ownerId = null;
        return true;
      }
      const chosen = pick(m.candidates);
      const owner = chosen ? roster.staff.find((st) => st.id === chosen.id) ?? null : resolveStaffByName(v, roster.staff);
      if (!owner || owner === "ambiguous") return false;
      draft.ownerId = owner.id;
      draft.ownerName = owner.name;
      return true;
    }
    default:
      return false;
  }
}

function taskInputFromDraft(draft: TaskDraft, today: string): { input: NewTaskInput; label: string } | null {
  const type = taskTypeFromLabel(draft.taskType);
  if (!type) return null;
  const studentIds = draft.students.map((st) => st.id);
  const unresolvedNote = draft.unresolved.length > 0 ? ` (찾지 못한 이름: ${draft.unresolved.join(", ")})` : "";
  const contentParts = [
    draft.instruction,
    draft.material ? `자료: ${draft.material}` : "",
    draft.quantity ? `수량: ${draft.quantity}` : "",
  ].filter(Boolean);
  return {
    input: {
      type,
      studentId: studentIds[0] ?? null,
      studentIds: studentIds.length > 1 ? studentIds : undefined,
      classIds: draft.classIds.length > 0 ? draft.classIds : undefined,
      content: contentParts.join(" / "),
      date: draft.date || today,
      time: draft.time || "",
      priority: draft.priority,
      // 학생 이름이 명단에 없거나(신입생 등) "업무풀"로 답했으면 자동배정 없이 업무풀로.
      forcePool: (draft.unresolved.length > 0 && studentIds.length === 0) || !!draft.ownerToPool,
      ownerId: draft.ownerId,
      createdBy: draft.createdBy,
    },
    label: `${draft.taskType}${draft.students.length ? " · " + draft.students.map((st) => st.name).join(",") : ""}${unresolvedNote}`,
  };
}

type SlackTask = { typeLabel: string; studentName: string; ownerName: string | null; pool: boolean };

async function createTaskOutcomes(
  taskInputs: { input: NewTaskInput; label: string }[],
  roster: Roster,
  studentNames: Map<string, string>
): Promise<{ outcomes: UnifiedOutcome[]; slackTasks: SlackTask[]; createdIds: string[] }> {
  const outcomes: UnifiedOutcome[] = [];
  const slackTasks: SlackTask[] = [];
  const createdIds: string[] = [];
  if (taskInputs.length === 0) return { outcomes, slackTasks, createdIds };
  mark("unified:before_createTasks_write");
  try {
    const created = await createTasks(taskInputs.map((t) => t.input), { staff: roster.staff, classes: roster.classes, studentNames });
    mark("unified:after_createTasks_write");
    const staffNameById = new Map(roster.staff.map((st) => [st.id, st.name]));
    created.forEach((c, i) => {
      createdIds.push(c.id);
      outcomes.push({
        route: "task",
        label: taskInputs[i].label,
        status: "완료",
        message: `업무 등록: ${taskInputs[i].label} → ${
          c.ownerId
            ? `${staffNameById.get(c.ownerId) ?? "담당자"} ${taskInputs[i].input.ownerId ? "지정 배정" : "자동배정"}`
            : "조교 업무풀(근무 중인 조교에게 자동배정 대기)"
        }`,
      });
      const rawStudentId = taskInputs[i].input.studentId;
      slackTasks.push({
        typeLabel: TASK_TYPE_LABELS[c.type],
        studentName: rawStudentId ? studentNames.get(rawStudentId) ?? "" : "",
        ownerName: c.ownerId ? staffNameById.get(c.ownerId) ?? null : null,
        pool: c.pool,
      });
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "업무 저장 중 오류가 발생했습니다.";
    taskInputs.forEach((t) => outcomes.push({ route: "task", label: t.label, status: "실패", message }));
  }
  return { outcomes, slackTasks, createdIds };
}

// ---------------------------------------------------------------------------
// 최상위 의도 경계(AI 출력 검증). 모델이 고른 intentClass와 route 조합이 어긋나거나,
// 명시어 없이 신입생/신규 상담을 고르거나, 기록 정정과 같은 대상에 새 업무를 함께
// 만들려 하면 — 저장하지 않고 구체적으로 되묻는(clarify) intent로 바꾼다.
// 특정 문장이 아니라 "의미 경계"를 검사한다(잘못 저장하는 것보다 묻는 것이 낫다).
// ---------------------------------------------------------------------------
export const ROUTES_BY_INTENT_CLASS: Record<IntentClass, UnifiedIntent["route"][]> = {
  correction: ["correction"],
  query: ["history_query", "schedule_view", "attendance_check"],
  record: ["class_progress", "student_record", "counseling"],
  action: ["task", "schedule", "student_action"],
  special: ["schedule", "admin_inbox"],
  unclear: ["clarify"],
};
const INTENT_CLASS_LABEL: Record<IntentClass, string> = {
  correction: "기존 기록 수정·취소",
  query: "조회",
  record: "수업/학습 기록",
  action: "업무·일정 요청",
  special: "상담·행정 전달",
  unclear: "확인 필요",
};
// 신입생/신규 상담은 사용자가 그런 뜻을 직접 말했을 때만(명단에 없는 학생 ≠ 신입생).
const EXPLICIT_NEW_STUDENT = /(신입|신규|입학|첫\s*상담|처음\s*(상담|왔|방문|등원)|등록\s*문의|체험\s*수업|새로\s*(온|들어온|등록))/;

function toClarify(i: UnifiedIntent, message: string): UnifiedIntent {
  return { ...i, intentClass: "unclear", route: "clarify", message };
}

export function enforceIntentBoundaries(intents: UnifiedIntent[], text: string): UnifiedIntent[] {
  const correctionStudents = new Set(
    intents.filter((i) => i.route === "correction").flatMap((i) => (i.students ?? []).map((n) => n?.trim()).filter(Boolean) as string[])
  );
  const hasCorrection = intents.some((i) => i.route === "correction");
  return intents.map((i) => {
    const cls = i.intentClass;
    if (cls && ROUTES_BY_INTENT_CLASS[cls] && !ROUTES_BY_INTENT_CLASS[cls].includes(i.route)) {
      return toClarify(
        i,
        `"${text}"을(를) ${INTENT_CLASS_LABEL[cls]}(으)로 이해했지만 처리 방식이 맞지 않아 아무것도 저장하지 않았습니다. 원하시는 것을 조금만 더 알려주세요 — 예: 학습 기록이면 "OO 단어시험 84점", 업무면 "OO 재시험 시켜줘", 수정이면 "방금 입력한 거 취소".`
      );
    }
    const newStudentRoute = (i.route === "schedule" && i.scheduleType === "신입생상담") || (i.route === "admin_inbox" && i.inboxType === "신규생문의");
    if (newStudentRoute && !EXPLICIT_NEW_STUDENT.test(text)) {
      const who = i.students?.[0] ? `${i.students[0]} ` : "";
      return toClarify(
        i,
        `${who}학생을 신입생 상담으로 처리하지 않았습니다(신입생·신규·입학 상담이라는 말이 없어서요). "${text}"을(를) 학습 기록으로 남길까요, 아니면 신입생 상담을 잡을까요? 원하는 쪽으로 다시 알려주세요.`
      );
    }
    if (i.route === "student_action" && cls && cls !== "action") {
      return toClarify(i, `"${text}"을(를) 조치사항으로 저장하지 않았습니다. 학습 기록인지, 앞으로 계속 관리할 방침인지 알려주세요.`);
    }
    // 같은 문장에 기록 정정이 있으면(우선순위 최상), 같은 학생에 대한 새 업무/조치/상담 생성은 하지 않는다.
    if (hasCorrection && i.route !== "correction" && ["task", "student_action", "schedule", "admin_inbox"].includes(i.route)) {
      const names = (i.students ?? []).map((n) => n?.trim()).filter(Boolean) as string[];
      if (names.length === 0 || names.some((n) => correctionStudents.has(n)) || correctionStudents.size === 0) {
        return toClarify(i, `기록 수정·취소 요청으로 이해해 새 업무/조치는 만들지 않았습니다. 새 업무도 필요하면 따로 알려주세요.`);
      }
    }
    return i;
  });
}

// 일정·할 일 조회(schedule_view) — 읽기 전용. 대시보드가 쓰는 getTodaySchedule과
// 내 업무(listMyTasks)를 그대로 읽어 요약하고, 자세한 화면으로 안내한다.
async function runScheduleView(date: string, staffId: string | undefined): Promise<UnifiedOutcome> {
  const [sched, mine] = await Promise.all([
    getTodaySchedule(date, staffId || undefined) as Promise<Record<string, unknown>>,
    staffId ? listMyTasks(staffId) : Promise.resolve([]),
  ]);
  const sections: [string, string][] = [
    ["makeupClasses", "보강"],
    ["retests", "재시"],
    ["newStudentEvents", "신입생상담/레벨체크"],
    ["clinicTasks", "클리닉"],
    ["reviewTasks", "복습"],
    ["counseling", "상담"],
    ["personalTodos", "개인 할일"],
  ];
  const lines: string[] = [`${date === todayKST() ? "오늘" : date} 일정`];
  for (const [key, label] of sections) {
    const list = (Array.isArray(sched?.[key]) ? (sched[key] as Record<string, unknown>[]) : []);
    if (list.length === 0) continue;
    const preview = list
      .slice(0, 5)
      .map((x) => [x.studentName && x.studentName !== "-" ? x.studentName : x.title, x.time].filter(Boolean).join(" "))
      .join(", ");
    lines.push(`· ${label} ${list.length}건${preview ? `: ${preview}${list.length > 5 ? " …" : ""}` : ""}`);
  }
  const dueToday = mine.filter((t) => t.date === date).length;
  lines.push(`· 내 미완료 업무 ${mine.length}건(오늘 예정 ${dueToday}건)`);
  if (lines.length === 2 && mine.length === 0) lines.splice(1, 0, "· 등록된 일정이 없습니다.");
  lines.push("자세히 보기: 대시보드(/director/dashboard) · 내 업무(/director/tasks)");
  return { route: "schedule_view", label: "일정 조회", status: "완료", message: lines.join("\n") };
}

// ---------------------------------------------------------------------------
// 입력 이력 조회(history_query) — 읽기 전용. 결과 번호 ↔ 실제 기록 연결은 서버가
// HMAC(SESSION_SECRET)으로 서명한 토큰에 담아 화면에 준다. 토큰에는 조회한 직원 id가
// 들어가 있어, 다른 로그인 사용자의 토큰이거나 위·변조됐으면 무시한다(목록이 섞이지 않음).
// ---------------------------------------------------------------------------
export type HistoryRef = { ref: string; label: string };
const HISTORY_TTL_MS = 12 * 60 * 60 * 1000;

function historySecret(): string | null {
  return process.env.SESSION_SECRET || null;
}

export function signHistoryToken(staffId: string, refs: HistoryRef[]): string | undefined {
  const secret = historySecret();
  if (!secret || !staffId) return undefined;
  const body = Buffer.from(JSON.stringify({ s: staffId, t: Date.now(), r: refs })).toString("base64url");
  const mac = createHmac("sha256", secret).update(`history.${body}`).digest("base64url");
  return `${body}.${mac}`;
}

export function verifyHistoryToken(token: string | null | undefined, staffId: string | undefined): HistoryRef[] | null {
  const secret = historySecret();
  if (!secret || !token || !staffId) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", secret).update(`history.${body}`).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { s: string; t: number; r: HistoryRef[] };
    if (data.s !== staffId || Date.now() - data.t > HISTORY_TTL_MS) return null;
    return Array.isArray(data.r) ? data.r : null;
  } catch {
    return null;
  }
}

const KST_HM = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const KST_MD = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit" });
const kstStartIso = (date: string) => new Date(`${date}T00:00:00+09:00`).toISOString();

type HistoryItem = { ref: string; at: string; author: string; lines: string[]; label: string };

// 조회 결과를 만든다. DB는 GET만(listExamAiHistoryRows). 기존에 저장된 기록도 그대로
// 잡힌다: 학생 기록은 created_at+entered_by, 반 진도는 examAiLog(by/at) — 로그 도입 전
// EXAM AI 행(로그 없음, 학생기록 미생성)은 작성자 불명으로 "전체" 조회에만 포함, 업무는
// workflow.createdBy(EXAM AI 지시 업무에만 있음). 학생 기록의 후속 업무는 기록 줄에 표시.
async function runHistoryQuery(
  intent: UnifiedIntent,
  roster: Roster,
  opts: { staffName?: string; staffId?: string }
): Promise<{ outcome: UnifiedOutcome; token?: string }> {
  const today = todayKST();
  const recent = intent.historyRecent === true;
  const from = recent ? null : intent.historyFrom || today;
  const to = recent ? null : intent.historyTo || from!;
  const fromIso = recent ? new Date(Date.now() - CORRECTION_WINDOW_MS).toISOString() : kstStartIso(from!);
  const toIso = recent ? new Date(Date.now() + 60_000).toISOString() : new Date(new Date(kstStartIso(to!)).getTime() + 86400000).toISOString();
  const onlyMine = intent.onlyMine !== false;
  const me = opts.staffName ?? "";

  const studentIds = new Set((intent.students ?? []).flatMap((n) => studentIdsByName(n ?? "", roster)));
  const classId = intent.className ? resolveClassCandidates(intent.className, roster.classes)[0]?.id ?? "__none__" : null;
  const recordType = Object.keys(RECORD_TYPE_LABEL).includes(intent.recordType ?? "") ? (intent.recordType as LearningRecordType) : null;
  const recordOnly = !!recordType || intent.retestOnly === true || intent.incompleteOnly === true;
  const staffName = new Map(roster.staff.map((st) => [st.id, st.name]));

  const { records, progress, tasks } = await listExamAiHistoryRows(fromIso, toIso);
  const items: HistoryItem[] = [];

  for (const r of records) {
    if (onlyMine && r.entered_by !== me) continue;
    const sid = (r.student_notion_ids as string[] | null)?.[0] ?? "";
    if (studentIds.size && !studentIds.has(sid)) continue;
    if (classId && !((r.class_notion_ids as string[] | null) ?? []).includes(classId)) continue;
    if (recordType && r.record_type !== recordType) continue;
    if (intent.retestOnly && !(r.retest_required === true || r.record_type === "retest")) continue;
    if (intent.incompleteOnly && r.completed !== false) continue;
    const label = learningRecordLabel(r, roster);
    const cls = roster.classes.find((c) => c.id === (r.class_notion_ids as string[] | null)?.[0]);
    const [name, ...rest] = label.split(" · ");
    items.push({
      ref: `slr:${r.id}`,
      at: String(r.created_at ?? ""),
      author: String(r.entered_by ?? ""),
      label,
      lines: [`${name}${cls ? ` · ${stripClassSuffix(cls.name)}` : ""}`, `${rest.join(" · ")}${r.task_id ? " · 후속 업무 연결" : ""}`],
    });
  }

  if (!recordOnly && studentIds.size === 0) {
    for (const row of progress) {
      if (classId && !((row.class_notion_ids as string[] | null) ?? []).includes(classId)) continue;
      const log = ((row.source_payload as { examAiLog?: { at?: string; by?: string }[] } | null)?.examAiLog ?? []).filter(
        (e) => (e.at ?? "") >= fromIso && (e.at ?? "") < toIso
      );
      const mine = log.filter((e) => e.by === me);
      let at = "";
      let author = "";
      if (onlyMine) {
        if (mine.length === 0) continue;
        at = mine[0].at ?? "";
        author = me;
      } else if (log.length > 0) {
        at = log[0].at ?? "";
        author = Array.from(new Set(log.map((e) => e.by ?? ""))).filter(Boolean).join(", ");
      } else if (row.student_records_created === false && String(row.created_at ?? "") >= fromIso && String(row.created_at ?? "") < toIso) {
        at = String(row.created_at ?? "");
        author = "작성자 기록 없음";
      } else continue;
      const label = classProgressLabel(row, roster);
      const one = (v: unknown) => String(v ?? "").split("\n").filter(Boolean).join(" / ") || "-";
      items.push({
        ref: `cp:${row.id}`,
        at,
        author,
        label,
        lines: [label.split(" · ")[0], `진도: ${one(row.progress_content)}`, `과제: ${one(row.homework_content)}`],
      });
    }
  }

  if (!recordOnly || intent.retestOnly) {
    for (const t of tasks) {
      const wf = ((t.source_payload as { workflow?: { createdBy?: string; sourceRecordId?: string; startedAt?: string } } | null)?.workflow ?? {});
      if (!wf.createdBy || wf.sourceRecordId) continue;
      if (onlyMine && wf.createdBy !== me) continue;
      const sid = (t.student_notion_ids as string[] | null)?.[0] ?? "";
      if (studentIds.size && !studentIds.has(sid)) continue;
      if (classId && !((t.class_notion_ids as string[] | null) ?? []).includes(classId)) continue;
      if (intent.retestOnly && !["재시험", "단어재시"].includes(String(t.type))) continue;
      const owner = (t.staff_notion_ids as string[] | null)?.[0];
      const status = t.complete ? `완료${t.outcome ? `(${t.outcome})` : ""}` : !owner ? "업무풀" : wf.startedAt ? "진행중" : "대기";
      const student = roster.students.find((x) => x.id === sid)?.name;
      const label = `업무 · ${t.type}${student ? ` · ${student}` : ""}`;
      items.push({
        ref: `task:${t.id}`,
        at: String(t.created_at ?? ""),
        author: wf.createdBy,
        label,
        lines: [label, `${(t.memo as string) || ""}${t.memo ? " · " : ""}담당 ${owner ? staffName.get(owner) ?? "-" : "업무풀"} · ${status}`],
      });
    }
  }

  items.sort((a, b) => a.at.localeCompare(b.at));
  const shown = recent ? items.slice(-10) : items.slice(0, 50);
  const title = recent ? "최근 입력한 내용" : from === to ? `${from === today ? "오늘" : from} 입력한 내용` : `${from} ~ ${to} 입력한 내용`;
  const scope = onlyMine ? `(${me || "나"} 입력)` : "(전체 직원)";
  if (shown.length === 0) {
    return { outcome: { route: "history_query", label: title, status: "완료", message: `${title} ${scope}이 없습니다.` } };
  }
  const multiDay = !recent && from !== to;
  const body = shown.map((it, i) => {
    const time = it.at ? `${multiDay || recent ? `${KST_MD.format(new Date(it.at))} ` : ""}${KST_HM.format(new Date(it.at))}` : "--:--";
    const by = !onlyMine && it.author ? ` (작성: ${it.author})` : "";
    return [`${i + 1}. ${time} · ${it.lines[0]}${by}`, ...it.lines.slice(1).map((l) => `   ${l}`)].join("\n");
  });
  const more = items.length > shown.length ? ` (최근 ${shown.length}건만 표시)` : "";
  const message = [`${title} ${scope}`, ...body, `총 ${items.length}건${more} — "2번 94점으로", "3번 취소"처럼 번호로 고칠 수 있어요.`].join("\n");
  return {
    outcome: { route: "history_query", label: title, status: "완료", message },
    token: signHistoryToken(opts.staffId ?? "", shown.map((it) => ({ ref: it.ref, label: it.label }))),
  };
}

// ---------------------------------------------------------------------------
// 자연어 정정(correction)
// ---------------------------------------------------------------------------
const CORRECTION_WINDOW_MS = 24 * 60 * 60 * 1000;

type CorrectionCandidate = { id: string; label: string; at: string; row: Record<string, unknown> };

function learningRecordLabel(row: Record<string, unknown>, roster: Roster): string {
  const studentId = (row.student_notion_ids as string[] | null)?.[0] ?? "";
  const name = roster.students.find((x) => x.id === studentId)?.name ?? "학생";
  const type = RECORD_TYPE_LABEL[(row.record_type as LearningRecordType) ?? "memo"] ?? "기록";
  const parts = [name, (row.assessment_name as string) || type];
  if (row.score !== null && row.score !== undefined) parts.push(row.max_score ? `${row.score}/${row.max_score}` : `${row.score}점`);
  if (row.passed === true) parts.push("통과");
  if (row.passed === false) parts.push("미통과");
  if (row.retest_required === true) parts.push("재시험 필요");
  if (row.completed === true) parts.push("완료");
  if (row.completed === false) parts.push("미완료");
  if (row.note) parts.push(String(row.note));
  if (row.period) parts.push(String(row.period));
  return parts.join(" · ");
}

function classProgressLabel(row: Record<string, unknown>, roster: Roster): string {
  const classId = (row.class_notion_ids as string[] | null)?.[0] ?? "";
  const cls = roster.classes.find((c) => c.id === classId);
  const head = `${cls ? stripClassSuffix(cls.name) : "반"}${row.period ? ` ${row.period}` : ""}`;
  const one = (v: unknown) => (String(v ?? "").split("\n").filter(Boolean).join(" / ") || "-");
  return `${head} · 진도: ${one(row.progress_content)} · 과제: ${one(row.homework_content)}`;
}

function studentIdsByName(name: string, roster: Roster): string[] {
  const n = name.trim();
  if (!n) return [];
  const exact = roster.students.filter((x) => x.name === n);
  return (exact.length > 0 ? exact : roster.students.filter((x) => x.name.includes(n) || n.includes(x.name))).map((x) => x.id);
}

async function studentRecordCandidates(d: CorrectionDraft, roster: Roster, sinceIso: string): Promise<CorrectionCandidate[]> {
  let rows = await listRecentLearningRecords(sinceIso);
  const named = d.studentNames.length > 0;
  if (named) {
    const ids = new Set(d.studentNames.flatMap((n) => studentIdsByName(n, roster)));
    rows = rows.filter((r) => ids.has((r.student_notion_ids as string[] | null)?.[0] ?? ""));
  } else {
    // 학생을 말하지 않았으면 이 사용자가 입력한 기록만 대상으로 한다.
    rows = rows.filter((r) => r.entered_by === d.enteredBy);
  }
  const validType = Object.keys(RECORD_TYPE_LABEL).includes(d.recordType);
  if (validType) rows = rows.filter((r) => r.record_type === d.recordType);
  if (d.assessmentName) {
    const a = norm(d.assessmentName);
    rows = rows.filter((r) => norm(String(r.assessment_name ?? "")).includes(a) || a.includes(norm(RECORD_TYPE_LABEL[r.record_type as LearningRecordType] ?? "")));
  }
  if (d.oldScore !== null) rows = rows.filter((r) => Number(r.score) === d.oldScore);
  if (d.classId) rows = rows.filter((r) => ((r.class_notion_ids as string[] | null) ?? []).includes(d.classId!));
  if (d.period) rows = rows.filter((r) => r.period === d.period);
  // 아무 단서 없이 "방금 거"면 가장 최근 입력(같은 원문) 묶음만.
  if (!named && !validType && !d.assessmentName && d.oldScore === null && rows.length > 1) {
    const latestRaw = rows[0].raw_text;
    rows = rows.filter((r) => r.raw_text === latestRaw);
  }
  return rows.map((r) => ({ id: `slr:${r.id}`, label: learningRecordLabel(r, roster), at: String(r.created_at ?? ""), row: r }));
}

async function classProgressCandidates(d: CorrectionDraft, roster: Roster, sinceIso: string): Promise<CorrectionCandidate[]> {
  let rows: { row: Record<string, unknown>; lastAt: string }[] = [];
  if (d.classId) {
    const periods = d.period ? [d.period] : [...(await listClassProgressPeriods(d.classId, d.date)), ""];
    for (const p of periods) {
      const row = await findClassProgressRow(d.classId, d.date, p || null);
      if (row) rows.push({ row, lastAt: String(row.updated_at ?? "") });
    }
  } else {
    rows = await listRecentClassProgressByUser(d.enteredBy ?? "", sinceIso);
  }
  if (d.fromText) {
    const f = norm(d.fromText);
    const withText = rows.filter(({ row }) => {
      const fields = d.field ? [row[d.field === "progress" ? "progress_content" : "homework_content"]] : [row.progress_content, row.homework_content];
      return fields.some((v) => norm(String(v ?? "")).includes(f));
    });
    rows = withText;
  } else if (!d.classId && rows.length > 1) {
    rows = rows.slice(0, 1); // 반을 말하지 않았으면 이 사용자가 가장 최근에 건드린 수업 기록
  }
  return rows.map(({ row, lastAt }) => ({ id: `cp:${row.id}`, label: classProgressLabel(row, roster), at: lastAt, row }));
}

async function loadSelected(d: CorrectionDraft): Promise<Record<string, unknown> | null> {
  if (!d.selectedId) return null;
  const sep = d.selectedId.indexOf(":");
  const kind = d.selectedId.slice(0, sep);
  const id = d.selectedId.slice(sep + 1);
  if (kind === "slr") return getActiveLearningRecord(id);
  if (kind === "cp") return getClassProgressRowById(id);
  return null;
}

function hasStudentChange(d: CorrectionDraft): boolean {
  return (
    d.newScore !== null ||
    d.newMaxScore !== null ||
    d.newPassed !== null ||
    d.newRetestRequired !== null ||
    d.newCompleted !== null ||
    !!d.newStudentName ||
    !!d.newPeriod
  );
}

// 정정 대상 확정 → 동작(수정/취소) 확정 → 바꿀 내용 → 부수효과(통과여부·연결업무) 순으로
// 부족한 것만 묻는다. 대상이 없으면 되묻지 않고 error로 안내(새 기록을 만들지 않는다).
async function checkCorrectionDraft(d: CorrectionDraft, roster: Roster): Promise<MissingInfo[]> {
  d.error = "";
  const sinceIso = new Date(Date.now() - CORRECTION_WINDOW_MS).toISOString();
  const verb = d.operation === "cancel" ? "취소할까요" : d.operation === "modify" ? "수정할까요" : "고칠까요";

  if (!d.selectedId) {
    if (d.className && !d.classId) {
      const found = resolveClassCandidates(d.className, roster.classes);
      if (found.length === 1) d.classId = found[0].id;
    }
    let cands: CorrectionCandidate[] = [];
    const wantsClass = d.target === "class_progress" || (!!d.fromText && d.target !== "student_record");
    if (d.target === "student_record" || (d.target === "recent" && !wantsClass)) cands = await studentRecordCandidates(d, roster, sinceIso);
    if (wantsClass || (d.target === "recent" && cands.length === 0) || (d.target === "recent" && !d.studentNames.length)) {
      const cp = await classProgressCandidates(d, roster, sinceIso);
      if (d.target === "recent" && cands.length > 0 && cp.length > 0) {
        // "방금 거": 학생 기록 묶음과 반 진도 중 더 최근에 입력한 쪽
        cands = (cp[0].at > cands[0].at ? cp : cands);
      } else if (cp.length > 0 && (wantsClass || cands.length === 0)) cands = cp;
    }
    if (cands.length === 0) {
      d.error = `수정할 기록을 찾지 못했습니다${d.studentNames.length ? `(${d.studentNames.join(", ")})` : ""}. 최근 24시간 안에 입력한 기록만 고칠 수 있어요 — 학생 이름이나 반을 함께 알려주세요.`;
      return [];
    }
    if (cands.length > 1) {
      return [
        {
          key: "target",
          field: "target",
          question: `해당하는 기록이 ${cands.length}개 있습니다. 어느 기록을 ${verb}?`,
          candidates: cands.slice(0, 10).map((c) => ({ id: c.id, label: c.label })),
        },
      ];
    }
    d.selectedId = cands[0].id;
    d.selectedLabel = cands[0].label;
  }

  const row = await loadSelected(d);
  if (!row) {
    d.error = "수정할 기록을 찾지 못했습니다(이미 취소됐거나 삭제됐을 수 있습니다).";
    return [];
  }
  const isRecord = d.selectedId!.startsWith("slr:");
  d.selectedLabel = isRecord ? learningRecordLabel(row, roster) : classProgressLabel(row, roster);
  const missing: MissingInfo[] = [];

  if (d.operation === "unknown") {
    return [
      {
        key: "operation",
        field: "operation",
        question: `방금 입력한 "${d.selectedLabel}" 기록을 수정할까요, 삭제할까요?`,
        candidates: [
          { id: "modify", label: "수정" },
          { id: "cancel", label: "삭제(취소)" },
        ],
      },
    ];
  }

  if (isRecord) {
    const task = await getLinkedTask(row.task_id as string | null);
    if (d.operation === "modify") {
      if (!hasStudentChange(d)) {
        missing.push({ key: "change", field: "change", question: `"${d.selectedLabel}"을(를) 무엇으로 수정할까요? (예: 94점, 재시험 아님, 과제 완료, 2교시)` });
        return missing;
      }
      if (d.newStudentName && !d.newStudentId) {
        const active = roster.students.filter((x) => x.status === "재원" || !x.status);
        const ids = studentIdsByName(d.newStudentName, { ...roster, students: active });
        const classNameById = new Map(roster.classes.map((c) => [c.id, stripClassSuffix(c.name)]));
        if (ids.length === 1) d.newStudentId = ids[0];
        else
          missing.push({
            key: "newStudent",
            field: "newStudent",
            question:
              ids.length > 1
                ? `${d.newStudentName} 학생이 여러 명입니다. 어느 학생으로 바꿀까요?`
                : `명단에서 "${d.newStudentName}" 학생을 찾지 못했습니다. 어느 학생으로 바꿀까요?`,
            candidates:
              ids.length > 1 ? active.filter((x) => ids.includes(x.id)).map((x) => ({ id: x.id, label: candidateLabel(x, classNameById) })) : undefined,
          });
      }
      // 점수만 바뀌고 기존 기록에 통과/재시험 판정이 있으면 — 합격 기준을 추측하지 않고 묻는다.
      const scoreChanged = d.newScore !== null && Number(row.score) !== d.newScore;
      const hadVerdict = row.passed !== null && row.passed !== undefined ? true : row.retest_required !== null && row.retest_required !== undefined;
      if (scoreChanged && hadVerdict && d.newPassed === null && d.newRetestRequired === null && !d.passDecision) {
        missing.push({
          key: "pass",
          field: "pass",
          question: `${row.score ?? "-"}점 → ${d.newScore}점으로 수정하면 통과/재시험 여부도 바뀌나요?`,
          candidates: [
            { id: "pass", label: "통과(재시험 없음)" },
            { id: "fail", label: "미통과·재시험 필요" },
            { id: "keep", label: "그대로 유지" },
          ],
        });
      }
      // 정정으로 후속 업무가 필요 없어지면(재시험 아님/완료/통과) 열린 연결 업무를 어떻게 할지 묻는다.
      const resolvesNeed = d.newRetestRequired === false || d.newCompleted === true || d.newPassed === true || d.passDecision === "pass";
      if (task && !task.done && resolvesNeed && !d.taskDecision) {
        missing.push({
          key: "task",
          field: "task",
          question: `연결된 업무(${task.typeLabel}${task.started ? " · 진행 중" : " · 대기"})도 취소할까요?`,
          candidates: [
            { id: "cancel", label: "업무도 취소" },
            { id: "keep", label: "업무는 유지" },
          ],
        });
      }
    } else if (d.operation === "cancel") {
      // 아직 시작 안 한 연결 업무는 기록과 함께 자동 취소, 진행 중이면 확인, 완료된 업무는 그대로.
      if (task && !task.done && task.started && !d.taskDecision) {
        missing.push({
          key: "task",
          field: "task",
          question: `연결된 업무(${task.typeLabel})가 이미 진행 중입니다. 업무도 취소할까요?`,
          candidates: [
            { id: "cancel", label: "업무도 취소" },
            { id: "keep", label: "업무는 유지" },
          ],
        });
      }
    }
    return missing;
  }

  // class_progress
  // "과제 27쪽까지로 바꿔"처럼 바꿀 값만 말한 경우: 같은 단위(쪽/번/과…)의 숫자가 그 칸에
  // 딱 하나 있으면 그것을 바꿀 대상으로 본다. 여러 개/없음이면 되묻는다.
  if (d.operation === "modify" && d.toText && !d.fromText && d.field) {
    d.toText = d.toText.replace(/\s*(까지|부터)?\s*(으로|로)?$/, "").replace(/까지$/, "");
    const unit = d.toText.match(/\d+\s*(쪽|번|과|p|페이지|문제|개)/)?.[1];
    const text = String(row[d.field === "progress" ? "progress_content" : "homework_content"] ?? "");
    const hits = unit ? text.match(new RegExp(`\\d+\\s*${unit}`, "g")) ?? [] : [];
    if (hits.length === 1) d.fromText = hits[0];
  }
  if (d.operation === "modify" && !d.newPeriod && !(d.fromText && d.toText)) {
    missing.push({
      key: "change",
      field: "change",
      question: d.fromText ? `"${d.fromText}"을(를) 무엇으로 바꿀까요?` : `"${d.selectedLabel}"을(를) 어떻게 수정할까요? (예: '25쪽 → 27쪽')`,
    });
    return missing;
  }
  if (d.fromText && !d.field) {
    const f = norm(d.fromText);
    const inP = norm(String(row.progress_content ?? "")).includes(f);
    const inH = norm(String(row.homework_content ?? "")).includes(f);
    if (inP && inH) {
      missing.push({
        key: "field",
        field: "field",
        question: `"${d.fromText}"이(가) 진도와 과제에 모두 있습니다. 어느 쪽을 ${verb}?`,
        candidates: [
          { id: "progress", label: "진도" },
          { id: "homework", label: "과제" },
        ],
      });
    } else if (inP) d.field = "progress";
    else if (inH) d.field = "homework";
    else {
      d.error = `"${classProgressLabel(row, roster)}"에서 "${d.fromText}"을(를) 찾지 못했습니다.`;
      return [];
    }
  }
  return missing;
}

function applyCorrectionValue(
  d: CorrectionDraft,
  m: MissingInfo,
  v: string,
  roster: Roster,
  choiceId: string | undefined,
  pick: (cands: Choice[] | undefined) => Choice | null
): boolean {
  switch (m.field) {
    case "target": {
      const chosen = pick(m.candidates);
      if (!chosen) {
        // "단어시험", "2번", "첫 번째"처럼 답한 경우
        const idx = v.match(/^(\d+)/) ? Number(v.match(/^(\d+)/)![1]) - 1 : -1;
        const byIndex = idx >= 0 ? m.candidates?.[idx] : undefined;
        const hits = (m.candidates ?? []).filter((c) => norm(c.label).includes(norm(v)));
        const c = byIndex ?? (hits.length === 1 ? hits[0] : undefined);
        if (!c) return false;
        d.selectedId = c.id;
        d.selectedLabel = c.label;
        return true;
      }
      d.selectedId = chosen.id;
      d.selectedLabel = chosen.label;
      return true;
    }
    case "operation": {
      const x = choiceId ?? (/(삭제|취소|지워|없던)/.test(v) ? "cancel" : /(수정|고쳐|바꿔|변경)/.test(v) ? "modify" : "");
      if (x !== "modify" && x !== "cancel") return false;
      d.operation = x;
      return true;
    }
    case "change": {
      let applied = false;
      if (d.selectedId?.startsWith("cp:")) {
        const arrow = v.match(/^(.+?)\s*(?:→|->|아니고|대신)\s*(.+?)(?:으로|로)?(?:\s*(?:수정|바꿔|변경).*)?$/);
        if (arrow) {
          d.fromText = arrow[1].trim();
          d.toText = arrow[2].trim();
          return true;
        }
        if (d.fromText) {
          d.toText = v.replace(/(으로|로)?\s*(수정|바꿔|변경).*$/, "").trim();
          return !!d.toText;
        }
        const p = normalizePeriod(v, true);
        if (p) {
          d.newPeriod = p;
          return true;
        }
        return false;
      }
      const period = v.match(/(\d+)\s*교시/);
      if (period) {
        d.newPeriod = `${Number(period[1])}교시`;
        applied = true;
      }
      const num = v.replace(/\d+\s*교시/, "").match(/(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+))?\s*점?/);
      if (num) {
        d.newScore = Number(num[1]);
        if (num[2]) d.newMaxScore = Number(num[2]);
        applied = true;
      }
      if (/재시험\s*(아니|아님|필요\s*없|없)/.test(v)) {
        d.newRetestRequired = false;
        applied = true;
      } else if (/재시험/.test(v)) {
        d.newRetestRequired = true;
        applied = true;
      }
      if (/미통과|불합격/.test(v)) {
        d.newPassed = false;
        applied = true;
      } else if (/통과|합격/.test(v)) {
        d.newPassed = true;
        applied = true;
      }
      if (/미완료|안\s*(했|함)/.test(v)) {
        d.newCompleted = false;
        applied = true;
      } else if (/완료|했/.test(v)) {
        d.newCompleted = true;
        applied = true;
      }
      return applied;
    }
    case "pass": {
      const x = choiceId ?? (/그대로|유지/.test(v) ? "keep" : /미통과|불합격|재시험/.test(v) ? "fail" : /통과|합격/.test(v) ? "pass" : "");
      if (x !== "pass" && x !== "fail" && x !== "keep") return false;
      d.passDecision = x;
      return true;
    }
    case "task": {
      const x = choiceId ?? (/취소|삭제|없애/.test(v) ? "cancel" : /유지|그대로|남겨/.test(v) ? "keep" : "");
      if (x !== "cancel" && x !== "keep") return false;
      d.taskDecision = x;
      return true;
    }
    case "newStudent": {
      const chosen = pick(m.candidates);
      if (chosen) {
        d.newStudentId = chosen.id;
        return true;
      }
      if (!m.candidates && v) {
        d.newStudentName = v;
        d.newStudentId = null;
        return true;
      }
      return false;
    }
    case "field": {
      const x = choiceId ?? (/과제|숙제/.test(v) ? "homework" : /진도/.test(v) ? "progress" : "");
      if (x !== "progress" && x !== "homework") return false;
      d.field = x;
      return true;
    }
    default:
      return false;
  }
}

async function executeCorrection(d: CorrectionDraft, roster: Roster): Promise<UnifiedOutcome> {
  if (d.error) return { route: "correction", label: "기록 정정", status: "확인필요", message: d.error };
  const audit = { by: d.enteredBy ?? "", raw: d.rawText };
  const row = await loadSelected(d);
  if (!row) return { route: "correction", label: "기록 정정", status: "확인필요", message: "수정할 기록을 찾지 못했습니다(이미 취소됐거나 삭제됐을 수 있습니다)." };

  if (d.selectedId!.startsWith("slr:")) {
    const recordId = row.id as string;
    const studentId = (row.student_notion_ids as string[] | null)?.[0] ?? "";
    const name = roster.students.find((x) => x.id === studentId)?.name ?? "학생";
    const what = (row.assessment_name as string) || RECORD_TYPE_LABEL[row.record_type as LearningRecordType] || "기록";
    const task = await getLinkedTask(row.task_id as string | null);
    const taskLines: string[] = [];
    const closeTask = async (reason: string) => {
      if (!task || task.done) return;
      if (d.taskDecision === "keep") {
        taskLines.push(`연결된 업무(${task.typeLabel})는 그대로 유지합니다.`);
        return;
      }
      await cancelTaskForRecord(task.id, { ...audit, reason });
      taskLines.push(`연결된 업무(${task.typeLabel})도 취소했습니다.`);
    };

    if (d.operation === "cancel") {
      await cancelLearningRecord(recordId, audit);
      if (task && task.done) taskLines.push(`연결된 업무(${task.typeLabel})는 이미 완료돼 그대로 둡니다.`);
      else await closeTask("근거 학생 기록 취소");
      return {
        route: "correction",
        label: name,
        status: "완료",
        message: [`${name} · ${learningRecordLabel(row, roster).split(" · ").slice(1).join(" · ")} 기록을 취소했습니다.`, ...taskLines].join("\n"),
      };
    }

    const patch: Record<string, unknown> = {};
    const changes: string[] = [];
    if (d.newScore !== null && Number(row.score) !== d.newScore) {
      patch.score = d.newScore;
      changes.push(`${row.score ?? "-"}점 → ${d.newScore}점`);
    }
    if (d.newMaxScore !== null) patch.max_score = d.newMaxScore;
    let passed = d.newPassed;
    let retest = d.newRetestRequired;
    if (d.passDecision === "pass") {
      passed = true;
      retest = false;
    } else if (d.passDecision === "fail") {
      passed = false;
      retest = true;
    }
    const yn = (b: unknown, t: string, f: string) => (b === true ? t : b === false ? f : "-");
    if (passed !== null && passed !== row.passed) {
      patch.passed = passed;
      changes.push(`${yn(row.passed, "통과", "미통과")} → ${yn(passed, "통과", "미통과")}`);
    }
    if (retest !== null && retest !== row.retest_required) {
      patch.retest_required = retest;
      changes.push(`재시험 ${yn(row.retest_required, "필요", "아님")} → ${yn(retest, "필요", "아님")}`);
    }
    if (d.newCompleted !== null && d.newCompleted !== row.completed) {
      patch.completed = d.newCompleted;
      changes.push(`${yn(row.completed, "완료", "미완료")} → ${yn(d.newCompleted, "완료", "미완료")}`);
    }
    if (d.newPeriod && d.newPeriod !== row.period) {
      patch.period = d.newPeriod;
      const classId = (row.class_notion_ids as string[] | null)?.[0];
      patch.class_progress_id = classId ? ((await findClassProgressRow(classId, String(row.record_date), d.newPeriod))?.id ?? null) : null;
      changes.push(`${row.period || "교시 없음"} → ${d.newPeriod}`);
    }
    let newName = "";
    if (d.newStudentId && d.newStudentId !== studentId) {
      const { pgResolveRelationId } = await import("@/lib/supabaseRepo");
      patch.student_id = await pgResolveRelationId("STUDENT", d.newStudentId);
      patch.student_notion_ids = [d.newStudentId];
      newName = roster.students.find((x) => x.id === d.newStudentId)?.name ?? "";
      changes.push(`학생 ${name} → ${newName}`);
    }
    if (Object.keys(patch).length === 0) {
      return { route: "correction", label: name, status: "완료", message: `${name} · ${what}: 이미 같은 내용이라 바꿀 것이 없습니다.` };
    }
    await updateLearningRecord(recordId, patch as never, audit);
    if (task && !task.done) {
      if (newName) {
        await retargetTaskStudent(task.id, d.newStudentId!, newName, task.typeLabel);
        taskLines.push(`연결된 업무(${task.typeLabel})의 학생도 ${newName}(으)로 바꿨습니다.`);
      } else if (d.taskDecision) await closeTask("근거 학생 기록 정정");
    }
    return {
      route: "correction",
      label: name,
      status: "완료",
      message: [`${name} · ${what}`, `${changes.join(", ")}(으)로 수정했습니다.`, ...taskLines].join("\n"),
    };
  }

  // class_progress
  const header = classProgressLabel(row, roster).split(" · ")[0];
  if (d.newPeriod && d.operation === "modify" && !d.fromText) {
    const classId = (row.class_notion_ids as string[] | null)?.[0] ?? "";
    const clash = classId ? await findClassProgressRow(classId, String(row.record_date), d.newPeriod) : null;
    if (clash) return { route: "correction", label: header, status: "확인필요", message: `${header}: 이미 ${d.newPeriod} 기록이 있어 교시를 옮기지 않았습니다. 그 기록을 직접 수정해 주세요.` };
    await correctClassProgressRow(row.id as string, { period: d.newPeriod }, { ...audit, operation: "modify" });
    return { route: "correction", label: header, status: "완료", message: `${header}\n${row.period || "교시 없음"} → ${d.newPeriod}(으)로 수정했습니다.` };
  }
  if (d.fromText && d.field) {
    const col = d.field === "progress" ? "progress_content" : "homework_content";
    const fieldLabel = d.field === "progress" ? "진도" : "과제";
    const before = String(row[col] ?? "");
    if (d.operation === "cancel") {
      const merged = mergeProgressText(before, d.fromText, "delete");
      if (merged.change !== "deleted") return { route: "correction", label: header, status: "확인필요", message: `${header}: ${fieldLabel}에서 "${d.fromText}"을(를) 찾지 못했습니다.` };
      await correctClassProgressRow(row.id as string, { [d.field]: merged.value }, { ...audit, operation: "delete" });
      const removed = before.split("\n").filter((l) => !merged.value.split("\n").includes(l)).join(" / ");
      return { route: "correction", label: header, status: "완료", message: `${header}\n${fieldLabel} "${removed}"을(를) 삭제했습니다.` };
    }
    const lines = before.split("\n");
    const idx = lines.findIndex((l) => norm(l).includes(norm(d.fromText)));
    if (idx < 0) return { route: "correction", label: header, status: "확인필요", message: `${header}: ${fieldLabel}에서 "${d.fromText}"을(를) 찾지 못했습니다.` };
    const oldLine = lines[idx];
    const newLine = oldLine.includes(d.fromText) ? oldLine.replace(d.fromText, d.toText) : d.toText;
    lines[idx] = newLine;
    await correctClassProgressRow(row.id as string, { [d.field]: lines.join("\n") }, { ...audit, operation: "modify" });
    return { route: "correction", label: header, status: "완료", message: `${header}\n${fieldLabel} ${oldLine} → ${newLine}(으)로 수정했습니다.` };
  }
  if (d.operation === "cancel") {
    // "방금 입력한 거 취소" — 이 사용자의 마지막 변경을 되돌린다(이후 다른 변경이 없을 때만).
    const log = ((row.source_payload as { examAiLog?: { by?: string; progress?: { before?: string; after?: string }; homework?: { before?: string; after?: string } }[] } | null)?.examAiLog ?? []);
    const last = log[log.length - 1];
    if (!last || last.by !== d.enteredBy) {
      return { route: "correction", label: header, status: "확인필요", message: `${header}: 마지막 변경이 다른 사람의 입력이라 자동으로 되돌리지 않았습니다. 지울 내용을 알려주세요.` };
    }
    const curP = String(row.progress_content ?? "");
    const curH = String(row.homework_content ?? "");
    if ((last.progress?.after ?? curP) !== curP || (last.homework?.after ?? curH) !== curH) {
      return { route: "correction", label: header, status: "확인필요", message: `${header}: 이후 다른 변경이 있어 자동으로 되돌리지 않았습니다. 지울 내용을 알려주세요.` };
    }
    await correctClassProgressRow(
      row.id as string,
      { progress: last.progress?.before ?? curP, homework: last.homework?.before ?? curH },
      { ...audit, operation: "delete" }
    );
    return { route: "correction", label: header, status: "완료", message: `${header}\n방금 입력한 진도/과제를 취소했습니다(이전 상태로 되돌림).` };
  }
  return { route: "correction", label: header, status: "확인필요", message: `${header}: 무엇을 어떻게 바꿀지 알려주세요(예: '25쪽 → 27쪽').` };
}

const RECORD_TYPE_LABEL: Record<LearningRecordType, string> = {
  assessment: "시험",
  vocab: "단어시험",
  homework: "과제",
  memorization: "암기",
  retest: "재시험",
  attitude: "태도/특이사항",
  makeup: "보강 필요",
  followup: "추가 확인",
  memo: "메모",
};
const DEFAULT_FOLLOWUP_TASK: Partial<Record<LearningRecordType, string>> = {
  homework: "숙제확인",
  memorization: "암기확인",
  vocab: "단어재시",
  assessment: "재시험",
  retest: "재시험",
};

export function describeLearningRecord(d: StudentRecordDraft): string {
  const parts = [d.assessmentName || RECORD_TYPE_LABEL[d.recordType]];
  if (d.score !== null && d.score !== undefined) parts.push(d.maxScore ? `${d.score}/${d.maxScore}` : `${d.score}점`);
  if (d.passed === true) parts.push("통과");
  if (d.passed === false) parts.push("미통과");
  if (d.completed === true) parts.push("완료");
  if (d.completed === false) parts.push("미완료");
  if (d.retestRequired) parts.push("재시험 필요");
  if (d.note) parts.push(d.note);
  if (d.followUp) parts.push(`후속: ${d.followUp}`);
  return parts.join(" · ");
}

// 재전송 중복 방지 키 — 같은 날짜·교시·학생·유형·시험명·점수·결과 + 같은 원문일 때만
// 같다. 다른 수업/다른 입력에서 같은 학생에게 같은 유형 기록이 또 생기는 건 정상 기록된다.
export function learningInputHash(d: StudentRecordDraft): string {
  const key = [
    d.date,
    d.period,
    d.studentId,
    d.recordType,
    norm(d.assessmentName),
    d.score ?? "",
    d.passed ?? "",
    d.completed ?? "",
    d.retestRequired ?? "",
    norm(d.rawText),
  ].join("|");
  return createHash("sha256").update(key).digest("hex");
}

// 학생 기록 저장 → (행동 지시가 있을 때만) 후속 업무 생성 → 기록↔업무 연결.
// 기록 저장이 실패하면 업무를 만들지 않는다. 중복 입력이면 기록도 업무도 새로 만들지 않는다.
async function saveStudentRecordOutcome(
  d: StudentRecordDraft,
  roster: Roster,
  studentNames: Map<string, string>,
  today: string
): Promise<{ outcomes: UnifiedOutcome[]; slackTasks: SlackTask[]; taskKeys: string[] }> {
  const where = d.className ? ` (${d.className}${d.period ? ` ${d.period}` : ""})` : "";
  const desc = describeLearningRecord(d);
  const label = `${d.studentName}${where}`;
  const context: ClassContext | undefined = d.classId ? { classId: d.classId, className: d.className, date: d.date, period: d.period } : undefined;
  const typeLabel = RECORD_TYPE_LABEL[d.recordType];
  const saved = await saveStudentLearningRecord({
    studentId: d.studentId as string,
    classId: d.classId,
    date: d.date,
    period: d.period || null,
    recordType: d.recordType,
    assessmentName: d.assessmentName || null,
    score: d.score,
    maxScore: d.maxScore,
    passed: d.passed,
    retestRequired: d.retestRequired,
    completed: d.completed,
    note: d.note || null,
    followUp: d.followUp || null,
    enteredBy: d.enteredBy,
    rawText: d.rawText,
    inputHash: learningInputHash(d),
    interpretation: { studentName: d.studentName, className: d.className, classFromContext: !!d.classFromContext, actionRequested: d.actionRequested },
  });
  if (saved.status === "duplicate") {
    return {
      outcomes: [{ route: "student_record", label, status: "완료", message: `${label} ${typeLabel}: 이미 기록된 입력입니다(중복 — 새로 저장하지 않음)`, context }],
      slackTasks: [],
      taskKeys: [],
    };
  }
  const outcomes: UnifiedOutcome[] = [
    { route: "student_record", label, status: "완료", message: `${label} ${typeLabel} 기록: ${desc}`, context },
  ];
  if (!d.actionRequested) return { outcomes, slackTasks: [], taskKeys: [] };

  const taskLabel = taskTypeFromLabel(d.taskType) ? d.taskType : DEFAULT_FOLLOWUP_TASK[d.recordType] ?? "기타업무";
  const type = taskTypeFromLabel(taskLabel)!;
  const t = {
    input: {
      type,
      studentId: d.studentId,
      classIds: d.classId ? [d.classId] : undefined,
      content: [d.instruction, desc].filter(Boolean).join(" / "),
      date: today,
      time: "",
      createdBy: d.enteredBy,
      sourceRecordId: saved.id,
    } as NewTaskInput,
    label: `${taskLabel} · ${d.studentName}`,
  };
  const created = await createTaskOutcomes([t], roster, studentNames);
  if (created.createdIds[0]) {
    try {
      await linkLearningRecordTask(saved.id, created.createdIds[0]);
    } catch (err) {
      console.error("[exam-ai] linkLearningRecordTask failed", { recordId: saved.id, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return {
    outcomes: [...outcomes, ...created.outcomes.map((o) => ({ ...o, message: `후속 ${o.message}` }))],
    slackTasks: created.slackTasks,
    taskKeys: created.createdIds.length > 0 ? [`${d.studentId}|${type}`] : [],
  };
}

async function executeDraft(
  draft: AnyDraft,
  roster: Roster,
  studentNames: Map<string, string>,
  today: string
): Promise<{ outcomes: UnifiedOutcome[]; slackTasks: SlackTask[] }> {
  if (draft.kind === "class_progress") {
    return {
      outcomes: [
        await saveClassProgressOutcome({
          classId: draft.classId as string,
          date: draft.date,
          progress: draft.progress,
          homework: draft.homework,
          period: draft.period,
          mode: draft.mode,
          enteredBy: draft.enteredBy,
          rawText: draft.rawText,
        }),
      ],
      slackTasks: [],
    };
  }
  if (draft.kind === "student_record") {
    const r = await saveStudentRecordOutcome(draft, roster, studentNames, today);
    return { outcomes: r.outcomes, slackTasks: r.slackTasks };
  }
  if (draft.kind === "correction") return { outcomes: [await executeCorrection(draft, roster)], slackTasks: [] };
  const t = taskInputFromDraft(draft, today);
  if (!t) return { outcomes: [{ route: "task", label: draft.taskType, status: "실패", message: "업무 유형을 확인할 수 없습니다." }], slackTasks: [] };
  return createTaskOutcomes([t], roster, studentNames);
}

// 후속 답변 처리 — pending.draft에 답변을 병합하고, 충분하면 바로 실행한다.
export async function continuePendingInput(
  pending: PendingAction,
  answer: string,
  opts: { choiceId?: string; staffName?: string } = {}
): Promise<{ ok: boolean; outcomes: UnifiedOutcome[]; tasks: SlackTask[]; context?: ClassContext }> {
  const today = todayKST();
  const roster = await getNlRoster();
  const studentNames = new Map(roster.students.map((st) => [st.id, st.name]));
  const draft = pending.draft;
  // 작성자는 항상 이번 요청의 로그인 세션 기준 — pending은 클라이언트가 들고 있다가
  // 돌려주는 값이라, 그 안의 작성자 이름을 신뢰하지 않고 덮어쓴다.
  if (draft.kind === "task") draft.createdBy = opts.staffName;
  else draft.enteredBy = opts.staffName;
  const missing = await checkDraft(draft, roster);

  let applied = 0;
  if (opts.choiceId) {
    const target = missing.find((m) => m.candidates?.some((c) => c.id === opts.choiceId));
    if (target && applyValue(draft, target, answer, roster, opts.choiceId)) applied++;
  } else if (missing.length === 1) {
    if (applyValue(draft, missing[0], answer, roster)) applied++;
  } else if (missing.length > 1) {
    let values: Record<string, string> = {};
    try {
      values = await parsePendingAnswer(answer, missing.map((m) => ({ key: m.key, question: m.question })));
    } catch {
      values = {};
    }
    for (const m of missing) {
      if (values[m.key] && applyValue(draft, m, values[m.key], roster)) applied++;
    }
  }

  const remaining = await checkDraft(draft, roster);
  if (remaining.length > 0) {
    const attempts = pending.attempts + (applied === 0 ? 1 : 0);
    if (attempts >= 3) {
      return {
        ok: false,
        outcomes: [{ route: draft.kind, label: "", status: "실패", message: "필요한 정보를 확인하지 못해 요청을 취소했습니다. 처음부터 다시 입력해 주세요." }],
        tasks: [],
      };
    }
    const note = applied === 0 ? "답변에서 필요한 정보를 찾지 못했습니다." : "";
    return { ok: false, outcomes: [pendingOutcome(draft, remaining, attempts, note)], tasks: [] };
  }
  const { outcomes, slackTasks } = await executeDraft(draft, roster, studentNames, today);
  return {
    ok: outcomes.every((o) => o.status !== "실패"),
    outcomes,
    tasks: slackTasks,
    context: [...outcomes].reverse().find((o) => o.context)?.context,
  };
}

// class_progress 전용 반 매칭. 띄어쓰기를 무시하고 정확 일치 → 부분 일치 순으로
// 찾고, 부분 일치가 여러 개면 가장 길게 겹치는(가장 구체적인) 이름만 남긴다
// (예: "고2 이사벨A" → "이사벨"보다 "이사벨A"). 그래도 여러 개면 사용자 선택.
export function resolveClassCandidates(className: string | undefined, classes: { id: string; name: string }[]): { id: string; name: string }[] {
  const norm = (v: string) => v.replace(/\s+/g, "").toLowerCase();
  const target = norm(className ?? "");
  if (!target) return [];
  const named = classes.map((c) => ({ id: c.id, name: stripClassSuffix(c.name) }));
  const exact = named.filter((c) => norm(c.name) === target);
  if (exact.length > 0) return exact;
  const partial = named.filter((c) => {
    const cn = norm(c.name);
    return cn.length > 0 && (cn.includes(target) || target.includes(cn));
  });
  if (partial.length <= 1) return partial;
  const score = (c: { name: string }) => Math.min(norm(c.name).length, target.length);
  const best = Math.max(...partial.map(score));
  return partial.filter((c) => score(c) === best);
}

// 반 진도/과제 저장 + 화면 표시용 결과 문구(되묻기 후 재요청 경로도 같이 쓴다).
const CHANGE_LABEL: Record<LineChange, string> = {
  added: "추가",
  duplicate: "이미 기록된 내용(변경 없음)",
  replaced: "수정",
  deleted: "삭제",
  notfound: "지울 내용 없음",
  none: "",
};
export async function saveClassProgressOutcome(input: {
  classId: string;
  date: string;
  progress: string;
  homework: string;
  period?: string;
  mode?: ProgressEditMode;
  enteredBy?: string;
  rawText?: string;
}): Promise<UnifiedOutcome> {
  const saved = await saveClassProgressFromText({ ...input, period: input.period || null });
  const header = `${saved.className}${input.period ? ` ${input.period}` : ""}`;
  const multi = (v: string) => (v ? v.split("\n").join(" / ") : "-");
  const changes = [
    saved.progressChange !== "none" ? `진도 ${CHANGE_LABEL[saved.progressChange]}` : "",
    saved.homeworkChange !== "none" ? `과제 ${CHANGE_LABEL[saved.homeworkChange]}` : "",
  ].filter(Boolean);
  const status =
    saved.mode === "created" ? "저장 완료" : saved.mode === "unchanged" ? "이미 기록된 내용입니다(변경 없음)" : `기존 수업기록에 반영 완료(${changes.join(", ")})`;
  const lines = [header, `${input.date === todayKST() ? "오늘" : input.date} 진도: ${multi(saved.progress)}`, `과제: ${multi(saved.homework)}`, status];
  return {
    route: "class_progress",
    label: header,
    status: "완료",
    message: lines.join("\n"),
    context: { classId: input.classId, className: saved.className, date: input.date, period: input.period ?? "" },
  };
}

// "민지" → "김민지"처럼 직원 이름을 찾는다. 정확 일치 우선, 아니면 부분 일치가
// 딱 1명일 때만 확정한다(여러 명이면 임의로 고르지 않는다).
function resolveStaffByName(name: string | undefined, staff: { id: string; name: string }[]): { id: string; name: string } | null | "ambiguous" {
  const n = name?.trim().replace(/(쌤|선생님|조교님|조교|님)$/, "");
  if (!n) return null;
  const exact = staff.filter((s) => s.name === n);
  if (exact.length === 1) return exact[0];
  const partial = staff.filter((s) => s.name.includes(n) || n.includes(s.name));
  if (partial.length === 1) return partial[0];
  return partial.length > 1 || exact.length > 1 ? "ambiguous" : null;
}

function resolveNamesForIntent(
  names: string[],
  students: StudentInfo[],
  classNameById: Map<string, string>,
  contextText: string,
  strict = false
): { resolved: { id: string; name: string }[]; unresolved: string[]; ambiguous: { name: string; candidates: Choice[] }[] } {
  const resolved: { id: string; name: string }[] = [];
  const unresolved: string[] = [];
  const ambiguous: { name: string; candidates: Choice[] }[] = [];
  for (const raw of names ?? []) {
    const name = raw?.trim();
    if (!name) continue;
    const exact = students.filter((s) => s.name === name);
    let candidates = exact.length > 0 ? exact : students.filter((s) => s.name.includes(name) || name.includes(s.name));
    if (candidates.length > 1) candidates = narrowCandidates(contextText, candidates, classNameById);
    // strict(업무 생성): 동명이인이 남으면 첫 번째를 임의로 고르지 않고 되묻는다.
    if (strict && candidates.length > 1) {
      ambiguous.push({ name, candidates: candidates.map((c) => ({ id: c.id, label: candidateLabel(c, classNameById) })) });
    } else if (candidates.length >= 1) resolved.push({ id: candidates[0].id, name: candidates[0].name });
    else unresolved.push(name);
  }
  return { resolved, unresolved, ambiguous };
}

export async function runUnifiedNlInput(
  text: string,
  opts: { staffName?: string; staffId?: string; context?: ClassContext | null; historyToken?: string | null } = {}
): Promise<{
  ok: boolean;
  outcomes: UnifiedOutcome[];
  tasks: { typeLabel: string; studentName: string; ownerName: string | null; pool: boolean }[];
  context?: ClassContext;
  // 이번 요청에서 입력 이력을 조회했으면 번호↔기록 서명 토큰(다음 입력의 "2번 …"용)
  history?: string;
}> {
  mark("unified:start");
  const today = todayKST();
  mark("unified:before_getNlRoster");
  const roster = await getNlRoster();
  const { students: allStudents, classes, staff } = roster;
  mark("unified:after_getNlRoster");
  const activeStudents = allStudents.filter((s) => s.status === "재원" || !s.status);
  const classNameById = new Map(classes.map((c) => [c.id, stripClassSuffix(c.name)]));
  const weekday = WEEKDAYS[new Date(`${today}T00:00:00Z`).getUTCDay()];
  const studentNames = new Map(allStudents.map((s) => [s.id, s.name]));

  let intents: UnifiedIntent[];
  mark("unified:before_llm");
  try {
    intents = await parseUnifiedInput(
      text,
      {
        today,
        weekday,
        students: activeStudents.map((s) => `${s.name}(${s.school || "학교미상"})`),
        classes: classes.map((c) => stripClassSuffix(c.name)),
        staff: staff.map((s) => s.name),
      },
      TASK_TYPE_LABEL_LIST
    );
    mark("unified:after_llm");
  } catch {
    mark("unified:after_llm_error");
    return { ok: false, outcomes: [{ route: "error", label: text, status: "실패", message: "AI 처리 중 오류가 발생했습니다." }], tasks: [] };
  }

  if (intents.length === 0) {
    return { ok: false, outcomes: [{ route: "clarify", label: text, status: "확인필요", message: "요청을 이해하지 못했습니다. 다시 입력해 주세요." }], tasks: [] };
  }
  intents = enforceIntentBoundaries(intents, text);

  const outcomes: UnifiedOutcome[] = [];
  const taskInputs: { input: NewTaskInput; label: string }[] = [];
  const recordSlackTasks: SlackTask[] = [];
  const recordTaskKeys = new Set<string>();
  let historyToken: string | undefined;

  for (const intent of intents) {
    const label = intent.instruction || intent.taskType || intent.route;
    try {
      const { resolved, unresolved } = resolveNamesForIntent(intent.students ?? [], activeStudents, classNameById, text);
      const unresolvedNote = unresolved.length > 0 ? ` (찾지 못한 이름: ${unresolved.join(", ")})` : "";

      switch (intent.route) {
        case "clarify": {
          outcomes.push({
            route: "clarify",
            label,
            status: "확인필요",
            message:
              intent.message ||
              "요청을 정확히 이해하지 못했어요. 조금만 더 알려주세요 — 예: '고2 이사벨A 1교시 본문 3과'(진도), '김민수 단어 84점'(학생 기록), '민지에게 출력 맡겨'(업무), '방금 입력한 거 취소'(정정), '오늘 입력한 내용 보여줘'(조회).",
          });
          break;
        }
        case "attendance_check": {
          if (resolved.length === 0) {
            outcomes.push({ route: "attendance_check", label, status: "실패", message: `학생을 찾지 못해 확인할 수 없습니다${unresolvedNote}.` });
            break;
          }
          const date = intent.date || today;
          for (const s of resolved) {
            const check = await getAttendanceOnDate(s.id, date);
            if (!check) {
              outcomes.push({ route: "attendance_check", label: s.name, status: "실패", message: `${s.name}: 출결 조회 기능을 사용할 수 없습니다.` });
            } else if (!check.hasRecord) {
              outcomes.push({
                route: "attendance_check",
                label: s.name,
                status: "확인필요",
                message: `${s.name}: ${date} 학생기록이 아직 없습니다 — 결석 처리가 입력 안 됐을 수 있습니다.`,
              });
            } else if (check.attendance === "결석") {
              outcomes.push({ route: "attendance_check", label: s.name, status: "완료", message: `${s.name}: ${date} 결석으로 정상 기록되어 있습니다.` });
            } else {
              outcomes.push({
                route: "attendance_check",
                label: s.name,
                status: "확인필요",
                message: `${s.name}: ${date} 기록은 있으나 출결이 "${check.attendance ?? "미입력"}"입니다(결석 아님).`,
              });
            }
          }
          break;
        }
        case "task": {
          const strictNames = resolveNamesForIntent(intent.students ?? [], activeStudents, classNameById, text, true);
          const draft: TaskDraft = {
            kind: "task",
            taskType: intent.taskType ?? "",
            instruction: intent.instruction ?? "",
            material: intent.material || "",
            quantity: intent.quantity || null,
            date: intent.date || today,
            time: intent.time || "",
            priority: intent.priority,
            classIds: resolveClassIds(intent.className, classes),
            students: strictNames.resolved,
            unresolved: strictNames.unresolved,
            ambiguous: strictNames.ambiguous,
            ownerName: intent.ownerName?.trim() || "",
            ownerId: null,
            createdBy: opts.staffName,
          };
          const missing = await checkDraft(draft, roster);
          if (missing.length > 0) {
            outcomes.push(pendingOutcome(draft, missing, 0));
            break;
          }
          const t = taskInputFromDraft(draft, today);
          if (t) taskInputs.push(t);
          break;
        }
        case "admin_inbox": {
          await createAdminInboxEntry({
            type: intent.inboxType || "기타",
            studentId: resolved[0]?.id ?? null,
            content: intent.instruction,
            startDate: intent.date || today,
            endDate: intent.endDate || undefined,
            enteredBy: opts.staffName,
          });
          outcomes.push({
            route: "admin_inbox",
            label: `${intent.inboxType || "기타"}${unresolvedNote}`,
            status: "완료",
            message: `행정실에 저장했습니다: ${intent.inboxType || "기타"}`,
          });
          break;
        }
        case "schedule": {
          if (resolved.length === 0) {
            outcomes.push({ route: "schedule", label, status: "실패", message: `학생을 찾지 못해 일정을 저장하지 못했습니다${unresolvedNote}.` });
            break;
          }
          const date = intent.date || today;
          await createScheduleEntry({
            type: intent.scheduleType || "보강",
            studentId: resolved[0].id,
            date,
            time: intent.time || "",
            note: intent.instruction || "",
            ownerName: intent.ownerName || undefined,
          });
          outcomes.push({
            route: "schedule",
            label: `${intent.scheduleType || "보강"} · ${resolved[0].name}`,
            status: "완료",
            message: `${intent.scheduleType || "보강"} 일정으로 저장했습니다: ${resolved[0].name} (${date})`,
          });
          break;
        }
        case "counseling": {
          if (resolved.length === 0) {
            outcomes.push({ route: "counseling", label, status: "실패", message: `학생을 찾지 못해 상담일지를 저장하지 못했습니다${unresolvedNote}.` });
            break;
          }
          const date = intent.date || today;
          await createCounselingEntry({
            studentId: resolved[0].id,
            counselor: intent.counselor || "",
            date,
            transcript: "",
            summary: intent.instruction,
            followUp: "",
            enteredBy: opts.staffName,
          });
          outcomes.push({
            route: "counseling",
            label: `상담 · ${resolved[0].name}`,
            status: "완료",
            message: `상담일지에 저장했습니다: ${resolved[0].name} (${date})`,
          });
          break;
        }
        case "student_action": {
          if (resolved.length === 0) {
            outcomes.push({ route: "student_action", label, status: "실패", message: `학생을 찾지 못해 조치사항을 저장하지 못했습니다${unresolvedNote}.` });
            break;
          }
          await updateStudentInfo({
            studentId: resolved[0].id,
            action: intent.instruction,
            actionOwner: intent.ownerName || undefined,
            actionAlarmDate: intent.date || today,
          });
          outcomes.push({
            route: "student_action",
            label: `조치 · ${resolved[0].name}`,
            status: "완료",
            message: `학생 조치사항을 저장했습니다: ${resolved[0].name}`,
          });
          break;
        }
        case "class_progress": {
          const date = intent.date || today;
          const ctx = usableContext(opts.context, date, roster);
          const explicitClass = intent.className?.trim() || "";
          const draft: ClassProgressDraft = {
            kind: "class_progress",
            className: explicitClass || ctx?.className || "",
            // 반 이름이 없으면 직전 입력의 반/교시를 이어 쓴다("추가로 관계대명사 진행").
            classId: explicitClass ? null : ctx?.classId ?? null,
            date,
            progress: intent.progress?.trim() || "",
            homework: intent.homework?.trim() || "",
            period: normalizePeriod(intent.period) || (!explicitClass && ctx ? ctx.period : ""),
            mode: intent.editMode === "replace" || intent.editMode === "delete" ? intent.editMode : "append",
            enteredBy: opts.staffName,
            rawText: text,
          };
          const missing = await checkDraft(draft, roster);
          if (missing.length > 0) {
            outcomes.push(pendingOutcome(draft, missing, 0));
            break;
          }
          outcomes.push(...(await executeDraft(draft, roster, studentNames, today)).outcomes);
          break;
        }
        case "schedule_view": {
          // 조회 전용 — 저장 함수 호출 없음.
          outcomes.push(await runScheduleView(intent.date || today, opts.staffId));
          break;
        }
        case "history_query": {
          // 조회는 읽기 전용 — 이 분기에서는 어떤 저장 함수도 부르지 않는다.
          const r = await runHistoryQuery(intent, roster, { staffName: opts.staffName, staffId: opts.staffId });
          outcomes.push(r.outcome);
          if (r.token) historyToken = r.token;
          break;
        }
        case "correction": {
          const date = intent.date || today;
          const ctx = usableContext(opts.context, date, roster);
          const draft: CorrectionDraft = {
            kind: "correction",
            target: intent.correctionTarget === "student_record" || intent.correctionTarget === "class_progress" ? intent.correctionTarget : "recent",
            operation: intent.operation === "modify" || intent.operation === "cancel" ? intent.operation : "unknown",
            studentNames: (intent.newStudentName ? (intent.students ?? []).slice(0, 1) : intent.students ?? []).map((n) => n?.trim()).filter((n): n is string => !!n),
            className: intent.className?.trim() || "",
            classId: intent.className?.trim() ? null : ctx?.classId ?? null,
            period: normalizePeriod(intent.period),
            date,
            recordType: intent.recordType ?? "",
            assessmentName: intent.assessmentName?.trim() || "",
            oldScore: typeof intent.oldScore === "number" ? intent.oldScore : null,
            selectedId: null,
            selectedLabel: "",
            newScore: typeof intent.newScore === "number" ? intent.newScore : null,
            newMaxScore: typeof intent.newMaxScore === "number" && intent.newMaxScore > 0 ? intent.newMaxScore : null,
            newPassed: typeof intent.newPassed === "boolean" ? intent.newPassed : null,
            newRetestRequired: typeof intent.newRetestRequired === "boolean" ? intent.newRetestRequired : null,
            newCompleted: typeof intent.newCompleted === "boolean" ? intent.newCompleted : null,
            newStudentName: intent.newStudentName?.trim() || "",
            newStudentId: null,
            newPeriod: normalizePeriod(intent.newPeriod),
            field: intent.field === "progress" || intent.field === "homework" ? intent.field : "",
            fromText: intent.fromText?.trim() || "",
            toText: intent.toText?.trim() || "",
            passDecision: null,
            taskDecision: null,
            error: "",
            enteredBy: opts.staffName,
            rawText: text,
          };
          // "2번 …/마지막 거 …": 직전 조회 목록(이 로그인 사용자의 서명 토큰)에서 대상을 바로 고른다.
          if (typeof intent.itemNumber === "number" && intent.itemNumber !== 0) {
            const refs = verifyHistoryToken(opts.historyToken, opts.staffId);
            const idx = intent.itemNumber < 0 ? (refs?.length ?? 0) + intent.itemNumber : intent.itemNumber - 1;
            const ref = refs?.[idx];
            if (!refs) {
              draft.error = "번호로 고치려면 먼저 '오늘 입력한 내용 보여줘'로 목록을 불러와 주세요.";
            } else if (!ref) {
              draft.error = `목록에 ${intent.itemNumber}번이 없습니다(총 ${refs.length}건).`;
            } else if (ref.ref.startsWith("task:")) {
              draft.error = `${intent.itemNumber}번은 업무(${ref.label})입니다. 업무 수정·취소는 '내 업무' 화면에서 해주세요.`;
            } else {
              draft.selectedId = ref.ref;
              draft.selectedLabel = ref.label;
            }
          }
          const missing = draft.error ? [] : await checkDraft(draft, roster);
          if (missing.length > 0) {
            outcomes.push(pendingOutcome(draft, missing, 0));
            break;
          }
          outcomes.push(await executeCorrection(draft, roster));
          break;
        }
        case "student_record": {
          const names = (intent.students ?? []).map((n) => n?.trim()).filter((n): n is string => !!n);
          if (names.length === 0) {
            outcomes.push({ route: "student_record", label, status: "실패", message: `학생 이름을 찾지 못해 기록하지 않았습니다: ${intent.instruction || text}` });
            break;
          }
          const date = intent.date || today;
          const ctx = usableContext(opts.context, date, roster);
          const explicitClass = intent.className?.trim() || "";
          const recordType = (Object.keys(RECORD_TYPE_LABEL) as LearningRecordType[]).includes(intent.recordType as LearningRecordType)
            ? (intent.recordType as LearningRecordType)
            : "memo";
          // 학생마다 따로 기록한다(여러 학생이 한 intent에 묶여 와도 한 명도 빠뜨리지 않는다).
          for (const name of names) {
            const draft: StudentRecordDraft = {
              kind: "student_record",
              studentName: name,
              studentId: null,
              className: explicitClass || ctx?.className || "",
              classId: explicitClass ? null : ctx?.classId ?? null,
              classFromContext: !explicitClass && !!ctx,
              date,
              period: normalizePeriod(intent.period) || (!explicitClass && ctx ? ctx.period : ""),
              recordType,
              assessmentName: intent.assessmentName?.trim() || "",
              score: typeof intent.score === "number" && Number.isFinite(intent.score) ? intent.score : null,
              maxScore: typeof intent.maxScore === "number" && intent.maxScore > 0 ? intent.maxScore : null,
              passed: typeof intent.passed === "boolean" ? intent.passed : null,
              retestRequired: typeof intent.retestRequired === "boolean" ? intent.retestRequired : null,
              completed: typeof intent.completed === "boolean" ? intent.completed : null,
              note: intent.note?.trim() || "",
              followUp: intent.followUp?.trim() || "",
              actionRequested: intent.actionRequested === true,
              taskType: intent.taskType ?? "",
              instruction: intent.instruction ?? "",
              enteredBy: opts.staffName,
              rawText: text,
            };
            const missing = await checkDraft(draft, roster);
            if (missing.length > 0) {
              outcomes.push(pendingOutcome(draft, missing, 0));
              continue;
            }
            try {
              const r = await saveStudentRecordOutcome(draft, roster, studentNames, today);
              outcomes.push(...r.outcomes);
              recordSlackTasks.push(...r.slackTasks);
              r.taskKeys.forEach((k) => recordTaskKeys.add(k));
            } catch (err) {
              // 학생 기록 저장 실패 — 후속 업무도 만들지 않는다(saveStudentRecordOutcome이 기록 먼저 저장).
              outcomes.push({
                route: "student_record",
                label: name,
                status: "실패",
                message: `${name} 학생 기록 저장 실패: ${err instanceof Error ? err.message : "오류"}`,
              });
            }
          }
          break;
        }
        default: {
          outcomes.push({ route: intent.route, label, status: "실패", message: "처리할 수 없는 요청 유형입니다." });
        }
      }
    } catch (err) {
      outcomes.push({ route: intent.route, label, status: "실패", message: err instanceof Error ? err.message : "처리 중 오류가 발생했습니다." });
    }
  }

  // AI가 학생 기록의 후속 업무와 같은 업무를 별도 task로 또 뽑은 경우 중복 생성하지 않는다.
  const dedupedTaskInputs = taskInputs.filter((t) => {
    const dup = !!t.input.studentId && recordTaskKeys.has(`${t.input.studentId}|${t.input.type}`);
    if (dup) outcomes.push({ route: "task", label: t.label, status: "완료", message: `업무 생략: ${t.label} — 학생 기록의 후속 업무로 이미 생성됨` });
    return !dup;
  });
  const created = await createTaskOutcomes(dedupedTaskInputs, roster, studentNames);
  outcomes.push(...created.outcomes);
  const slackTasks = [...recordSlackTasks, ...created.slackTasks];

  const ok = outcomes.length > 0 && outcomes.every((o) => o.status !== "실패");
  const lastContext = [...outcomes].reverse().find((o) => o.context)?.context;
  return { ok, outcomes, tasks: slackTasks, context: lastContext, history: historyToken };
}
