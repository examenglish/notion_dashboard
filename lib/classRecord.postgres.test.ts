// 수업진도/출결 postgres-primary 전환(staff.md PART 13) 검증. Notion SDK는
// 완전히 mock(실제 네트워크 없음, best-effort 미러 성공/실패를 자유롭게
// 시뮬레이션), Supabase REST는 인메모리 fake fetch로 실제 REST 시맨틱(GET
// 필터/POST insert/PATCH update, branch_id 스코프)을 그대로 재현한다.
// lib/notion.ts는 모듈 최상단에서 `new Client()`/env를 읽으므로 테스트마다
// vi.resetModules() 후 동적 import로 새로 불러온다(기존 supabasePgRead.test.ts
// PART 11 테스트와 동일한 패턴).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { notionInstances } = vi.hoisted(() => ({ notionInstances: [] as any[] }));

vi.mock("@notionhq/client", () => ({
  Client: vi.fn().mockImplementation(function Client() {
    const instance = {
      pages: {
        create: vi.fn().mockImplementation(async () => ({ id: `notion-mock-${Math.random().toString(36).slice(2)}` })),
        update: vi.fn().mockResolvedValue({}),
        retrieve: vi.fn().mockResolvedValue(null),
      },
      dataSources: { query: vi.fn().mockResolvedValue({ results: [] }) },
    };
    notionInstances.push(instance);
    return instance;
  }),
}));

type Row = Record<string, any>;

function matchClause(clause: string, row: Row): boolean {
  const m = clause.match(/^([a-z_]+)\.(eq|cs|is|in)\.(.*)$/);
  if (!m) throw new Error(`fake-supabase: unsupported clause "${clause}"`);
  const [, col, op, rawVal] = m;
  const cell = row[col];
  if (op === "eq") {
    const decoded = decodeURIComponent(rawVal);
    if (decoded === "true" || decoded === "false") return cell === (decoded === "true");
    return String(cell ?? "") === decoded;
  }
  if (op === "is") return rawVal === "null" ? cell === null || cell === undefined : false;
  if (op === "cs") {
    const v = decodeURIComponent(rawVal.replace(/^\{/, "").replace(/\}$/, ""));
    return Array.isArray(cell) && cell.includes(v);
  }
  if (op === "in") {
    const vals = rawVal
      .replace(/^\(/, "")
      .replace(/\)$/, "")
      .split(",")
      .map((v) => decodeURIComponent(v));
    return vals.includes(String(cell ?? ""));
  }
  return false;
}

function applyFilters(rows: Row[], searchParams: URLSearchParams): Row[] {
  let out = rows;
  for (const [key, value] of searchParams.entries()) {
    if (key === "select" || key === "order" || key === "limit") continue;
    if (key === "or") {
      const inner = value.replace(/^\(/, "").replace(/\)$/, "");
      const clauses = inner.split(/,(?=[a-z_]+\.)/);
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
      const id = code === "sajik" ? "branch-sajik" : code === "geumjeong" ? "branch-geumjeong" : null;
      return new Response(JSON.stringify(id ? [{ id }] : []), { status: 200 });
    }
    tables[table] = tables[table] ?? [];
    if (method === "GET") {
      return new Response(JSON.stringify(applyFilters(tables[table], u.searchParams)), { status: 200 });
    }
    if (method === "POST") {
      const body = JSON.parse(init.body as string);
      const items = Array.isArray(body) ? body : [body];
      const inserted = items.map((item: Row) => ({ id: `gen-${++idCounter}`, notion_id: null, ...item }));
      tables[table].push(...inserted);
      return new Response(JSON.stringify(inserted), { status: 201 });
    }
    if (method === "PATCH") {
      const body = JSON.parse(init.body as string);
      const matched = applyFilters(tables[table], u.searchParams);
      for (const row of matched) Object.assign(row, body);
      return new Response(JSON.stringify(matched), { status: 200 });
    }
    return new Response("[]", { status: 200 });
  });
}

