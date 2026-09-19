// Phase D(원장 지시, staff.md PART 18) — 학생 일일기록/시험성적/상담이력
// 조회 + 대기생 승격(cron)을 postgres-primary로 전환한 것 검증. 같은
// 기법: Notion SDK mock + 인메모리 Supabase REST.
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
  const m = clause.match(/^([a-z_]+)\.(eq|cs|is|in|lte|gte|not\.is)\.(.*)$/);
  if (!m) throw new Error(`fake-supabase: unsupported clause "${clause}"`);
  const [, col, op, rawVal] = m;
  const cell = row[col];
  if (op === "eq") {
    const decoded = decodeURIComponent(rawVal);
    if (decoded === "true" || decoded === "false") return cell === (decoded === "true");
    return String(cell ?? "") === decoded;
  }
  if (op === "is") return rawVal === "null" ? cell === null || cell === undefined : false;
  if (op === "not.is") return rawVal === "null" ? cell !== null && cell !== undefined : true;
  if (op === "lte") return cell !== null && cell !== undefined && String(cell) <= decodeURIComponent(rawVal);
  if (op === "gte") return cell !== null && cell !== undefined && String(cell) >= decodeURIComponent(rawVal);
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
    if (u.pathname === "/rest/v1/branches") {
      const code = u.searchParams.get("code")?.replace(/^eq\./, "");
      const id = code === "sajik" ? "branch-sajik" : code === "geumjeong" ? "branch-geumjeong" : null;
      return new Response(JSON.stringify(id ? [{ id }] : []), { status: 200 });
    }
    const table = u.pathname.replace("/rest/v1/", "");
    const method = (init?.method || "GET").toUpperCase();
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

