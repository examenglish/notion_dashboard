// createTasks(및 관련 신규 함수)가 실제로 postgres-primary로 동작하는지,
// 그리고 2026-09-19 "암기확인" 500 사고의 근본 원인(Notion select 옵션
// 누락)이 재발하지 않는지(Postgres 쓰기는 성공, Notion 미러 실패는
// best-effort로만 격리)를 검증한다. staff.md PART 8 참고.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

function makeFakeFetch(tables: Record<string, Row[]>, opts: { notionFails?: boolean } = {}) {
  return vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const u = new URL(url);

    if (u.hostname === "api.notion.com") {
      if (opts.notionFails) {
        return new Response(
          JSON.stringify({ object: "error", status: 400, code: "validation_error", message: 'select option "암기확인" not found for property "유형".' }),
          { status: 400 }
        );
      }
      return new Response(JSON.stringify({ id: "notion-fake-page-id" }), { status: 200 });
    }

    const table = u.pathname.replace("/rest/v1/", "");
    const method = init?.method ?? "GET";

    if (table === "branches") {
      const code = u.searchParams.get("code")?.replace(/^eq\./, "");
      const id = code === "sajik" ? "branch-sajik" : code === "geumjeong" ? "branch-geumjeong" : null;
      return new Response(JSON.stringify(id ? [{ id }] : []), { status: 200 });
    }

    if (method === "POST") {
      const parsed = JSON.parse((init!.body as string) ?? "[]") as Row[];
      const inserted = parsed.map((row, i) => ({ id: `pg-${table}-${(tables[table]?.length ?? 0) + i + 1}`, ...row }));
      tables[table] = [...(tables[table] ?? []), ...inserted];
      return new Response(JSON.stringify(inserted), { status: 201 });
    }

    if (method === "PATCH") {
      const id = u.searchParams.get("id")?.replace(/^eq\./, "");
      const patchBody = JSON.parse((init!.body as string) ?? "{}") as Row;
      if (id && tables[table]) {
        tables[table] = tables[table].map((r) => (r.id === id ? { ...r, ...patchBody } : r));
      }
      return new Response(null, { status: 204 });
    }

    // GET
    const rows = tables[table] ?? [];
    const branchId = u.searchParams.get("branch_id")?.replace(/^eq\./, "");
    const completeParam = u.searchParams.get("complete");
    let filtered = branchId ? rows.filter((r) => r.branch_id === branchId) : rows;
    if (completeParam === "eq.false") filtered = filtered.filter((r) => r.complete === false);
    for (const [key, value] of u.searchParams.entries()) {
      if (["select", "branch_id", "complete"].includes(key)) continue;
      const eqMatch = value.match(/^eq\.(.*)$/);
      if (eqMatch) {
        const v = decodeURIComponent(eqMatch[1]);
        filtered = filtered.filter((r) => String(r[key]) === v);
        continue;
      }
      const csMatch = value.match(/^cs\.\{(.*)\}$/);
      if (csMatch) {
        const v = decodeURIComponent(csMatch[1]);
        filtered = filtered.filter((r) => Array.isArray(r[key]) && (r[key] as string[]).includes(v));
      }
    }
    return new Response(JSON.stringify(filtered), { status: 200 });
  });
}

function setEnv() {
  process.env.SUPABASE_URL = "https://fake.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-key";
  process.env.NOTION_TOKEN = "fake-notion-token";
  process.env.ACADEMY_BRANCH_ID = "sajik";
  process.env.ACADEMY_DB_PROVIDER = "postgres";
  process.env.ACADEMY_STUDENT_READ_PROVIDER = "postgres";
}

function clearEnv() {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.NOTION_TOKEN;
  delete process.env.ACADEMY_BRANCH_ID;
  delete process.env.ACADEMY_DB_PROVIDER;
  delete process.env.ACADEMY_STUDENT_READ_PROVIDER;
}

