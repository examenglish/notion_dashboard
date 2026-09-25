import "server-only";
import { getDbProvider, pgQueryRaw } from "./supabaseRepo";
import { pgStaffNameMap } from "./supabasePgRead";

// 원장·직원 조회 화면용 읽기 전용 모음 — 기존 업무(tasks) 데이터를 역할에 맞게 보여줄 뿐,
// 쓰기·새 저장 구조는 없다. 지점은 pgQueryRaw의 branch_id(이 배포 지점)로만.

export type ScheduleTaskRow = {
  id: string;
  studentId: string | null;
  studentName: string;
  date: string | null;
  time: string;
  owner: string;
  done: boolean;
  memo: string;
};

export type ScheduleBuckets = { today: ScheduleTaskRow[]; upcoming: ScheduleTaskRow[]; overdue: ScheduleTaskRow[]; done: ScheduleTaskRow[] };

/** 보강/재시(tasks.type) 일정 — 오늘·예정·지난 미완료·완료로 나눈다. Postgres 모드가 아니면 null(화면이 안내). */
export async function listScheduleTasks(type: "보강" | "재시", today: string): Promise<ScheduleBuckets | null> {
  if (getDbProvider() !== "postgres") return null;
  const [rows, students, staff] = await Promise.all([
    pgQueryRaw("TODO", `type=eq.${encodeURIComponent(type)}`),
    pgQueryRaw("STUDENT", "id=not.is.null").catch(() => []),
    pgStaffNameMap().catch(() => new Map<string, string>()),
  ]);
  const studentName = new Map<string, string>();
  for (const s of students) {
    const name = String(s.name ?? "");
    if (s.notion_id) studentName.set(String(s.notion_id), name);
    studentName.set(String(s.id), name);
  }
  const items: ScheduleTaskRow[] = rows
    .filter((r) => !(r.source_payload as { archived?: boolean } | null)?.archived)
    .map((r) => {
      const sid = (r.student_notion_ids as string[] | undefined)?.[0] ?? null;
      const oid = (r.staff_notion_ids as string[] | undefined)?.[0];
      return {
        id: String(r.notion_id ?? r.id),
        studentId: sid,
        studentName: (sid && studentName.get(sid)) || String(r.title ?? "").replace(/^(보강|재시)\s*-\s*/, "") || "-",
        date: (r.due_date as string | null) ?? null,
        time: String(r.time_text ?? ""),
        owner: (oid && staff.get(oid)) || "",
        done: !!r.complete,
        memo: String(r.memo ?? ""),
      };
    });
  const key = (x: ScheduleTaskRow) => `${x.date ?? "9999"} ${x.time}`;
  const asc = (a: ScheduleTaskRow, b: ScheduleTaskRow) => key(a).localeCompare(key(b));
  return {
    today: items.filter((x) => !x.done && x.date === today).sort(asc),
    upcoming: items.filter((x) => !x.done && !!x.date && x.date > today).sort(asc),
    overdue: items.filter((x) => !x.done && (!x.date || x.date < today)).sort(asc),
    done: items.filter((x) => x.done).sort((a, b) => asc(b, a)).slice(0, 100),
  };
}

// ---------------------------------------------------------------------------
// 확인 필요 학생(최근 기록 기준) — EXAM AI 학생 기록에서 재시험 필요·숙제 미완료·암기 미완료를 모은다.
// 읽기 전용이며 업무를 만들지 않는다. 같은 학생·같은 항목이 여러 번이면 가장 최근 것 하나만.
// ---------------------------------------------------------------------------
export type CheckItem = { id: string; studentId: string | null; studentName: string; date: string; label: string; detail: string; enteredBy: string };
export type CheckQueues = { retest: CheckItem[]; homework: CheckItem[]; memorization: CheckItem[]; since: string };

export async function listCheckQueues(today: string, days = 14): Promise<CheckQueues | null> {
  if (getDbProvider() !== "postgres") return null;
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - (days - 1) * 86400000).toISOString().slice(0, 10);
  const [rows, students] = await Promise.all([
    pgQueryRaw("STUDENT_LEARNING_RECORD", `record_date=gte.${since}`),
    pgQueryRaw("STUDENT", "id=not.is.null").catch(() => []),
  ]);
  const names = new Map<string, string>();
  for (const s of students) {
    if (s.notion_id) names.set(String(s.notion_id), String(s.name ?? ""));
    names.set(String(s.id), String(s.name ?? ""));
  }
  const active = rows
    .filter((r) => !(r.source_payload as { cancelled?: unknown } | null)?.cancelled)
    .sort((a, b) => String(b.record_date ?? "").localeCompare(String(a.record_date ?? "")) || String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));

  // 같은 학생·유형·시험명의 가장 최근 기록만 본다(그 뒤에 통과/완료로 기록됐으면 목록에서 빠진다).
  const latest = new Map<string, Record<string, unknown>>();
  for (const r of active) {
    const sid = (r.student_notion_ids as string[] | undefined)?.[0] ?? "";
    const kind = r.record_type === "retest" ? "vocab" : String(r.record_type);
    const key = `${sid}|${kind}|${String(r.assessment_name ?? "")}`;
    if (!latest.has(key)) latest.set(key, r);
  }
  const toItem = (r: Record<string, unknown>, label: string): CheckItem => {
    const sid = (r.student_notion_ids as string[] | undefined)?.[0] ?? null;
    const score = r.score === null || r.score === undefined ? "" : ` · ${r.score}점`;
    return {
      id: String(r.id),
      studentId: sid,
      studentName: (sid && names.get(sid)) || "-",
      date: String(r.record_date ?? ""),
      label,
      detail: `${String(r.assessment_name ?? "") || label}${score}${r.note ? ` · ${r.note}` : ""}`,
      enteredBy: String(r.entered_by ?? ""),
    };
  };
  const out: CheckQueues = { retest: [], homework: [], memorization: [], since };
  for (const r of latest.values()) {
    if (r.retest_required === true || ((r.record_type === "vocab" || r.record_type === "retest" || r.record_type === "assessment") && r.passed === false)) out.retest.push(toItem(r, "재시험"));
    else if (r.record_type === "homework" && r.completed === false) out.homework.push(toItem(r, "숙제"));
    else if (r.record_type === "memorization" && r.completed === false) out.memorization.push(toItem(r, "암기"));
  }
  return out;
}
