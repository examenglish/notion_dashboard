import Anthropic from "@anthropic-ai/sdk";
import { mark } from "@/lib/timing";

// Server-only. Never import this file from a "use client" component.
if (typeof window !== "undefined") {
  throw new Error("lib/anthropic.ts must only be used on the server");
}

export const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Haiku 4.5 — cheap enough for a high-volume (300+/day) single-turn
// extraction task; accuracy needs are modest since every result still
// resolves against known student/staff names before it's trusted.
export const NL_MODEL = "claude-haiku-4-5-20251001";

export type NlReference = {
  today: string;
  weekday: string;
  students: string[];
  classes: string[];
  staff: string[];
};

const WEEKDAY_NUM: Record<string, number> = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };

// Haiku is unreliable at "다음주 X요일"-style relative-date arithmetic even
// with a printed lookup table in context (verified in testing: it
// consistently landed a week too far out, ignoring the table). Rather than
// trust the model for this, resolve the common explicit patterns
// deterministically in code and use that as an override when it matches.
export function resolveRelativeDate(text: string, todayStr: string): string | null {
  const [y, m, d] = todayStr.split("-").map(Number);
  const today = Date.UTC(y, m - 1, d);
  const todayDow = new Date(today).getUTCDay();
  const mondayOffset = todayDow === 0 ? 6 : todayDow - 1;
  const thisMonday = today - mondayOffset * 86400000;
  const addDays = (base: number, days: number) => new Date(base + days * 86400000).toISOString().slice(0, 10);

  if (/모레/.test(text)) return addDays(today, 2);
  if (/오늘/.test(text)) return todayStr;
  if (/내일/.test(text)) return addDays(today, 1);

  const weekMatch = text.match(/(다다음|다음|이번)\s?주\s?([일월화수목금토])요?일?/);
  if (weekMatch) {
    const weekOffset = weekMatch[1] === "다다음" ? 2 : weekMatch[1] === "다음" ? 1 : 0;
    const dow = WEEKDAY_NUM[weekMatch[2]];
    const base = thisMonday + weekOffset * 7 * 86400000;
    const dayOffset = dow === 0 ? 6 : dow - 1;
    return addDays(base, dayOffset);
  }

  const explicit = text.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/) || text.match(/(\d{1,2})\/(\d{1,2})(?!\d)/);
  if (explicit) {
    const mm = Number(explicit[1]);
    const dd = Number(explicit[2]);
    let year = y;
    const candidate = Date.UTC(year, mm - 1, dd);
    if (candidate < today - 30 * 86400000) year += 1;
    return new Date(Date.UTC(year, mm - 1, dd)).toISOString().slice(0, 10);
  }

  return null;
}

const NL_TOOLS: Anthropic.Tool[] = [
  {
    name: "log_admin_inbox",
    description: "결석예정, 긴급상담요청, 신규생문의, 기타 전달사항을 행정실에 등록한다.",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["결석예정", "긴급상담요청", "신규생문의", "기타"] },
        studentName: { type: "string", description: "학생 이름. 해당 없으면 빈 문자열." },
        studentSchool: { type: "string", description: "학생 학교 이름(예: 여명중). 문장에 언급되어 있으면 채우고, 없으면 빈 문자열." },
        content: { type: "string", description: "전달할 내용 요약" },
        startDate: { type: "string", description: "YYYY-MM-DD. 결석예정의 시작일 또는 사건 날짜." },
        endDate: { type: "string", description: "YYYY-MM-DD. 기간이 있는 결석예정에만 사용, 없으면 빈 문자열." },
      },
      required: ["type", "content", "startDate"],
    },
  },
  {
    name: "log_schedule_entry",
    description: "보강, 재시, 신입생상담, 레벨체크 일정을 할일관리에 등록한다.",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["보강", "재시", "신입생상담", "레벨체크"] },
        studentName: { type: "string" },
        studentSchool: { type: "string", description: "학생 학교 이름(예: 여명중). 문장에 언급되어 있으면 채우고, 없으면 빈 문자열." },
        date: { type: "string", description: "YYYY-MM-DD" },
        time: { type: "string", description: "예: 16:00. 모르면 빈 문자열." },
        ownerName: { type: "string", description: "담당 직원 이름. 모르면 빈 문자열." },
        note: { type: "string", description: "추가 메모. 없으면 빈 문자열." },
      },
      required: ["type", "studentName", "date"],
    },
  },
  {
    name: "log_counseling",
    description: "학생 상담 내용을 상담일지에 등록한다.",
    input_schema: {
      type: "object",
      properties: {
        studentName: { type: "string" },
        studentSchool: { type: "string", description: "학생 학교 이름(예: 여명중). 문장에 언급되어 있으면 채우고, 없으면 빈 문자열." },
        counselor: { type: "string", description: "상담자 이름. 모르면 빈 문자열." },
        date: { type: "string", description: "YYYY-MM-DD" },
        summary: { type: "string", description: "상담 내용 요약" },
        followUp: { type: "string", description: "후속조치. 없으면 빈 문자열." },
      },
      required: ["studentName", "summary", "date"],
    },
  },
  {
    name: "log_student_action",
    description: "학생의 학습레벨/조치사항(예: 성적하락 상담필요 등 후속 조치가 필요한 메모)과 담당자, 알람일을 학생 정보에 기록한다.",
    input_schema: {
      type: "object",
      properties: {
        studentName: { type: "string" },
        studentSchool: { type: "string", description: "학생 학교 이름(예: 여명중). 문장에 언급되어 있으면 채우고, 없으면 빈 문자열." },
        action: { type: "string", description: "조치 내용" },
        actionOwner: { type: "string", description: "담당자 이름. 모르면 빈 문자열." },
        actionAlarmDate: { type: "string", description: "YYYY-MM-DD. 알림이 필요한 날짜, 모르면 오늘." },
      },
      required: ["studentName", "action"],
    },
  },
  {
    name: "clarify",
    description: "문장이 위 항목 중 어디에도 명확히 해당하지 않거나, 학생 이름 자체가 문장에 전혀 없을 때만 사용한다. 학생 이름이 있지만 재원생 명단에서 못 찾은 경우는 clarify를 쓰지 말고, 문장에 적힌 이름 그대로 studentName에 넣어 해당 도구를 정상적으로 호출한다 (이름 확인은 시스템이 별도로 처리한다).",
    input_schema: {
      type: "object",
      properties: {
        message: { type: "string", description: "사용자에게 보여줄, 무엇이 불명확한지 설명하는 한국어 메시지" },
      },
      required: ["message"],
    },
  },
];