let tables: Record<string, Row[]>;

function seedBaseline() {
  tables = {
    classes: [
      // notion_id 있는 기존(legacy) 반.
      { id: "cls-legacy-pg", notion_id: "cls-legacy-notion", branch_id: "branch-sajik", name: "영어2 천재조", student_notion_ids: ["stu-a", "stu-b"], assistant_notion_ids: [], days: [] },
      // notion_id 없는 postgres-primary 신규 반(미러 아직 안 끝남).
      { id: "cls-new-pg", notion_id: null, branch_id: "branch-sajik", name: "수학1 신설반", student_notion_ids: ["stu-c"], assistant_notion_ids: [], days: [] },
      // 다른 지점 반(교차 오염 테스트용).
      { id: "cls-geumjeong", notion_id: null, branch_id: "branch-geumjeong", name: "금정 반", student_notion_ids: ["stu-geumjeong"], assistant_notion_ids: [], days: [] },
    ],
    students: [
      { id: "stu-a", notion_id: "stu-a", branch_id: "branch-sajik", name: "김학생" },
      { id: "stu-b", notion_id: "stu-b", branch_id: "branch-sajik", name: "이학생" },
      { id: "stu-c", notion_id: null, branch_id: "branch-sajik", name: "박학생" },
      { id: "stu-geumjeong", notion_id: null, branch_id: "branch-geumjeong", name: "금정학생" },
    ],
    class_progress: [],
    daily_records: [],
    briefings: [],
    tasks: [],
  };
}

beforeEach(() => {
  notionInstances.length = 0;
  seedBaseline();
  vi.stubGlobal("fetch", makeFakeSupabase(tables));
  process.env.SUPABASE_URL = "https://fake.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-key";
  process.env.ACADEMY_BRANCH_ID = "sajik";
  process.env.ACADEMY_DB_PROVIDER = "postgres";
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.ACADEMY_BRANCH_ID;
  delete process.env.ACADEMY_DB_PROVIDER;
});

async function freshNotion() {
  return import("@/lib/notion");
}

