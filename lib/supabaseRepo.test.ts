// pgResolveRelationId/pgGetByNotionId/pgPatchByNotionId가
//  (1) legacy notion_id
//  (2) postgres-primary가 갓 만든 native uuid(notion_id가 아직 null)
// 둘 다 안전하게 찾고, 항상 branch_id로 스코핑돼 다른 지점 행을 절대
// 건드리지 않는지를 검증한다. 실제 Supabase 대신 PostgREST 쿼리 문법의
// 딱 필요한 부분(eq/in/or, branch_id AND 스코프)만 흉내 내는 가짜 fetch를 쓴다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown> & { id: string; notion_id: string | null; branch_id: string };

interface FakeDb {
  branches: { id: string; code: string }[];
  tables: Record<string, Row[]>;
}

// depth-aware split: "a.in.(x,y),b.eq.z" -> ["a.in.(x,y)", "b.eq.z"]
function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur) parts.push(cur);
  return parts;
}

function parseClause(clause: string): (row: Row) => boolean {
  const m = clause.match(/^([a-z_]+)\.(eq|in)\.(.*)$/);
  if (!m) throw new Error(`fake-fetch: unsupported clause "${clause}"`);
  const [, col, op, rawVal] = m;
  if (op === "eq") {
    const val = decodeURIComponent(rawVal);
    return (row) => row[col] === val;
  }
  // in.(a,b,c)
  const inner = rawVal.replace(/^\(/, "").replace(/\)$/, "");
  const values = splitTopLevel(inner).map(decodeURIComponent);
  return (row) => values.includes(row[col] as string);
}

function makeFakeFetch(db: FakeDb) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const table = u.pathname.replace("/rest/v1/", "");
    const params = u.searchParams;

    if (table === "branches") {
      const code = params.get("code")?.replace(/^eq\./, "");
      const found = db.branches.find((b) => b.code === code);
      return new Response(JSON.stringify(found ? [{ id: found.id }] : []), { status: 200 });
    }

    const rows = db.tables[table] ?? [];
    const predicates: ((row: Row) => boolean)[] = [];

    for (const [key, rawValue] of params.entries()) {
      if (key === "select") continue;
      if (key === "or") {
        const inner = rawValue.replace(/^\(/, "").replace(/\)$/, "");
        const clauses = splitTopLevel(inner).map(parseClause);
        predicates.push((row) => clauses.some((c) => c(row)));
        continue;
      }
      predicates.push(parseClause(`${key}.${rawValue}`));
    }

    const matched = rows.filter((row) => predicates.every((p) => p(row)));

    const method = init?.method ?? "GET";
    if (method === "PATCH") {
      const patch = JSON.parse(String(init!.body));
      for (const row of matched) Object.assign(row, patch);
      return new Response(null, { status: 204 });
    }
    if (method === "POST") {
      const body = JSON.parse(String(init!.body)) as Row[];
      const created = body.map((r) => ({ ...r, id: r.id ?? `generated-${Math.random().toString(36).slice(2)}` }));
      db.tables[table] = [...rows, ...created];
      return new Response(JSON.stringify(created), { status: 201 });
    }
    return new Response(JSON.stringify(matched), { status: 200 });
  });
}

function makeFixture(): FakeDb {
  return {
    branches: [
      { id: "branch-sajik", code: "sajik" },
      { id: "branch-geumjeong", code: "geumjeong" },
    ],
    tables: {
      staff: [
        // legacy: 이미 Notion에서 이전된 행 — notion_id로 찾아야 하는 케이스.
        { id: "pg-uuid-1", notion_id: "notion-abc", branch_id: "branch-sajik", name: "사직-기존직원" },
        // postgres-primary로 방금 생성돼 아직 Notion 미러가 안 끝난 행 —
        // notion_id가 null이고 pg uuid로만 찾아야 하는 케이스.
        { id: "pg-uuid-2", notion_id: null, branch_id: "branch-sajik", name: "사직-신규직원" },
        // 다른 지점(geumjeong)에 "pg-uuid-2"와 완전히 같은 id 문자열을 가진
        // 행을 일부러 심어둔다 — branch_id 스코프가 실제로 걸려 있지 않으면
        // 사직 쪽 조회에서 이 행이 잘못 섞여 나올 것이다.
        { id: "pg-uuid-2", notion_id: "notion-geumjeong-only", branch_id: "branch-geumjeong", name: "금정-동일id행" },
      ],
    },
  };
}