const WEEKDAYS_KO = ["일", "월", "화", "수", "목", "금", "토"];

// A model computing "다음주 월요일" via pure arithmetic is error-prone
// (verified in testing: Haiku consistently landed on the Monday a week too
// far out). Tagging each date with its 이번주/다음주/다다음주 week label
// turns that into a plain lookup instead of a calculation, which fixed it
// across repeated trials. Lives in the cached system block, so it costs
// nothing extra per call.
function buildDateTable(todayStr: string): string {
  const [y, m, d] = todayStr.split("-").map(Number);
  const start = Date.UTC(y, m - 1, d);
  const startDow = new Date(start).getUTCDay(); // 0=Sun..6=Sat
  const mondayOffset = startDow === 0 ? 6 : startDow - 1;
  const thisWeekMonday = start - mondayOffset * 86400000;

  const rows: string[] = [];
  for (let i = 0; i < 21; i++) {
    const t = start + i * 86400000;
    const dt = new Date(t);
    const dateStr = dt.toISOString().slice(0, 10);
    const weekday = WEEKDAYS_KO[dt.getUTCDay()];
    const weeksFromThisMonday = Math.floor((t - thisWeekMonday) / (7 * 86400000));
    const label = weeksFromThisMonday === 0 ? "이번주" : weeksFromThisMonday === 1 ? "다음주" : weeksFromThisMonday === 2 ? "다다음주" : null;
    rows.push(`${dateStr}(${weekday}${i === 0 ? ",오늘" : ""}${label ? "," + label : ""})`);
  }
  return rows.join(" ");
}

function buildSystemBlocks(ref: NlReference): Anthropic.TextBlockParam[] {
  const text = `너는 영어학원 관리 시스템의 자연어 입력을 구조화된 데이터로 변환하는 도우미다.
직원이 자유롭게 쓴 한국어 문장을 읽고, 제공된 도구(tool) 중 가장 적절한 것 하나를 반드시 호출해서 정보를 추출한다.

날짜 규칙:
- 오늘 날짜는 ${ref.today} (${ref.weekday}요일)이다. "오늘"/"내일"/"모레"/"이번주 O요일"/"다음주 O요일" 같은 표현이 나오면 직접 계산하지 말고, 아래 날짜 참고표에서 각 날짜에 붙은 이번주/다음주/다다음주 표시와 요일을 보고 정확히 일치하는 날짜를 찾아 그대로 사용한다.

날짜 참고표 (YYYY-MM-DD(요일,주차) 형식):
${buildDateTable(ref.today)}

이름 추출 규칙:
- 문장에 학생 이름이 등장하면, content/summary/action 같은 서술형 필드 안에만 적어두지 말고 반드시 studentName 필드에도 별도로 채워 넣는다.
- 학생 이름은 아래 재원생 명단에 있는 이름과 최대한 정확히 일치시킨다. 명단에 없는 이름이어도 절대 clarify를 사용하지 말고, 문장에 적힌 이름 그대로 studentName에 넣어 해당 도구를 정상적으로 호출한다(학생 확인은 시스템이 따로 한다). 명단에 없다는 사실만으로 신입생·신규 문의·신입생상담으로 판단하지 않는다.
- 문장에 학교 이름(예: "여명중", "이그잼고")이 언급되어 있으면 studentSchool에도 채운다.
- 담당자/상담자 이름도 마찬가지로 서술형 필드뿐 아니라 ownerName/counselor/actionOwner 필드에 별도로 채운다. 아래 직원 명단과 최대한 일치시킨다.

분류 규칙 (log_admin_inbox의 type):
- 학생이 결석/지각/조퇴한다는 내용 → 반드시 "결석예정"
- 시급하게 상담이 필요하다는 내용(성적 하락, 문제 행동, 퇴원 의사 등) → "긴급상담요청"
- 아직 등록하지 않은 신규 학생/학부모의 문의 → "신규생문의"(문장에 신규·신입·입학·등록 문의 같은 말이 있을 때만)
- 위 세 가지 중 어디에도 해당하지 않는 전달사항 → "기타" (마지막 수단으로만 사용)

- 보강/재시/신입생상담/레벨체크처럼 특정 날짜·시간에 일어날 "일정"이면 log_schedule_entry를 사용한다. 신입생상담은 신입생·신규·입학·첫 상담이라는 말이 문장에 있을 때만 고른다.
- 상담을 실제로 진행하고 그 내용을 기록하는 것이면 log_counseling을 사용한다 (아직 예정된 상담 일정이면 log_schedule_entry).
- 학생의 학습 상태에 대한 지속적인 조치/후속관리 메모(예: "성적하락 상담 필요", "단어시험 재시 필요")를 남기는 것이면 log_student_action을 사용한다.
- 학생 이름이 저장에 꼭 필요한데 문장 어디에도 이름 자체가 전혀 없거나, 문장이 어느 항목에도 명확히 해당하지 않으면 clarify 도구를 사용한다. (이름이 있지만 명단에 없는 것은 clarify 사유가 아니다.) 추측해서 지어내지 않는다.
- 도구는 반드시 하나만 호출하고, 그 외의 텍스트 응답은 하지 않는다.

예시 (이름이 명단에 없어도 clarify를 쓰지 않는 경우):
입력: "박서연 8월5일 오후 4시 레벨체크, 이강사 담당" (박서연이 아래 재원생 명단에 없다고 가정)
→ clarify를 쓰지 않고 log_schedule_entry를 호출한다: {type:"레벨체크", studentName:"박서연", date:"...", time:"16:00", ownerName:"이강사"}

재원생 명단 (이름(학교)):
${ref.students.join(", ")}

반 목록:
${ref.classes.join(", ")}

직원 명단:
${ref.staff.join(", ")}`;

  return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
}

export type NlParseResult =
  | { kind: "clarify"; message: string }
  | { kind: "log_admin_inbox" | "log_schedule_entry" | "log_counseling" | "log_student_action"; input: any };

// ---------------------------------------------------------------------------
// AI 업무운영 시스템(섹션3) — "한 문장 → 여러 업무"로 쪼개는 전용 경로.
// 위 NL_TOOLS/parseNaturalLanguageInput은 건드리지 않고 완전히 별도의 tool +
// 별도의 호출부(app/api/tasks/from-text/route.ts)로만 쓰인다 — 기존 대시보드
// 입력창/Slack 슬래시태그 동작에는 전혀 영향이 없다. 담당자 배정은 여기서
// 하지 않는다(AI는 "무슨 업무들인지"만 판단하고, 배정은 lib/task-routing.ts의
// 결정론적 규칙이 맡는다 — 섹션3 요구사항).
// ---------------------------------------------------------------------------

