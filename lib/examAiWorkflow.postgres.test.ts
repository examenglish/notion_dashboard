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
  const m = clause.match(/^([a-z_]+)\.(eq|cs|is|in|gte)\.(.*)$/);
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
      { id: "cls-isabel-a", notion_id: "cls-isabel-a", branch_id: B, name: "고2 이사벨A", student_notion_ids: ["stu-minsu-2b-x"], assistant_notion_ids: [], days: [] },
      { id: "cls-isabel-b", notion_id: "cls-isabel-b", branch_id: B, name: "고2 이사벨B", student_notion_ids: [], assistant_notion_ids: [], days: [] },
      { id: "cls-1a", notion_id: "cls-1a", branch_id: B, name: "고1A", student_notion_ids: ["stu-minsu-1a"], assistant_notion_ids: [], days: [] },
      { id: "cls-2b", notion_id: "cls-2b", branch_id: B, name: "고2B", student_notion_ids: ["stu-minsu-2b"], assistant_notion_ids: [], days: [] },
    ],
    students: [
      { id: "stu-minsu-1a", notion_id: "stu-minsu-1a", branch_id: B, name: "김민수", school: "금정고", grade: "고1", status: "재원", class_notion_ids: ["cls-1a"] },
      { id: "stu-minsu-2b", notion_id: "stu-minsu-2b", branch_id: B, name: "김민수", school: "부산고", grade: "고2", status: "재원", class_notion_ids: ["cls-2b"] },
      { id: "stu-jiho", notion_id: "stu-jiho", branch_id: B, name: "이지호", school: "부산고", grade: "고2", status: "재원", class_notion_ids: ["cls-isabel-a"] },
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
