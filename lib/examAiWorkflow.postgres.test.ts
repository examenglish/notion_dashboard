// EXAM AI 자연어 입력 E2E(LLM만 mock): 반 진도/과제 저장, 업무지시 →
// 지정배정/자동배정/조교 업무풀 → 진행 시작 → 완료 → 원장 진행현황, 그리고
// 정보 부족 시 대화형 보완(pending)까지 실제 lib 코드로 검증한다. Supabase
// REST는 인메모리 fake fetch(GET 필터/POST/PATCH, branch 스코프),
// Notion SDK는 mock(best-effort 미러), next/cache는 캐시 없이 통과.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UnifiedIntent } from "@/lib/anthropic";

vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: any[]) => any) => fn,
  revalidateTag: vi.fn(),
}));

vi.mock("@notionhq/client", () => ({
  Client: vi.fn().mockImplementation(function Client() {
    return {
      pages: {
        create: vi.fn().mockImplementation(async () => ({ id: `notion-mock-${Math.random().toString(36).slice(2)}` })),
        update: vi.fn().mockResolvedValue({}),
        retrieve: vi.fn().mockResolvedValue(null),
      },
      dataSources: { query: vi.fn().mockResolvedValue({ results: [] }) },
    };
  }),
}));

const { parseUnifiedInput, parsePendingAnswer } = vi.hoisted(() => ({
  parseUnifiedInput: vi.fn(),
  parsePendingAnswer: vi.fn(),
}));
vi.mock("@/lib/anthropic", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/anthropic")>()),
  parseUnifiedInput,
  parsePendingAnswer,
}));

type Row = Record<string, any>;

function matchClause(clause: string, row: Row): boolean {
  const neg = clause.match(/^([a-z_]+)\.not\.(.*)$/);
  if (neg) return !matchClause(`${neg[1]}.${neg[2]}`, row);
  const m = clause.match(/^([a-z_]+)\.(eq|cs|is|in|gte|lte)\.(.*)$/);
  if (!m) throw new Error(`fake-supabase: unsupported clause "${clause}"`);
  const [, col, op, rawVal] = m;
  const cell = row[col];
  const decoded = decodeURIComponent(rawVal);
  if (op === "eq") {
    if (decoded === "true" || decoded === "false") return cell === (decoded === "true");
    return String(cell ?? "") === decoded;
  }
  if (op === "is") return rawVal === "null" ? cell === null || cell === undefined : false;
  if (op === "cs") {
    const v = decodeURIComponent(rawVal.replace(/^\{/, "").replace(/\}$/, ""));
    return Array.isArray(cell) && cell.includes(v);
  }
  if (op === "gte") return String(cell ?? "") >= decoded;
  if (op === "lte") return String(cell ?? "") <= decoded;
  if (op === "in") return rawVal.replace(/^\(/, "").replace(/\)$/, "").split(",").map(decodeURIComponent).includes(String(cell ?? ""));
  return false;
}

function applyFilters(rows: Row[], searchParams: URLSearchParams): Row[] {
  let out = rows;
  for (const [key, value] of searchParams.entries()) {
    if (key === "select" || key === "order" || key === "limit") continue;
    if (key === "or") {
      const clauses = value.replace(/^\(/, "").replace(/\)$/, "").split(/,(?=[a-z_]+\.)/);
      out = out.filter((row) => clauses.some((c) => matchClause(c, row)));
      continue;
    }
    out = out.filter((row) => matchClause(`${key}.${value}`, row));
  }
  return out;
}

function makeFakeSupabase(tables: Record<string, Row[]>) {
  let idCounter = 0;
  return vi.fn(async (url: string, init?: any) => {
    const u = new URL(url);
    const table = u.pathname.replace("/rest/v1/", "");
    const method = (init?.method || "GET").toUpperCase();
    if (table === "branches") {
      const code = u.searchParams.get("code")?.replace(/^eq\./, "");
      return new Response(JSON.stringify(code === "sajik" ? [{ id: "branch-sajik" }] : []), { status: 200 });
    }
    tables[table] = tables[table] ?? [];
    if (method === "GET") return new Response(JSON.stringify(applyFilters(tables[table], u.searchParams)), { status: 200 });
    if (method === "POST") {
      const body = JSON.parse(init.body as string);
      const now = new Date().toISOString();
      const inserted = (Array.isArray(body) ? body : [body]).map((item: Row) => ({
        id: `gen-${++idCounter}`,
        notion_id: null,
        created_at: now,
        updated_at: now,
        source_payload: {},
        ...item,
      }));
      tables[table].push(...inserted);
      return new Response(JSON.stringify(inserted), { status: 201 });
    }
    if (method === "PATCH") {
      const body = JSON.parse(init.body as string);
      const matched = applyFilters(tables[table], u.searchParams);
      for (const row of matched) Object.assign(row, body, { updated_at: new Date().toISOString() });
      return new Response(JSON.stringify(matched), { status: 200 });
    }
    return new Response("[]", { status: 200 });
  });
}

let tables: Record<string, Row[]>;
const B = "branch-sajik";