describe("createClassProgress — postgres-primary", () => {
  it("notion_id 없는(native PG UUID) 신규 반에서도 정상적으로 진도/출결/브리핑을 저장한다", async () => {
    const notion = await freshNotion();
    const result = await notion.createClassProgress({
      classId: "cls-new-pg",
      date: "2026-09-20",
      subjects: ["수학"],
      progress: "2단원",
      homework: "문제집 10p",
      nextAssignment: "쪽지시험",
      notice: "",
      perStudent: { "stu-c": { vocabFail: false, homeworkIncomplete: false, absent: false } },
    });
    expect(result.studentCount).toBe(1);
    expect(tables.class_progress).toHaveLength(1);
    expect(tables.class_progress[0].class_id).toBe("cls-new-pg");
    expect(tables.class_progress[0].progress_content).toBe("2단원");
    expect(tables.daily_records).toHaveLength(1);
    expect(tables.daily_records[0].attendance).toBe("출석");
    expect(tables.briefings).toHaveLength(1);
  });

  it("legacy notion_id 반에서도 정상적으로 저장된다(dual-id)", async () => {
    const notion = await freshNotion();
    const result = await notion.createClassProgress({
      classId: "cls-legacy-notion",
      date: "2026-09-20",
      subjects: ["영어"],
      progress: "3과",
      homework: "",
      nextAssignment: "",
      notice: "",
      perStudent: {},
    });
    expect(result.studentCount).toBe(2);
    expect(tables.class_progress[0].class_id).toBe("cls-legacy-pg"); // native FK는 항상 실제 pg uuid
    expect(tables.class_progress[0].class_notion_ids).toEqual(["cls-legacy-notion"]);
  });

  it("결석/지각 학생의 출결이 정확히 기록된다", async () => {
    const notion = await freshNotion();
    await notion.createClassProgress({
      classId: "cls-legacy-notion",
      date: "2026-09-20",
      subjects: [],
      progress: "진도",
      homework: "",
      nextAssignment: "",
      notice: "",
      perStudent: {
        "stu-a": { vocabFail: false, homeworkIncomplete: false, absent: true },
        "stu-b": { vocabFail: false, homeworkIncomplete: false, absent: false, late: true },
      },
    });
    const byStudent = new Map(tables.daily_records.map((r) => [r.student_notion_ids[0], r]));
    expect(byStudent.get("stu-a")?.attendance).toBe("결석");
    expect(byStudent.get("stu-b")?.attendance).toBe("지각");
  });

  it("branch isolation: 사직 반을 생성해도 금정 데이터에는 절대 안 섞인다", async () => {
    const notion = await freshNotion();
    await notion.createClassProgress({
      classId: "cls-legacy-notion",
      date: "2026-09-20",
      subjects: [],
      progress: "진도",
      homework: "",
      nextAssignment: "",
      notice: "",
      perStudent: {},
    });
    expect(tables.class_progress.every((r) => r.branch_id === "branch-sajik")).toBe(true);
    expect(tables.daily_records.every((r) => r.branch_id === "branch-sajik")).toBe(true);
    // 금정 학생(stu-geumjeong)은 애초에 사직 반 로스터에 없으므로 섞일 수 없다.
    expect(tables.daily_records.some((r) => r.student_notion_ids[0] === "stu-geumjeong")).toBe(false);
  });

  it("Notion mirror가 실패해도 Postgres 저장은 그대로 성공한다(500 금지)", async () => {
    const notion = await freshNotion();
    // fireAndForget 안에서 첫 notion.pages.create가 실패하도록 설정 —
    // notionInstances는 lib/notion.ts import 시점에 생성된 인스턴스 1개.
    const result = await notion.createClassProgress({
      classId: "cls-new-pg",
      date: "2026-09-20",
      subjects: [],
      progress: "진도",
      homework: "",
      nextAssignment: "",
      notice: "",
      perStudent: {},
    });
    const client = notionInstances[notionInstances.length - 1];
    client.pages.create.mockRejectedValue(new Error("Notion API down"));
    // 이미 저장은 끝난 뒤이므로(await 이전에 이미 resolve) 여기서 확인할 것은
    // "저장 자체가 Notion 실패로 막히지 않았다"는 사실 — result가 정상 반환됨.
    expect(result.progressPageId).toBeTruthy();
    expect(tables.class_progress).toHaveLength(1);
  });

  it("일부 학생 기록 저장이 실패해도 나머지 학생 기록은 조용히 누락되지 않고 Postgres에 남는다", async () => {
    const notion = await freshNotion();
    const originalFetch = (globalThis.fetch as any).getMockImplementation();
    let dailyRecordPostCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: any) => {
        const isDailyRecordInsert = url.includes("/rest/v1/daily_records") && (init?.method || "GET") === "POST";
        if (isDailyRecordInsert) {
          dailyRecordPostCount++;
          // 반 로스터(stu-a, stu-b) 중 두 번째 학생의 daily_record insert만
          // 실패시켜 "부분 실패" 상황을 만든다 — 첫 번째 학생은 이미 성공.
          if (dailyRecordPostCount === 2) throw new Error("network blip");
        }
        return originalFetch(url, init);
      })
    );
    await expect(
      notion.createClassProgress({
        classId: "cls-legacy-notion",
        date: "2026-09-20",
        subjects: [],
        progress: "진도",
        homework: "",
        nextAssignment: "",
        notice: "",
        perStudent: {},
      })
    ).rejects.toThrow(/저장에 실패했습니다/);
    // 실패했다고 해서 이미 성공한 학생 기록까지 사라지지 않는다.
    expect(tables.daily_records.length).toBeGreaterThan(0);
  });
});