beforeEach(() => {
  notionInstances.length = 0;
  tables = { daily_records: [], exam_scores: [], counseling_entries: [], students: [] };
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

describe("getStudentDailyRecords / getStudentExamScores — postgres-primary", () => {
  it("학생별 일일기록을 날짜 오름차순으로 돌려준다", async () => {
    tables.daily_records.push(
      { id: "d2", notion_id: null, branch_id: "branch-sajik", student_notion_ids: ["stu-a"], record_date: "2026-09-20", attendance: "출석", homework_done: true, vocab_result: "통과", achievement: "", progress_content: "2과" },
      { id: "d1", notion_id: null, branch_id: "branch-sajik", student_notion_ids: ["stu-a"], record_date: "2026-09-10", attendance: "결석", homework_done: false, vocab_result: "재시험", achievement: "", progress_content: "1과" },
      { id: "d-other", notion_id: null, branch_id: "branch-sajik", student_notion_ids: ["stu-b"], record_date: "2026-09-15", attendance: "출석", homework_done: true, vocab_result: "통과", achievement: "", progress_content: "다른 학생" }
    );
    const notion = await freshNotion();
    const records = await notion.getStudentDailyRecords("stu-a");
    expect(records.map((r) => r.progress)).toEqual(["1과", "2과"]);
    expect(records[0].attendance).toBe("결석");
  });

  it("학생별 시험성적을 날짜 오름차순으로 돌려준다", async () => {
    tables.exam_scores.push(
      { id: "e2", notion_id: null, branch_id: "branch-sajik", student_notion_ids: ["stu-a"], exam_date: "2026-09-20", exam_name: "기말", subject: "영어", score: 90 },
      { id: "e1", notion_id: null, branch_id: "branch-sajik", student_notion_ids: ["stu-a"], exam_date: "2026-06-20", exam_name: "중간", subject: "영어", score: 80 }
    );
    const notion = await freshNotion();
    const scores = await notion.getStudentExamScores("stu-a");
    expect(scores.map((s) => s.examName)).toEqual(["중간", "기말"]);
  });

  it("branch isolation: 다른 지점 기록은 절대 안 섞인다", async () => {
    tables.daily_records.push({ id: "d-geumjeong", notion_id: null, branch_id: "branch-geumjeong", student_notion_ids: ["stu-a"], record_date: "2026-09-20", attendance: "출석", homework_done: true, vocab_result: "통과", achievement: "", progress_content: "금정 기록" });
    const notion = await freshNotion();
    const records = await notion.getStudentDailyRecords("stu-a");
    expect(records).toHaveLength(0);
  });
});

describe("getRecentCounseling — postgres-primary", () => {
  it("최근 생성순으로 상담 이력을 돌려주고 학생명/학교/학년을 채운다", async () => {
    tables.students.push({ id: "stu-a", notion_id: "notion-stu-a", branch_id: "branch-sajik", name: "김학생", school: "천재중", grade: "중2", status: "재원", class_notion_ids: [] });
    tables.counseling_entries.push(
      { id: "c1", notion_id: null, branch_id: "branch-sajik", student_notion_ids: ["notion-stu-a"], record_date: "2026-09-10", counselor: "박선생", transcript: "", content: "1차 상담", follow_up: "", entered_by: "", created_at: "2026-09-10T00:00:00Z" },
      { id: "c2", notion_id: null, branch_id: "branch-sajik", student_notion_ids: ["notion-stu-a"], record_date: "2026-09-15", counselor: "박선생", transcript: "", content: "2차 상담", follow_up: "", entered_by: "", created_at: "2026-09-15T00:00:00Z" }
    );
    const notion = await freshNotion();
    const list = await notion.getRecentCounseling();
    expect(list.map((c) => c.content)).toEqual(["2차 상담", "1차 상담"]); // 최신순
    expect(list[0].studentName).toBe("김학생");
    expect(list[0].studentSchool).toBe("천재중");
  });
});

describe("promoteWaitlistedStudents — postgres-primary", () => {
  it("등원일이 지난 대기생만 재원으로 승격하고, 아닌 학생은 건드리지 않는다", async () => {
    tables.students.push(
      { id: "stu-ready", notion_id: "notion-ready", branch_id: "branch-sajik", name: "대기생1", school: "천재중", grade: "중2", status: "대기생", attendance_started_on: "2026-09-15", class_notion_ids: [] },
      { id: "stu-future", notion_id: "notion-future", branch_id: "branch-sajik", name: "대기생2", school: "천재중", grade: "중2", status: "대기생", attendance_started_on: "2026-09-25", class_notion_ids: [] },
      { id: "stu-active", notion_id: "notion-active", branch_id: "branch-sajik", name: "재원생", school: "천재중", grade: "중2", status: "재원", attendance_started_on: "2026-09-01", class_notion_ids: [] }
    );
    const notion = await freshNotion();
    const promoted = await notion.promoteWaitlistedStudents("2026-09-20");
    expect(promoted.map((p) => p.name)).toEqual(["대기생1"]);
    expect(tables.students.find((s) => s.id === "stu-ready")?.status).toBe("재원");
    expect(tables.students.find((s) => s.id === "stu-future")?.status).toBe("대기생"); // 아직 등원일 전
  });

  it("branch isolation: 다른 지점 대기생은 승격 대상에서 제외된다", async () => {
    tables.students.push({ id: "stu-geumjeong", notion_id: null, branch_id: "branch-geumjeong", name: "금정대기생", school: "금정중", grade: "중2", status: "대기생", attendance_started_on: "2026-09-01", class_notion_ids: [] });
    const notion = await freshNotion();
    const promoted = await notion.promoteWaitlistedStudents("2026-09-20");
    expect(promoted).toHaveLength(0);
  });

  it("Notion mirror가 실패해도 postgres 승격 자체는 유지된다", async () => {
    tables.students.push({ id: "stu-ready", notion_id: "notion-ready", branch_id: "branch-sajik", name: "대기생1", school: "천재중", grade: "중2", status: "대기생", attendance_started_on: "2026-09-15", class_notion_ids: [] });
    const notion = await freshNotion();
    const client = notionInstances[notionInstances.length - 1];
    client.pages.update.mockRejectedValue(new Error("Notion down"));
    const promoted = await notion.promoteWaitlistedStudents("2026-09-20");
    expect(promoted).toHaveLength(1);
    expect(tables.students[0].status).toBe("재원");
  });
});
