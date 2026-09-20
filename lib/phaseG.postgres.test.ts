// Phase G(운영 안정성, staff.md PART 19) — "새로 생성된 postgres-native
// 데이터가 옛 notion_id를 전제로 한 코드 때문에 열기/로그인이 안 되는"
// 부류의 버그를 다시 전수검사하다 찾은 findStaffByNameAndPin/
// findStudentByName의 dual-id 회귀 방지 테스트.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@notionhq/client", () => ({
  Client: vi.fn().mockImplementation(function Client() {
    return {
      pages: { create: vi.fn(), update: vi.fn(), retrieve: vi.fn().mockResolvedValue(null) },
      dataSources: { query: vi.fn().mockResolvedValue({ results: [] }) },
    };
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
  return false;
}

function applyFilters(rows: Row[], searchParams: URLSearchParams): Row[] {
  let out = rows;
  for (const [key, value] of searchParams.entries()) {
    if (key === "select" || key === "order" || key === "limit") continue;
    out = out.filter((row) => matchClause(`${key}.${value}`, row));
  }
  return out;
}

function makeFakeSupabase(tables: Record<string, Row[]>) {
  return vi.fn(async (url: string) => {
    const u = new URL(url);
    if (u.pathname === "/rest/v1/branches") {
      const code = u.searchParams.get("code")?.replace(/^eq\./, "");
      const id = code === "sajik" ? "branch-sajik" : null;
      return new Response(JSON.stringify(id ? [{ id }] : []), { status: 200 });
    }
    const table = u.pathname.replace("/rest/v1/", "");
    tables[table] = tables[table] ?? [];
    return new Response(JSON.stringify(applyFilters(tables[table], u.searchParams)), { status: 200 });
  });
}

let tables: Record<string, Row[]>;

beforeEach(() => {
  tables = { staff: [], students: [] };
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

describe("findStaffByNameAndPin — dual-id 회귀 방지", () => {
  it("notion_id가 아직 없는(postgres-primary 신규) 직원도 로그인 시 null이 아닌 id를 돌려준다", async () => {
    const { hashPin } = await import("@/lib/pinAuth");
    tables.staff.push({
      id: "pg-staff-new",
      notion_id: null,
      branch_id: "branch-sajik",
      name: "신규조교",
      role: "조교",
      resigned: false,
      pin_hash: await hashPin("1234"),
    });
    const notion = await freshNotion();
    const result = await notion.findStaffByNameAndPin("신규조교", "1234");
    expect(result?.id).toBe("pg-staff-new"); // notion_id 없으면 postgres id로 대체돼야 함(로그인 session.staffId가 null이 되면 안 됨)
  });
});

describe("findStudentByName — dual-id 회귀 방지", () => {
  it("notion_id가 아직 없는 학생도 id가 null이 아니다", async () => {
    tables.students.push({ id: "pg-student-new", notion_id: null, branch_id: "branch-sajik", name: "신규학생" });
    const notion = await freshNotion();
    const result = await notion.findStudentByName("신규학생");
    expect(result?.id).toBe("pg-student-new");
  });

  it("legacy notion_id 학생은 그대로 notion_id를 쓴다", async () => {
    tables.students.push({ id: "pg-student-old", notion_id: "notion-student-old", branch_id: "branch-sajik", name: "기존학생" });
    const notion = await freshNotion();
    const result = await notion.findStudentByName("기존학생");
    expect(result?.id).toBe("notion-student-old");
  });
});
