// findStaffByNameAndPin — Notion 평문 PIN 폴백 제거 검증(staff.md PART 24).
// 원장이 재직 직원 pin_hash 누락 0명을 직접 SQL로 확인한 뒤 지시한 작업 —
// 이제 로그인은 PostgreSQL(staff.pin_hash)만 쓰고, 실패해도 Notion으로
// 다시 시도하지 않는다. Notion SDK 호출이 아예 발생하지 않는지까지 확인한다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { notionCalls } = vi.hoisted(() => ({ notionCalls: [] as string[] }));

vi.mock("@notionhq/client", () => ({
  Client: vi.fn().mockImplementation(function Client() {
    return {
      pages: {
        create: vi.fn().mockImplementation(async () => {
          notionCalls.push("pages.create");
          return { id: "notion-mock" };
        }),
        update: vi.fn().mockImplementation(async () => {
          notionCalls.push("pages.update");
          return {};
        }),
        retrieve: vi.fn().mockImplementation(async () => {
          notionCalls.push("pages.retrieve");
          return null;
        }),
      },
      dataSources: {
        query: vi.fn().mockImplementation(async () => {
          notionCalls.push("dataSources.query");
          return { results: [] };
        }),
      },
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
      const id = code === "sajik" ? "branch-sajik" : code === "geumjeong" ? "branch-geumjeong" : null;
      return new Response(JSON.stringify(id ? [{ id }] : []), { status: 200 });
    }
    const table = u.pathname.replace("/rest/v1/", "");
    tables[table] = tables[table] ?? [];
    return new Response(JSON.stringify(applyFilters(tables[table], u.searchParams)), { status: 200 });
  });
}

let tables: Record<string, Row[]>;

beforeEach(() => {
  notionCalls.length = 0;
  tables = { staff: [] };
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

describe("findStaffByNameAndPin — PostgreSQL 전용, Notion fallback 없음", () => {
  it("정상 PIN 로그인이 된다", async () => {
    const { hashPin } = await import("@/lib/pinAuth");
    tables.staff.push({ id: "pg-staff-1", notion_id: "notion-staff-1", branch_id: "branch-sajik", name: "박선생", role: "조교", resigned: false, pin_hash: await hashPin("1234"), must_change_password: false });
    const notion = await freshNotion();
    const result = await notion.findStaffByNameAndPin("박선생", "1234");
    expect(result?.name).toBe("박선생");
    expect(result?.id).toBe("notion-staff-1");
  });

  it("잘못된 PIN이면 null이고 Notion으로 재시도하지 않는다", async () => {
    const { hashPin } = await import("@/lib/pinAuth");
    tables.staff.push({ id: "pg-staff-1", notion_id: "notion-staff-1", branch_id: "branch-sajik", name: "박선생", role: "조교", resigned: false, pin_hash: await hashPin("1234"), must_change_password: false });
    const notion = await freshNotion();
    const result = await notion.findStaffByNameAndPin("박선생", "9999");
    expect(result).toBeNull();
    expect(notionCalls).toEqual([]);
  });

  it("다른 지점에 같은 이름이 있어도 자기 지점 계정만 확인한다", async () => {
    const { hashPin } = await import("@/lib/pinAuth");
    tables.staff.push(
      { id: "pg-staff-sajik", notion_id: "notion-staff-sajik", branch_id: "branch-sajik", name: "김선생", role: "강사", resigned: false, pin_hash: await hashPin("1111"), must_change_password: false },
      { id: "pg-staff-geumjeong", notion_id: "notion-staff-geumjeong", branch_id: "branch-geumjeong", name: "김선생", role: "강사", resigned: false, pin_hash: await hashPin("2222"), must_change_password: false }
    );
    const notion = await freshNotion();
    // 금정 계정의 PIN(2222)으로는 사직에서 로그인 안 됨.
    const wrongBranch = await notion.findStaffByNameAndPin("김선생", "2222");
    expect(wrongBranch).toBeNull();
    const correctBranch = await notion.findStaffByNameAndPin("김선생", "1111");
    expect(correctBranch?.id).toBe("notion-staff-sajik");
  });

  it("퇴사한 직원은 PIN이 맞아도 로그인되지 않는다", async () => {
    const { hashPin } = await import("@/lib/pinAuth");
    tables.staff.push({ id: "pg-staff-1", notion_id: "notion-staff-1", branch_id: "branch-sajik", name: "퇴사자", role: "조교", resigned: true, pin_hash: await hashPin("1234"), must_change_password: false });
    const notion = await freshNotion();
    const result = await notion.findStaffByNameAndPin("퇴사자", "1234");
    expect(result).toBeNull();
  });

  it("notion_id 없는 postgres-native 직원도 로그인되고 native UUID를 id로 돌려준다", async () => {
    const { hashPin } = await import("@/lib/pinAuth");
    tables.staff.push({ id: "pg-staff-new", notion_id: null, branch_id: "branch-sajik", name: "신규직원", role: "조교", resigned: false, pin_hash: await hashPin("5678"), must_change_password: true });
    const notion = await freshNotion();
    const result = await notion.findStaffByNameAndPin("신규직원", "5678");
    expect(result?.id).toBe("pg-staff-new");
    expect(result?.mustChangePin).toBe(true);
  });

  it("pin_hash가 없는 계정은(이론상 0명이어야 하지만) 조용히 로그인 실패 처리되고 Notion을 조회하지 않는다", async () => {
    tables.staff.push({ id: "pg-staff-nohash", notion_id: "notion-staff-nohash", branch_id: "branch-sajik", name: "해시없음", role: "조교", resigned: false, pin_hash: null, must_change_password: false });
    const notion = await freshNotion();
    const result = await notion.findStaffByNameAndPin("해시없음", "0000");
    expect(result).toBeNull();
    expect(notionCalls).toEqual([]);
  });

  it("정상 로그인 과정에서 Notion SDK가 전혀 호출되지 않는다", async () => {
    const { hashPin } = await import("@/lib/pinAuth");
    tables.staff.push({ id: "pg-staff-1", notion_id: "notion-staff-1", branch_id: "branch-sajik", name: "박선생", role: "조교", resigned: false, pin_hash: await hashPin("1234"), must_change_password: false });
    const notion = await freshNotion();
    await notion.findStaffByNameAndPin("박선생", "1234");
    expect(notionCalls).toEqual([]);
  });
});
