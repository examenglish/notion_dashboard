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
  return row[col] === decodeURIComponent(rawVal);
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