function seed() {
  tables = {
    classes: [
      { id: "cls-isabel-a", notion_id: "cls-isabel-a", branch_id: B, name: "고2 이사벨A", student_notion_ids: ["stu-minsu-2b", "stu-jiho", "stu-seoyeon", "stu-jihun"], assistant_notion_ids: [], days: [] },
      { id: "cls-isabel-b", notion_id: "cls-isabel-b", branch_id: B, name: "고2 이사벨B", student_notion_ids: [], assistant_notion_ids: [], days: [] },
      { id: "cls-1a", notion_id: "cls-1a", branch_id: B, name: "고1A", student_notion_ids: ["stu-minsu-1a"], assistant_notion_ids: [], days: [] },
      { id: "cls-2b", notion_id: "cls-2b", branch_id: B, name: "고2B", student_notion_ids: ["stu-minsu-2b"], assistant_notion_ids: [], days: [] },
    ],
    students: [
      { id: "stu-minsu-1a", notion_id: "stu-minsu-1a", branch_id: B, name: "김민수", school: "금정고", grade: "고1", status: "재원", class_notion_ids: ["cls-1a"] },
      { id: "stu-minsu-2b", notion_id: "stu-minsu-2b", branch_id: B, name: "김민수", school: "부산고", grade: "고2", status: "재원", class_notion_ids: ["cls-2b"] },
      { id: "stu-jiho", notion_id: "stu-jiho", branch_id: B, name: "이지호", school: "부산고", grade: "고2", status: "재원", class_notion_ids: ["cls-isabel-a"] },
      { id: "stu-seoyeon", notion_id: "stu-seoyeon", branch_id: B, name: "이서연", school: "부산고", grade: "고2", status: "재원", class_notion_ids: ["cls-isabel-a"] },
      { id: "stu-jihun", notion_id: "stu-jihun", branch_id: B, name: "박지훈", school: "부산고", grade: "고2", status: "재원", class_notion_ids: ["cls-isabel-a"] },
    ],
    staff: [
      { id: "staff-director", notion_id: "staff-director", branch_id: B, name: "원장님", role: "원장", work_schedule: "" },
      { id: "staff-minji", notion_id: "staff-minji", branch_id: B, name: "박민지", role: "조교", work_schedule: "" },
      { id: "staff-sora", notion_id: "staff-sora", branch_id: B, name: "최소라", role: "조교", work_schedule: "" },
    ],
    class_progress: [],
    daily_records: [],
    briefings: [],
    tasks: [],
    student_learning_records: [],
  };
}

function intent(partial: Partial<UnifiedIntent>): UnifiedIntent {
  return { route: "clarify", students: [], instruction: "", ...partial } as UnifiedIntent;
}

// 모든 조교가 "지금" 근무하지 않도록 오늘 요일이 아닌 요일만 근무시간표에 둔다.
function makeEveryoneOffShift() {
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  const today = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" })).getDay();
  const other = weekdays[(today + 3) % 7];
  for (const s of tables.staff) if (s.role === "조교") s.work_schedule = `${other}=14:00-22:00`;
}

beforeEach(() => {
  seed();
  vi.stubGlobal("fetch", makeFakeSupabase(tables));
  process.env.SUPABASE_URL = "https://fake.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-key";
  process.env.ACADEMY_BRANCH_ID = "sajik";
  process.env.ACADEMY_DB_PROVIDER = "postgres";
  process.env.ACADEMY_STUDENT_READ_PROVIDER = "postgres";
  parseUnifiedInput.mockReset();
  parsePendingAnswer.mockReset();
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.ACADEMY_BRANCH_ID;
  delete process.env.ACADEMY_DB_PROVIDER;
  delete process.env.ACADEMY_STUDENT_READ_PROVIDER;
});

describe("1. 자연어 → 반 진도/과제 저장", () => {
  it("'고2 이사벨A 오늘 3과 본문 1~4번, 숙제 워크북 22~25쪽' → 반 1행만 저장(학생별 복제 없음)", async () => {
    parseUnifiedInput.mockResolvedValue([
      intent({ route: "class_progress", className: "고2 이사벨A", progress: "3과 본문 1~4번", homework: "워크북 22~25쪽" }),
    ]);
    const { runUnifiedNlInput } = await import("@/lib/nl-input");
    const res = await runUnifiedNlInput("고2 이사벨A 오늘 3과 본문 1~4번, 숙제 워크북 22~25쪽", { staffName: "원장님" });

    expect(res.ok).toBe(true);
    expect(res.outcomes[0].message).toBe("고2 이사벨A\n오늘 진도: 3과 본문 1~4번\n과제: 워크북 22~25쪽\n저장 완료");
    expect(tables.class_progress).toHaveLength(1);
    expect(tables.class_progress[0]).toMatchObject({
      class_id: "cls-isabel-a",
      class_notion_ids: ["cls-isabel-a"],
      progress_content: "3과 본문 1~4번",
      homework_content: "워크북 22~25쪽",
      period: null,
      student_records_created: false,
    });
    expect(tables.daily_records).toHaveLength(0);
    expect(tables.briefings).toHaveLength(0);
  });

  it("같은 반·같은 날 두 번째 입력은 새 행을 만들지 않고 과제만 갱신한다", async () => {
    parseUnifiedInput
      .mockResolvedValueOnce([intent({ route: "class_progress", className: "이사벨A", progress: "본문 3과까지", homework: "" })])
      .mockResolvedValueOnce([intent({ route: "class_progress", className: "이사벨A", progress: "", homework: "워크북 22~25쪽" })]);
    const { runUnifiedNlInput } = await import("@/lib/nl-input");
    await runUnifiedNlInput("고2 이사벨A 오늘 본문 3과까지");
    const second = await runUnifiedNlInput("이사벨A 과제 워크북 22~25쪽");

    expect(tables.class_progress).toHaveLength(1);
    expect(tables.class_progress[0]).toMatchObject({ progress_content: "본문 3과까지", homework_content: "워크북 22~25쪽" });
    expect(second.outcomes[0].message).toContain("기존 수업기록에 반영 완료");
  });

  it("반 후보가 여러 개면 되묻고, 후보 버튼 선택(choiceId)으로 첫 입력과 합쳐 저장한다", async () => {
    parseUnifiedInput.mockResolvedValue([intent({ route: "class_progress", className: "이사벨", progress: "3과 본문", homework: "워크북 22쪽" })]);
    const { runUnifiedNlInput, continuePendingInput } = await import("@/lib/nl-input");
    const first = await runUnifiedNlInput("이사벨 오늘 3과 본문, 숙제 워크북 22쪽");

    const pending = first.outcomes[0].pending!;
    expect(first.outcomes[0].status).toBe("확인필요");
    expect(pending.question).toContain("어느 반인가요?");
    expect(pending.missing[0].candidates?.map((c) => c.label)).toEqual(["고2 이사벨A", "고2 이사벨B"]);
    expect(tables.class_progress).toHaveLength(0);

    const second = await continuePendingInput(JSON.parse(JSON.stringify(pending)), "고2 이사벨B", { choiceId: "cls-isabel-b" });
    expect(second.ok).toBe(true);
    expect(tables.class_progress).toHaveLength(1);
    expect(tables.class_progress[0]).toMatchObject({ class_id: "cls-isabel-b", progress_content: "3과 본문", homework_content: "워크북 22쪽" });
    expect(parseUnifiedInput).toHaveBeenCalledTimes(1);
  });

  it("반과 진도가 모두 없으면 두 가지를 한 번에 묻고, 일부만 답하면 남은 것만 다시 묻는다", async () => {
    parseUnifiedInput.mockResolvedValue([intent({ route: "class_progress", className: "", progress: "", homework: "" })]);
    const { runUnifiedNlInput, continuePendingInput } = await import("@/lib/nl-input");
    const first = await runUnifiedNlInput("오늘 수업 기록해줘");
    const p1 = first.outcomes[0].pending!;
    expect(p1.missing.map((m) => m.field)).toEqual(["class", "content"]);
    expect(p1.question).toContain("2가지 정보가 더 필요합니다");

    // 반만 답함 → 진도만 다시 질문(반은 유지)
    parsePendingAnswer.mockResolvedValueOnce({ class: "고2 이사벨A", content: "" });
    const second = await continuePendingInput(JSON.parse(JSON.stringify(p1)), "고2 이사벨A 반이요");
    const p2 = second.outcomes[0].pending!;
    expect(p2.missing.map((m) => m.field)).toEqual(["content"]);
    expect((p2.draft as any).classId).toBe("cls-isabel-a");

    // 부족 항목이 하나면 LLM 없이 답변 전체를 그 값으로 사용
    const third = await continuePendingInput(JSON.parse(JSON.stringify(p2)), "본문 3과까지");
    expect(third.ok).toBe(true);
    expect(parsePendingAnswer).toHaveBeenCalledTimes(1);
    expect(tables.class_progress[0]).toMatchObject({ class_id: "cls-isabel-a", progress_content: "본문 3과까지", homework_content: "" });
  });
});

