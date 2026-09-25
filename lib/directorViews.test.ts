import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type Row = Record<string, any>;
let tables: Record<string, Row[]>;

beforeEach(() => {
  vi.resetModules();
  Object.assign(process.env, { SUPABASE_URL: "https://fake.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k", ACADEMY_BRANCH_ID: "sajik", ACADEMY_DB_PROVIDER: "postgres" });
  tables = {
    students: [
      { id: "s1", notion_id: "n1", branch_id: "b-sajik", name: "임서영" },
      { id: "s2", notion_id: "n2", branch_id: "b-sajik", name: "김민준" },
    ],
    student_learning_records: [],
    tasks: [],
    staff: [],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = new URL(url);
      const table = u.pathname.replace("/rest/v1/", "");
      if (table === "branches") return new Response(JSON.stringify([{ id: "b-sajik" }]), { status: 200 });
      const bid = u.searchParams.get("branch_id")?.replace(/^eq\./, "");
      let rows = (tables[table] ?? []).filter((r) => !bid || r.branch_id === bid);
      const gte = u.searchParams.get("record_date")?.replace(/^gte\./, "");
      if (gte) rows = rows.filter((r) => r.record_date >= gte);
      const type = u.searchParams.get("type")?.replace(/^eq\./, "");
      if (type) rows = rows.filter((r) => r.type === decodeURIComponent(type));
      return new Response(JSON.stringify(rows), { status: 200 });
    })
  );
});

const rec = (over: Row): Row => ({ branch_id: "b-sajik", student_notion_ids: ["n1"], record_date: "2026-09-24", created_at: "2026-09-24T01:00:00Z", source_payload: {}, ...over });

describe("확인 필요 학생(학생 기록 기반)", () => {
  it("재시험 필요·숙제 미완료·암기 미완료를 모으고, 더 최근 기록이 통과/완료면 빠진다", async () => {
    tables.student_learning_records = [
      rec({ id: "r1", record_type: "vocab", assessment_name: "단어시험", passed: false, retest_required: true, record_date: "2026-09-20" }),
      rec({ id: "r2", record_type: "retest", assessment_name: "단어시험", passed: true, record_date: "2026-09-22" }), // 재시험 통과 → r1 해소
      rec({ id: "r3", record_type: "vocab", assessment_name: "문법 Unit3", passed: false, retest_required: true, student_notion_ids: ["n2"] }),
      rec({ id: "r4", record_type: "homework", assessment_name: "워크북", completed: false }),
      rec({ id: "r5", record_type: "memorization", assessment_name: "대회문", completed: false, student_notion_ids: ["n2"] }),
      rec({ id: "r6", record_type: "homework", assessment_name: "프린트", completed: false, source_payload: { cancelled: { at: "x" } } }), // 취소된 기록 제외
      rec({ id: "r7", record_type: "homework", assessment_name: "옛날숙제", completed: false, record_date: "2026-08-01" }), // 2주 밖
    ];
    const { listCheckQueues } = await import("./directorViews");
    const q = (await listCheckQueues("2026-09-25"))!;
    expect(q.retest.map((x) => [x.studentName, x.detail])).toEqual([["김민준", "문법 Unit3"]]);
    expect(q.homework.map((x) => x.id)).toEqual(["r4"]);
    expect(q.memorization.map((x) => x.studentName)).toEqual(["김민준"]);
  });

  it("보강 일정: 오늘·예정·지난 미완료·완료로 나눈다", async () => {
    tables.tasks = [
      { id: "t1", branch_id: "b-sajik", type: "보강", student_notion_ids: ["n1"], due_date: "2026-09-26", time_text: "13:30", complete: false, source_payload: {} },
      { id: "t2", branch_id: "b-sajik", type: "보강", student_notion_ids: ["n2"], due_date: "2026-09-25", time_text: "", complete: false, source_payload: {} },
      { id: "t3", branch_id: "b-sajik", type: "보강", student_notion_ids: ["n2"], due_date: "2026-09-20", complete: false, source_payload: {} },
      { id: "t4", branch_id: "b-sajik", type: "보강", student_notion_ids: ["n1"], due_date: "2026-09-19", complete: true, source_payload: {} },
      { id: "t5", branch_id: "b-sajik", type: "재시", student_notion_ids: ["n1"], due_date: "2026-09-26", complete: false, source_payload: {} },
    ];
    const { listScheduleTasks } = await import("./directorViews");
    const b = (await listScheduleTasks("보강", "2026-09-25"))!;
    expect(b.today.map((x) => x.id)).toEqual(["t2"]);
    expect(b.upcoming.map((x) => [x.studentName, x.date, x.time])).toEqual([["임서영", "2026-09-26", "13:30"]]);
    expect(b.overdue.map((x) => x.id)).toEqual(["t3"]);
    expect(b.done.map((x) => x.id)).toEqual(["t4"]);
  });
});
