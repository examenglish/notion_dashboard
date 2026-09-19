// getClinicCompliance / getClinicCoverageGaps postgres-primary 전환
// (staff.md PART 21, Phase C에서 마지막으로 남았던 순수 Notion 전용
// 함수 2개) 검증.
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
  const m = clause.match(/^([a-z_]+)\.(eq|cs|is|in|gte)\.(.*)$/);
  if (!m) throw new Error(`fake-supabase: unsupported clause "${clause}"`);
  const [, col, op, rawVal] = m;
  const cell = row[col];
  if (op === "eq") {
    const decoded = decodeURIComponent(rawVal);
    if (decoded === "true" || decoded === "false") return cell === (decoded === "true");
    return String(cell ?? "") === decoded;
  }
  if (op === "gte") return cell !== null && cell !== undefined && String(cell) >= decodeURIComponent(rawVal);
  if (op === "cs") {
    const v = decodeURIComponent(rawVal.replace(/^\{/, "").replace(/\}$/, ""));
    return Array.isArray(cell) && cell.includes(v);
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
  tables = { tasks: [], clinic_records: [], students: [], staff: [], classes: [] };
  vi.stubGlobal("fetch", makeFakeSupabase(tables));
  process.env.SUPABASE_URL = "https://fake.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-key";
  process.env.ACADEMY_BRANCH_ID = "sajik";
  process.env.ACADEMY_DB_PROVIDER = "postgres";
  process.env.ACADEMY_STUDENT_READ_PROVIDER = "postgres";
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

async function freshNotion() {
  return import("@/lib/notion");
}

describe("getClinicCompliance — postgres-primary", () => {
  it("클리닉 지시 TODO에 보고 내용을 연결하고, 미완료+기한지남이면 overdue다", async () => {
    tables.students.push({ id: "stu-a", notion_id: "notion-stu-a", branch_id: "branch-sajik", name: "김학생", school: "천재중", grade: "중2", status: "재원", class_notion_ids: [] });
    tables.staff.push({ id: "staff-1", notion_id: "notion-staff-1", branch_id: "branch-sajik", name: "김조교" });
    tables.clinic_records.push({ id: "cl-1", notion_id: "notion-cl-1", branch_id: "branch-sajik", content: "진행함", next_preparation: "다음 준비" });
    tables.tasks.push({
      id: "t-1",
      notion_id: null,
      branch_id: "branch-sajik",
      type: "클리닉",
      due_date: "2020-01-01", // 훨씬 과거 = overdue
      complete: false,
      student_notion_ids: ["notion-stu-a"],
      staff_notion_ids: ["notion-staff-1"],
      clinic_report_notion_ids: ["notion-cl-1"],
      memo: "단어 확인 지시",
    });
    const notion = await freshNotion();
    const result = await notion.getClinicCompliance(3650); // 넉넉한 기간
    expect(result).toHaveLength(1);
    expect(result[0].studentName).toBe("김학생");
    expect(result[0].assistant).toBe("김조교");
    expect(result[0].report?.content).toBe("진행함");
    expect(result[0].overdue).toBe(true);
  });
});

describe("getClinicCoverageGaps — postgres-primary", () => {
  it("최근 케어 기록이 전혀 없는 재원생만 걸러낸다", async () => {
    tables.students.push(
      { id: "stu-covered", notion_id: "notion-stu-covered", branch_id: "branch-sajik", name: "케어받은학생", school: "천재중", grade: "중2", status: "재원", class_notion_ids: [] },
      { id: "stu-gap", notion_id: "notion-stu-gap", branch_id: "branch-sajik", name: "누락학생", school: "천재중", grade: "중2", status: "재원", class_notion_ids: [] },
      { id: "stu-inactive", notion_id: null, branch_id: "branch-sajik", name: "퇴원생", school: "천재중", grade: "중2", status: "퇴원", class_notion_ids: [] }
    );
    tables.clinic_records.push({ id: "cl-1", notion_id: null, branch_id: "branch-sajik", record_date: "2026-09-15", student_notion_ids: ["notion-stu-covered"] });
    const notion = await freshNotion();
    const gaps = await notion.getClinicCoverageGaps(14);
    expect(gaps.map((g) => g.name)).toEqual(["누락학생"]); // 케어받은학생 제외, 퇴원생은 애초에 재원 필터에서 빠짐
  });
});