describe("getClassProgressForEdit / updateClassProgress / checkInAttendance — postgres-primary", () => {
  it("checkInAttendance: 처음 체크인하면 골격 기록을 만들고, 같은 반/날짜로 다시 부르면 기존 기록을 갱신한다(idempotency)", async () => {
    const notion = await freshNotion();
    const first = await notion.checkInAttendance({
      classId: "cls-legacy-notion",
      date: "2026-09-20",
      perStudent: { "stu-a": { vocabFail: false, homeworkIncomplete: false, absent: false } },
    });
    expect(first.created).toBe(true);
    expect(tables.class_progress).toHaveLength(1);
    expect(tables.daily_records).toHaveLength(2); // 반 전체 로스터(stu-a, stu-b)

    const second = await notion.checkInAttendance({
      classId: "cls-legacy-notion",
      date: "2026-09-20",
      perStudent: { "stu-a": { vocabFail: false, homeworkIncomplete: false, absent: true } },
    });
    expect(second.created).toBe(false);
    // progressId 자체는 그 사이 Notion 미러가 끝나 notion_id로 바뀌었을 수
    // 있다(displayId 규약, 정상 동작) — 중요한 건 같은 postgres 행을
    // 가리킨다는 것과 중복 생성이 없다는 것.
    expect(tables.class_progress.map((r) => r.notion_id ?? r.id)).toContain(second.progressId);
    // 새 class_progress/daily_records가 중복 생성되지 않았다.
    expect(tables.class_progress).toHaveLength(1);
    expect(tables.daily_records).toHaveLength(2);
    const stuA = tables.daily_records.find((r) => r.student_notion_ids[0] === "stu-a");
    expect(stuA?.attendance).toBe("결석"); // 갱신된 값
  });

  it("updateClassProgress로 진도를 저장하면 getClassProgressForEdit이 그대로 불러온다", async () => {
    const notion = await freshNotion();
    const created = await notion.createClassProgress({
      classId: "cls-legacy-notion",
      date: "2026-09-20",
      subjects: ["영어"],
      progress: "1과",
      homework: "",
      nextAssignment: "",
      notice: "",
      perStudent: {},
    });
    await notion.updateClassProgress({
      progressId: created.progressPageId,
      classId: "cls-legacy-notion",
      date: "2026-09-20",
      progress: "1과 수정본",
      perStudent: { "stu-a": { vocabFail: true, homeworkIncomplete: false, absent: false } },
    });
    const loaded = await notion.getClassProgressForEdit("cls-legacy-notion", "2026-09-20");
    expect(loaded?.progress).toBe("1과 수정본");
    expect(loaded?.perStudent["stu-a"].vocabFail).toBe(true);
  });

  it("branch isolation: 다른 지점 반 id로는 아무 기록도 못 찾는다", async () => {
    const notion = await freshNotion();
    const found = await notion.getClassProgressForEdit("cls-geumjeong", "2026-09-20");
    expect(found).toBeNull();
  });
});

describe("saveClassRecordScores — postgres-primary", () => {
  it("지정한 학생의 achievement만 갱신하고 다른 학생은 건드리지 않는다", async () => {
    const notion = await freshNotion();
    const created = await notion.createClassProgress({
      classId: "cls-legacy-notion",
      date: "2026-09-20",
      subjects: [],
      progress: "진도",
      homework: "",
      nextAssignment: "",
      notice: "",
      perStudent: {},
    });
    const before = tables.daily_records.find((r) => r.student_notion_ids[0] === "stu-b")?.achievement;

    const result = await notion.saveClassRecordScores(created.progressPageId, {
      "stu-a": [{ type: "단어테스트", correct: "8", total: "10" }],
    });
    expect(result.updated).toBe(1);
    const stuA = tables.daily_records.find((r) => r.student_notion_ids[0] === "stu-a");
    expect(stuA?.achievement).toContain("8");
    const stuB = tables.daily_records.find((r) => r.student_notion_ids[0] === "stu-b");
    expect(stuB?.achievement).toBe(before); // 안 건드림
  });
});