const CREATE_TASKS_TOOL = (typeLabels: string[]): Anthropic.Tool => ({
  name: "create_tasks",
  description:
    "직원이 학생 상황이나 업무를 자연어로 설명한 문장을, 실행 가능한 개별 업무 여러 건으로 쪼갠다. 문장 하나에 여러 조치가 섞여 있으면(예: 암기 확인 + 재시험 + 숙제 확인) 각각을 별도 업무로 분리한다.",
  input_schema: {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: typeLabels, description: "업무 유형(한글 라벨 중 하나)" },
            studentName: { type: "string", description: "학생 이름. 해당 없으면 빈 문자열." },
            studentSchool: { type: "string", description: "학생 학교. 언급 없으면 빈 문자열." },
            content: { type: "string", description: "업무 내용 요약 — 무엇을, 왜 해야 하는지." },
            date: { type: "string", description: "YYYY-MM-DD. 언급 없으면 오늘." },
            time: { type: "string", description: "예: 16:00. 언급 없으면 빈 문자열." },
            priority: { type: "string", enum: ["긴급", "보통"], description: "문장에 '급하다/오늘 꼭' 같은 긴급 표현이 있으면 긴급." },
          },
          required: ["type", "content", "date"],
        },
      },
    },
    required: ["tasks"],
  },
});

const CREATE_TASKS_CLARIFY_TOOL: Anthropic.Tool = {
  name: "clarify",
  description: "문장에서 실행 가능한 업무를 전혀 찾을 수 없을 때만 사용한다.",
  input_schema: {
    type: "object",
    properties: { message: { type: "string", description: "무엇이 불명확한지 설명하는 한국어 메시지" } },
    required: ["message"],
  },
};

function buildCreateTasksSystemBlocks(ref: NlReference, typeLabels: string[]): Anthropic.TextBlockParam[] {
  const text = `너는 영어학원 관리 시스템에서, 직원이 자연어로 쓴 업무 지시를 실행 가능한 개별 업무 목록으로 구조화하는 도우미다.

오늘 날짜는 ${ref.today} (${ref.weekday}요일)이다.
날짜 참고표 (YYYY-MM-DD(요일,주차) 형식):
${buildDateTable(ref.today)}

규칙:
- 문장 하나에 여러 조치가 섞여 있으면 각각을 별도 업무로 나눈다. 예: "민수 대화문 암기 안 됨. 관계대명사도 잘 모름. 문제 뽑아서 오늘 재시험시키고 본문 숙제도 확인" → (1)암기확인 (2)재시험 (3)숙제확인, 세 건.
- 업무 유형(type)은 반드시 아래 목록 중 하나를 그대로 쓴다: ${typeLabels.join(", ")}
- 담당자를 임의로 정하지 않는다 — ownerName 같은 필드는 없다. 시스템이 근무시간/담당반 기준으로 자동 배정한다.
- 학생 이름이 문장에 있으면 studentName에 정확히 채운다(재원생 명단과 최대한 일치시킨다). 학교가 언급되면 studentSchool도 채운다.
- 날짜/시간이 명시되지 않으면 date는 오늘(${ref.today}), time은 빈 문자열로 둔다.
- 실행 가능한 업무를 전혀 찾을 수 없는 문장(잡담, 의미 불명 등)에서만 clarify를 쓴다.
- 도구는 반드시 하나만 호출한다.

재원생 명단 (이름(학교)):
${ref.students.join(", ")}

직원 명단:
${ref.staff.join(", ")}`;
  return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
}

export type TaskDraft = {
  type: string;
  studentName: string;
  studentSchool: string;
  content: string;
  date: string;
  time: string;
  priority?: "긴급" | "보통";
};

export type CreateTasksParseResult = { kind: "tasks"; tasks: TaskDraft[] } | { kind: "clarify"; message: string };

export async function parseCreateTasksInput(text: string, ref: NlReference, typeLabels: string[]): Promise<CreateTasksParseResult> {
  mark("anthropic:ct:before_call");
  const res = await anthropic.messages.create({
    model: NL_MODEL,
    max_tokens: 1024,
    system: buildCreateTasksSystemBlocks(ref, typeLabels),
    tools: [CREATE_TASKS_TOOL(typeLabels), CREATE_TASKS_CLARIFY_TOOL],
    tool_choice: { type: "any" },
    messages: [{ role: "user", content: text }],
  });
  mark("anthropic:ct:after_call");

  const toolUse = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!toolUse || toolUse.name === "clarify") {
    const input = (toolUse?.input as { message?: string }) ?? {};
    return { kind: "clarify", message: input.message || "업무를 파악하지 못했습니다. 다시 입력해 주세요." };
  }
  const input = toolUse.input as { tasks: TaskDraft[] };
  return { kind: "tasks", tasks: input.tasks ?? [] };
}

// forceTool: "/보강", "/상담" 같은 슬래시 명령으로 카테고리를 이미 알고 있을
// 때 넘긴다 — Haiku의 분류(어느 도구를 쓸지) 단계를 완전히 건너뛰고 해당
// 도구 하나만 강제 호출해서, 그 안의 필드(학생 이름/날짜/시간 등) 추출만
// 맡긴다. 분류가 애매해서 잘못된 카테고리로 저장되는 문제를 원천 차단한다.
export async function parseNaturalLanguageInput(
  text: string,
  ref: NlReference,
  forceTool?: "log_admin_inbox" | "log_schedule_entry" | "log_counseling" | "log_student_action"
): Promise<NlParseResult> {
  mark("anthropic:legacy:before_call");
  const res = await anthropic.messages.create({
    model: NL_MODEL,
    max_tokens: 512,
    system: buildSystemBlocks(ref),
    tools: NL_TOOLS,
    tool_choice: forceTool ? { type: "tool", name: forceTool } : { type: "any" },
    messages: [{ role: "user", content: text }],
  });
  mark("anthropic:legacy:after_call");

  const toolUse = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!toolUse) {
    return { kind: "clarify", message: "요청을 이해하지 못했습니다. 다시 입력해 주세요." };
  }
  if (toolUse.name === "clarify") {
    const input = toolUse.input as { message?: string };
    return { kind: "clarify", message: input.message || "요청을 이해하지 못했습니다. 다시 입력해 주세요." };
  }
  return { kind: toolUse.name as any, input: toolUse.input };
}

