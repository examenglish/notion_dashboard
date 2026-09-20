// getStudentFullHistory postgres-primary 전환(staff.md PART 20) 검증 —
// 여러 엔티티(일일기록+반별진도 과제내용 병합, 보강/조치사항/복습/클리닉
// TODO, 상담, 행정실, 클리닉기록, Slack, 시험대비)를 한 번에 합치는
// 대형 집계 함수. 같은 기법: Notion SDK mock + 인메모리 Supabase REST.
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
  if (op === "is") return rawVal === "null" ? cell === null || cell === undefined : false;
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

function seedBaseline() {
  tables = {
    staff: [{ id: "staff-1", notion_id: "notion-staff-1", branch_id: "branch-sajik", name: "박선생" }],
    class_progress: [
      { id: "cp-1", notion_id: null, branch_id: "branch-sajik", homework_content: "문제집 10p" },
    ],
    daily_records: [
      {
        id: "d1",
        notion_id: null,
        branch_id: "branch-sajik",
        student_notion_ids: ["stu-a"],
        record_date: "2026-09-10",
        progress_content: "1과",
        attendance: "출석",
        homework_done: true,
        class_progress_notion_ids: ["cp-1"],
      },
      {
        id: "d-other",
        notion_id: null,
        branch_id: "branch-sajik",
        student_notion_ids: ["stu-b"],
        record_date: "2026-09-10",
        progress_content: "다른 학생 기록",
        attendance: "출석",
        homework_done: true,
        class_progress_notion_ids: [],
      },
    ],
    tasks: [
      { id: "t-makeup", notion_id: null, branch_id: "branch-sajik", type: "보강", student_notion_ids: ["stu-a"], staff_notion_ids: ["notion-staff-1"], due_date: "2026-09-12", time_text: "16:00", complete: false },
      { id: "t-action", notion_id: null, branch_id: "branch-sajik", type: "조치사항", student_notion_ids: ["stu-a"], staff_notion_ids: [], due_date: "2026-09-11", title: "지각 3회", complete: false },
      { id: "t-review", notion_id: null, branch_id: "branch-sajik", type: "복습", student_notion_ids: ["stu-a"], due_date: "2026-09-13", memo: "1과 복습", complete: false },
      { id: "t-clinic", notion_id: null, branch_id: "branch-sajik", type: "클리닉", student_notion_ids: ["stu-a"], staff_notion_ids: ["notion-staff-1"], due_date: "2026-09-14", memo: "클리닉 지시" },
    ],
    counseling_entries: [
      { id: "c1", notion_id: null, branch_id: "branch-sajik", student_notion_ids: ["stu-a"], record_date: "2026-09-05", counselor: "박선생", content: "상담내용", follow_up: "", entered_by: "" },
    ],
    admin_inbox_entries: [
      { id: "i1", notion_id: null, branch_id: "branch-sajik", student_notion_ids: ["stu-a"], input_type: "결석예정", start_date: "2026-09-08", content: "다음주 결석", complete: false, entered_by: "" },
    ],
    clinic_records: [
      { id: "cl1", notion_id: null, branch_id: "branch-sajik", student_notion_ids: ["stu-a"], assistant_notion_ids: ["notion-staff-1"], record_date: "2026-09-09", content: "클리닉 진행", next_preparation: "다음 준비" },
    ],
    slack_records: [
      { id: "s1", notion_id: null, branch_id: "branch-sajik", student_notion_ids: ["stu-a"], written_at: "2026-09-07", original: "슬랙 메시지", author: "학부모", permalink: "", status: "미확인", link_status: "연결됨" },
    ],
    exam_preps: [],
    students: [
      { id: "stu-a", notion_id: null, branch_id: "branch-sajik", name: "김학생", school: "천재중", grade: "중2", status: "재원", class_notion_ids: [] },
      { id: "stu-b", notion_id: null, branch_id: "branch-sajik", name: "이학생", school: "천재중", grade: "중2", status: "재원", class_notion_ids: [] },
    ],
  };
}

beforeEach(() => {
  seedBaseline();
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

describe("getStudentFullHistory — postgres-primary", () => {
  it("일일기록에 반별진도의 과제내용을 병합하고, 다른 학생 기록은 안 섞인다", async () => {
    const notion = await freshNotion();
    const history = await notion.getStudentFullHistory("stu-a");
    expect(history.progress).toHaveLength(1);
    expect(history.progress[0].progress).toBe("1과");
    expect(history.progress[0].homework).toBe("문제집 10p"); // class_progress에서 병합됨
  });

  it("보강/조치사항/복습/클리닉 TODO가 각각 올바른 섹션에 분류된다", async () => {
    const notion = await freshNotion();
    const history = await notion.getStudentFullHistory("stu-a");
    expect(history.makeup).toHaveLength(1);
    expect(history.makeup[0].owner).toBe("박선생");
    expect(history.actions).toHaveLength(1);
    expect(history.actions[0].content).toBe("지각 3회");
    expect(history.review).toHaveLength(1);
    // 클리닉은 clinic_records(source:"record")와 TODO(source:"task") 둘 다 합쳐진다.
    expect(history.clinic).toHaveLength(2);
    expect(history.clinic.map((c) => c.source).sort()).toEqual(["record", "task"]);
  });

  it("상담/행정실/Slack 기록이 각각 채워진다", async () => {
    const notion = await freshNotion();
    const history = await notion.getStudentFullHistory("stu-a");
    expect(history.counseling).toHaveLength(1);
    expect(history.counseling[0].content).toBe("상담내용");
    expect(history.inquiries).toHaveLength(1);
    expect(history.inquiries[0].type).toBe("결석예정");
    expect(history.slack).toHaveLength(1);
    expect(history.slack[0].content).toBe("슬랙 메시지");
  });

  it("시험대비 시트가 없으면 examPrep은 null이다(지어내지 않음)", async () => {
    const notion = await freshNotion();
    const history = await notion.getStudentFullHistory("stu-a");
    expect(history.examPrep).toBeNull();
  });

  it("branch isolation: 다른 지점 기록은 전혀 안 보인다", async () => {
    tables.daily_records.push({
      id: "d-geumjeong",
      notion_id: null,
      branch_id: "branch-geumjeong",
      student_notion_ids: ["stu-a"],
      record_date: "2026-09-10",
      progress_content: "금정 기록",
      attendance: "출석",
      homework_done: true,
      class_progress_notion_ids: [],
    });
    const notion = await freshNotion();
    const history = await notion.getStudentFullHistory("stu-a");
    expect(history.progress.map((p) => p.progress)).not.toContain("금정 기록");
  });
});
