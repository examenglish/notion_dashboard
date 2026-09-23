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

// 006 migration(실제 운영 스키마)에서 student_learning_records 컬럼 목록을 읽어, fake DB가
// 운영 PostgREST처럼 없는 컬럼을 거부하게 한다(PGRST204). 스키마 없는 fake 때문에
// notion_id 주입 버그(운영 400)를 놓쳤던 것을 막는다.
import { readFileSync } from "fs";
import path from "path";
const SLR_COLUMNS: Set<string> = (() => {
  const sql = readFileSync(path.resolve(__dirname, "../supabase/schema/006_student_learning_records.sql"), "utf8");
  const body = sql.slice(sql.indexOf("create table student_learning_records"), sql.indexOf(");", sql.indexOf("create table student_learning_records")));
  return new Set(Array.from(body.matchAll(/^\s+([a-z_]+)\s+(uuid|text|date|numeric|boolean|jsonb|timestamptz)/gm)).map((m) => m[1]));
})();
const slrPosts: Row[] = [];
function schemaViolation(table: string, body: Row): string | null {
  if (table !== "student_learning_records") return null;
  const bad = Object.keys(body).find((k) => !SLR_COLUMNS.has(k));
  return bad ? JSON.stringify({ code: "PGRST204", message: `Could not find the '${bad}' column of 'student_learning_records' in the schema cache` }) : null;
}

