import { parseNaturalLanguageInput, parseCreateTasksInput, parseUnifiedInput, resolveRelativeDate, type UnifiedIntent } from "@/lib/anthropic";
import {
  createAdminInboxEntry,
  createScheduleEntry,
  createCounselingEntry,
  updateStudentInfo,
  createMinimalStudent,
  createTasks,
  getNlRoster,
  getAttendanceOnDate,
} from "@/lib/notion";
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
};

function resolveNamesForIntent(
  names: string[],
  students: StudentInfo[],
  classNameById: Map<string, string>,
  contextText: string
): { resolved: { id: string; name: string }[]; unresolved: string[] } {
  const resolved: { id: string; name: string }[] = [];
  const unresolved: string[] = [];
  for (const raw of names ?? []) {
    const name = raw?.trim();
    if (!name) continue;
    const exact = students.filter((s) => s.name === name);
    let candidates = exact.length > 0 ? exact : students.filter((s) => s.name.includes(name) || name.includes(s.name));
    if (candidates.length > 1) candidates = narrowCandidates(contextText, candidates, classNameById);
    if (candidates.length >= 1) resolved.push({ id: candidates[0].id, name: candidates[0].name });
    else unresolved.push(name);
  }
  return { resolved, unresolved };
}

export async function runUnifiedNlInput(
  text: string,
  opts: { staffName?: string } = {}
): Promise<{
  ok: boolean;
  outcomes: UnifiedOutcome[];
  tasks: { typeLabel: string; studentName: string; ownerName: string | null; pool: boolean }[];
}> {
  mark("unified:start");
  const today = todayKST();
  mark("unified:before_getNlRoster");
  const { students: allStudents, classes, staff } = await getNlRoster();
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

  const outcomes: UnifiedOutcome[] = [];
  const taskInputs: { input: NewTaskInput; label: string }[] = [];

  for (const intent of intents) {
    const label = intent.instruction || intent.taskType || intent.route;
    try {
      const { resolved, unresolved } = resolveNamesForIntent(intent.students ?? [], activeStudents, classNameById, text);
      const unresolvedNote = unresolved.length > 0 ? ` (찾지 못한 이름: ${unresolved.join(", ")})` : "";

      switch (intent.route) {
        case "clarify": {
          outcomes.push({ route: "clarify", label, status: "확인필요", message: intent.message || "무엇을 해야 할지 명확하지 않습니다." });
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
          const type = intent.taskType ? taskTypeFromLabel(intent.taskType) : null;
          if (!type) {
            outcomes.push({ route: "task", label, status: "실패", message: `"${intent.taskType ?? ""}"은(는) 알 수 없는 업무 유형입니다.` });
            break;
          }
          const studentIds = resolved.map((s) => s.id);
          const forcePool = (intent.students?.length ?? 0) > 0 && studentIds.length === 0;
          const classIds = resolveClassIds(intent.className, classes);
          const contentParts = [
            intent.instruction,
            intent.material ? `자료: ${intent.material}` : "",
            intent.quantity ? `수량: ${intent.quantity}` : "",
          ].filter(Boolean);
          taskInputs.push({
            input: {
              type,
              studentId: studentIds[0] ?? null,
              studentIds: studentIds.length > 1 ? studentIds : undefined,
              classIds: classIds.length > 0 ? classIds : undefined,
              content: contentParts.join(" / "),
              date: intent.date || today,
              time: intent.time || "",
              priority: intent.priority,
              forcePool,
            },
            label: `${intent.taskType}${resolved.length ? " · " + resolved.map((s) => s.name).join(",") : ""}${unresolvedNote}`,
          });
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
        default: {
          outcomes.push({ route: intent.route, label, status: "실패", message: "처리할 수 없는 요청 유형입니다." });
        }
      }
    } catch (err) {
      outcomes.push({ route: intent.route, label, status: "실패", message: err instanceof Error ? err.message : "처리 중 오류가 발생했습니다." });
    }
  }

  const slackTasks: { typeLabel: string; studentName: string; ownerName: string | null; pool: boolean }[] = [];
  if (taskInputs.length > 0) {
    mark("unified:before_createTasks_write");
    try {
      const created = await createTasks(taskInputs.map((t) => t.input), { staff, classes, studentNames });
      mark("unified:after_createTasks_write");
      const staffNameById = new Map(staff.map((s) => [s.id, s.name]));
      created.forEach((c, i) => {
        outcomes.push({
          route: "task",
          label: taskInputs[i].label,
          status: "완료",
          message: `업무 등록: ${TASK_TYPE_LABELS[c.type]}${c.pool ? " (공용업무풀)" : ""}`,
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
  }

  const ok = outcomes.length > 0 && outcomes.every((o) => o.status !== "실패");
  return { ok, outcomes, tasks: slackTasks };
}