// ---------------------------------------------------------------------------
// 통합 자연어 입력(2026-09-19, staff.md PART 8) — 위 parseCreateTasksInput과
// parseNaturalLanguageInput을 순서대로 호출하던 예전 app/api/ai-input 경로가
// 실측 9.9초 중 LLM 호출만 7.1초(72%)를 차지했다(호출을 두 번 했으므로).
// 여기서는 한 번의 호출로 문장을 "여러 개의 독립된 intent"로 나눠서 위
// 두 도구가 커버하던 것(업무 생성 13종 + 행정/일정/상담/조치 4종)과, 새로
// 추가된 "확인"(조회, 예: 결석 입력 여부 확인) intent까지 한 번에 뽑는다.
// 기존 parseCreateTasksInput/parseNaturalLanguageInput과 그 호출부
// (runCreateTasksCommand/runNaturalLanguageCommand, 슬래시 명령/Slack)는
// 그대로 둔다 — 이 함수는 app/api/ai-input의 자유 텍스트 입력 전용
// 신규 경로(runUnifiedNlInput)에서만 쓴다.
// ---------------------------------------------------------------------------

export type UnifiedIntentRoute =
  | "task"
  | "admin_inbox"
  | "schedule"
  | "counseling"
  | "student_action"
  | "attendance_check"
  | "class_progress"
  | "student_record"
  | "correction"
  | "history_query"
  | "schedule_view"
  | "clarify";

// 최상위 의도 경계. 모델이 세부 route보다 먼저 이것을 정하고, route는 반드시 이 경계 안에서
// 고른다(lib/nl-input.ts enforceIntentBoundaries가 어긋난 조합을 저장 없이 되묻기로 바꾼다).
// 의미 우선순위: correction > query > record > action (special은 명시어가 있을 때만).
export type IntentClass = "correction" | "query" | "record" | "action" | "special" | "unclear";

export type UnifiedIntent = {
  intentClass?: IntentClass;
  // 서버 내부 표시(AI 출력 아님): 명시적 행동 동사가 없어 "업무로 등록할까요?" 확인이 필요,
  // 또는 서버 guard가 남기는 안내 문구.
  needsActionConfirm?: boolean;
  guardNote?: string;
  route: UnifiedIntentRoute;
  taskType?: string;
  inboxType?: "결석예정" | "긴급상담요청" | "신규생문의" | "기타";
  scheduleType?: "보강" | "재시" | "신입생상담" | "레벨체크";
  students: string[];
  studentSchool?: string;
  className?: string;
  instruction: string;
  quantity?: number | null;
  material?: string | null;
  date?: string;
  endDate?: string;
  time?: string;
  ownerName?: string;
  counselor?: string;
  priority?: "긴급" | "보통";
  message?: string;
  progress?: string;
  homework?: string;
  period?: string;
  editMode?: "append" | "replace" | "delete";
  recordType?: "assessment" | "vocab" | "homework" | "memorization" | "retest" | "attitude" | "makeup" | "followup" | "memo";
  assessmentName?: string;
  score?: number | null;
  maxScore?: number | null;
  passed?: boolean | null;
  retestRequired?: boolean | null;
  completed?: boolean | null;
  note?: string;
  followUp?: string;
  actionRequested?: boolean;
  correctionTarget?: "student_record" | "class_progress" | "admin_record" | "recent";
  newStartDate?: string;
  newEndDate?: string;
  operation?: "modify" | "cancel" | "unknown";
  oldScore?: number | null;
  newScore?: number | null;
  newMaxScore?: number | null;
  newPassed?: boolean | null;
  newRetestRequired?: boolean | null;
  newCompleted?: boolean | null;
  newStudentName?: string;
  newPeriod?: string;
  fromText?: string;
  toText?: string;
  field?: "progress" | "homework" | "";
  itemNumber?: number;
  afterPrevious?: boolean;
  historyFrom?: string;
  historyTo?: string;
  historyRecent?: boolean;
  onlyMine?: boolean;
  retestOnly?: boolean;
  incompleteOnly?: boolean;
};