function matchClause(clause: string, row: Row): boolean {
  const neg = clause.match(/^([a-z_]+)\.not\.(.*)$/);
  if (neg) return !matchClause(`${neg[1]}.${neg[2]}`, row);
  const m = clause.match(/^([a-z_]+)\.(eq|cs|is|in|gte|lte|lt)\.(.*)$/);
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
  if (op === "lt") return String(cell ?? "") < decoded;
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
      const items = Array.isArray(body) ? body : [body];
      if (table === "student_learning_records") slrPosts.push(...items);
      for (const item of items) {
        const v = schemaViolation(table, item);
        if (v) return new Response(v, { status: 400 });
      }
      const now = new Date().toISOString();
      const inserted = items.map((item: Row) => ({
        id: `gen-${++idCounter}`,
        ...(table === "student_learning_records" ? {} : { notion_id: null }),
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
      const v = schemaViolation(table, body);
      if (v) return new Response(v, { status: 400 });
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
  slrPosts.length = 0;
  seed();
  vi.stubGlobal("fetch", makeFakeSupabase(tables));
  process.env.SUPABASE_URL = "https://fake.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-key";
  process.env.ACADEMY_BRANCH_ID = "sajik";
  process.env.ACADEMY_DB_PROVIDER = "postgres";
  process.env.ACADEMY_STUDENT_READ_PROVIDER = "postgres";
  process.env.SESSION_SECRET = "test-session-secret";
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

    const second = await continuePendingInput(JSON.parse(JSON.stringify(pending)), "고2B", { staffName: "원장님" });
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
    // "민지에게 시험지 15부 출력"은 행동 동사가 없어 저장 전에 "업무로 등록할까요?" 확인
    expect(first.outcomes.map((o) => [o.route, o.status])).toEqual([
      ["class_progress", "완료"],
      ["student_record", "완료"],
      ["student_record", "완료"],
      ["student_record", "완료"],
      ["task", "확인필요"],
    ]);
    expect(tables.tasks).toHaveLength(0);
    const { continuePendingInput } = await import("@/lib/nl-input");
    const confirmed = await continuePendingInput(JSON.parse(JSON.stringify(first.outcomes[4].pending)), "네", { staffName: "원장님" });
    expect(confirmed.outcomes[0]).toMatchObject({ route: "task", status: "완료" });
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

describe("작성자 = 로그인 사용자", () => {
  it("본문 속 다른 이름은 담당자일 뿐 — 지시자/작성자는 로그인 사용자", async () => {
    parseUnifiedInput.mockResolvedValue([
      intent({ route: "task", taskType: "재시험", students: ["이지호"], instruction: "재시험 확인", ownerName: "민지" }),
      intent({ route: "student_record", className: "고2 이사벨A", students: ["박지훈"], recordType: "homework", completed: false }),
      intent({ route: "class_progress", className: "고2 이사벨A", progress: "본문 3과", homework: "" }),
    ]);
    const { runUnifiedNlInput } = await import("@/lib/nl-input");
    await runUnifiedNlInput("민지에게 이지호 재시험 확인 맡겨, 박지훈 과제 미완료, 고2 이사벨A 본문 3과", { staffName: "서도영" });
    expect(tables.tasks[0].staff_notion_ids).toEqual(["staff-minji"]);
    expect(tables.tasks[0].source_payload.workflow.createdBy).toBe("서도영");
    expect(tables.student_learning_records[0].entered_by).toBe("서도영");
    expect(tables.class_progress[0].source_payload.examAiLog[0].by).toBe("서도영");
  });

  it("되묻기 답변 시 클라이언트가 돌려준 pending의 작성자 값은 무시하고 현재 로그인 사용자로 기록한다", async () => {
    parseUnifiedInput.mockResolvedValue([intent({ route: "student_record", students: ["김민수"], recordType: "vocab", score: 84 })]);
    const { runUnifiedNlInput, continuePendingInput } = await import("@/lib/nl-input");
    const first = await runUnifiedNlInput("김민수 단어 84점", { staffName: "서도영" });
    const tampered = JSON.parse(JSON.stringify(first.outcomes[0].pending));
    tampered.draft.enteredBy = "가짜작성자";
    await continuePendingInput(tampered, "", { choiceId: "stu-minsu-1a", staffName: "박민지" });
    expect(tables.student_learning_records[0].entered_by).toBe("박민지");
  });
});

// ---------------------------------------------------------------------------
// 자연어 정정(수정/취소) + 입력 이력 조회
// ---------------------------------------------------------------------------
async function seedRecord(text: string, i: Partial<UnifiedIntent>, staffName = "서도영") {
  parseUnifiedInput.mockResolvedValueOnce([intent({ route: "student_record", className: "고2 이사벨A", ...i })]);
  const { runUnifiedNlInput } = await import("@/lib/nl-input");
  return runUnifiedNlInput(text, { staffName, staffId: `staff-${staffName}` });
}
async function say(text: string, i: Partial<UnifiedIntent>, opts: Record<string, unknown> = {}) {
  parseUnifiedInput.mockResolvedValueOnce([intent(i)]);
  const { runUnifiedNlInput } = await import("@/lib/nl-input");
  return runUnifiedNlInput(text, { staffName: "서도영", staffId: "staff-seo", ...opts });
}
const active = () => tables.student_learning_records.filter((r) => !r.source_payload?.cancelled);

describe("자연어 정정 — class_progress", () => {
  it("'아까 과제 25쪽까지 아니고 27쪽까지' → 해당 부분만 수정 + 감사 로그(작성자/전후/원문/operation)", async () => {
    await say("고2 이사벨A 1교시 본문 3과, 과제 워크북 22~25쪽", { route: "class_progress", className: "고2 이사벨A", period: "1교시", progress: "본문 3과", homework: "워크북 22~25쪽" });
    const res = await say("아까 이사벨A 과제 25쪽까지 아니고 27쪽까지야", {
      route: "correction", correctionTarget: "class_progress", operation: "modify", className: "고2 이사벨A", field: "homework", fromText: "25쪽", toText: "27쪽",
    });
    expect(tables.class_progress[0].homework_content).toBe("워크북 22~27쪽");
    expect(tables.class_progress[0].progress_content).toBe("본문 3과");
    expect(res.outcomes[0].message).toBe("고2 이사벨A 1교시\n과제 워크북 22~25쪽 → 워크북 22~27쪽(으)로 수정했습니다.");
    const last = tables.class_progress[0].source_payload.examAiLog.at(-1);
    expect(last).toMatchObject({ by: "서도영", operation: "modify", raw: "아까 이사벨A 과제 25쪽까지 아니고 27쪽까지야", homework: { before: "워크북 22~25쪽", after: "워크북 22~27쪽" } });
    expect(last.at).toBeTruthy();
  });

  it("'관계대명사 한 거 삭제해' → 그 줄만 삭제, '방금 입력한 거 취소'는 내 마지막 변경만 되돌림", async () => {
    await say("고2 이사벨A 1교시 본문 3과", { route: "class_progress", className: "고2 이사벨A", period: "1교시", progress: "본문 3과" });
    await say("고2 이사벨A 1교시 추가로 관계대명사", { route: "class_progress", className: "고2 이사벨A", period: "1교시", progress: "관계대명사" });
    await say("관계대명사 한 거 삭제해", { route: "correction", correctionTarget: "class_progress", operation: "cancel", field: "progress", fromText: "관계대명사" });
    expect(tables.class_progress[0].progress_content).toBe("본문 3과");
    await say("고2 이사벨A 1교시 과제 워크북 22쪽", { route: "class_progress", className: "고2 이사벨A", period: "1교시", homework: "워크북 22쪽" });
    const res = await say("방금 입력한 거 취소해", { route: "correction", correctionTarget: "recent", operation: "cancel" });
    expect(res.outcomes[0].message).toContain("방금 입력한 진도/과제를 취소했습니다");
    expect(tables.class_progress[0]).toMatchObject({ progress_content: "본문 3과", homework_content: "" });
    expect(tables.class_progress[0].source_payload.examAiLog.at(-1)).toMatchObject({ operation: "delete", by: "서도영" });
  });
});

describe("자연어 정정 — student_learning_records", () => {
  it("'84점 아니고 94점이야' → 통과/재시험 여부를 추측하지 않고 묻고, 답하면 일관되게 갱신(수행자=로그인 사용자, 원작성자 보존)", async () => {
    await seedRecord("고2 이사벨A 김민수 단어시험 84점 재시험", { students: ["김민수"], recordType: "vocab", assessmentName: "단어시험", score: 84, passed: false, retestRequired: true }, "박민지");
    const first = await say("김민수 84점 아니고 94점이야", { route: "correction", correctionTarget: "student_record", operation: "modify", students: ["김민수"], oldScore: 84, newScore: 94 });
    const pending = first.outcomes[0].pending!;
    expect(pending.question).toBe("84점 → 94점으로 수정하면 통과/재시험 여부도 바뀌나요?");
    expect(tables.student_learning_records[0].score).toBe(84);
    const { continuePendingInput } = await import("@/lib/nl-input");
    const done = await continuePendingInput(JSON.parse(JSON.stringify(pending)), "통과야", { staffName: "서도영" });
    expect(done.outcomes[0].message).toBe("김민수 · 단어시험\n84점 → 94점, 미통과 → 통과, 재시험 필요 → 아님(으)로 수정했습니다.");
    const r = tables.student_learning_records[0];
    expect(r).toMatchObject({ score: 94, passed: true, retest_required: false, entered_by: "박민지" });
    expect(r.source_payload.edits[0]).toMatchObject({ by: "서도영", op: "modify", before: { score: 84, passed: false, retest_required: true }, after: { score: 94 } });
  });

  it("'김민수 재시험 아니야' → retest_required만 정정", async () => {
    await seedRecord("고2 이사벨A 김민수 단어 70점 재시험", { students: ["김민수"], recordType: "vocab", score: 70, retestRequired: true });
    await say("김민수 재시험 아니야", { route: "correction", correctionTarget: "student_record", operation: "modify", students: ["김민수"], newRetestRequired: false });
    expect(tables.student_learning_records[0]).toMatchObject({ score: 70, retest_required: false });
  });

  it("'박지훈 과제 미완료 취소' → soft cancel(조회·중복판정에서 제외), 같은 문장 재입력은 새로 기록됨", async () => {
    const text = "고2 이사벨A 박지훈 워크북 과제 미완료";
    await seedRecord(text, { students: ["박지훈"], recordType: "homework", assessmentName: "워크북", completed: false });
    const res = await say("박지훈 과제 미완료 기록 취소해", { route: "correction", correctionTarget: "student_record", operation: "cancel", students: ["박지훈"], recordType: "homework" });
    expect(res.outcomes[0].message).toBe("박지훈 · 워크북 · 미완료 기록을 취소했습니다.");
    const r = tables.student_learning_records[0];
    expect(r.input_hash).toBeNull();
    expect(r.source_payload.cancelled).toMatchObject({ by: "서도영", raw: "박지훈 과제 미완료 기록 취소해" });
    const notion = await import("@/lib/notion");
    expect(await notion.listStudentLearningRecords({})).toHaveLength(0);
    await seedRecord(text, { students: ["박지훈"], recordType: "homework", assessmentName: "워크북", completed: false });
    expect(active()).toHaveLength(1);
  });

  it("후보가 여러 개면 실제 후보를 보여주고 DB는 바꾸지 않는다 → 2~3턴 대화로 수정 완료", async () => {
    await seedRecord("고2 이사벨A 김민수 단어시험 84점", { students: ["김민수"], recordType: "vocab", assessmentName: "단어시험", score: 84 });
    await seedRecord("고2 이사벨A 김민수 문법테스트 72점", { students: ["김민수"], recordType: "assessment", assessmentName: "문법테스트", score: 72 });
    const before = JSON.stringify(tables.student_learning_records);
    const q1 = await say("김민수 점수 잘못 넣었어", { route: "correction", correctionTarget: "student_record", operation: "modify", students: ["김민수"] });
    const p1 = q1.outcomes[0].pending!;
    expect(p1.question).toBe("해당하는 기록이 2개 있습니다. 어느 기록을 수정할까요?");
    expect(p1.missing[0].candidates!.map((c) => c.label)).toEqual(["김민수 · 문법테스트 · 72점", "김민수 · 단어시험 · 84점"]);
    expect(JSON.stringify(tables.student_learning_records)).toBe(before);

    const { continuePendingInput } = await import("@/lib/nl-input");
    const q2 = await continuePendingInput(JSON.parse(JSON.stringify(p1)), "단어시험", { staffName: "서도영" });
    const p2 = q2.outcomes[0].pending!;
    expect(p2.question).toContain("무엇으로 수정할까요");
    const done = await continuePendingInput(JSON.parse(JSON.stringify(p2)), "94", { staffName: "서도영" });
    expect(done.ok).toBe(true);
    expect(tables.student_learning_records.find((r) => r.assessment_name === "단어시험")!.score).toBe(94);
    expect(tables.student_learning_records.find((r) => r.assessment_name === "문법테스트")!.score).toBe(72);
  });

  it("기록이 없으면 새 기록을 만들지 않고 안내한다", async () => {
    const res = await say("이서연 84점 아니고 94점이야", { route: "correction", correctionTarget: "student_record", operation: "modify", students: ["이서연"], oldScore: 84, newScore: 94 });
    expect(res.outcomes[0].status).toBe("확인필요");
    expect(res.outcomes[0].message).toContain("수정할 기록을 찾지 못했습니다");
    expect(tables.student_learning_records).toHaveLength(0);
    expect(tables.tasks).toHaveLength(0);
  });

  it("'방금 입력한 거 취소' / '아까 거 잘못 입력했어'(수정·삭제 되묻기)", async () => {
    await seedRecord("고2 이사벨A 이서연 단어 96점 통과", { students: ["이서연"], recordType: "vocab", score: 96, passed: true });
    const q = await say("아까 거 잘못 입력했어", { route: "correction", correctionTarget: "recent", operation: "unknown" });
    expect(q.outcomes[0].pending!.question).toBe('방금 입력한 "이서연 · 단어시험 · 96점 · 통과" 기록을 수정할까요, 삭제할까요?');
    expect(active()).toHaveLength(1);
    await say("방금 입력한 거 취소해", { route: "correction", correctionTarget: "recent", operation: "cancel" });
    expect(active()).toHaveLength(0);
  });

  it("'민수가 아니라 민지야' — 새 학생이 명단에서 안전하게 특정될 때만 바꾸고, 못 찾으면 되묻는다", async () => {
    await seedRecord("고2 이사벨A 김민수 과제 미완료", { students: ["김민수"], recordType: "homework", completed: false });
    const res = await say("아니, 민수가 아니라 민지야", { route: "correction", operation: "modify", students: ["민수"], newStudentName: "민지" });
    expect(res.outcomes[0].pending!.question).toContain('명단에서 "민지" 학생을 찾지 못했습니다');
    expect(tables.student_learning_records[0].student_notion_ids).toEqual(["stu-minsu-2b"]);
    await say("아니, 김민수가 아니라 박지훈이야", { route: "correction", operation: "modify", students: ["김민수"], newStudentName: "박지훈" });
    expect(tables.student_learning_records[0].student_notion_ids).toEqual(["stu-jihun"]);
  });

  it("연결 업무 모순 방지: 미착수 업무는 기록 취소와 함께 취소, 진행 중이면 확인, 정정으로 필요 없어지면 확인", async () => {
    await seedRecord("고2 이사벨A 박지훈 과제 미완료 다음 시간 확인해줘", {
      students: ["박지훈"], recordType: "homework", completed: false, actionRequested: true, taskType: "숙제확인",
    });
    const taskId = tables.tasks[0].id;
    expect(tables.student_learning_records[0].task_id).toBe(taskId);
    const res = await say("박지훈 과제 미완료 아니야. 취소해", { route: "correction", correctionTarget: "student_record", operation: "cancel", students: ["박지훈"] });
    expect(res.outcomes[0].message).toContain("연결된 업무(숙제확인)도 취소했습니다.");
    expect(tables.tasks[0]).toMatchObject({ complete: true, outcome: "취소" });
    expect(tables.tasks[0].source_payload.workflow).toMatchObject({ cancelledBy: "서도영" });

    // 진행 중 업무 → 확인 질문
    await seedRecord("고2 이사벨A 김민수 암기 미완료 확인시켜", { students: ["김민수"], recordType: "memorization", completed: false, actionRequested: true, taskType: "암기확인" });
    const t2 = tables.tasks.find((t) => t.type === "암기확인")!;
    t2.source_payload.workflow.startedAt = new Date().toISOString();
    const q = await say("김민수 암기 미완료 취소", { route: "correction", correctionTarget: "student_record", operation: "cancel", students: ["김민수"] });
    expect(q.outcomes[0].pending!.question).toContain("이미 진행 중입니다. 업무도 취소할까요?");
    const { continuePendingInput } = await import("@/lib/nl-input");
    await continuePendingInput(JSON.parse(JSON.stringify(q.outcomes[0].pending)), "업무는 유지", { staffName: "서도영" });
    expect(t2.complete).toBe(false);

    // 정정으로 필요 없어짐(완료) → 연결 업무 처리 확인
    await seedRecord("고2 이사벨A 이서연 과제 미완료 확인해줘", { students: ["이서연"], recordType: "homework", completed: false, actionRequested: true, taskType: "숙제확인" });
    const q2 = await say("이서연 과제 했대", { route: "correction", correctionTarget: "student_record", operation: "modify", students: ["이서연"], newCompleted: true });
    expect(q2.outcomes[0].pending!.question).toContain("도 취소할까요?");
  });

  it("정정 pending의 작성자 조작 무시 — 수정 수행자는 현재 로그인 사용자", async () => {
    await seedRecord("고2 이사벨A 김민수 단어 84점", { students: ["김민수"], recordType: "vocab", score: 84 });
    await seedRecord("고2 이사벨A 김민수 문법 72점", { students: ["김민수"], recordType: "assessment", assessmentName: "문법", score: 72 });
    const q = await say("김민수 점수 94로 고쳐", { route: "correction", correctionTarget: "student_record", operation: "modify", students: ["김민수"], newScore: 94 });
    const tampered = JSON.parse(JSON.stringify(q.outcomes[0].pending));
    tampered.draft.enteredBy = "가짜";
    const { continuePendingInput } = await import("@/lib/nl-input");
    await continuePendingInput(tampered, "단어시험", { staffName: "박민지" });
    const edited = tables.student_learning_records.find((r) => r.record_type === "vocab")!;
    expect(edited.score).toBe(94);
    expect(edited.source_payload.edits[0].by).toBe("박민지");
  });
});

describe("입력 이력 조회(읽기 전용) + 번호로 이어서 정정", () => {
  async function showHistory(i: Partial<UnifiedIntent> = {}, staffName = "서도영", staffId = "staff-seo") {
    parseUnifiedInput.mockResolvedValueOnce([intent({ route: "history_query", ...i })]);
    const { runUnifiedNlInput } = await import("@/lib/nl-input");
    return runUnifiedNlInput("오늘 입력한 내용 보여줘", { staffName, staffId });
  }

  async function seedDay() {
    await say("고2 이사벨A 1교시 본문 3과, 과제 워크북 22~25쪽", { route: "class_progress", className: "고2 이사벨A", period: "1교시", progress: "본문 3과", homework: "워크북 22~25쪽" });
    await seedRecord("고2 이사벨A 김민수 단어시험 84점 재시험", { students: ["김민수"], recordType: "vocab", assessmentName: "단어시험", score: 84, passed: false, retestRequired: true });
    await seedRecord("고2 이사벨A 박지훈 과제 미완료", { students: ["박지훈"], recordType: "homework", completed: false });
    await say("민지에게 시험지 출력 맡겨", { route: "task", taskType: "출력", instruction: "시험지 출력", ownerName: "민지" });
    await seedRecord("고2 이사벨A 이서연 단어 96점", { students: ["이서연"], recordType: "vocab", score: 96 }, "박민지");
  }

  it("오늘 내가 입력한 내용: 번호·시각·반/학생·내용·총 건수, 다른 사람 입력 제외, DB 변경·task 생성 없음(GET만)", async () => {
    await seedDay();
    const snapshot = JSON.stringify(tables);
    const calls: string[] = [];
    const base = globalThis.fetch as any;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: any) => {
      calls.push((init?.method ?? "GET").toUpperCase());
      return base(url, init);
    }));
    const res = await showHistory();
    expect(calls.every((m) => m === "GET")).toBe(true);
    expect(JSON.stringify(tables)).toBe(snapshot);
    const msg = res.outcomes[0].message;
    expect(msg.split("\n")[0]).toBe("오늘 입력한 내용 (서도영 입력)");
    expect(msg).toMatch(/^1\. \d\d:\d\d · 고2 이사벨A 1교시\n   진도: 본문 3과\n   과제: 워크북 22~25쪽$/m);
    expect(msg).toContain("2. ");
    expect(msg).toContain("김민수 · 고2 이사벨A\n   단어시험 · 84점 · 미통과 · 재시험 필요");
    expect(msg).toContain("박지훈 · 고2 이사벨A\n   과제 · 미완료");
    expect(msg).toContain("업무 · 출력");
    expect(msg).not.toContain("이서연");
    expect(msg).toContain("총 4건");
    expect(res.history).toBeTruthy();
  });

  it("이미 저장돼 있던 오늘 기록(로그 도입 전 반 진도 포함)과 어제 기록 조회, 학생/반 필터", async () => {
    const { todayKST } = await import("@/lib/date");
    const now = new Date().toISOString();
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    // 로그 도입 전 EXAM AI 반 진도 행(examAiLog 없음, 학생기록 미생성)
    tables.class_progress.push({ id: "cp-legacy", branch_id: B, class_id: "cls-2b", class_notion_ids: ["cls-2b"], record_date: todayKST(), period: null,
      progress_content: "모의고사 29~32번", homework_content: "", student_records_created: false, source_payload: {}, created_at: now, updated_at: now });
    tables.student_learning_records.push({ id: "old-1", branch_id: B, student_notion_ids: ["stu-jihun"], class_notion_ids: ["cls-isabel-a"], record_type: "memo",
      note: "지각", entered_by: "서도영", raw_text: "박지훈 지각", created_at: now, record_date: todayKST(), source_payload: {} });
    tables.student_learning_records.push({ id: "old-y", branch_id: B, student_notion_ids: ["stu-minsu-2b"], class_notion_ids: ["cls-isabel-a"], record_type: "vocab",
      score: 70, entered_by: "서도영", raw_text: "김민수 70", created_at: yesterday, record_date: todayKST(), source_payload: {} });

    const mine = await showHistory();
    expect(mine.outcomes[0].message).toContain("박지훈 · 고2 이사벨A\n   메모 · 지각");
    const all = await showHistory({ onlyMine: false });
    expect(all.outcomes[0].message).toContain("고2B (작성: 작성자 기록 없음)\n   진도: 모의고사 29~32번");
    const y = await showHistory({ historyFrom: new Date(Date.now() - 86400000 + 9 * 3600000).toISOString().slice(0, 10) });
    expect(y.outcomes[0].message).toContain("김민수 · 고2 이사벨A\n   단어시험 · 70점");
    expect(y.outcomes[0].message).toContain("총 1건");

    await seedRecord("고2 이사벨A 김민수 단어 84점", { students: ["김민수"], recordType: "vocab", score: 84 });
    const byStudent = await showHistory({ students: ["김민수"] });
    expect(byStudent.outcomes[0].message).toContain("총 1건");
    const byClass = await showHistory({ className: "고2B", onlyMine: false });
    expect(byClass.outcomes[0].message).toContain("총 1건");
  });

  it("조회 후 '2번 94점으로' → 84→94, '마지막 거 취소' → 취소, 다시 조회하면 반영", async () => {
    await seedDay();
    const h = await showHistory();
    const opts = { historyToken: h.history };
    const q = await say("2번 94점으로 고쳐", { route: "correction", operation: "modify", itemNumber: 2, newScore: 94, newPassed: true, newRetestRequired: false }, opts);
    expect(q.outcomes[0].message).toBe("김민수 · 단어시험\n84점 → 94점, 미통과 → 통과, 재시험 필요 → 아님(으)로 수정했습니다.");
    const lastTask = await say("마지막 거 삭제", { route: "correction", operation: "cancel", itemNumber: -1 }, opts);
    expect(lastTask.outcomes[0].message).toContain("업무 수정·취소는 '내 업무' 화면에서");
    await say("3번 취소", { route: "correction", operation: "cancel", itemNumber: 3 }, opts);
    expect(active().map((r) => r.student_notion_ids[0])).toEqual(["stu-minsu-2b", "stu-seoyeon"]);

    await say("1번 과제 27쪽까지로 바꿔", { route: "correction", correctionTarget: "class_progress", operation: "modify", itemNumber: 1, field: "homework", toText: "27쪽까지" }, opts);
    expect(tables.class_progress[0].homework_content).toBe("워크북 22~27쪽");

    const again = await showHistory();
    expect(again.outcomes[0].message).toContain("단어시험 · 94점 · 통과");
    expect(again.outcomes[0].message).toContain("과제: 워크북 22~27쪽");
    expect(again.outcomes[0].message).not.toContain("박지훈");
  });

  it("다른 로그인 사용자의 조회 번호는 쓸 수 없다(위조·교차 사용 방지)", async () => {
    await seedDay();
    const minji = await showHistory({}, "박민지", "staff-minji");
    const res = await say("1번 취소", { route: "correction", operation: "cancel", itemNumber: 1 }, { historyToken: minji.history });
    expect(res.outcomes[0].message).toContain("먼저 '오늘 입력한 내용 보여줘'로 목록을 불러와 주세요");
    expect(active()).toHaveLength(3);
    const forged = (minji.history as string).replace(/\.[^.]+$/, ".AAAA");
    const res2 = await say("1번 취소", { route: "correction", operation: "cancel", itemNumber: 1 }, { historyToken: forged, staffId: "staff-minji", staffName: "박민지" });
    expect(res2.outcomes[0].message).toContain("먼저");
  });
});

// ---------------------------------------------------------------------------
// 최상위 의도 경계(correction > query > record > action, special은 명시어 필요)
// 실제 Haiku 호출 없이: (a) 올바른 분류가 오면 안전하게 처리되는지, (b) 과거 장애처럼
// 잘못된 분류가 와도 경계 검사가 저장 없이 되묻기로 막는지 고정한다.
// ---------------------------------------------------------------------------
describe("의도 경계 — prompt", () => {
  it("우선순위·신입생 명시어 규칙이 들어 있고 '신입생일 수 있음' 추측 문구가 없다", async () => {
    const { unifiedSystemPromptText } = await import("@/lib/anthropic");
    const text = unifiedSystemPromptText({ today: "2026-09-23", weekday: "수", students: [], classes: [], staff: [] }, ["출력"]);
    expect(text).not.toContain("신입생일 수 있음");
    expect(text).toContain("최상위 의도 판단");
    expect(text.indexOf("1) correction")).toBeLessThan(text.indexOf("2) query"));
    expect(text.indexOf("2) query")).toBeLessThan(text.indexOf("3) record"));
    expect(text.indexOf("3) record")).toBeLessThan(text.indexOf("4) action"));
    expect(text).toContain("학생이 명단에 없다는 사실만으로 신입생·신규 상담을 추측하지 않는다");
    expect(text).toContain("student_action은 fallback이 아니다");
  });
});

describe("의도 경계 — 잘못된 분류는 저장하지 않고 되묻는다", () => {
  const writes = () => tables.tasks.length + tables.student_learning_records.length + tables.class_progress.length + (tables.admin_inbox_entries?.length ?? 0);

  it.each([
    // [입력, 잘못된 AI 출력(과거 장애 유형), 사유, 기대 route(모두 write 0건)]
    ["이태경 불규칙동사 테스트", { intentClass: "special", route: "schedule", scheduleType: "신입생상담", students: ["이태경"] }, "명시어 없는 신입생상담", "clarify"],
    ["박지훈 문법 퀴즈 봤어", { intentClass: "special", route: "admin_inbox", inboxType: "신규생문의", students: ["박지훈"] }, "명시어 없는 신규생문의", "clarify"],
    ["이태경 불규칙동사 테스트", { intentClass: "record", route: "student_action", students: ["이태경"], instruction: "불규칙동사 테스트" }, "기록인데 조치사항", "clarify"],
    ["불규칙 관련 입력한 것 취소", { intentClass: "correction", route: "student_action", students: [], instruction: "불규칙 취소" }, "정정인데 조치사항", "correction"],
    ["오늘 입력한 내용 보여줘", { intentClass: "query", route: "task", taskType: "기타업무", instruction: "오늘 입력 내용" }, "조회인데 업무", "history_query"],
    ["오늘 일정 보여줘", { intentClass: "query", route: "schedule", scheduleType: "보강", students: [] }, "조회인데 일정 생성", "schedule_view"],
  ] as [string, Partial<UnifiedIntent>, string, string][])("%s — %s → %s(write 0건) (%s)", async (text, bad, _why, expectedRoute) => {
    parseUnifiedInput.mockResolvedValueOnce([intent(bad)]);
    const { runUnifiedNlInput } = await import("@/lib/nl-input");
    const before = writes();
    const res = await runUnifiedNlInput(text, { staffName: "서도영", staffId: "staff-seo" });
    expect(res.outcomes).toHaveLength(1);
    expect(res.outcomes[0].route).toBe(expectedRoute);
    expect(res.outcomes[0].status).not.toBe("실패");
    expect(res.outcomes[0].message).not.toContain("무엇을 해야 할지 명확하지 않습니다");
    expect(writes()).toBe(before);
  });

  it("같은 문장에 정정이 있으면 같은 대상의 새 조치/업무는 만들지 않는다", async () => {
    await seedRecord("고2 이사벨A 김민수 불규칙동사 테스트 84점", { students: ["김민수"], recordType: "vocab", assessmentName: "불규칙동사 테스트", score: 84 });
    parseUnifiedInput.mockResolvedValueOnce([
      intent({ intentClass: "correction", route: "correction", correctionTarget: "student_record", operation: "cancel", students: ["김민수"], assessmentName: "불규칙" }),
      intent({ intentClass: "action", route: "student_action", students: ["김민수"], instruction: "불규칙 취소" }),
    ]);
    const { runUnifiedNlInput } = await import("@/lib/nl-input");
    const res = await runUnifiedNlInput("김민수 불규칙 관련 입력한 것 취소", { staffName: "서도영", staffId: "staff-seo" });
    // 원문 정정 신호로 두 intent 모두 정정 흐름 — 조치사항은 만들어지지 않는다.
    expect(res.outcomes.map((o) => o.route)).toEqual(["correction", "correction"]);
    expect(active()).toHaveLength(0);
    expect(tables.tasks).toHaveLength(0);
  });

  it.each([
    ["이태경 신입생 상담 잡아줘"],
    ["최유진 입학 상담 예약해줘"],
    ["김하늘 처음 상담 잡아줘"],
    ["등록 문의 온 학생 상담 일정"],
  ])("명시어가 있으면 신입생상담은 막지 않는다: %s", async (text) => {
    const { enforceIntentBoundaries } = await import("@/lib/nl-input");
    const [out] = enforceIntentBoundaries([intent({ intentClass: "special", route: "schedule", scheduleType: "신입생상담", students: ["이태경"] })], text);
    expect(out.route).toBe("schedule");
  });
});

describe("의도 경계 — 올바른 분류 회귀 fixture(12문장 + 유사 표현)", () => {
  const TODAY_STUDENT = { id: "stu-lee", notion_id: "stu-lee", branch_id: B, name: "이태경", school: "부산고", grade: "고2", status: "재원", class_notion_ids: ["cls-isabel-a"] };
  beforeEach(() => {
    tables.students.push(TODAY_STUDENT);
    tables.classes[0].student_notion_ids.push("stu-lee");
  });

  it.each([
    ["이태경 불규칙동사 테스트", { intentClass: "record", route: "student_record", students: ["이태경"], recordType: "vocab", assessmentName: "불규칙동사 테스트" }],
    ["이태경 불규칙동사 퀴즈 봤음", { intentClass: "record", route: "student_record", students: ["이태경"], recordType: "vocab", assessmentName: "불규칙동사 퀴즈" }],
    ["이태경 불규칙동사 테스트 84점", { intentClass: "record", route: "student_record", students: ["이태경"], recordType: "vocab", assessmentName: "불규칙동사 테스트", score: 84 }],
    ["이태경 불규칙동사 84점 받음", { intentClass: "record", route: "student_record", students: ["이태경"], recordType: "vocab", assessmentName: "불규칙동사", score: 84 }],
  ] as [string, Partial<UnifiedIntent>][])("기록: %s → student_record 1건, 업무/상담/조치 0건", async (text, good) => {
    parseUnifiedInput.mockResolvedValueOnce([intent(good)]);
    const { runUnifiedNlInput } = await import("@/lib/nl-input");
    const res = await runUnifiedNlInput(text, { staffName: "서도영", staffId: "staff-seo" });
    expect(res.outcomes[0]).toMatchObject({ route: "student_record", status: "완료" });
    expect(active()).toHaveLength(1);
    expect(active()[0]).toMatchObject({ student_notion_ids: ["stu-lee"], record_type: "vocab" });
    expect(tables.tasks).toHaveLength(0);
  });

  it("이태경 불규칙동사 테스트 84점 재시험 → 기록 + 재시험 상태(업무 아님)", async () => {
    parseUnifiedInput.mockResolvedValueOnce([
      intent({ intentClass: "record", route: "student_record", students: ["이태경"], recordType: "vocab", assessmentName: "불규칙동사 테스트", score: 84, passed: false, retestRequired: true }),
    ]);
    const { runUnifiedNlInput } = await import("@/lib/nl-input");
    await runUnifiedNlInput("이태경 불규칙동사 테스트 84점 재시험", { staffName: "서도영", staffId: "staff-seo" });
    expect(active()[0]).toMatchObject({ score: 84, retest_required: true });
    expect(tables.tasks).toHaveLength(0);
  });

  it.each([
    ["이태경 불규칙동사 다시 테스트해줘", "단어재시"],
    ["이태경 불규칙 재시험 시켜줘", "재시험"],
  ])("명시적 행동: %s → 업무(%s)", async (text, taskType) => {
    parseUnifiedInput.mockResolvedValueOnce([intent({ intentClass: "action", route: "task", taskType, students: ["이태경"], instruction: text })]);
    const { runUnifiedNlInput } = await import("@/lib/nl-input");
    const res = await runUnifiedNlInput(text, { staffName: "서도영", staffId: "staff-seo" });
    expect(res.outcomes[0]).toMatchObject({ route: "task", status: "완료" });
    expect(tables.tasks).toHaveLength(1);
    expect(tables.tasks[0]).toMatchObject({ type: taskType, student_notion_ids: ["stu-lee"] });
  });

  it.each([
    ["불규칙 관련 입력한 것 취소", { correctionTarget: "student_record", operation: "cancel", assessmentName: "불규칙" }],
    ["불규칙동사 기록 지워줘", { correctionTarget: "student_record", operation: "cancel", assessmentName: "불규칙동사" }],
    ["방금 입력한 거 취소해", { correctionTarget: "recent", operation: "cancel" }],
    ["아까 넣은 거 없던 걸로 해줘", { correctionTarget: "recent", operation: "cancel" }],
  ] as [string, Partial<UnifiedIntent>][])("정정(취소): %s → 기존 기록 취소, 새 업무/조치 0건", async (text, fields) => {
    await seedRecord("고2 이사벨A 이태경 불규칙동사 테스트 84점", { students: ["이태경"], recordType: "vocab", assessmentName: "불규칙동사 테스트", score: 84 });
    parseUnifiedInput.mockResolvedValueOnce([intent({ intentClass: "correction", route: "correction", ...fields })]);
    const { runUnifiedNlInput } = await import("@/lib/nl-input");
    const res = await runUnifiedNlInput(text, { staffName: "서도영", staffId: "staff-seo" });
    expect(res.outcomes[0].route).toBe("correction");
    expect(active()).toHaveLength(0);
    expect(tables.tasks).toHaveLength(0);
  });

  it.each([
    ["84점 아니고 94점이야"],
    ["84 말고 94점"],
  ])("정정(수정): %s → 84→94", async (text) => {
    await seedRecord("고2 이사벨A 이태경 불규칙동사 테스트 84점", { students: ["이태경"], recordType: "vocab", assessmentName: "불규칙동사 테스트", score: 84 });
    parseUnifiedInput.mockResolvedValueOnce([intent({ intentClass: "correction", route: "correction", correctionTarget: "student_record", operation: "modify", oldScore: 84, newScore: 94 })]);
    const { runUnifiedNlInput } = await import("@/lib/nl-input");
    await runUnifiedNlInput(text, { staffName: "서도영", staffId: "staff-seo" });
    expect(active()[0].score).toBe(94);
    expect(tables.tasks).toHaveLength(0);
  });

  it("민수가 아니라 민지야 / 과제 25쪽 아니고 27쪽까지 → correction", async () => {
    await say("고2 이사벨A 과제 워크북 22~25쪽", { intentClass: "record", route: "class_progress", className: "고2 이사벨A", homework: "워크북 22~25쪽" });
    await say("과제 25쪽 아니고 27쪽까지", { intentClass: "correction", route: "correction", correctionTarget: "class_progress", operation: "modify", field: "homework", fromText: "25쪽", toText: "27쪽" });
    expect(tables.class_progress[0].homework_content).toBe("워크북 22~27쪽");
    const r = await say("민수가 아니라 민지야", { intentClass: "correction", route: "correction", operation: "modify", students: ["민수"], newStudentName: "민지" });
    expect(r.outcomes[0].route).toBe("correction");
    expect(tables.tasks).toHaveLength(0);
  });

  it.each([
    ["오늘 입력한 내용 보여줘", "history_query"],
    ["오늘 내가 뭐 입력했지", "history_query"],
    ["오늘 일정 보여줘", "schedule_view"],
    ["오늘 할 일 뭐 있어", "schedule_view"],
  ])("조회: %s → %s, DB 요청은 GET만", async (text, route) => {
    await seedRecord("고2 이사벨A 이태경 불규칙동사 테스트 84점", { students: ["이태경"], recordType: "vocab", assessmentName: "불규칙동사 테스트", score: 84 });
    // fake DB는 처음 GET한 테이블 이름에 빈 배열을 만든다 — 행 내용만 비교한다.
    const rowsOnly = () => JSON.stringify(Object.fromEntries(Object.entries(tables).filter(([, v]) => v.length > 0)));
    const snapshot = rowsOnly();
    const methods: string[] = [];
    const base = globalThis.fetch as any;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: any) => {
      methods.push((init?.method ?? "GET").toUpperCase());
      return base(url, init);
    }));
    parseUnifiedInput.mockResolvedValueOnce([intent({ intentClass: "query", route: route as UnifiedIntent["route"] })]);
    const { runUnifiedNlInput } = await import("@/lib/nl-input");
    const res = await runUnifiedNlInput(text, { staffName: "서도영", staffId: "staff-seo" });
    expect(res.outcomes[0]).toMatchObject({ route, status: "완료" });
    if (route === "schedule_view") {
      expect(res.outcomes[0].message).toContain("일정");
      expect(res.outcomes[0].message).toContain("/director/tasks");
      expect(res.outcomes[0].message).not.toContain("입력한 내용");
    } else {
      expect(res.outcomes[0].message).toContain("입력한 내용");
    }
    expect(methods.every((m) => m === "GET")).toBe(true);
    expect(rowsOnly()).toBe(snapshot);
  });

  it("이태경 신입생 상담 잡아줘 → 신입생상담 일정(명시어 있음)", async () => {
    parseUnifiedInput.mockResolvedValueOnce([
      intent({ intentClass: "special", route: "schedule", scheduleType: "신입생상담", students: ["이태경"], instruction: "신입생 상담" }),
    ]);
    const { runUnifiedNlInput } = await import("@/lib/nl-input");
    const res = await runUnifiedNlInput("이태경 신입생 상담 잡아줘", { staffName: "서도영", staffId: "staff-seo" });
    expect(res.outcomes[0]).toMatchObject({ route: "schedule" });
  });
});

