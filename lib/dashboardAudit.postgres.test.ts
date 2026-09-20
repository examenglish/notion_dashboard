// 안정성 전수점검(staff.md PART 23)에서 새로 발견한 gap — 대시보드/원장
// 화면이 쓰는 여러 함수가 queryAllPages()(Notion 전용 wrapper) 뒤에
// 숨어있어 Phase C 1차 조사(notion.* 직접호출만 검색)에서 빠졌었다.
// getTodaySchedule/getClassSummaryByDate/getMonthlyStudentMetrics/
// getMonthlyOutcomeBreakdown/getDailyOutcomeBreakdown/getDailyOutcomeDetail/
// getUrgentCounselingRequests/getRecentAdminInbox/getRecentBriefings/
// getMakeupScheduleStatus/findClassRecordGaps 전부 postgres-primary로 전환.
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
  const m = clause.match(/^([a-z_]+)\.(eq|cs|is|in|gte|lte|lt)\.(.*)$/);
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
  if (op === "lt") return cell !== null && cell !== undefined && String(cell) < decodeURIComponent(rawVal);
  if (op === "cs") {
    const v = decodeURIComponent(rawVal.replace(/^\{/, "").replace(/\}$/, ""));
    return Array.isArray(cell) && cell.includes(v);
  }
  if (op === "in") {
    const vals = rawVal.replace(/^\(/, "").replace(/\)$/, "").split(",").map((v) => decodeURIComponent(v));
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
    students: [
      { id: "stu-a", notion_id: "notion-stu-a", branch_id: "branch-sajik", name: "김학생", school: "천재중", grade: "중2", status: "재원", class_notion_ids: ["notion-cls-1"], action: "지각 상담", action_assignee_text: "박선생", action_alarm_on: "2026-09-20", attendance_started_on: "2026-09-20" },
      { id: "stu-geumjeong", notion_id: null, branch_id: "branch-geumjeong", name: "금정학생", school: "금정중", grade: "중2", status: "재원", class_notion_ids: [], action: "", action_assignee_text: "", action_alarm_on: "2026-09-20", attendance_started_on: "2026-09-20" },
    ],
    classes: [{ id: "cls-1", notion_id: "notion-cls-1", branch_id: "branch-sajik", name: "영어2 천재조", days: ["월", "수"], time_text: "16:00", category: "정규", student_notion_ids: ["notion-stu-a"] }],
    daily_records: [],
    tasks: [],
    counseling_entries: [],
    admin_inbox_entries: [],
    briefings: [],
    class_progress: [],
    staff: [{ id: "staff-1", notion_id: "notion-staff-1", branch_id: "branch-sajik", name: "박선생", role: "조교" }],
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

describe("getTodaySchedule — postgres-primary", () => {
  it("조치알람/등원일/보강/상담/문의가 오늘 날짜로 정확히 채워진다", async () => {
    tables.tasks.push({
      id: "t-makeup", notion_id: null, branch_id: "branch-sajik", type: "보강",
      due_date: "2026-09-20", time_text: "16:00", memo: "", student_notion_ids: ["notion-stu-a"], staff_notion_ids: ["notion-staff-1"], complete: false,
    });
    tables.counseling_entries.push({ id: "c1", notion_id: null, branch_id: "branch-sajik", student_notion_ids: ["notion-stu-a"], record_date: "2026-09-20", counselor: "박선생", content: "상담", transcript: "", follow_up: "", entered_by: "" });
    const notion = await freshNotion();
    const schedule = await notion.getTodaySchedule("2026-09-20");
    expect(schedule.alarms).toHaveLength(1);
    expect(schedule.alarms[0].studentName).toBe("김학생");
    expect(schedule.firstDays).toHaveLength(1);
    expect(schedule.makeupClasses).toHaveLength(1);
    expect(schedule.counseling).toHaveLength(1);
  });

  it("branch isolation: 금정 학생/업무가 절대 안 섞인다", async () => {
    const notion = await freshNotion();
    const schedule = await notion.getTodaySchedule("2026-09-20");
    expect(schedule.alarms.every((a) => a.studentName !== "금정학생")).toBe(true);
  });
});

describe("getClassSummaryByDate / getMonthlyStudentMetrics — postgres-primary", () => {
  it("반별 출석/과제/단어통과율을 정확히 계산한다", async () => {
    tables.daily_records.push(
      { id: "d1", notion_id: null, branch_id: "branch-sajik", record_date: "2026-09-20", class_notion_ids: ["notion-cls-1"], attendance: "출석", homework_done: true, vocab_result: "통과" },
      { id: "d2", notion_id: null, branch_id: "branch-sajik", record_date: "2026-09-20", class_notion_ids: ["notion-cls-1"], attendance: "결석", homework_done: false, vocab_result: "재시험" }
    );
    const notion = await freshNotion();
    const summary = await notion.getClassSummaryByDate("2026-09-20");
    const row = summary.find((s) => s.classId === "notion-cls-1");
    expect(row?.recordCount).toBe(2);
    expect(row?.attendanceRate).toBe(0.5);
  });

  it("월간 학생별 지표를 집계한다", async () => {
    tables.daily_records.push({ id: "d1", notion_id: null, branch_id: "branch-sajik", record_date: "2026-09-05", student_notion_ids: ["notion-stu-a"], class_notion_ids: ["notion-cls-1"], attendance: "출석", homework_done: true, vocab_result: "통과" });
    const notion = await freshNotion();
    const metrics = await notion.getMonthlyStudentMetrics();
    expect(metrics).toHaveLength(1);
    expect(metrics[0].studentName).toBe("김학생");
    expect(metrics[0].attendanceRate).toBe(1);
  });
});

describe("getMonthlyOutcomeBreakdown / getDailyOutcomeBreakdown / getDailyOutcomeDetail — postgres-primary", () => {
  beforeEach(() => {
    tables.daily_records.push(
      { id: "d1", notion_id: null, branch_id: "branch-sajik", record_date: "2026-09-20", student_notion_ids: ["notion-stu-a"], class_notion_ids: ["notion-cls-1"], attendance: "결석", homework_done: false, vocab_result: "재시험" }
    );
  });

  it("월간 도넛차트 집계가 맞다", async () => {
    const notion = await freshNotion();
    const breakdown = await notion.getMonthlyOutcomeBreakdown("2026-09");
    expect(breakdown.attendance.결석).toBe(1);
    expect(breakdown.homework.미완료).toBe(1);
  });

  it("일간 집계가 맞다", async () => {
    const notion = await freshNotion();
    const breakdown = await notion.getDailyOutcomeBreakdown("2026-09-20");
    expect(breakdown.vocab.재시험).toBe(1);
  });

  it("결석/미완료과제 학생 상세 목록이 채워진다", async () => {
    const notion = await freshNotion();
    const detail = await notion.getDailyOutcomeDetail("2026-09-20");
    expect(detail.absentStudents).toHaveLength(1);
    expect(detail.absentStudents[0].studentName).toBe("김학생");
    expect(detail.incompleteHomeworkStudents).toHaveLength(1);
  });
});

describe("getUrgentCounselingRequests / getRecentAdminInbox / getRecentBriefings — postgres-primary", () => {
  it("미처리 긴급상담요청만 걸러진다", async () => {
    tables.admin_inbox_entries.push(
      { id: "i1", notion_id: null, branch_id: "branch-sajik", student_notion_ids: ["notion-stu-a"], input_type: "긴급상담요청", complete: false, start_date: "2026-09-20", content: "긴급", owner_text: "", entered_by: "" },
      { id: "i2", notion_id: null, branch_id: "branch-sajik", student_notion_ids: ["notion-stu-a"], input_type: "긴급상담요청", complete: true, start_date: "2026-09-19", content: "이미처리", owner_text: "", entered_by: "" }
    );
    const notion = await freshNotion();
    const urgent = await notion.getUrgentCounselingRequests();
    expect(urgent).toHaveLength(1);
    expect(urgent[0].content).toBe("긴급");
  });

  it("행정실 전체 이력을 돌려준다", async () => {
    tables.admin_inbox_entries.push({ id: "i1", notion_id: null, branch_id: "branch-sajik", student_notion_ids: ["notion-stu-a"], input_type: "기타", complete: false, start_date: "2026-09-20", content: "메모", owner_text: "", entered_by: "", created_at: "2026-09-20T00:00:00Z" });
    const notion = await freshNotion();
    const items = await notion.getRecentAdminInbox();
    expect(items).toHaveLength(1);
  });

  it("브리핑 이력을 돌려준다", async () => {
    tables.briefings.push({ id: "b1", notion_id: null, branch_id: "branch-sajik", student_notion_ids: ["notion-stu-a"], record_date: "2026-09-20", briefing_type: "전달사항", content: "오늘 브리핑" });
    const notion = await freshNotion();
    const items = await notion.getRecentBriefings();
    expect(items).toHaveLength(1);
    expect(items[0].studentName).toBe("김학생");
  });
});

describe("getMakeupScheduleStatus / findClassRecordGaps — postgres-primary", () => {
  it("보강/재시 미완료만, staffId로 필터링된다", async () => {
    tables.tasks.push(
      { id: "t1", notion_id: null, branch_id: "branch-sajik", type: "보강", complete: false, student_notion_ids: ["notion-stu-a"], class_notion_ids: ["notion-cls-1"], staff_notion_ids: ["notion-staff-1"], due_date: "2026-09-22", time_text: "", memo: "" },
      { id: "t2", notion_id: null, branch_id: "branch-sajik", type: "보강", complete: false, student_notion_ids: ["notion-stu-a"], class_notion_ids: [], staff_notion_ids: [], due_date: "2026-09-23", time_text: "16:00", memo: "" }
    );
    const notion = await freshNotion();
    const mine = await notion.getMakeupScheduleStatus({ staffId: "notion-staff-1" });
    expect(mine).toHaveLength(1);
    expect(mine[0].confirmed).toBe(false);
    const all = await notion.getMakeupScheduleStatus();
    expect(all).toHaveLength(2);
    expect(all.find((m) => m.id === "t2")?.confirmed).toBe(true);
  });

  it("수업 있는 요일인데 진도기록이 없는 반×날짜를 찾는다", async () => {
    const notion = await freshNotion();
    const gaps = await notion.findClassRecordGaps("2026-09-21", "2026-09-21"); // 월요일, cls-1 수업일
    expect(gaps).toHaveLength(1);
    expect(gaps[0].classId).toBe("notion-cls-1");

    tables.class_progress.push({ id: "cp1", notion_id: null, branch_id: "branch-sajik", record_date: "2026-09-21", class_notion_ids: ["notion-cls-1"] });
    vi.resetModules();
    const notion2 = await freshNotion();
    const gapsAfter = await notion2.findClassRecordGaps("2026-09-21", "2026-09-21");
    expect(gapsAfter).toHaveLength(0); // 기록이 생겼으니 더 이상 gap 아님
  });
});

describe("getAdminInboxEntry / getCounselingEntryEnteredBy — 상세/수정/삭제 라우트 dual-id 버그 수정", () => {
  it("native PG UUID 항목도 조회된다(예전엔 notion.pages.retrieve라 여기서 항상 실패했음)", async () => {
    tables.admin_inbox_entries.push({ id: "pg-inbox-new", notion_id: null, branch_id: "branch-sajik", student_notion_ids: ["notion-stu-a"], input_type: "결석예정", complete: false, start_date: "2026-09-20", content: "결석", owner_text: "박선생", entered_by: "김조교" });
    const notion = await freshNotion();
    const entry = await notion.getAdminInboxEntry("pg-inbox-new");
    expect(entry?.enteredBy).toBe("김조교");
    expect(entry?.studentId).toBe("notion-stu-a");
  });

  it("legacy notion_id 상담 항목도 조회된다", async () => {
    tables.counseling_entries.push({ id: "pg-c1", notion_id: "notion-c1", branch_id: "branch-sajik", student_notion_ids: ["notion-stu-a"], record_date: "2026-09-20", counselor: "", content: "", follow_up: "", entered_by: "박선생" });
    const notion = await freshNotion();
    const enteredBy = await notion.getCounselingEntryEnteredBy("notion-c1");
    expect(enteredBy).toBe("박선생");
  });
});