const UNIFIED_INTENTS_TOOL = (taskTypeLabels: string[]): Anthropic.Tool => ({
  name: "submit_intents",
  description:
    "사용자 문장 하나를 독립적으로 처리 가능한 intent 여러 개로 분리한다. 서로 다른 요청(업무 지시, 기록, 조회 등)이 한 문장에 섞여 있으면 반드시 각각 별도 intent로 나눈다.",
  input_schema: {
    type: "object",
    properties: {
      intents: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          properties: {
            intentClass: {
              type: "string",
              enum: ["correction", "query", "record", "action", "special", "unclear"],
              description:
                "route보다 먼저 정하는 최상위 의도. correction=이미 입력한 것을 고치거나 취소, query=보여달라/확인만(아무것도 만들지 않음), record=이미 일어난 수업·학습 결과/상태 기록, action=직원에게 앞으로 할 일을 시키는 명시적 행동 요청(…해줘/시켜/맡겨/잡아줘) 또는 명시된 지속관리 방침, special=신입생·신규·입학 상담/등록 문의나 결석예정·긴급상담 같은 행정 전달(명시어가 있을 때만), unclear=판단 불가.",
            },
            route: {
              type: "string",
              enum: ["task", "admin_inbox", "schedule", "counseling", "student_action", "attendance_check", "class_progress", "student_record", "correction", "history_query", "schedule_view", "clarify"],
              description:
                "task=업무 생성(아래 taskType 13종 중 하나), admin_inbox=행정실 기록(결석예정/긴급상담요청/신규생문의/기타), schedule=예정된 일정(보강/재시/신입생상담/레벨체크), counseling=이미 진행한 상담 기록, student_action=학생 조치사항 메모, attendance_check=이미 입력된 출결/결석 여부를 조회만 하는 확인 요청(새로 기록하지 않음), class_progress=반 전체의 오늘 수업 진도/과제(숙제) 기록, student_record=학생 한 명의 학습 결과/상태 기록(시험·단어시험 점수, 과제 완료/미완료, 암기, 재시험, 태도, 보강 필요, 추가 확인, 메모), correction=이미 입력한 기록을 고치거나 취소하는 요청(아까/방금/그거/잘못 입력/아니고/아니야/취소/고쳐/바꿔/삭제/수정), history_query=이미 입력한 내용을 보여달라는 조회 요청(보여줘/뭐 입력했지/목록/기록 확인 — 새로 기록하지 않음), schedule_view=오늘(또는 특정 날짜) 일정·할 일·업무·보강/재시 일정을 보여달라는 조회(새로 만들지 않음), clarify=위 어디에도 명확히 해당하지 않을 때.",
            },
            taskType: { type: "string", enum: taskTypeLabels, description: "route가 task일 때만. 업무 유형 한글 라벨." },
            inboxType: { type: "string", enum: ["결석예정", "긴급상담요청", "신규생문의", "기타"], description: "route가 admin_inbox일 때만." },
            scheduleType: { type: "string", enum: ["보강", "재시", "신입생상담", "레벨체크"], description: "route가 schedule일 때만." },
            students: {
              type: "array",
              items: { type: "string" },
              description: "이 intent가 관련된 학생 이름들. 여러 명이면 전부 나열(예: 3명이 같은 업무 하나를 공유하면 배열에 3명 다). 해당 없으면 빈 배열.",
            },
            studentSchool: { type: "string", description: "문장에 학교 이름이 있으면 채움. 없으면 빈 문자열." },
            className: { type: "string", description: "언급된 반 이름. 없으면 빈 문자열." },
            instruction: { type: "string", description: "이 intent의 핵심 내용/지시/요약(무엇을 해야 하는지 또는 무엇을 기록하는지)." },
            quantity: { type: "number", description: "'3부'처럼 수량이 언급되면 그 숫자. 없으면 0." },
            material: { type: "string", description: "언급된 자료/교재 이름(예: '부교재', '예상문제'). 없으면 빈 문자열." },
            date: { type: "string", description: "YYYY-MM-DD. 언급 없으면 오늘." },
            endDate: { type: "string", description: "YYYY-MM-DD. 기간이 있는 admin_inbox(결석예정)에만, 없으면 빈 문자열." },
            time: { type: "string", description: "예: 16:00. 없으면 빈 문자열." },
            ownerName: {
              type: "string",
              description: "담당 직원 이름. schedule의 담당자, 또는 task에서 '민지에게 맡겨/OO쌤이 해줘'처럼 지시자가 담당자를 직접 지정한 경우 그 직원 이름(직원 명단 기준). 지정이 없으면 빈 문자열.",
            },
            counselor: { type: "string", description: "상담자 이름(counseling). 없으면 빈 문자열." },
            priority: { type: "string", enum: ["긴급", "보통"], description: "급한 표현이 있으면 긴급, 아니면 보통." },
            message: { type: "string", description: "route가 clarify일 때만, 무엇이 불명확한지 한국어 설명." },
            progress: { type: "string", description: "route가 class_progress일 때만. 오늘 수업한 진도 내용(예: '3과 본문 1~4번'). 없으면 빈 문자열." },
            homework: { type: "string", description: "route가 class_progress일 때만. 내준 과제/숙제 내용(예: '워크북 22~25쪽'). 없으면 빈 문자열." },
            period: { type: "string", description: "route가 class_progress/student_record일 때. 문장에 'N교시'(예: 1교시, 2교시)가 있을 때만 그대로 'N교시' 형식으로. 없으면 빈 문자열(추측 금지)." },
            editMode: {
              type: "string",
              enum: ["append", "replace", "delete"],
              description: "route가 class_progress일 때. 기본 append(추가). '수정해/바꿔/잘못 입력했어/이걸로 교체'처럼 기존 내용을 바꾸라는 명시가 있으면 replace, '삭제해/지워'면 delete(progress/homework에 지울 내용). 애매하면 append.",
            },
            recordType: {
              type: "string",
              enum: ["assessment", "vocab", "homework", "memorization", "retest", "attitude", "makeup", "followup", "memo"],
              description: "route가 student_record일 때. assessment=시험(단원평가/모의고사 등), vocab=단어시험, homework=과제, memorization=암기(본문/대화문), retest=재시험을 치른 결과, attitude=수업 태도/특이사항, makeup=보강 필요, followup=추가 확인 필요, memo=그 외 일반 메모.",
            },
            assessmentName: { type: "string", description: "student_record: 시험/과제/암기 대상 이름(예: '단어시험 3과', '워크북', '본문 암기'). 없으면 빈 문자열." },
            score: { type: "number", description: "student_record: 점수(예: 84). 없으면 생략." },
            maxScore: { type: "number", description: "student_record: 만점/문항수(예: '17/20'이면 20). 없으면 생략(시스템이 100점 만점으로 보지 않음)." },
            passed: { type: "boolean", description: "student_record: '통과/합격'이면 true, '불합격/미통과/재시험'이면 false. 언급 없으면 생략." },
            retestRequired: { type: "boolean", description: "student_record: 재시험이 필요하다고 했으면 true. 언급 없으면 생략." },
            completed: { type: "boolean", description: "student_record: 과제/암기/재시험을 '완료/했음'이면 true, '미완료/안 함'이면 false. 해당 없으면 생략." },
            note: { type: "string", description: "student_record: 특이사항/메모 원문 요약. 없으면 빈 문자열." },
            followUp: { type: "string", description: "student_record: '다음 시간 재확인'처럼 언급된 후속조치. 없으면 빈 문자열." },
            correctionTarget: {
              type: "string",
              enum: ["student_record", "class_progress", "admin_record", "recent"],
              description: "route가 correction일 때. 학생 점수/과제/암기/재시험 등 학생 기록이면 student_record, 반 진도/과제면 class_progress, 이미 입력된 행정실 기록(결석예정·긴급상담요청·신규생문의·행정실 문의)이면 admin_record(inboxType도 채움), '방금 거/아까 거'처럼 대상이 불분명하면 recent.",
            },
            operation: {
              type: "string",
              enum: ["modify", "cancel", "unknown"],
              description: "correction: 값을 바꾸면 modify(…아니고 …야, 고쳐, 바꿔, 수정), 기록 자체를 없애면 cancel(취소, 삭제, 지워, 없던 걸로), '잘못 입력했어'처럼 어느 쪽인지 모르면 unknown.",
            },
            oldScore: { type: "number", description: "correction: 틀렸다고 한 기존 점수('84점 아니고'의 84). 없으면 생략." },
            newScore: { type: "number", description: "correction: 바꿀 점수('94점이야'의 94). 없으면 생략." },
            newMaxScore: { type: "number", description: "correction: 바꿀 만점. 없으면 생략." },
            newPassed: { type: "boolean", description: "correction: '통과야'면 true, '불합격이야'면 false. 언급 없으면 생략." },
            newRetestRequired: { type: "boolean", description: "correction: '재시험 아니야/재시험 필요 없어'면 false, '재시험이야'면 true. 언급 없으면 생략." },
            newCompleted: { type: "boolean", description: "correction: '과제 했어/완료야'면 true, '미완료야'면 false. 언급 없으면 생략." },
            newStudentName: { type: "string", description: "correction: '민수가 아니라 민지야'처럼 학생을 바꾸면 새 이름(민지). 이때 students에는 기존 이름(민수). 없으면 빈 문자열." },
            newStartDate: { type: "string", description: "correction(admin_record): 바꿀 시작 날짜 YYYY-MM-DD(예: 결석 날짜 수정). 없으면 빈 문자열." },
            newEndDate: { type: "string", description: "correction(admin_record): 바꿀 끝 날짜 YYYY-MM-DD. 없으면 빈 문자열." },
            newPeriod: { type: "string", description: "correction: '1교시 아니고 2교시'면 'N교시' 형식의 새 교시. 없으면 빈 문자열." },
            fromText: { type: "string", description: "correction(class_progress): 틀린/지울 부분 원문('25쪽 아니고 27쪽'의 '25쪽', '관계대명사 한 거 삭제'의 '관계대명사'). 없으면 빈 문자열." },
            toText: { type: "string", description: "correction(class_progress): 바꿀 부분('27쪽'). 삭제면 빈 문자열." },
            afterPrevious: {
              type: "boolean",
              description: "route가 task일 때: 같은 문장에서 바로 앞 task가 끝난 뒤에 해야 하는 업무면 true(예: '어순배열 수정하고 15부 출력해줘'의 출력). 순서가 없으면 생략.",
            },
            itemNumber: {
              type: "number",
              description: "correction: 직전에 보여준 입력 목록의 번호로 가리킬 때('2번 94점으로'의 2, '첫 번째 거'는 1, '마지막 거'는 -1). 없으면 생략.",
            },
            historyFrom: { type: "string", description: "history_query: 조회 시작 날짜 YYYY-MM-DD(오늘/어제 등을 날짜로). 없으면 오늘." },
            historyTo: { type: "string", description: "history_query: 조회 끝 날짜 YYYY-MM-DD(포함). 없으면 historyFrom과 같게." },
            historyRecent: { type: "boolean", description: "history_query: '방금/최근/아까 입력한 거'처럼 날짜보다 최근 몇 건을 원하면 true." },
            onlyMine: { type: "boolean", description: "history_query: '전체/모든 직원/다른 선생님 것까지'라고 하면 false, 그 외(내가/제가 입력한, 입력한 내용)는 true." },
            retestOnly: { type: "boolean", description: "history_query: '재시험 기록'만 보여달라면 true." },
            incompleteOnly: { type: "boolean", description: "history_query: '과제 미완료/암기 미완료'처럼 미완료 기록만이면 true(recordType도 함께)." },
            field: { type: "string", enum: ["progress", "homework", ""], description: "correction(class_progress): 진도면 progress, 과제/숙제면 homework, 모르면 빈 문자열." },
            actionRequested: {
              type: "boolean",
              description: "student_record: 직원에게 행동을 지시하는 표현('확인해줘/확인시켜/재시험 시켜/다음 시간 체크해줘/맡겨')이 있으면 true — 이때 taskType에 알맞은 업무 유형도 넣는다. 단순 상태 기록('미완료', '다음 시간 재확인' 메모)은 false.",
            },
          },
          required: ["intentClass", "route", "students", "instruction"],
        },
      },
    },
    required: ["intents"],
  },
});

