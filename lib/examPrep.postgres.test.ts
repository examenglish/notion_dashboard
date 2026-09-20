// 시험대비/학교시험범위 postgres-primary 전환(staff.md PART 15) 검증.
// lib/classRecord.postgres.test.ts와 동일한 기법: Notion SDK는 완전히
// mock, Supabase REST는 인메모리 fake fetch로 실제 REST 시맨틱을 재현한다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultDataFor, newTextSource, type ExamPrepData } from "@/lib/examPrep";

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
    const table = u.pathname.replace("/rest/v1/", "");
    const method = (init?.method || "GET").toUpperCase();
    if (table === "branches") {
      const code = u.searchParams.get("code")?.replace(/^eq\./, "");
      const id = code === "sajik" ? "branch-sajik" : code === "geumjeong" ? "branch-geumjeong" : null;
      return new Response(JSON.stringify(id ? [{ id }] : []), { status: 200 });
    }
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

function seedBaseline() {
  tables = {
    students: [
      { id: "stu-a", notion_id: "notion-stu-a", branch_id: "branch-sajik", name: "김학생", school: "천재고", grade: "고1", status: "재원", class_notion_ids: [] },
      { id: "stu-b", notion_id: "notion-stu-b", branch_id: "branch-sajik", name: "이학생", school: "천재고", grade: "고1", status: "재원", class_notion_ids: [] },
      { id: "stu-geumjeong", notion_id: null, branch_id: "branch-geumjeong", name: "금정학생", school: "금정고", grade: "고1", status: "재원", class_notion_ids: [] },
    ],
    classes: [],
    daily_records: [],
    exam_scores: [],
    exam_preps: [],
    school_exam_ranges: [],
  };
}