describe("2~5. 업무지시 → 배정/업무풀 → 진행 → 완료 → 원장 진행현황", () => {
  it("'이사벨A 김민수 대화문 암기 확인…' 동명이인 → '고2B' 답변으로 확정 → 업무 생성 → 시작 → 완료 → 진행현황", async () => {
    parseUnifiedInput.mockResolvedValue([
      intent({ route: "task", taskType: "암기확인", students: ["김민수"], instruction: "대화문 암기 확인, 미완이면 재시험" }),
    ]);
    const { runUnifiedNlInput, continuePendingInput } = await import("@/lib/nl-input");
    const first = await runUnifiedNlInput("김민수 대화문 암기 확인하고 미완이면 재시험 시켜줘", { staffName: "원장님" });

    const pending = first.outcomes[0].pending!;
    expect(pending.question).toContain("김민수 학생이 여러 명입니다");
    expect(pending.missing[0].candidates).toHaveLength(2);
    expect(tables.tasks).toHaveLength(0);

    const second = await continuePendingInput(JSON.parse(JSON.stringify(pending)), "고2B");
    expect(second.ok).toBe(true);
    expect(tables.tasks).toHaveLength(1);
    const row = tables.tasks[0];
    expect(row.student_notion_ids).toEqual(["stu-minsu-2b"]);
    expect(row.type).toBe("암기확인");
    // 담당자 미지정 → 풀 경유 자동배정(근무시간표 비어있음 = 근무중, 미완료 적은 순/id순)
    expect(row.pool).toBe(true);
    expect(row.staff_notion_ids).toHaveLength(1);
    expect(row.source_payload.workflow).toMatchObject({ createdBy: "원장님", assignedVia: "auto" });
    expect(second.tasks[0].ownerName).toBeTruthy();

    const owner = row.staff_notion_ids[0] as string;
    const notion = await import("@/lib/notion");
    const mine = await notion.listMyTasks(owner);
    // 화면 id는 displayId(Notion 미러 후엔 notion_id) — 이후 호출도 그 id로 한다.
    expect(mine.map((t) => [t.id, t.status])).toEqual([[row.notion_id ?? row.id, "대기"]]);
    const taskId = mine[0].id;

    expect(await notion.startTask(taskId, "staff-director")).toMatchObject({ ok: false });
    expect(await notion.startTask(taskId, owner)).toEqual({ ok: true });
    expect((await notion.listMyTasks(owner))[0].status).toBe("진행중");

    await notion.completeTaskEntry(taskId, { outcome: "통과", completedBy: owner });
    const board = await notion.listTaskBoard();
    expect(board).toHaveLength(1);
    expect(board[0]).toMatchObject({ status: "완료", outcome: "통과", ownerId: owner, createdBy: "원장님" });
    expect(board[0].completedAt).toBeTruthy();
    expect(board[0].completedByName).toBe(tables.staff.find((s) => s.notion_id === owner)!.name);
    expect(board[0].createdAt).toBeTruthy();
  });

  it("'민지에게 오늘 8시까지 고2 시험지 출력 맡겨' → 박민지에게 지정 배정(자동배정 안 함)", async () => {
    parseUnifiedInput.mockResolvedValue([
      intent({ route: "task", taskType: "출력", instruction: "고2 시험지 출력", time: "20:00", ownerName: "민지" }),
    ]);
    const { runUnifiedNlInput } = await import("@/lib/nl-input");
    const res = await runUnifiedNlInput("민지에게 오늘 8시까지 고2 시험지 출력 맡겨", { staffName: "원장님" });
    expect(res.ok).toBe(true);
    expect(tables.tasks[0]).toMatchObject({ staff_notion_ids: ["staff-minji"], pool: false, time_text: "20:00" });
    expect(tables.tasks[0].source_payload.workflow.assignedVia).toBe("direct");
    expect(res.outcomes[0].message).toContain("박민지 지정 배정");
    expect(res.tasks[0]).toMatchObject({ ownerName: "박민지" });
  });

  it("지정한 담당자를 못 찾으면 되묻고, '업무풀' 답변이면 조교 업무풀로 보낸다", async () => {
    parseUnifiedInput.mockResolvedValue([intent({ route: "task", taskType: "출력", instruction: "프린트 출력", ownerName: "하늘" })]);
    const { runUnifiedNlInput, continuePendingInput } = await import("@/lib/nl-input");
    const first = await runUnifiedNlInput("하늘에게 프린트 출력 맡겨");
    expect(first.outcomes[0].pending!.question).toContain('"하늘" 직원을 찾지 못했습니다');
    const second = await continuePendingInput(JSON.parse(JSON.stringify(first.outcomes[0].pending)), "업무풀로 보내줘");
    expect(second.ok).toBe(true);
    expect(tables.tasks[0]).toMatchObject({ staff_notion_ids: [], pool: true });
  });

  it("담당자 미지정 + 근무 중 조교 없음 → 조교 업무풀에 남고(유형 무관), 근무 조교가 생기면 자동배정된다", async () => {
    makeEveryoneOffShift();
    parseUnifiedInput.mockResolvedValue([
      intent({ route: "task", taskType: "암기확인", students: ["이지호"], instruction: "대화문 암기 확인" }),
      intent({ route: "task", taskType: "전달", instruction: "거성중2 프린트 수업 전 배부" }),
    ]);
    const { runUnifiedNlInput } = await import("@/lib/nl-input");
    const res = await runUnifiedNlInput("이지호 대화문 암기 확인, 거성중2 프린트 나눠줘");
    expect(res.ok).toBe(true);
    expect(tables.tasks.map((t) => [t.type, t.staff_notion_ids.length, t.pool])).toEqual([
      ["암기확인", 0, true],
      ["전달", 0, true],
    ]);
    expect(res.outcomes.every((o) => o.message.includes("조교 업무풀"))).toBe(true);

    const notion = await import("@/lib/notion");
    expect((await notion.listPoolTasks()).map((t) => t.status)).toEqual(["업무풀", "업무풀"]);
    expect(await notion.autoAssignPoolTasks()).toEqual([]);

    // 최소라 근무 시작 → 풀의 오늘 업무가 자동배정
    tables.staff.find((s) => s.name === "최소라")!.work_schedule = "";
    const assigned = await notion.autoAssignPoolTasks();
    expect(assigned.map((a) => a.ownerName)).toEqual(["최소라", "최소라"]);
    expect(tables.tasks.every((t) => t.staff_notion_ids[0] === "staff-sora" && t.source_payload.workflow.assignedVia === "pool_auto")).toBe(true);
    expect(await notion.listPoolTasks()).toEqual([]);
  });

  it("업무풀 업무는 조교가 '진행 시작'으로 바로 가져가 진행할 수 있다", async () => {
    makeEveryoneOffShift();
    parseUnifiedInput.mockResolvedValue([intent({ route: "task", taskType: "출력", instruction: "고1A 단어시험지 출력" })]);
    const { runUnifiedNlInput } = await import("@/lib/nl-input");
    await runUnifiedNlInput("고1A 단어시험지 출력해줘");
    const notion = await import("@/lib/notion");
    const id = tables.tasks[0].id;
    expect(await notion.startTask(id, "staff-minji")).toEqual({ ok: true });
    expect(tables.tasks[0].staff_notion_ids).toEqual(["staff-minji"]);
    expect(tables.tasks[0].source_payload.workflow).toMatchObject({ assignedVia: "claim", startedBy: "staff-minji" });
    expect(await notion.claimTask(id, "staff-sora")).toMatchObject({ ok: false });
  });
});

