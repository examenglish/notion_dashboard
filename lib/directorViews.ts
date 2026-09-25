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