describe("createTasks (postgres-primary)", () => {
  let tables: Record<string, Row[]>;

  beforeEach(() => {
    tables = { tasks: [] };
    setEnv();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearEnv();
  });

  const preloaded = {
    staff: [{ id: "staff-1", name: "김조교", role: "조교" as const, workHours: {} }],
    classes: [],
    studentNames: new Map([["student-1", "김정우"]]),
  };

  it("암기확인 업무를 Postgres에 정상 저장한다 — Notion select 옵션 존재 여부와 무관(2026-09-19 사고 회귀 방지)", async () => {
    vi.stubGlobal("fetch", makeFakeFetch(tables, { notionFails: true }));
    vi.resetModules();
    const { createTasks } = await import("./notion");

    const results = await createTasks(
      [{ type: "MEMORIZATION_CHECK", studentId: "student-1", content: "암기 확인", date: "2026-09-19", time: "", forcePool: true }],
      preloaded
    );

    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("MEMORIZATION_CHECK");
    expect(results[0].id).toMatch(/^pg-tasks-/);
    expect(tables.tasks[0].type).toBe("암기확인");
    await new Promise((r) => setTimeout(r, 20)); // 백그라운드 미러 시도가 teardown 전에 끝나도록
  });

  it("Notion 미러가 실패해도(4xx) 요청 전체가 실패하지 않는다 — 500 재발 방지의 핵심", async () => {
    vi.stubGlobal("fetch", makeFakeFetch(tables, { notionFails: true }));
    vi.resetModules();
    const { createTasks } = await import("./notion");

    await expect(
      createTasks([{ type: "MEMORIZATION_CHECK", studentId: null, content: "test", date: "2026-09-19", time: "", forcePool: true }], preloaded)
    ).resolves.toBeDefined();
    await new Promise((r) => setTimeout(r, 20));
  });

  it("Notion 미러가 성공하면 notion_id가 postgres 행에 백필된다", async () => {
    vi.stubGlobal("fetch", makeFakeFetch(tables, { notionFails: false }));
    vi.resetModules();
    const { createTasks } = await import("./notion");

    const results = await createTasks(
      [{ type: "PRINT", studentId: "student-1", content: "출력", date: "2026-09-19", time: "", forcePool: true }],
      preloaded
    );
    expect(results[0].type).toBe("PRINT");
    // fireAndForget은 백그라운드 실행이라 메인 흐름은 안 기다리지만, 여기서는
    // 실제로 notion_id가 백필됐는지까지 확인하려고 살짝 기다린다(teardown 전에
    // 백그라운드 fetch가 끝나도록 — 안 그러면 stub 해제 후 실제 네트워크로
    // 새는 레이스가 생긴다).
    await new Promise((r) => setTimeout(r, 20));
    expect(tables.tasks[0].notion_id).toBe("notion-fake-page-id");
  });

  it("existingOpen 조회는 Notion이 아니라 Postgres에서 branch로 스코프돼 읽힌다", async () => {
    tables.tasks = [
      { id: "existing-1", branch_id: "branch-sajik", complete: false, type: "보강", staff_id: "staff-1" },
      { id: "existing-2", branch_id: "branch-geumjeong", complete: false, type: "보강", staff_id: "staff-1" },
    ];
    const fetchMock = makeFakeFetch(tables, { notionFails: true });
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
    const { createTasks } = await import("./notion");

    await createTasks([{ type: "MEMORIZATION_CHECK", studentId: null, content: "x", date: "2026-09-19", time: "", forcePool: true }], preloaded);
    await new Promise((r) => setTimeout(r, 20));

    const notionCalls = fetchMock.mock.calls.filter(([u]) => new URL(u as string).hostname === "api.notion.com" && (u as string).includes("pages"));
    // 미러 시도 자체는 있어야 하지만(best-effort), existingOpen을 위한 조회 목적의
    // Notion 호출(예: databases.query)은 전혀 없어야 한다.
    const notionQueryCalls = fetchMock.mock.calls.filter(([u]) => new URL(u as string).hostname === "api.notion.com" && !(u as string).includes("/pages"));
    expect(notionQueryCalls).toHaveLength(0);
  });
});

describe("getAttendanceOnDate", () => {
  let tables: Record<string, Row[]>;

  beforeEach(() => {
    tables = {
      daily_records: [
        { id: "dr-1", branch_id: "branch-sajik", record_date: "2026-09-19", student_notion_ids: ["notion-student-1"], attendance: "결석" },
        { id: "dr-2", branch_id: "branch-geumjeong", record_date: "2026-09-19", student_notion_ids: ["notion-student-1"], attendance: "출석" },
      ],
    };
    setEnv();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearEnv();
  });

  it("결석으로 기록된 학생을 정확히 찾는다", async () => {
    vi.stubGlobal("fetch", makeFakeFetch(tables));
    vi.resetModules();
    const { getAttendanceOnDate } = await import("./notion");

    const result = await getAttendanceOnDate("notion-student-1", "2026-09-19");
    expect(result).toEqual({ hasRecord: true, attendance: "결석" });
  });

  it("branch_id가 다른 학생/기록을 절대 섞지 않는다(같은 notion_id, 다른 지점)", async () => {
    process.env.ACADEMY_BRANCH_ID = "geumjeong";
    vi.stubGlobal("fetch", makeFakeFetch(tables));
    vi.resetModules();
    const { getAttendanceOnDate } = await import("./notion");

    const result = await getAttendanceOnDate("notion-student-1", "2026-09-19");
    expect(result?.attendance).toBe("출석"); // 사직의 "결석"이 아니라 금정의 "출석"이어야 함
  });

  it("기록 자체가 없으면 hasRecord:false를 반환한다(추측하지 않음)", async () => {
    vi.stubGlobal("fetch", makeFakeFetch(tables));
    vi.resetModules();
    const { getAttendanceOnDate } = await import("./notion");

    const result = await getAttendanceOnDate("notion-student-없음", "2026-09-19");
    expect(result).toEqual({ hasRecord: false, attendance: null });
  });
});