function buildUnifiedSystemBlocks(ref: NlReference, taskTypeLabels: string[]): Anthropic.TextBlockParam[] {
  const text = `너는 영어학원 관리 시스템의 자연어 입력을 구조화하는 도우미다. 직원이 자유롭게 쓴 한국어 문장 하나에 서로 다른 요청이 여러 개 섞여 있을 수 있다 — 반드시 각각을 독립된 intent로 분리해서 submit_intents 도구 하나를 호출한다.

오늘 날짜는 ${ref.today} (${ref.weekday}요일)이다.
날짜 참고표 (YYYY-MM-DD(요일,주차) 형식):
${buildDateTable(ref.today)}

intent 분리 예시:
"김정우, 신융, 허준혁 영어2 천재조 3과 예상문제, 부교재 변형문제 출처 찾아서 출력 3부 오류 생김, 김정우 결석 입력했음 확인해줘"
→ 3개 intent로 분리:
  1) route:"task", taskType:"자료준비"(또는 "출력"), students:["김정우","신융","허준혁"], instruction:"3과 예상문제/부교재 변형문제 출처 찾기", material:"부교재 변형문제"
  2) route:"task", taskType:"출력", students:["김정우","신융","허준혁"], instruction:"출력", quantity:3
  3) route:"attendance_check", students:["김정우"], instruction:"결석 입력 여부 확인"

최상위 의도 판단(각 intent마다 route보다 먼저 intentClass를 정한다). 한 문장이 여러 의미에 걸치면 아래 순서가 앞선 쪽이 이긴다:
1) correction(수정·취소): 이미 입력한 기록/내용을 가리키면서(방금·아까·입력한 것·그거·N번·기존 값 "X 아니고 Y") 고치거나 없애라는 뜻. 취소/삭제/지워/잘못 입력/아니고/정정/수정/고쳐/바꿔 같은 말이 "이미 입력한 것"을 향하면 새 기록·업무·조치사항을 만들지 말고 route:"correction". 새로 할 일을 취소하는 게 아니라 기록을 되돌리는 것이다.
2) query(조회): 보여줘/뭐 입력했지/목록/확인만 → 아무것도 만들지 않는다. 내가 입력한 기록·이력이면 route:"history_query", 오늘/특정 날짜의 일정·할 일·업무·보강/재시 일정이면 route:"schedule_view", 특정 학생 출결이 입력됐는지면 route:"attendance_check". "오늘 입력한 내용 보여줘"(history_query)와 "오늘 일정 보여줘"(schedule_view)는 다르다.
3) record(이미 일어난 사실): 수업 진도/과제(route:"class_progress"), 학생의 시험·단어·과제·암기·재시험 결과/상태·태도·메모(route:"student_record"), 이미 진행한 상담 내용(route:"counseling"). "테스트/과제/재시험/암기" 같은 명사만 있고 행동을 시키는 말이 없으면 기록이다 — 업무나 일정으로 만들지 않는다. 예: "OO 불규칙동사 테스트" → student_record(recordType 알맞게, 점수 없으면 score 생략), "OO 단어시험 84점" → student_record, "OO 84점 재시험" → student_record(retestRequired:true).
4) action(앞으로 할 일): 직원에게 시키는 명시적 행동 요청(…해줘/시켜/맡겨/잡아줘/확인해줘/체크해줘/전화해줘/출력해줘/다시 테스트해줘)만 route:"task" 또는 route:"schedule"(보강/재시/레벨체크처럼 날짜·시간이 있는 일정). 기록 + 행동이 함께 있으면 학생 기록(actionRequested:true, taskType)으로 한 번에 나타낸다. 앞으로 지속 관리할 방침을 명시한 경우(예: "당분간 단어시험 매일 체크", "성적하락 — 매주 상담 필요")만 route:"student_action".
5) special(명시어가 있을 때만): 신입생·신규·입학·첫/처음 상담·등록 문의·신규생 문의라는 말이 문장에 있을 때만 scheduleType:"신입생상담" 또는 inboxType:"신규생문의". 결석예정·긴급상담요청 같은 행정 전달은 route:"admin_inbox". 학생이 명단에 없다는 사실만으로 신입생·신규 상담을 추측하지 않는다.
6) unclear: 위 어디에도 확신이 없으면 저장될 route를 억지로 고르지 말고 route:"clarify" + message에 가능한 해석을 구체적으로 묻는다(예: "이태경의 불규칙동사 학습 결과를 기록할까요, 테스트를 진행하라는 업무인가요?"). 잘못 저장하는 것보다 묻는 것이 낫다.

분류 규칙:
- route:"task"의 taskType은 반드시 아래 13개 중 하나: ${taskTypeLabels.join(", ")}
- route:"schedule"은 아직 안 한, 앞으로 할 일정(보강/재시/레벨체크, 그리고 명시어가 있을 때만 신입생상담)을 새로 잡을 때만. 일정을 보여달라는 문장은 schedule_view.
- route:"counseling"은 상담을 이미 진행하고 그 내용을 기록할 때만(예정이면 schedule).
- route:"student_action"은 위 4)의 "지속 관리 방침"을 사용자가 명시했을 때만. 시험·과제 결과(→student_record), 기록 취소·수정(→correction), 판단이 애매한 문장(→clarify)을 student_action으로 보내지 않는다 — student_action은 fallback이 아니다.
- route:"admin_inbox"는 결석예정/긴급상담요청/(명시어가 있는)신규생문의/기타 행정 전달사항.
- route:"attendance_check"는 "확인해줘/입력됐는지 봐줘"처럼 이미 있어야 할 기록을 조회만 하는 요청 — 새로 기록을 만들라는 뜻이 아니다. 절대 task나 admin_inbox로 분류하지 않는다.
- 학생 이름은 재원생 명단과 최대한 정확히 일치시킨다. 명단에 없는 이름도 문장 그대로 students에 넣는다(시스템이 학생 확인을 따로 묻는다). 이름을 못 찾았다고 의도(route/intentClass)를 바꾸지 않는다.
- 문장 전체가 어디에도 해당하지 않을 때만 그 부분을 route:"clarify"로 남긴다(문장 전체를 통째로 포기하지 말고, 해석 가능한 다른 부분은 정상 분류한다).
- route:"class_progress"는 반 이름 + 그 반의 오늘 수업 진도/과제(숙제)를 기록하는 문장일 때(학생 개인이 아니라 반 전체 기록). className은 반 목록에서 가장 가까운 이름을 그대로 쓰고(학년 표기 '고2/중2' 등은 반 이름에 있을 때만 포함), progress에 진도, homework에 과제를 나눠 넣는다. students는 빈 배열. 예: "고2 이사벨A 오늘 3과 본문 1~4번 했고 숙제는 워크북 22~25쪽" → route:"class_progress", className:"이사벨A"(반 목록의 실제 이름), progress:"3과 본문 1~4번", homework:"워크북 22~25쪽". 이것을 task로 분류하지 않는다. "1교시/2교시"가 있으면 period에 넣는다(같은 반이라도 교시가 다르면 별개 수업 — 한 문장에 여러 교시가 있으면 교시별로 intent를 나눈다).
- route:"student_record"는 학생 한 명당 intent 하나다(여러 학생이 나오면 학생마다 따로, 한 학생도 빠뜨리지 말 것). students에는 그 학생 이름 하나만. 여러 줄 입력에서 첫 줄의 반/교시("고2 이사벨A 1교시")는 아래 모든 줄(진도·과제·학생 기록)에 className/period로 똑같이 넣는다. 예: "김민수 단어시험 84점 재시험" → recordType:"vocab", score:84, passed:false, retestRequired:true. "박지훈 워크북 과제 미완료" → recordType:"homework", assessmentName:"워크북", completed:false, actionRequested:false. "박지훈 과제 미완료, 다음 시간 확인해줘" → 같은 기록 + actionRequested:true, taskType:"숙제확인". 학생 기록을 task로 따로 중복 생성하지 않는다.
- route:"correction"은 이미 입력한 기록을 고치거나 취소하는 문장이다(새 기록을 만들지 않는다). 언급된 학생/반/교시/시험 종류는 students/className/period/recordType/assessmentName에 그대로(대상 찾기용), 바뀔 값은 new* 필드에 넣는다. 예: "84점 아니고 94점이야" → correctionTarget:"student_record", operation:"modify", oldScore:84, newScore:94. "김민수 재시험 아니야" → students:["김민수"], operation:"modify", newRetestRequired:false. "박지훈 과제 미완료 취소" → students:["박지훈"], recordType:"homework", operation:"cancel". "아까 과제 25쪽까지 아니고 27쪽까지" → correctionTarget:"class_progress", field:"homework", fromText:"25쪽", toText:"27쪽", operation:"modify". "관계대명사 한 거 삭제해" → correctionTarget:"class_progress", field:"progress", fromText:"관계대명사", operation:"cancel". "방금 입력한 거 취소해" → correctionTarget:"recent", operation:"cancel". "아까 거 잘못 입력했어" → correctionTarget:"recent", operation:"unknown". "민수가 아니라 민지야" → students:["민수"], newStudentName:"민지", operation:"modify". "1교시 아니고 2교시야" → newPeriod:"2교시", correctionTarget:"recent", operation:"modify".
- route:"history_query"는 조회만 한다. 언급된 학생은 students, 반은 className, 종류는 recordType. 예: "오늘 입력한 내용 보여줘" → route:"history_query", historyFrom:오늘. "어제 입력한 내용" → historyFrom:어제. "방금 입력한 거 보여줘" → historyRecent:true. "김민수 오늘 기록 보여줘" → students:["김민수"]. "오늘 재시험 기록 보여줘" → retestOnly:true. "오늘 과제 미완료 입력한 거" → recordType:"homework", incompleteOnly:true. 조회 문장을 student_record/class_progress/task로 분류해 새 기록을 만들면 절대 안 된다.
- 목록 번호로 고치는 문장("2번 94점으로", "3번 취소", "첫 번째 거 잘못됐어", "마지막 거 삭제", "2번 재시험 아니야")은 route:"correction" + itemNumber. "3번 과제 27쪽까지로 바꿔" → itemNumber:3, correctionTarget:"class_progress", field:"homework", toText:"27쪽", operation:"modify".
- 이미 입력된 행정실 기록(결석예정 등)을 지우거나 고치는 문장("박재하 결석예정 삭제해줘", "박재하 결석예정 취소", "박재하 결석예정 아니야", "박재하 결석 날짜 수정해줘")은 새 행정 전달(admin_inbox)이나 업무가 아니라 route:"correction", correctionTarget:"admin_record", inboxType:"결석예정", students:["박재하"]이다. 삭제/취소/아니야 → operation:"cancel", 날짜 수정 → operation:"modify" + newStartDate/newEndDate. 반면 "박재하 결석 관련해서 학부모에게 전화해줘"는 기존 기록 변경이 아니라 task(학부모연락)다.
- route:"clarify"를 쓸 때 message에는 "무엇을 해야 할지 명확하지 않습니다" 같은 일반 문구 대신, 문장에서 이해한 부분과 부족한 정보를 구체적으로 묻는 한국어 질문을 쓴다.
- route:"class_progress"의 기본 editMode는 append다. "추가로 ~ 진행"은 append. 명시적인 수정/교체/삭제 표현이 있을 때만 replace/delete.
- 교재 제작·편집(시험지·어순배열·빈칸 문제·단어시험·워크북·정답지 제작/수정, PDF/문서 편집, OCR/원문 확인, 교재 검수)은 taskType:"교재편집"이고 instruction에 대상(학교/학년/반/시험)과 세부 작업을 적는다. 프린트 출력·제본은 "출력", 학생에게 나눠주기·전달은 "전달". "A 하고 B 해줘"처럼 순서가 있는 여러 업무는 각각 task로 나누고 뒤 업무에 afterPrevious:true. 예: "거성중2 어순배열 수정하고 15부 출력해줘" → 1) taskType:"교재편집", instruction:"거성중2 어순배열 수정" 2) taskType:"출력", quantity:15, afterPrevious:true. 담당자가 없으면 ownerName은 빈 문자열(교재편집은 시스템이 Pool에 둔다).
- route:"task"에서 "OO에게 맡겨/OO가 해줘"처럼 담당 직원이 명시되면 ownerName에 그 직원 이름을 넣는다. 명시가 없으면 ownerName은 빈 문자열(시스템이 조교 업무풀/자동배정으로 처리). "8시까지"처럼 마감 시각이 있으면 time에 넣는다.
- intents 배열은 최소 1개 이상이어야 한다.

재원생 명단 (이름(학교)):
${ref.students.join(", ")}

반 목록:
${ref.classes.join(", ")}

직원 명단:
${ref.staff.join(", ")}`;
  return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
}

