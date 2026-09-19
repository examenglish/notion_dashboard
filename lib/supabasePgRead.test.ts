// displayId()가 legacy notion_id와 postgres-primary native uuid를 올바르게
// 구분하고, pgGetStudent가 실제로 두 식별자 중 뭘 받아도 자기 지점 행만
// 찾는지 검증한다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { displayId } from "./supabasePgRead";

type Row = Record<string, unknown> & { id: string; notion_id: string | null; branch_id: string };

function parseClause(clause: string, row: Row): boolean {
  const m = clause.match(/^([a-z_]+)\.eq\.(.*)$/);
  if (!m) throw new Error(`fake-fetch: unsupported clause "${clause}"`);
  const [, col, rawVal] = m;
  const decoded = decodeURIComponent(rawVal);
  // PostgREST의 eq.true/eq.false는 실제 컬럼이 boolean이면 boolean으로
  // 비교돼야 한다 — 문자열 "false"와 boolean false는 다른 값이라 그냥
  // 문자열 비교만 하면 boolean 컬럼(complete/pool/director_ack/urgent 등)
  // 필터가 전부 실패한다.
  if (decoded === "true" || decoded === "false") {
    return row[col] === (decoded === "true");
  }
  return row[col] === decoded;
}

function makeFakeFetch(tables: Record<string, Row[]>) {
  return vi.fn(async (url: string) => {
    const u = new URL(url);
    const table = u.pathname.replace("/rest/v1/", "");
    if (table === "branches") {
      const code = u.searchParams.get("code")?.replace(/^eq\./, "");
      const id = code === "sajik" ? "branch-sajik" : code === "geumjeong" ? "branch-geumjeong" : null;
      return new Response(JSON.stringify(id ? [{ id }] : []), { status: 200 });
    }
    const rows = tables[table] ?? [];
    const predicates: ((row: Row) => boolean)[] = [];
    for (const [key, value] of u.searchParams.entries()) {
      if (key === "select") continue;
      if (key === "or") {
        const inner = value.replace(/^\(/, "").replace(/\)$/, "");
        const clauses = inner.split(",").map((c) => (row: Row) => parseClause(c, row));
        predicates.push((row) => clauses.some((c) => c(row)));
        continue;
      }
      predicates.push((row) => parseClause(`${key}.${value}`, row));
    }
    const matched = rows.filter((r) => predicates.every((p) => p(r)));
    return new Response(JSON.stringify(matched), { status: 200 });
  });
}

describe("displayId", () => {
  it("prefers notion_id when present (legacy migrated row)", () => {
    expect(displayId({ id: "pg-1", notion_id: "notion-abc" })).toBe("notion-abc");
  });

  it("falls back to postgres id when notion_id is null (postgres-primary create, mirror not done yet)", () => {
    expect(displayId({ id: "pg-2", notion_id: null })).toBe("pg-2");
  });
});

describe("pgGetStudent dual-id lookup", () => {
  let tables: Record<string, Row[]>;

  beforeEach(() => {
    tables = {
      students: [
        { id: "pg-student-1", notion_id: "notion-student-1", branch_id: "branch-sajik", name: "기존학생" },
        { id: "pg-student-2", notion_id: null, branch_id: "branch-sajik", name: "신규학생" },
        { id: "pg-student-2", notion_id: "notion-geumjeong", branch_id: "branch-geumjeong", name: "금정-동일id" },
      ],
      daily_records: [],
      exam_scores: [],
      classes: [],
    };
    vi.stubGlobal("fetch", makeFakeFetch(tables));
    process.env.SUPABASE_URL = "https://fake.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-key";
    process.env.ACADEMY_BRANCH_ID = "sajik";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.ACADEMY_BRANCH_ID;
  });

  it("finds a native-uuid row (notion_id still null) by its own id", async () => {
    vi.resetModules();
    const { pgGetStudent } = await import("./supabasePgRead");
    const row = await pgGetStudent("pg-student-2");
    expect(row?.name).toBe("신규학생");
    expect(row?.id).toBe("pg-student-2"); // displayId falls back correctly
  });

  it("never leaks another branch's row even when the id string collides", async () => {
    vi.resetModules();
    process.env.ACADEMY_BRANCH_ID = "sajik";
    const { pgGetStudent } = await import("./supabasePgRead");
    const row = await pgGetStudent("pg-student-2");
    expect(row?.name).not.toBe("금정-동일id");
  });

  it("still resolves legacy notion_id normally", async () => {
    vi.resetModules();
    const { pgGetStudent } = await import("./supabasePgRead");
    const row = await pgGetStudent("notion-student-1");
    expect(row?.name).toBe("기존학생");
  });

  it("returns null for an id that doesn't exist in this branch", async () => {
    vi.resetModules();
    const { pgGetStudent } = await import("./supabasePgRead");
    const row = await pgGetStudent("no-such-id");
    expect(row).toBeNull();
  });
});