async function freshRepo() {
  vi.resetModules();
  return import("./supabaseRepo");
}

describe("supabaseRepo dual-id relation resolution", () => {
  let db: FakeDb;

  beforeEach(() => {
    db = makeFixture();
    vi.stubGlobal("fetch", makeFakeFetch(db));
    process.env.SUPABASE_URL = "https://fake.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.ACADEMY_BRANCH_ID;
    delete process.env.MIGRATION_BRANCH_CODE;
  });

  it("legacy notion_id: resolves via notion_id column", async () => {
    process.env.ACADEMY_BRANCH_ID = "sajik";
    const { pgResolveRelationId } = await freshRepo();
    const id = await pgResolveRelationId("STAFF", "notion-abc");
    expect(id).toBe("pg-uuid-1");
  });

  it("postgres-native uuid: resolves via id column when notion_id is still null", async () => {
    process.env.ACADEMY_BRANCH_ID = "sajik";
    const { pgResolveRelationId } = await freshRepo();
    const id = await pgResolveRelationId("STAFF", "pg-uuid-2");
    expect(id).toBe("pg-uuid-2");
  });

  it("branch isolation: same id string in another branch is never returned", async () => {
    process.env.ACADEMY_BRANCH_ID = "sajik";
    const { pgGetByNotionId } = await freshRepo();
    const row = await pgGetByNotionId("STAFF", "pg-uuid-2");
    expect(row?.name).toBe("사직-신규직원"); // 금정의 동일 id 행("금정-동일id행")이 아니어야 한다
  });

  it("branch isolation: a notion_id that only exists in another branch resolves to null here", async () => {
    process.env.ACADEMY_BRANCH_ID = "sajik";
    const { pgResolveRelationId } = await freshRepo();
    const id = await pgResolveRelationId("STAFF", "notion-geumjeong-only");
    expect(id).toBeNull();
  });

  it("branch isolation: patch by native uuid only touches the row in the caller's own branch", async () => {
    process.env.ACADEMY_BRANCH_ID = "sajik";
    const { pgPatchByNotionId } = await freshRepo();
    await pgPatchByNotionId("STAFF", "pg-uuid-2", { name: "패치됨" });

    const sajikRow = db.tables.staff.find((r) => r.branch_id === "branch-sajik" && r.id === "pg-uuid-2");
    const geumjeongRow = db.tables.staff.find((r) => r.branch_id === "branch-geumjeong" && r.id === "pg-uuid-2");
    expect(sajikRow?.name).toBe("패치됨");
    expect(geumjeongRow?.name).toBe("금정-동일id행"); // 다른 지점 행은 절대 바뀌면 안 된다
  });

  it("geumjeong branch scope only ever sees its own rows even when ids collide with sajik", async () => {
    process.env.ACADEMY_BRANCH_ID = "geumjeong";
    const { pgGetByNotionId } = await freshRepo();
    const row = await pgGetByNotionId("STAFF", "pg-uuid-2");
    expect(row?.name).toBe("금정-동일id행");
  });

  it("unresolvable id (wrong branch, or not found anywhere) returns null without throwing", async () => {
    process.env.ACADEMY_BRANCH_ID = "sajik";
    const { pgResolveRelationId } = await freshRepo();
    const id = await pgResolveRelationId("STAFF", "no-such-id");
    expect(id).toBeNull();
  });
});