// ---------------------------------------------------------------------------
// 적대적 회귀: AI가 intentClass와 route를 "둘 다" 틀리게(서로는 일관되게) 출력해도
// 서버의 원문 기반 write guard가 위험한 저장을 막는다. 전체 테이블 행 스냅샷으로 검증.
// ---------------------------------------------------------------------------
describe("적대적 회귀 — AI intentClass+route 동시 오분류", () => {
  const rowsOnly = () => JSON.stringify(Object.fromEntries(Object.entries(tables).filter(([, v]) => v.length > 0)));
  beforeEach(() => {
    tables.students.push({ id: "stu-lee", notion_id: "stu-lee", branch_id: B, name: "이태경", school: "부산고", grade: "고2", status: "재원", class_notion_ids: ["cls-isabel-a"] });
    tables.classes[0].student_notion_ids.push("stu-lee");
  });

  it.each([
    ["1 신입생상담", "이태경 불규칙동사 테스트", { intentClass: "special", route: "schedule", scheduleType: "신입생상담", students: ["이태경"] }],
    ["1′ 긴급상담요청", "이태경 불규칙동사 테스트", { intentClass: "special", route: "admin_inbox", inboxType: "긴급상담요청", students: ["이태경"], instruction: "불규칙동사 테스트" }],
    ["1′ 행정 기타", "이태경 불규칙동사 테스트", { intentClass: "special", route: "admin_inbox", inboxType: "기타", students: ["이태경"], instruction: "불규칙동사 테스트" }],
    ["2 조치사항(이름 없음)", "불규칙 관련 입력한 것 취소", { intentClass: "action", route: "student_action", students: [], instruction: "불규칙 취소" }],
    ["2′ 조치사항(이름 있음)", "이태경 불규칙 관련 입력한 것 취소", { intentClass: "action", route: "student_action", students: ["이태경"], instruction: "불규칙 취소" }],
    ["2″ 업무", "불규칙 관련 입력한 것 취소", { intentClass: "action", route: "task", taskType: "기타업무", students: [], instruction: "불규칙 취소" }],
    ["3 업무", "오늘 입력한 내용 보여줘", { intentClass: "action", route: "task", taskType: "기타업무", students: [], instruction: "오늘 입력 내용" }],
    ["3′ 일정", "오늘 입력한 내용 보여줘", { intentClass: "action", route: "schedule", scheduleType: "보강", students: ["이태경"] }],
    ["4 새 기록(이름 없음)", "84점 아니고 94점", { intentClass: "record", route: "student_record", students: [], recordType: "vocab", score: 94 }],
    ["5 일정 생성", "오늘 일정 보여줘", { intentClass: "action", route: "schedule", scheduleType: "보강", students: ["이태경"] }],
    ["5′ 업무", "오늘 일정 보여줘", { intentClass: "action", route: "task", taskType: "기타업무", students: [] }],
    ["6 조치사항", "김민수 단어시험 84점", { intentClass: "action", route: "student_action", students: ["김민수"], instruction: "단어시험 84점" }],
    ["6′ 상담", "김민수 단어시험 84점", { intentClass: "record", route: "counseling", students: ["김민수"], instruction: "단어시험 84점" }],
    ["6″ 업무", "김민수 단어시험 84점", { intentClass: "action", route: "task", taskType: "단어재시", students: ["김민수"], instruction: "단어시험 84점" }],
    ["6‴ 학생기록+후속업무", "김민수 단어시험 84점", { intentClass: "record", route: "student_record", className: "고2 이사벨A", students: ["김민수"], recordType: "vocab", score: 84, actionRequested: true, taskType: "단어재시" }],
  ] as [string, string, Partial<UnifiedIntent>][])("%s: \"%s\" → 위험한 write 0건", async (name, text, bad) => {
    parseUnifiedInput.mockResolvedValueOnce([intent(bad)]);
    const { runUnifiedNlInput } = await import("@/lib/nl-input");
    const before = rowsOnly();
    const res = await runUnifiedNlInput(text, { staffName: "서도영", staffId: "staff-seo" });
    if (name.startsWith("6‴")) {
      // 학습 기록 자체는 정상 저장, 원문에 행동 요청이 없으므로 후속 업무는 만들지 않는다.
      expect(active()).toHaveLength(1);
      expect(tables.tasks).toHaveLength(0);
      expect(res.outcomes[0].message).toContain("후속 업무는 만들지 않았습니다");
      return;
    }
    expect(rowsOnly()).toBe(before);
    expect(res.outcomes.every((o) => o.status !== "완료" || ["history_query", "schedule_view", "correction"].includes(o.route))).toBe(true);
  });

  it("4′ '김민수 84점 아니고 94점'을 새 학생 기록으로 잘못 줘도 94점 새 기록은 생기지 않고 기존 84점 기록만 정정된다", async () => {
    await seedRecord("고2 이사벨A 김민수 단어시험 84점", { students: ["김민수"], recordType: "vocab", assessmentName: "단어시험", score: 84 });
    const id = tables.student_learning_records[0].id;
    parseUnifiedInput.mockResolvedValueOnce([intent({ intentClass: "record", route: "student_record", className: "고2 이사벨A", students: ["김민수"], recordType: "vocab", score: 94 })]);
    const { runUnifiedNlInput } = await import("@/lib/nl-input");
    const res = await runUnifiedNlInput("김민수 84점 아니고 94점", { staffName: "서도영", staffId: "staff-seo" });
    expect(res.outcomes[0].route).toBe("correction");
    expect(tables.student_learning_records).toHaveLength(1);
    expect(tables.student_learning_records[0]).toMatchObject({ id, score: 94 });
  });

  it("AI가 반 진도를 replace로 잘못 줘도 원문에 수정 표현이 없으면 기존 진도를 지우지 않는다(append)", async () => {
    await say("고2 이사벨A 본문 3과", { intentClass: "record", route: "class_progress", className: "고2 이사벨A", progress: "본문 3과" });
    await say("고2 이사벨A 관계대명사 진행", { intentClass: "record", route: "class_progress", className: "고2 이사벨A", progress: "관계대명사", editMode: "replace" });
    expect(tables.class_progress[0].progress_content).toBe("본문 3과\n관계대명사");
  });
});

