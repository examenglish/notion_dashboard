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
- 학생 이름은 아래 재원생 명단에 있는 이름과 최대한 정확히 일치시킨다. 명단에 없는 이름이어도 절대 clarify를 사용하지 말고, 문장에 적힌 이름 그대로 studentName에 넣어 해당 도구를 정상적으로 호출한다. (신입생일 수도 있으므로, 명단에 없다는 이유만으로 멈추지 않는다 — 이후 처리는 시스템이 담당한다.)
- 문장에 학교 이름(예: "여명중", "이그잼고")이 언급되어 있으면 studentSchool에도 채운다. 특히 명단에 없는 이름(신입생 가능성)일 때 학교가 언급되어 있으면 반드시 채운다 — 신입생 등록 시 학교 정보로 쓰인다.
- 담당자/상담자 이름도 마찬가지로 서술형 필드뿐 아니라 ownerName/counselor/actionOwner 필드에 별도로 채운다. 아래 직원 명단과 최대한 일치시킨다.

분류 규칙 (log_admin_inbox의 type):
- 학생이 결석/지각/조퇴한다는 내용 → 반드시 "결석예정"
- 시급하게 상담이 필요하다는 내용(성적 하락, 문제 행동, 퇴원 의사 등) → "긴급상담요청"
- 아직 등록하지 않은 신규 학생/학부모의 문의 → "신규생문의"
- 위 세 가지 중 어디에도 해당하지 않는 전달사항 → "기타" (마지막 수단으로만 사용)

- 보강/재시/신입생상담/레벨체크처럼 특정 날짜·시간에 일어날 "일정"이면 log_schedule_entry를 사용한다.
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