// 테스트/진단용: 실제 호출에 쓰는 system prompt 텍스트.
export function unifiedSystemPromptText(ref: NlReference, taskTypeLabels: string[]): string {
  return buildUnifiedSystemBlocks(ref, taskTypeLabels)[0].text;
}

export async function parseUnifiedInput(text: string, ref: NlReference, taskTypeLabels: string[]): Promise<UnifiedIntent[]> {
  mark("anthropic:unified:before_call");
  const res = await anthropic.messages.create({
    model: NL_MODEL,
    max_tokens: 2048,
    system: buildUnifiedSystemBlocks(ref, taskTypeLabels),
    tools: [UNIFIED_INTENTS_TOOL(taskTypeLabels)],
    tool_choice: { type: "tool", name: "submit_intents" },
    messages: [{ role: "user", content: text }],
  });
  mark("anthropic:unified:after_call");

  const toolUse = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const input = (toolUse?.input as { intents?: UnifiedIntent[] }) ?? {};
  return input.intents ?? [];
}

// ---------------------------------------------------------------------------
// EXAM AI 대화형 보완(pending) — 앞 입력에서 이미 구조화한 draft는 그대로 두고,
// 사용자의 후속 답변에서 "부족했던 항목"만 뽑는다(전체 명령을 다시 해석하지
// 않는다). 부족 항목이 1개면 lib/nl-input.ts가 LLM 없이 답변 전체를 그 값으로
// 쓰고, 2개 이상일 때만 이 함수를 부른다.
// ---------------------------------------------------------------------------
export async function parsePendingAnswer(answer: string, questions: { key: string; question: string }[]): Promise<Record<string, string>> {
  const properties = Object.fromEntries(
    questions.map((q) => [q.key, { type: "string", description: `질문: "${q.question}"에 대한 답. 답변에 없으면 빈 문자열.` }])
  );
  const res = await anthropic.messages.create({
    model: NL_MODEL,
    max_tokens: 512,
    system:
      "너는 학원 관리 시스템의 후속 답변 해석기다. 직원이 앞서 받은 질문들에 한 번에 답한 문장에서 각 질문에 해당하는 값만 원문 표현 그대로 뽑아 submit_answers를 호출한다. 추측하지 말고, 답하지 않은 항목은 빈 문자열로 둔다.",
    tools: [
      {
        name: "submit_answers",
        description: "질문별 답변 값",
        input_schema: { type: "object", properties, required: questions.map((q) => q.key) } as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: "tool", name: "submit_answers" },
    messages: [{ role: "user", content: `질문:\n${questions.map((q, i) => `${i + 1}. ${q.question}`).join("\n")}\n\n답변: ${answer}` }],
  });
  const toolUse = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const out = (toolUse?.input as Record<string, unknown>) ?? {};
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, typeof v === "string" ? v.trim() : ""]));
}