describe("원문 guard — 정상 입력은 계속 동작(과잉 차단 방지)", () => {
  it("동사 없는 축약 업무('민지 시험지 출력 8시까지', '김민수 내일 재시험')는 저장 전 확인 → '네'면 생성, '아니요'면 0건", async () => {
    const { runUnifiedNlInput, continuePendingInput } = await import("@/lib/nl-input");
    parseUnifiedInput.mockResolvedValueOnce([intent({ intentClass: "action", route: "task", taskType: "출력", instruction: "시험지 출력", time: "20:00", ownerName: "민지" })]);
    const q = await runUnifiedNlInput("민지 시험지 출력 8시까지", { staffName: "서도영", staffId: "staff-seo" });
    expect(q.outcomes[0].pending!.question).toContain("등록할까요?");
    expect(tables.tasks).toHaveLength(0);
    const tampered = JSON.parse(JSON.stringify(q.outcomes[0].pending));
    tampered.draft.enteredBy = "가짜";
    await continuePendingInput(tampered, "네", { staffName: "서도영" });
    expect(tables.tasks).toHaveLength(1);
    expect(tables.tasks[0]).toMatchObject({ staff_notion_ids: ["staff-minji"], time_text: "20:00" });
    expect(tables.tasks[0].source_payload.workflow.createdBy).toBe("서도영");

    parseUnifiedInput.mockResolvedValueOnce([intent({ intentClass: "action", route: "schedule", scheduleType: "재시", students: ["김민수"] })]);
    const q2 = await runUnifiedNlInput("김민수 내일 재시험", { staffName: "서도영", staffId: "staff-seo" });
    expect(q2.outcomes[0].pending!.question).toContain("재시 일정");
    const no = await continuePendingInput(JSON.parse(JSON.stringify(q2.outcomes[0].pending)), "아니요", { staffName: "서도영" });
    expect(no.outcomes[0].message).toBe("등록하지 않았습니다.");
  });

  it("명시 동사가 있으면 확인 없이 바로 업무 생성('워크북 10부 출력해줘')", async () => {
    parseUnifiedInput.mockResolvedValueOnce([intent({ intentClass: "action", route: "task", taskType: "출력", instruction: "워크북 10부 출력", quantity: 10 })]);
    const { runUnifiedNlInput } = await import("@/lib/nl-input");
    const res = await runUnifiedNlInput("워크북 10부 출력해줘", { staffName: "서도영", staffId: "staff-seo" });
    expect(res.outcomes[0]).toMatchObject({ route: "task", status: "완료" });
    expect(tables.tasks).toHaveLength(1);
  });

  it("지속관리 근거가 있으면 조치사항, 상담 의미가 있으면 상담 기록은 guard를 통과한다", async () => {
    const { enforceIntentBoundaries } = await import("@/lib/nl-input");
    const [a] = enforceIntentBoundaries([intent({ intentClass: "action", route: "student_action", students: ["김민수"] })], "김민수 당분간 단어시험 매일 체크");
    expect(a.route).toBe("student_action");
    const [b] = enforceIntentBoundaries([intent({ intentClass: "record", route: "counseling", students: ["김민수"] })], "김민수 어머니와 단어시험 관련 상담함");
    expect(b.route).toBe("counseling");
    const [c] = enforceIntentBoundaries([intent({ intentClass: "special", route: "admin_inbox", inboxType: "결석예정", students: ["김민수"] })], "김민수 내일 결석");
    expect(c.route).toBe("admin_inbox");
    const [d] = enforceIntentBoundaries([intent({ intentClass: "special", route: "admin_inbox", inboxType: "긴급상담요청", students: ["김민수"] })], "김민수 성적 급하게 상담 필요");
    expect(d.route).toBe("admin_inbox");
  });

  it("원문 신호 판정(특정 문장이 아닌 의미 신호)", async () => {
    const { writeGuardSignals, EXPLICIT_NEW_STUDENT } = await import("@/lib/nl-input");
    for (const t of ["방금 넣은 거 지워줘", "아까 입력한 불규칙 기록 삭제", "2번 잘못 넣었어", "민수가 아니라 민지야", "25쪽 말고 27쪽"]) expect(writeGuardSignals(t).correction).toBe(true);
    for (const t of ["김민수 단어시험 84점", "워크북 22~25쪽 과제", "김민수 과제 취소하고 보강 잡아줘"]) expect(writeGuardSignals(t).correction).toBe(false);
    for (const t of ["오늘 입력한 내용 보여줘", "오늘 일정 알려줘", "어제 뭐 입력했지", "김민수 최근 기록"]) expect(writeGuardSignals(t).query).toBe(true);
    for (const t of ["김민수 재시험 시켜줘", "민지에게 출력 맡겨", "학부모께 전화해줘"]) expect(writeGuardSignals(t).action).toBe(true);
    expect(writeGuardSignals("오늘 일정 보여줘").action).toBe(false);
    expect(EXPLICIT_NEW_STUDENT.test("이태경 불규칙동사 테스트")).toBe(false);
    expect(EXPLICIT_NEW_STUDENT.test("이태경 입학 상담 잡아줘")).toBe(true);
  });
});