describe("수업기록 권한 예외", () => {
  it("EXAM AI로 만든 반 진도 행(학생 기록 0건)은 학생 기록이 없다고 판단된다", async () => {
    parseUnifiedInput.mockResolvedValue([intent({ route: "class_progress", className: "고2 이사벨A", progress: "3과", homework: "" })]);
    const { runUnifiedNlInput } = await import("@/lib/nl-input");
    await runUnifiedNlInput("고2 이사벨A 오늘 3과");
    const notion = await import("@/lib/notion");
    expect(await notion.classProgressHasStudentRecords(tables.class_progress[0].id)).toBe(false);
    tables.class_progress[0].student_records_created = true;
    expect(await notion.classProgressHasStudentRecords(tables.class_progress[0].id)).toBe(true);
  });
});

describe("교시 구분(날짜+반+교시 단위)", () => {
  const todayWeekday = () =>
    ["일", "월", "화", "수", "목", "금", "토"][new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" })).getDay()];

  it("같은 반·같은 날 1/2/3교시 입력은 각각 별개 행으로 저장되고, 같은 교시 재입력만 갱신된다", async () => {
    parseUnifiedInput
      .mockResolvedValueOnce([intent({ route: "class_progress", className: "고2 이사벨A", period: "1교시", progress: "본문 3과 1~4번", homework: "워크북 22쪽" })])
      .mockResolvedValueOnce([intent({ route: "class_progress", className: "고2 이사벨A", period: "2교시", progress: "문법 관계대명사", homework: "문법책 35~38쪽" })])
      .mockResolvedValueOnce([intent({ route: "class_progress", className: "고2 이사벨A", period: "3 교시", progress: "모의고사 29~32번", homework: "오답" })])
      .mockResolvedValueOnce([intent({ route: "class_progress", className: "고2 이사벨A", period: "2교시", progress: "", homework: "문법책 35~40쪽" })]);
    const { runUnifiedNlInput } = await import("@/lib/nl-input");
    const r1 = await runUnifiedNlInput("고2 이사벨A 1교시 본문 3과 1~4번, 과제 워크북 22쪽");
    await runUnifiedNlInput("고2 이사벨A 2교시 문법 관계대명사, 과제 문법책 35~38쪽");
    await runUnifiedNlInput("고2 이사벨A 3교시 모의고사 29~32번, 과제 오답");
    await runUnifiedNlInput("고2 이사벨A 2교시 과제 문법책 35~40쪽으로 수정");

    expect(r1.outcomes[0].message).toBe("고2 이사벨A 1교시\n오늘 진도: 본문 3과 1~4번\n과제: 워크북 22쪽\n저장 완료");
    expect(tables.class_progress.map((r) => [r.period, r.progress_content, r.homework_content])).toEqual([
      ["1교시", "본문 3과 1~4번", "워크북 22쪽"],
      // 같은 교시 재입력은 기존 과제를 지우지 않고 한 줄 추가(append)한다.
      ["2교시", "문법 관계대명사", "문법책 35~38쪽\n문법책 35~40쪽"],
      ["3교시", "모의고사 29~32번", "오답"],
    ]);
    // 수업기록 화면(getClassProgressForEdit)도 교시별로 따로 불러온다.
    const notion = await import("@/lib/notion");
    expect((await notion.getClassProgressForEdit("cls-isabel-a", tables.class_progress[0].record_date, "2교시"))?.progress).toBe("문법 관계대명사");
    expect(await notion.getClassProgressForEdit("cls-isabel-a", tables.class_progress[0].record_date)).toBeNull();
  });

  it("시간표상 그날 교시가 2개 이상인데 교시를 안 밝히면 교시만 되묻고, 답하면 첫 입력과 합쳐 저장한다", async () => {
    tables.classes[0].day_teachers = `${todayWeekday()}=1:김쌤,2:이쌤`;
    parseUnifiedInput.mockResolvedValue([intent({ route: "class_progress", className: "고2 이사벨A", progress: "본문 3과", homework: "워크북 22쪽" })]);
    const { runUnifiedNlInput, continuePendingInput } = await import("@/lib/nl-input");
    const first = await runUnifiedNlInput("고2 이사벨A 오늘 본문 3과, 과제 워크북 22쪽");
    const pending = first.outcomes[0].pending!;
    expect(pending.missing.map((m) => m.field)).toEqual(["period"]);
    expect(pending.question).toContain("오늘 고2 이사벨A 수업은 여러 교시가 있습니다. 어느 교시인가요?");
    expect(pending.missing[0].candidates?.map((c) => c.label)).toEqual(["1교시", "2교시"]);
    expect(tables.class_progress).toHaveLength(0);

    const second = await continuePendingInput(JSON.parse(JSON.stringify(pending)), "2교시요");
    expect(second.ok).toBe(true);
    expect(tables.class_progress[0]).toMatchObject({ period: "2교시", progress_content: "본문 3과", homework_content: "워크북 22쪽" });
  });

  it("교시가 하나뿐인(또는 시간표 없는) 반은 교시를 묻지 않고 '교시 구분 없음'으로 저장한다", async () => {
    tables.classes[0].day_teachers = `${todayWeekday()}=1:김쌤`;
    parseUnifiedInput.mockResolvedValue([intent({ route: "class_progress", className: "고2 이사벨A", progress: "본문 3과", homework: "" })]);
    const { runUnifiedNlInput } = await import("@/lib/nl-input");
    const res = await runUnifiedNlInput("고2 이사벨A 오늘 본문 3과");
    expect(res.ok).toBe(true);
    expect(tables.class_progress[0].period).toBeNull();
  });
});

describe("교시 보완", () => {
  it("교시는 'N교시' 형태로만 인식한다(되묻기 답변은 숫자만도 허용)", async () => {
    const { normalizePeriod } = await import("@/lib/nl-input");
    expect(normalizePeriod("1교시")).toBe("1교시");
    expect(normalizePeriod("2 교시")).toBe("2교시");
    expect(normalizePeriod("1타임")).toBe("");
    expect(normalizePeriod("첫 수업")).toBe("");
    expect(normalizePeriod("2")).toBe("");
    expect(normalizePeriod("2", true)).toBe("2교시");
  });

  it("시간표가 없어도 그날 이미 교시별 기록이 있으면 교시를 되묻는다(기존 교시 + 다음 교시 후보)", async () => {
    const { todayKST } = await import("@/lib/date");
    tables.class_progress.push({
      id: "cp-1", notion_id: null, branch_id: B, class_id: "cls-isabel-a", class_notion_ids: ["cls-isabel-a"],
      record_date: todayKST(), period: "1교시", progress_content: "본문 3과", homework_content: "", student_records_created: true,
      daily_record_notion_ids: ["dr-1"], source_payload: {},
    });
    parseUnifiedInput.mockResolvedValue([intent({ route: "class_progress", className: "고2 이사벨A", progress: "문법 관계대명사", homework: "" })]);
    const { runUnifiedNlInput, continuePendingInput } = await import("@/lib/nl-input");
    const first = await runUnifiedNlInput("고2 이사벨A 오늘 문법 관계대명사");
    const pending = first.outcomes[0].pending!;
    expect(pending.missing[0].candidates?.map((c) => c.label)).toEqual(["1교시", "2교시"]);

    await continuePendingInput(JSON.parse(JSON.stringify(pending)), "2");
    expect(tables.class_progress.map((r) => [r.period, r.progress_content])).toEqual([
      ["1교시", "본문 3과"],
      ["2교시", "문법 관계대명사"],
    ]);
  });
});

describe("findClassRecordGaps — EXAM AI 진도만 입력한 날은 누락으로 유지", () => {
  it("정상 수업기록 저장은 student_records_created=true, AI 진도-only 행은 누락으로 남는다", async () => {
    const { todayKST } = await import("@/lib/date");
    const today = todayKST();
    const weekday = ["일", "월", "화", "수", "목", "금", "토"][new Date(`${today}T00:00:00Z`).getUTCDay()];
    tables.classes[0].days = [weekday];
    tables.classes[2].days = [weekday];
    tables.classes[2].student_notion_ids = ["stu-minsu-1a"];

    // 고2 이사벨A: EXAM AI로 진도만
    parseUnifiedInput.mockResolvedValue([intent({ route: "class_progress", className: "고2 이사벨A", progress: "3과", homework: "" })]);
    const { runUnifiedNlInput } = await import("@/lib/nl-input");
    await runUnifiedNlInput("고2 이사벨A 오늘 3과");

    // 고1A: 기존 수업기록 화면 경로(학생기록 생성)
    const notion = await import("@/lib/notion");
    await notion.createClassProgress({
      classId: "cls-1a", date: today, subjects: [], progress: "본문 2과", homework: "", nextAssignment: "", notice: "", perStudent: {},
    });
    const normal = tables.class_progress.find((r) => r.class_id === "cls-1a")!;
    expect(normal.student_records_created).toBe(true);
    expect(tables.daily_records).toHaveLength(1);

    const gaps = await notion.findClassRecordGaps(today, today);
    expect(gaps.map((g) => g.classId)).toEqual(["cls-isabel-a"]);
  });
});

describe("retryDualWriteFailures — PostgreSQL 정본에서 TODO 재동기화 금지", () => {
  it("TODO 실패 행은 Notion으로 덮어쓰지 않고 미해결(수동 검토)로 남긴다", async () => {
    tables.tasks.push({
      id: "task-1", notion_id: "notion-task-1", branch_id: B, type: "암기확인", complete: false,
      staff_notion_ids: ["staff-minji"], source_payload: { workflow: { startedAt: "2026-09-23T01:00:00Z", startedBy: "staff-minji" } },
    });
    tables.dual_write_failures = [{ id: "f-1", branch_id: B, entity: "TODO", notion_id: "notion-task-1", resolved: false, created_at: "2026-09-01" }];
    const { retryDualWriteFailures } = await import("@/lib/reconciliation");
    const result = await retryDualWriteFailures();
    expect(result).toEqual({ retried: 1, resolved: 0, stillFailing: 1 });
    expect(tables.dual_write_failures[0].resolved).toBe(false);
    expect(tables.tasks[0]).toMatchObject({ staff_notion_ids: ["staff-minji"], complete: false });
    expect(tables.tasks[0].source_payload.workflow.startedBy).toBe("staff-minji");
  });
});

describe("누적 기록: class_progress append / 수정·삭제는 명시할 때만", () => {
  it("같은 반·날짜·교시 추가 입력은 기존 진도를 보존하고 줄을 추가한다(동일 내용 반복은 추가 안 함)", async () => {
    parseUnifiedInput
      .mockResolvedValueOnce([intent({ route: "class_progress", className: "고2 이사벨A", period: "1교시", progress: "본문 3과 1~4번", homework: "" })])
      .mockResolvedValueOnce([intent({ route: "class_progress", className: "고2 이사벨A", period: "1교시", progress: "관계대명사", homework: "", editMode: "append" })])
      .mockResolvedValueOnce([intent({ route: "class_progress", className: "고2 이사벨A", period: "1교시", progress: "관계대명사", homework: "" })]);
    const { runUnifiedNlInput } = await import("@/lib/nl-input");
    await runUnifiedNlInput("고2 이사벨A 1교시 본문 3과 1~4번", { staffName: "원장님" });
    const second = await runUnifiedNlInput("고2 이사벨A 1교시 추가로 관계대명사 진행", { staffName: "원장님" });
    const third = await runUnifiedNlInput("고2 이사벨A 1교시 관계대명사", { staffName: "원장님" });

    expect(tables.class_progress).toHaveLength(1);
    expect(tables.class_progress[0].progress_content).toBe("본문 3과 1~4번\n관계대명사");
    expect(second.outcomes[0].message).toContain("진도 추가");
    expect(third.outcomes[0].message).toContain("이미 기록된 내용입니다");
    // 변경 이력(source_payload.examAiLog): 생성 + 추가 1건(변경 없음은 기록 안 함)
    const log = tables.class_progress[0].source_payload.examAiLog;
    expect(log.map((l: any) => l.mode)).toEqual(["create", "append"]);
    expect(log[1]).toMatchObject({ by: "원장님", raw: "고2 이사벨A 1교시 추가로 관계대명사 진행", progress: { before: "본문 3과 1~4번" } });
  });

  it("'수정해'(replace)·'삭제해'(delete)일 때만 기존 내용을 바꾸고, 지울 내용이 없으면 실패로 표시한다", async () => {
    parseUnifiedInput
      .mockResolvedValueOnce([intent({ route: "class_progress", className: "고2 이사벨A", period: "1교시", progress: "본문 3과", homework: "워크북 22쪽" })])
      .mockResolvedValueOnce([intent({ route: "class_progress", className: "고2 이사벨A", period: "1교시", progress: "", homework: "워크북 22~25쪽", editMode: "replace" })])
      .mockResolvedValueOnce([intent({ route: "class_progress", className: "고2 이사벨A", period: "1교시", progress: "본문 3과", homework: "", editMode: "delete" })])
      .mockResolvedValueOnce([intent({ route: "class_progress", className: "고2 이사벨A", period: "1교시", progress: "없는 내용", homework: "", editMode: "delete" })]);
    const { runUnifiedNlInput } = await import("@/lib/nl-input");
    await runUnifiedNlInput("고2 이사벨A 1교시 본문 3과, 과제 워크북 22쪽");
    await runUnifiedNlInput("고2 이사벨A 1교시 과제 잘못 입력했어, 워크북 22~25쪽으로 수정해");
    expect(tables.class_progress[0]).toMatchObject({ progress_content: "본문 3과", homework_content: "워크북 22~25쪽" });
    await runUnifiedNlInput("고2 이사벨A 1교시 진도 본문 3과 삭제해");
    expect(tables.class_progress[0]).toMatchObject({ progress_content: "", homework_content: "워크북 22~25쪽" });
    const bad = await runUnifiedNlInput("고2 이사벨A 1교시 진도 없는 내용 삭제해");
    expect(bad.ok).toBe(false);
    expect(bad.outcomes[0].status).toBe("실패");
  });

  it("mergeProgressText 순수 규칙", async () => {
    const { mergeProgressText } = await import("@/lib/notion");
    expect(mergeProgressText("A", "B", "append")).toEqual({ value: "A\nB", change: "added" });
    expect(mergeProgressText("A\nB", "b", "append")).toEqual({ value: "A\nB", change: "duplicate" });
    expect(mergeProgressText("A", "", "append")).toEqual({ value: "A", change: "none" });
    expect(mergeProgressText("A\nB", "C", "replace")).toEqual({ value: "C", change: "replaced" });
    expect(mergeProgressText("A\nB", "B", "delete")).toEqual({ value: "A", change: "deleted" });
  });
});

describe("학생별 학습 기록(student_learning_records)", () => {
  it("'고2 이사벨A 김민수 단어시험 84점 재시험' → 학생·반·점수·결과·후속상태·입력자·원문 구조화 저장(동명이인은 반으로 확정)", async () => {
    parseUnifiedInput.mockResolvedValue([
      intent({ route: "student_record", className: "고2 이사벨A", students: ["김민수"], recordType: "vocab", assessmentName: "단어시험", score: 84, passed: false, retestRequired: true }),
    ]);
    const { runUnifiedNlInput } = await import("@/lib/nl-input");
    const res = await runUnifiedNlInput("고2 이사벨A 김민수 단어시험 84점 재시험", { staffName: "원장님" });
    expect(res.ok).toBe(true);
    expect(tables.student_learning_records).toHaveLength(1);
    expect(tables.student_learning_records[0]).toMatchObject({
      branch_id: B,
      student_notion_ids: ["stu-minsu-2b"],
      class_notion_ids: ["cls-isabel-a"],
      record_type: "vocab",
      assessment_name: "단어시험",
      score: 84,
      passed: false,
      retest_required: true,
      entered_by: "원장님",
      raw_text: "고2 이사벨A 김민수 단어시험 84점 재시험",
    });
    expect(tables.student_learning_records[0].task_id ?? null).toBeNull();
    expect(tables.student_learning_records[0].input_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(res.outcomes[0].message).toContain("김민수 (고2 이사벨A) 단어시험 기록: 단어시험 · 84점 · 미통과 · 재시험 필요");
    // 기존 통계 원천(daily_records/exam_scores)은 건드리지 않는다.
    expect(tables.daily_records).toHaveLength(0);
    expect(tables.exam_scores ?? []).toHaveLength(0);
    expect(tables.tasks).toHaveLength(0);
  });

  it("'박지훈 워크북 과제 미완료' → 학생 기록만(업무 없음)", async () => {
    parseUnifiedInput.mockResolvedValue([
      intent({ route: "student_record", className: "고2 이사벨A", students: ["박지훈"], recordType: "homework", assessmentName: "워크북", completed: false }),
    ]);
    const { runUnifiedNlInput } = await import("@/lib/nl-input");
    await runUnifiedNlInput("고2 이사벨A 박지훈 워크북 과제 미완료");
    expect(tables.student_learning_records[0]).toMatchObject({ student_notion_ids: ["stu-jihun"], record_type: "homework", completed: false });
    expect(tables.tasks).toHaveLength(0);
  });

  it("'박지훈 워크북 과제 미완료, 다음 시간 확인해줘' → 학생 기록 + 숙제확인 업무, 서로 연결(중복 task intent는 생략)", async () => {
    parseUnifiedInput.mockResolvedValue([
      intent({ route: "student_record", className: "고2 이사벨A", students: ["박지훈"], recordType: "homework", assessmentName: "워크북", completed: false, actionRequested: true, taskType: "숙제확인", instruction: "워크북 과제 다음 시간 확인" }),
      intent({ route: "task", taskType: "숙제확인", students: ["박지훈"], instruction: "워크북 과제 확인" }),
    ]);
    const { runUnifiedNlInput } = await import("@/lib/nl-input");
    const res = await runUnifiedNlInput("고2 이사벨A 박지훈 워크북 과제 미완료, 다음 시간 확인해줘", { staffName: "원장님" });
    expect(res.ok).toBe(true);
    expect(tables.tasks).toHaveLength(1);
    const rec = tables.student_learning_records[0];
    const task = tables.tasks[0];
    expect(task).toMatchObject({ type: "숙제확인", student_notion_ids: ["stu-jihun"], class_notion_ids: ["cls-isabel-a"] });
    expect(task.source_payload.workflow.sourceRecordId).toBe(rec.id);
    expect(rec.task_id).toBe(task.id);
    expect(res.outcomes.some((o) => o.message.startsWith("업무 생략"))).toBe(true);
  });

  it("다건 입력: 진도+과제+학생 3명+업무 지시가 모두 분리 처리되고, 같은 입력 재전송은 중복 생성하지 않는다", async () => {
    const text = "고2 이사벨A 1교시\n진도 본문 3과\n과제 워크북 22~25\n김민수 단어시험 84점 재시험\n이서연 96점 통과\n박지훈 과제 미완료\n민지에게 시험지 15부 출력";
    const intents = [
      intent({ route: "class_progress", className: "고2 이사벨A", period: "1교시", progress: "본문 3과", homework: "워크북 22~25" }),
      intent({ route: "student_record", className: "고2 이사벨A", period: "1교시", students: ["김민수"], recordType: "vocab", score: 84, passed: false, retestRequired: true }),
      intent({ route: "student_record", className: "고2 이사벨A", period: "1교시", students: ["이서연"], recordType: "vocab", score: 96, passed: true }),
      intent({ route: "student_record", className: "고2 이사벨A", period: "1교시", students: ["박지훈"], recordType: "homework", completed: false }),
      intent({ route: "task", taskType: "출력", instruction: "시험지 출력", quantity: 15, ownerName: "민지" }),
    ];
    parseUnifiedInput.mockResolvedValue(intents);
    const { runUnifiedNlInput } = await import("@/lib/nl-input");
    const first = await runUnifiedNlInput(text, { staffName: "원장님" });
    expect(first.ok).toBe(true);
    expect(first.outcomes.map((o) => [o.route, o.status])).toEqual([
      ["class_progress", "완료"],
      ["student_record", "완료"],
      ["student_record", "완료"],
      ["student_record", "완료"],
      ["task", "완료"],
    ]);
    expect(tables.student_learning_records.map((r) => [r.student_notion_ids[0], r.record_type, r.score, r.period])).toEqual([
      ["stu-minsu-2b", "vocab", 84, "1교시"],
      ["stu-seoyeon", "vocab", 96, "1교시"],
      ["stu-jihun", "homework", null, "1교시"],
    ]);
    // 같은 날 같은 교시의 반 진도 행과 연결
    expect(tables.student_learning_records.every((r) => r.class_progress_id === tables.class_progress[0].id)).toBe(true);
    expect(tables.tasks).toHaveLength(1);
    expect(first.context).toMatchObject({ classId: "cls-isabel-a", period: "1교시" });

    // 재전송: 반 진도는 변경 없음, 학생 기록은 중복으로 건너뜀
    const again = await runUnifiedNlInput(text, { staffName: "원장님" });
    expect(tables.student_learning_records).toHaveLength(3);
    expect(tables.class_progress).toHaveLength(1);
    expect(again.outcomes.filter((o) => o.message.includes("중복"))).toHaveLength(3);
    expect(again.outcomes[0].message).toContain("이미 기록된 내용입니다");
    // 행동 지시가 있던 기록의 재전송도 업무를 다시 만들지 않는다.
    parseUnifiedInput.mockResolvedValue([
      intent({ route: "student_record", className: "고2 이사벨A", students: ["박지훈"], recordType: "homework", completed: false, actionRequested: true, taskType: "숙제확인" }),
    ]);
    await runUnifiedNlInput("박지훈 과제 미완료 확인해줘", { staffName: "원장님" });
    await runUnifiedNlInput("박지훈 과제 미완료 확인해줘", { staffName: "원장님" });
    expect(tables.tasks.filter((t) => t.type === "숙제확인")).toHaveLength(1);
  });

  it("동명이인은 임의 선택하지 않고 후보 선택으로 확정한다", async () => {
    parseUnifiedInput.mockResolvedValue([intent({ route: "student_record", students: ["김민수"], recordType: "vocab", score: 84 })]);
    const { runUnifiedNlInput, continuePendingInput } = await import("@/lib/nl-input");
    const first = await runUnifiedNlInput("김민수 단어 84점");
    const pending = first.outcomes[0].pending!;
    expect(pending.question).toContain("김민수 학생이 여러 명입니다");
    expect(pending.missing[0].candidates).toHaveLength(2);
    expect(tables.student_learning_records).toHaveLength(0);
    await continuePendingInput(JSON.parse(JSON.stringify(pending)), "", { choiceId: "stu-minsu-1a" });
    expect(tables.student_learning_records[0]).toMatchObject({ student_notion_ids: ["stu-minsu-1a"], class_notion_ids: ["cls-1a"] });
  });

  it("반 문맥: 직전 반의 학생이면 이어 쓰고, 그 반 학생이 아니면 문맥을 쓰지 않는다", async () => {
    const { todayKST } = await import("@/lib/date");
    const ctx = { classId: "cls-isabel-a", className: "고2 이사벨A", date: todayKST(), period: "1교시" };
    parseUnifiedInput
      .mockResolvedValueOnce([intent({ route: "student_record", students: ["박지훈"], recordType: "homework", completed: false })])
      .mockResolvedValueOnce([intent({ route: "student_record", students: ["김민수"], recordType: "vocab", score: 70 })]);
    const { runUnifiedNlInput } = await import("@/lib/nl-input");
    await runUnifiedNlInput("박지훈 과제 미완료", { context: ctx });
    expect(tables.student_learning_records[0]).toMatchObject({ class_notion_ids: ["cls-isabel-a"], period: "1교시" });

    // 김민수는 이사벨A에 한 명(고2B 김민수)뿐 → 문맥 반 안에서 확정(다른 반 김민수로 가지 않음)
    await runUnifiedNlInput("김민수 단어 70점", { context: ctx });
    expect(tables.student_learning_records[1]).toMatchObject({ student_notion_ids: ["stu-minsu-2b"], class_notion_ids: ["cls-isabel-a"] });

    // 문맥 반 소속이 아닌 학생(고1A 전용 학생)은 문맥을 버리고 자기 반으로 기록
    tables.students.push({ id: "stu-only1a", notion_id: "stu-only1a", branch_id: B, name: "최유진", school: "금정고", grade: "고1", status: "재원", class_notion_ids: ["cls-1a"] });
    parseUnifiedInput.mockResolvedValueOnce([intent({ route: "student_record", students: ["최유진"], recordType: "memorization", completed: false })]);
    await runUnifiedNlInput("최유진 본문 암기 미완료", { context: ctx });
    expect(tables.student_learning_records[2]).toMatchObject({ student_notion_ids: ["stu-only1a"], class_notion_ids: ["cls-1a"], period: null });
  });

  it("명단에 없는 학생은 만들지 않고 되묻는다", async () => {
    parseUnifiedInput.mockResolvedValue([intent({ route: "student_record", className: "고2 이사벨A", students: ["홍길동"], recordType: "memo", note: "지각" })]);
    const { runUnifiedNlInput } = await import("@/lib/nl-input");
    const res = await runUnifiedNlInput("고2 이사벨A 홍길동 지각");
    expect(res.outcomes[0].pending?.question).toContain('명단에서 "홍길동" 학생을 찾지 못했습니다');
    expect(tables.student_learning_records).toHaveLength(0);
    expect(tables.students.some((s) => s.name === "홍길동")).toBe(false);
  });

  it("학생 기록 저장이 실패하면 후속 업무를 만들지 않고 실패로 표시한다", async () => {
    const baseFetch = globalThis.fetch as any;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: any) => {
      if (String(url).includes("/student_learning_records") && (init?.method ?? "GET").toUpperCase() === "POST") {
        return new Response('{"message":"relation does not exist"}', { status: 404 });
      }
      return baseFetch(url, init);
    }));
    parseUnifiedInput.mockResolvedValue([
      intent({ route: "student_record", className: "고2 이사벨A", students: ["박지훈"], recordType: "homework", completed: false, actionRequested: true, taskType: "숙제확인" }),
    ]);
    const { runUnifiedNlInput } = await import("@/lib/nl-input");
    const res = await runUnifiedNlInput("고2 이사벨A 박지훈 과제 미완료 확인해줘");
    expect(res.ok).toBe(false);
    expect(res.outcomes[0]).toMatchObject({ status: "실패" });
    expect(tables.tasks).toHaveLength(0);
  });
});