beforeEach(() => {
  notionInstances.length = 0;
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

const highData: ExamPrepData = defaultDataFor("고등");

describe("saveExamPrepSheet / getExamPrepSheet — postgres-primary", () => {
  it("아직 시트가 없는 학생은 기본값 + 학교시험범위 병합 결과를 돌려준다", async () => {
    const notion = await freshNotion();
    const sheet = await notion.getExamPrepSheet("stu-a");
    expect(sheet.id).toBeNull();
    expect(sheet.studentName).toBe("김학생");
    expect(sheet.level).toBe("고등");
  });

  it("새 시트를 저장하면(native PG UUID) 다시 조회했을 때 그대로 불러와진다", async () => {
    const notion = await freshNotion();
    const saved = await notion.saveExamPrepSheet({
      id: null,
      studentId: "stu-a",
      level: "고등",
      examTitle: "1학기 기말",
      examRange: "",
      examDate: null,
      teachers: ["박선생"],
      weakPoints: "독해",
      data: { level: "고등", high: { textSources: [newTextSource("교과서", "능률(김성곤)")], textAnalysisProgress: "" } },
    });
    expect(saved.id).toBeTruthy();
    expect(tables.exam_preps).toHaveLength(1);
    expect(tables.exam_preps[0].exam_title).toBe("1학기 기말");
    expect(tables.exam_preps[0].exam_data.high.textSources[0].label).toBe("능률(김성곤)");

    const reloaded = await notion.getExamPrepSheet("stu-a");
    expect(reloaded.examTitle).toBe("1학기 기말");
    expect(reloaded.weakPoints).toBe("독해");
    expect(reloaded.data.level).toBe("고등");
  });

  it("기존 시트(legacy notion_id)를 수정하면 patch만 되고 새 행이 안 생긴다", async () => {
    tables.exam_preps.push({
      id: "pg-exam-1",
      notion_id: "notion-exam-1",
      branch_id: "branch-sajik",
      student_notion_ids: ["notion-stu-a"],
      school_level: "고등",
      exam_title: "중간고사",
      teachers: "박선생",
      progress: 0,
      weak_points: "",
      exam_data: highData,
      updated_on: "2026-09-01",
    });
    const notion = await freshNotion();
    await notion.saveExamPrepSheet({
      id: "notion-exam-1",
      studentId: "notion-stu-a",
      level: "고등",
      examTitle: "중간고사 수정",
      examRange: "",
      examDate: null,
      teachers: ["박선생"],
      weakPoints: "문법",
      data: highData,
    });
    expect(tables.exam_preps).toHaveLength(1);
    expect(tables.exam_preps[0].exam_title).toBe("중간고사 수정");
    expect(tables.exam_preps[0].weak_points).toBe("문법");
  });

  it("branch isolation: 사직 시트가 있어도 금정 학생 조회 결과에는 절대 안 섞인다", async () => {
    tables.exam_preps.push(
      {
        id: "pg-exam-sajik",
        notion_id: null,
        branch_id: "branch-sajik",
        student_notion_ids: ["notion-stu-a"],
        school_level: "고등",
        exam_title: "사직 시험",
        teachers: "",
        progress: 0,
        weak_points: "",
        exam_data: highData,
        updated_on: "2026-09-01",
      },
      {
        id: "pg-exam-geumjeong",
        notion_id: null,
        branch_id: "branch-geumjeong",
        student_notion_ids: ["stu-geumjeong"],
        school_level: "고등",
        exam_title: "금정 시험",
        teachers: "",
        progress: 0,
        weak_points: "",
        exam_data: highData,
        updated_on: "2026-09-01",
      }
    );
    process.env.ACADEMY_BRANCH_ID = "geumjeong";
    vi.resetModules();
    const notionGeumjeong = await freshNotion();
    const sheet = await notionGeumjeong.getExamPrepSheet("stu-geumjeong");
    expect(sheet.examTitle).toBe("금정 시험"); // 자기 지점 시트만 보인다
  });

  it("Notion mirror가 실패해도 저장 자체는 성공한다", async () => {
    const notion = await freshNotion();
    const client = notionInstances[notionInstances.length - 1];
    client.pages.create.mockRejectedValue(new Error("Notion down"));
    const saved = await notion.saveExamPrepSheet({
      id: null,
      studentId: "stu-b",
      level: "고등",
      examTitle: "기말",
      examRange: "",
      examDate: null,
      teachers: [],
      weakPoints: "",
      data: highData,
    });
    expect(saved.id).toBeTruthy();
    expect(tables.exam_preps.some((r) => r.exam_title === "기말")).toBe(true);
  });
});

describe("upsertSchoolExamRange / getSchoolExamRange — postgres-primary", () => {
  it("새 학교+학년 시험범위를 저장하면 카테고리별 컬럼이 정확히 채워진다", async () => {
    const notion = await freshNotion();
    const result = await notion.upsertSchoolExamRange({
      school: "천재고",
      grade: "고1",
      examTitle: "1학기 기말",
      examRange: "1~4과",
      examStartDate: "2026-10-10",
      examEndDate: "2026-10-12",
      units: {
        교과서: { name: "능률(김성곤)", units: ["1과", "2과"] },
        부교재: { name: "", units: [] },
        모의고사: { name: "", units: [] },
        학교프린트: { name: "", units: [] },
      },
    });
    expect(result.units.교과서.units).toEqual(["1과", "2과"]);
    const row = tables.school_exam_ranges[0];
    expect(row.textbook_name).toBe("능률(김성곤)");
    expect(row.textbook_units).toBe("1과, 2과");

    const fetched = await notion.getSchoolExamRange("천재고", "고1");
    expect(fetched?.examRange).toBe("1~4과");
    expect(fetched?.units.교과서.units).toEqual(["1과", "2과"]);
  });

  it("같은 학교+학년+시험명으로 다시 저장하면 새 항목이 아니라 기존 항목을 갱신한다", async () => {
    const notion = await freshNotion();
    await notion.upsertSchoolExamRange({
      school: "천재고",
      grade: "고1",
      examTitle: "중간고사",
      examRange: "1~2과",
      examStartDate: null,
      examEndDate: null,
      units: { 교과서: { name: "", units: [] }, 부교재: { name: "", units: [] }, 모의고사: { name: "", units: [] }, 학교프린트: { name: "", units: [] } },
    });
    await notion.upsertSchoolExamRange({
      school: "천재고",
      grade: "고1",
      examTitle: "중간고사",
      examRange: "1~3과",
      examStartDate: null,
      examEndDate: null,
      units: { 교과서: { name: "", units: [] }, 부교재: { name: "", units: [] }, 모의고사: { name: "", units: [] }, 학교프린트: { name: "", units: [] } },
    });
    expect(tables.school_exam_ranges).toHaveLength(1);
    expect(tables.school_exam_ranges[0].exam_range).toBe("1~3과");
  });
});

describe("pushSchoolUnitsToStudents — postgres-primary", () => {
  it("이미 있는 단원은 건드리지 않고 새 단원만 학생 시트에 추가한다", async () => {
    tables.exam_preps.push({
      id: "pg-exam-1",
      notion_id: null,
      branch_id: "branch-sajik",
      student_notion_ids: ["notion-stu-a"],
      school_level: "고등",
      exam_title: "기말",
      teachers: "",
      progress: 0,
      weak_points: "",
      exam_data: { level: "고등", high: { textSources: [{ ...newTextSource("교과서", "1과"), detail: "레벨업" }], textAnalysisProgress: "" } },
      updated_on: "2026-09-01",
    });
    const notion = await freshNotion();
    const entry = await notion.upsertSchoolExamRange({
      school: "천재고",
      grade: "고1",
      examTitle: "기말",
      examRange: "",
      examStartDate: null,
      examEndDate: null,
      units: {
        교과서: { name: "레벨업", units: ["1과", "2과"] },
        부교재: { name: "", units: [] },
        모의고사: { name: "", units: [] },
        학교프린트: { name: "", units: [] },
      },
    });
    const updated = await notion.pushSchoolUnitsToStudents(entry);
    expect(updated).toBe(1);
    const sources = tables.exam_preps[0].exam_data.high.textSources;
    expect(sources).toHaveLength(2); // 기존 1과 유지 + 새 2과 추가
    expect(sources.map((s: any) => s.label).sort()).toEqual(["1과", "2과"]);
  });
});

describe("getExamPrepTemplate — postgres-primary", () => {
  it("같은 학교+학년 학생들의 시험대비 옵션을 모아준다", async () => {
    tables.exam_preps.push(
      {
        id: "pg-exam-a",
        notion_id: null,
        branch_id: "branch-sajik",
        student_notion_ids: ["notion-stu-a"],
        school_level: "고등",
        exam_title: "기말",
        teachers: "박선생",
        progress: 0,
        weak_points: "",
        exam_data: { level: "고등", high: { textSources: [newTextSource("교과서", "능률")], textAnalysisProgress: "" } },
        updated_on: "2026-09-05",
      },
      {
        id: "pg-exam-b",
        notion_id: null,
        branch_id: "branch-sajik",
        student_notion_ids: ["notion-stu-b"],
        school_level: "고등",
        exam_title: "기말",
        teachers: "박선생",
        progress: 0,
        weak_points: "",
        exam_data: { level: "고등", high: { textSources: [newTextSource("교과서", "비상")], textAnalysisProgress: "" } },
        updated_on: "2026-09-01",
      }
    );
    const notion = await freshNotion();
    const template = await notion.getExamPrepTemplate({ school: "천재고", grade: "고1", excludeStudentId: "none" });
    expect(template?.textbookOptions.sort()).toEqual(["능률", "비상"]);
    expect(template?.latest.textbook).toBe("능률"); // 갱신일 최신(09-05)
  });
});