describe("hotfix: student_learning_records INSERT payload = 006 스키마(notion_id 없음)", () => {
  it("fake DB 스키마는 006 파일에서 읽은 컬럼이고 notion_id가 없다", () => {
    expect(SLR_COLUMNS.has("notion_id")).toBe(false);
    for (const c of ["branch_id", "student_id", "student_notion_ids", "class_id", "class_notion_ids", "input_hash", "source_payload"]) expect(SLR_COLUMNS.has(c)).toBe(true);
  });

  it("'이태경 불규칙동사 테스트 84점' 저장 시 실제 INSERT key는 006 컬럼만, notion_id 없음", async () => {
    tables.students.push({ id: "stu-lee", notion_id: "stu-lee", branch_id: B, name: "이태경", school: "부산고", grade: "고2", status: "재원", class_notion_ids: ["cls-isabel-a"] });
    tables.classes[0].student_notion_ids.push("stu-lee");
    parseUnifiedInput.mockResolvedValueOnce([
      intent({ intentClass: "record", route: "student_record", students: ["이태경"], recordType: "vocab", assessmentName: "불규칙동사 테스트", score: 84 }),
    ]);
    const { runUnifiedNlInput } = await import("@/lib/nl-input");
    const res = await runUnifiedNlInput("이태경 불규칙동사 테스트 84점", { staffName: "서도영", staffId: "staff-seo" });
    expect(res.ok).toBe(true);
    expect(slrPosts).toHaveLength(1);
    const keys = Object.keys(slrPosts[0]).sort();
    expect(keys).toEqual(
      [
        "branch_id", "student_id", "student_notion_ids", "class_id", "class_notion_ids", "class_progress_id",
        "record_date", "period", "record_type", "assessment_name", "score", "max_score", "passed",
        "retest_required", "completed", "note", "follow_up", "entered_by", "raw_text", "input_hash", "source_payload",
      ].sort()
    );
    expect(keys).not.toContain("notion_id");
    expect(keys.every((k) => SLR_COLUMNS.has(k))).toBe(true);
    expect(slrPosts[0]).toMatchObject({ branch_id: B, student_notion_ids: ["stu-lee"], class_notion_ids: ["cls-isabel-a"], record_type: "vocab", score: 84, entered_by: "서도영" });
  });

  it("다른 테이블 INSERT는 기존처럼 notion_id: null을 유지한다(Notion 미러 테이블 동작 불변)", async () => {
    const { pgInsertPayload } = await import("@/lib/supabaseRepo");
    expect(pgInsertPayload("TODO", "b1", { title: "x" })).toEqual({ branch_id: "b1", notion_id: null, title: "x" });
    expect(pgInsertPayload("CLASS_PROGRESS", "b1", {})).toHaveProperty("notion_id", null);
    expect(pgInsertPayload("STUDENT_LEARNING_RECORD", "b1", { score: 1 })).toEqual({ branch_id: "b1", score: 1 });
  });

  it("학생 기록 PATCH(수정·취소·업무 연결)도 006 컬럼만 쓴다", async () => {
    tables.students.push({ id: "stu-lee", notion_id: "stu-lee", branch_id: B, name: "이태경", school: "부산고", grade: "고2", status: "재원", class_notion_ids: ["cls-isabel-a"] });
    tables.classes[0].student_notion_ids.push("stu-lee");
    await seedRecord("고2 이사벨A 이태경 불규칙 84점 확인해줘", { students: ["이태경"], recordType: "vocab", score: 84, passed: false, actionRequested: true, taskType: "단어재시" });
    expect(tables.student_learning_records[0].task_id).toBe(tables.tasks[0].id);
    const q = await say("이태경 84점 아니고 94점", { intentClass: "correction", route: "correction", correctionTarget: "student_record", operation: "modify", students: ["이태경"], oldScore: 84, newScore: 94, newPassed: true });
    // 통과로 바뀌어 열린 연결 업무 처리 여부를 먼저 묻는다
    const { continuePendingInput } = await import("@/lib/nl-input");
    await continuePendingInput(JSON.parse(JSON.stringify(q.outcomes[0].pending)), "업무도 취소", { staffName: "서도영" });
    expect(tables.student_learning_records[0].score).toBe(94);
    expect(tables.tasks[0]).toMatchObject({ complete: true, outcome: "취소" });
    await say("이태경 불규칙 기록 취소", { intentClass: "correction", route: "correction", correctionTarget: "student_record", operation: "cancel", students: ["이태경"] });
    expect(tables.student_learning_records[0].source_payload.cancelled).toBeTruthy();
  });
});