describe("pgListNlRosterStudents — nl-roster 2.7초 병목 회귀 방지 (staff.md PART 8)", () => {
  let tables: Record<string, Row[]>;

  beforeEach(() => {
    tables = {
      students: [
        { id: "pg-s1", notion_id: "notion-s1", branch_id: "branch-sajik", name: "김정우", school: "천재중", grade: null, status: "재원", class_notion_ids: ["c-1"] },
        { id: "pg-s2", notion_id: "notion-s2", branch_id: "branch-geumjeong", name: "금정학생", school: "금정중", grade: null, status: "재원", class_notion_ids: [] },
      ],
      // 존재는 하지만(실측으로 확인된 실제 원인 테이블) 절대 조회되면 안 된다 —
      // pgSearchStudents(화면용, 출석률/최근성적 계산)와 달리 nl-roster는
      // 이름/학교/학년/상태/반만 있으면 되므로 이 두 테이블 전체스캔이 필요 없다.
      daily_records: [{ id: "dr-1", notion_id: null, branch_id: "branch-sajik" }],
      exam_scores: [{ id: "es-1", notion_id: null, branch_id: "branch-sajik" }],
      classes: [{ id: "c-1", branch_id: "branch-sajik", notion_id: "c-1", name: "영어2" }],
    };
    process.env.SUPABASE_URL = "https://fake.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-key";
    process.env.ACADEMY_BRANCH_ID = "sajik";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.ACADEMY_BRANCH_ID;
  });

  it("daily_records/exam_scores를 전혀 조회하지 않는다(2.7초 병목의 실제 원인)", async () => {
    const fetchMock = makeFakeFetch(tables);
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
    const { pgListNlRosterStudents } = await import("./supabasePgRead");

    await pgListNlRosterStudents();

    const heavyCalls = fetchMock.mock.calls.filter(([u]) => {
      const path = new URL(u as string).pathname;
      return path.includes("daily_records") || path.includes("exam_scores");
    });
    expect(heavyCalls).toHaveLength(0);
  });

  it("branch로 스코프돼 다른 지점 학생이 섞이지 않는다", async () => {
    vi.stubGlobal("fetch", makeFakeFetch(tables));
    vi.resetModules();
    const { pgListNlRosterStudents } = await import("./supabasePgRead");

    const rows = await pgListNlRosterStudents();

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("김정우");
  });

  it("legacy notion_id를 표시 id로 우선 사용한다(displayId와 동일 규약)", async () => {
    vi.stubGlobal("fetch", makeFakeFetch(tables));
    vi.resetModules();
    const { pgListNlRosterStudents } = await import("./supabasePgRead");

    const rows = await pgListNlRosterStudents();
    expect(rows[0].id).toBe("notion-s1");
  });
});

describe("pgListMyTasks/pgListPoolTasks/pgListReviewInbox — AI 업무 유형 필터 버그 수정 (staff.md PART 10)", () => {
  let tables: Record<string, Row[]>;

  beforeEach(() => {
    tables = {
      tasks: [
        // AI 업무운영 시스템이 만든 업무(13종 중 하나, 이번에 postgres-primary로
        // 전환됨) — "내 업무"/"공용업무"/"검토함"에 반드시 보여야 한다.
        { id: "pg-t1", notion_id: null, branch_id: "branch-sajik", type: "암기확인", complete: false, pool: false, staff_notion_ids: ["staff-1"], student_notion_ids: [], director_ack: false, outcome: null, urgent: false },
        // 기존 "일정"류(보강) — 대시보드 "오늘의 일정"에 이미 따로 나오므로
        // "내 업무"에는 섞이면 안 된다.
        { id: "pg-t2", notion_id: "notion-t2", branch_id: "branch-sajik", type: "보강", complete: false, pool: false, staff_notion_ids: ["staff-1"], student_notion_ids: [], director_ack: false, outcome: null, urgent: false },
        // 공용업무풀 — 담당자 미배정 AI 업무.
        { id: "pg-t3", notion_id: null, branch_id: "branch-sajik", type: "출력", complete: false, pool: true, staff_notion_ids: [], student_notion_ids: [], director_ack: false, outcome: null, urgent: false },
        // 완료됐지만 원장 미확인 + REVIEW 등급(부분통과) — 검토함에 떠야 한다.
        { id: "pg-t4", notion_id: null, branch_id: "branch-sajik", type: "암기확인", complete: true, pool: false, staff_notion_ids: ["staff-1"], student_notion_ids: [], director_ack: false, outcome: "부분통과", urgent: false },
      ],
    };
    process.env.SUPABASE_URL = "https://fake.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-key";
    process.env.ACADEMY_BRANCH_ID = "sajik";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.ACADEMY_BRANCH_ID;
  });

  it("pgListMyTasks: AI 업무(암기확인)는 포함하고 일정류(보강)는 제외한다", async () => {
    vi.stubGlobal("fetch", makeFakeFetch(tables));
    vi.resetModules();
    const { pgListMyTasks } = await import("./supabasePgRead");

    const rows = await pgListMyTasks("staff-1", new Map(), new Map());

    expect(rows.map((r) => r.typeLabel)).toEqual(["암기확인"]);
  });

  it("pgListMyTasks: notion_id가 아직 없는 postgres-primary 업무도 id가 null이 아니다(displayId 폴백)", async () => {
    vi.stubGlobal("fetch", makeFakeFetch(tables));
    vi.resetModules();
    const { pgListMyTasks } = await import("./supabasePgRead");

    const rows = await pgListMyTasks("staff-1", new Map(), new Map());

    expect(rows[0].id).toBe("pg-t1"); // notion_id: null -> postgres id로 폴백
  });

  it("pgListPoolTasks: 담당자 없는 AI 업무만 뜬다", async () => {
    vi.stubGlobal("fetch", makeFakeFetch(tables));
    vi.resetModules();
    const { pgListPoolTasks } = await import("./supabasePgRead");

    const rows = await pgListPoolTasks(new Map(), new Map());

    expect(rows).toHaveLength(1);
    expect(rows[0].typeLabel).toBe("출력");
  });

  it("pgListReviewInbox: 완료+원장미확인+REVIEW등급인 업무만 뜬다", async () => {
    vi.stubGlobal("fetch", makeFakeFetch(tables));
    vi.resetModules();
    const { pgListReviewInbox } = await import("./supabasePgRead");

    const rows = await pgListReviewInbox(new Map(), new Map());

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("pg-t4");
  });
});
