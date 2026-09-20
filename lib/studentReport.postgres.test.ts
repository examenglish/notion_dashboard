// getStudentPeriodReport(학부모 발송 리포트) postgres-primary 전환
// (staff.md PART 22) 검증.
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
  const m = clause.match(/^([a-z_]+)\.(eq|cs|is|in|gte|lte)\.(.*)$/);
  if (!m) throw new Error(`fake-supabase: unsupported clause "${clause}"`);
  const [, col, op, rawVal] = m;
  const cell = row[col];
  if (op === "eq") {
    const decoded = decodeURIComponent(rawVal);
    if (decoded === "true" || decoded === "false") return cell === (decoded === "true");
    return String(cell ?? "") === decoded;
  }
  if (op === "gte") return cell !== null && cell !== undefined && String(cell) >= decodeURIComponent(rawVal);
  if (op === "lte") return cell !== null && cell !== undefined && String(cell) <= decodeURIComponent(rawVal);
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
  tables = {
    students: [
      { id: "stu-a", notion_id: "notion-stu-a", branch_id: "branch-sajik", name: "김학생", school: "천재중", grade: "중2", status: "재원", guardian_phone: "010-1111-2222", class_notion_ids: ["notion-cls-1"] },
    ],
    classes: [{ id: "cls-1", notion_id: "notion-cls-1", branch_id: "branch-sajik", name: "영어2 천재조" }],
    daily_records: [],
    exam_scores: [],
  };
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

describe("getStudentPeriodReport — postgres-primary", () => {
  it("기간 안의 기록만으로 출석/과제/단어통과율을 계산하고 반 이름을 채운다", async () => {
    tables.daily_records.push(
      { id: "d1", notion_id: null, branch_id: "branch-sajik", student_notion_ids: ["notion-stu-a"], record_date: "2026-09-10", attendance: "출석", homework_done: true, vocab_result: "통과", progress_content: "1과" },
      { id: "d2", notion_id: null, branch_id: "branch-sajik", student_notion_ids: ["notion-stu-a"], record_date: "2026-09-12", attendance: "결석", homework_done: false, vocab_result: "재시험", progress_content: "" },
      // 기간 밖 — 집계에서 제외돼야 함.
      { id: "d-outside", notion_id: null, branch_id: "branch-sajik", student_notion_ids: ["notion-stu-a"], record_date: "2026-08-01", attendance: "출석", homework_done: true, vocab_result: "통과", progress_content: "범위밖" }
    );
    tables.exam_scores.push({ id: "e1", notion_id: null, branch_id: "branch-sajik", student_notion_ids: ["notion-stu-a"], exam_date: "2026-09-11", exam_name: "쪽지시험", subject: "영어", score: 85 });

    const notion = await freshNotion();
    const report = await notion.getStudentPeriodReport("notion-stu-a", "2026-09-01", "2026-09-30");
    expect(report.loggedDays).toBe(2);
    expect(report.attendanceRate).toBe(0.5); // 2일 중 1일 출석
    expect(report.homeworkRate).toBe(0.5);
    expect(report.vocabPassRate).toBe(0.5);
    expect(report.progressLog).toEqual([{ date: "2026-09-10", progress: "1과" }]);
    expect(report.examScores).toHaveLength(1);
    expect(report.classNames).toEqual(["영어2 천재조"]);
    expect(report.parentPhone).toBe("010-1111-2222");
  });

  it("branch isolation: 다른 지점 기록은 집계에 안 섞인다", async () => {
    tables.daily_records.push({ id: "d-geumjeong", notion_id: null, branch_id: "branch-geumjeong", student_notion_ids: ["notion-stu-a"], record_date: "2026-09-10", attendance: "출석", homework_done: true, vocab_result: "통과", progress_content: "금정" });
    const notion = await freshNotion();
    const report = await notion.getStudentPeriodReport("notion-stu-a", "2026-09-01", "2026-09-30");
    expect(report.loggedDays).toBe(0);
  });
});
