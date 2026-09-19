// Postgres(Supabase) 기반 READ 경로. ACADEMY_DB_PROVIDER=postgres일 때만
// lib/notion.ts의 일부 목록 조회 함수가 이쪽을 탄다. 반환하는 "id"는 항상
// Postgres PK가 아니라 notion_id다 — write 경로(lib/notion.ts의 create/
// update 함수들)가 여전히 Notion page id를 받아 notion.pages.update를
// 호출하므로, READ만 먼저 전환된 과도기에도 "목록에서 고른 항목을 수정"이
// 그대로 동작해야 하기 때문이다.
//
// 학생 누적출석률/숙제제출률/단어테스트통과율은 원래 Notion rollup이었다
// (Notion 서버가 relation을 따라 실시간 집계하는 값이라 Supabase에 그대로
// 미러링되지 않음). 아래 pgSearchStudents/pgGetStudent는 그 rollup을 그대로
// 베끼는 대신, daily_records를 직접 집계해 재구현한다 — 집계 규칙은 이미
// lib/notion.ts의 getStudentPeriodReport/getMonthlyStudentMetrics가 같은
// 화면 계열(누적 지표)에 쓰고 있던 것과 동일하게 맞춘다: 전체 일일기록
// 중 "출결≠결석"이면 출석, "과제여부" 체크박스, "단어테스트결과=통과"
// 비율 — 분모는 그 학생의 전체 일일기록 수(기간 제한 없음, "누적"이므로).
import { branchCode } from "./supabaseRepo";
import { taskTypeFromLabel } from "./tasks";
import { todayKST } from "./date";
import { stripClassSuffix } from "./format";

function supabaseEnv(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

let branchIdCache: Promise<string | null> | null = null;
async function branchId(): Promise<string | null> {
  const env = supabaseEnv();
  const code = branchCode();
  if (!env || !code) return null;
  if (!branchIdCache) {
    branchIdCache = (async () => {
      const r = await fetch(`${env.url}/rest/v1/branches?select=id&code=eq.${encodeURIComponent(code)}`, {
        headers: { apikey: env.key, Authorization: `Bearer ${env.key}` },
      });
      if (!r.ok) return null;
      const rows = (await r.json()) as { id: string }[];
      return rows[0]?.id ?? null;
    })();
  }
  const id = await branchIdCache;
  if (!id) branchIdCache = null;
  return id;
}

async function pgFetch(table: string, query: string): Promise<any[]> {
  const env = supabaseEnv();
  const bid = await branchId();
  if (!env || !bid) throw new Error("Postgres read requested but Supabase/branch is not configured.");
  const out: any[] = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await fetch(`${env.url}/rest/v1/${table}?branch_id=eq.${bid}&${query}`, {
      headers: { apikey: env.key, Authorization: `Bearer ${env.key}`, Range: `${offset}-${offset + 999}` },
    });
    if (!r.ok) throw new Error(`Supabase read ${table} failed (${r.status})`);
    const rows = await r.json();
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

// archived Notion 페이지는 source_payload.archived로만 구분된다(전용 컬럼 없음).
function notArchived(row: any): boolean {
  return row?.source_payload?.archived !== true;
}

/**
 * 화면/후속 요청에 노출할 "id"는 원래 항상 notion_id였다(위 파일 헤더 참고).
 * postgres-primary 경로(STAFF/CLASS/STUDENT create)가 Notion 미러보다 먼저
 * 끝나면 이 시점의 notion_id는 아직 null이다 — 그 경우에만 postgres 고유
 * id(uuid)로 대체한다. notion_id가 채워진 행(기존 이전 데이터, 또는 미러가
 * 이미 끝난 신규 행)은 지금까지와 동일하게 notion_id를 그대로 쓴다.
 */
export function displayId(row: Record<string, unknown>): string {
  return (row.notion_id as string | null) ?? (row.id as string);
}

// teachers/day_teachers는 원본 텍스트 그대로 돌려준다 — splitTeachers/
// parseDayTeachers(lib/format.ts)로 파싱하는 건 호출부(lib/notion.ts)가
// Notion 경로와 동일하게 담당한다.
export async function pgListClassesRaw() {
  const rows = await pgFetch("classes", "select=*");
  return rows.filter(notArchived).map((r) => ({
    id: displayId(r),
    name: r.name as string,
    teachersRaw: (r.teachers as string) ?? "",
    dayTeachersRaw: (r.day_teachers as string) ?? "",
    days: (r.days as string[]) ?? [],
    time: (r.time_text as string) ?? "",
    level: r.level as string | null,
    type: (r.category as string | null) ?? "정규",
    studentIds: (r.student_notion_ids as string[]) ?? [],
    assistantIds: (r.assistant_notion_ids as string[]) ?? [],
  }));
}

export async function pgListStaff() {
  const rows = await pgFetch("staff", "select=*");
  return rows
    .filter((r) => !r.resigned)
    .map((r) => ({ id: displayId(r), name: r.name, role: r.role, workHoursRaw: r.work_schedule ?? "" }));
}

export async function pgStudentNameMap(): Promise<Map<string, string>> {
  const rows = await pgFetch("students", "select=id,notion_id,name");
  return new Map(rows.map((r) => [displayId(r), r.name]));
}

export async function pgStaffNameMap(): Promise<Map<string, string>> {
  const rows = await pgFetch("staff", "select=id,notion_id,name");
  return new Map(rows.map((r) => [displayId(r), r.name]));
}

type PgTaskRow = {
  notion_id: string;
  staff_notion_ids: string[];
  student_notion_ids: string[];
  type: string | null;
  title: string | null;
  due_date: string | null;
  time_text: string | null;
  memo: string | null;
  priority: string | null;
  complete: boolean | null;
  outcome: string | null;
  urgent: boolean | null;
  director_ack: boolean | null;
  pool: boolean | null;
  parent_task_notion_ids: string[];
  source_payload: any;
};

const NEW_TASK_TYPE_LABELS = new Set(["보강", "재시", "신입생상담", "레벨체크", "클리닉", "복습", "조치사항", "개인할일"]);

function mapPgTask(r: PgTaskRow, studentNames: Map<string, string>, staffNames: Map<string, string>) {
  const studentId = r.student_notion_ids?.[0] ?? null;
  const ownerId = r.staff_notion_ids?.[0] ?? null;
  const typeLabel = r.type ?? "";
  return {
    id: r.notion_id,
    type: taskTypeFromLabel(typeLabel),
    typeLabel,
    title: r.title ?? "",
    studentId,
    studentName: studentId ? studentNames.get(studentId) ?? "-" : "-",
    ownerId,
    ownerName: ownerId ? staffNames.get(ownerId) ?? "-" : "",
    date: r.due_date,
    time: r.time_text ?? "",
    note: r.memo ?? "",
    priority: r.priority,
    done: !!r.complete,
    outcome: r.outcome ?? "",
    urgent: !!r.urgent,
    directorAck: !!r.director_ack,
    pool: !!r.pool,
    parentTaskId: r.parent_task_notion_ids?.[0] ?? null,
  };
}

export async function pgListMyTasks(staffNotionId: string, studentNames: Map<string, string>, staffNames: Map<string, string>) {
  const rows = (await pgFetch("tasks", "select=*&complete=eq.false")) as PgTaskRow[];
  return rows
    .filter(notArchived)
    .filter((r) => NEW_TASK_TYPE_LABELS.has(r.type ?? ""))
    .filter((r) => r.staff_notion_ids?.includes(staffNotionId))
    .map((r) => mapPgTask(r, studentNames, staffNames));
}

export async function pgListPoolTasks(studentNames: Map<string, string>, staffNames: Map<string, string>) {
  const rows = (await pgFetch("tasks", "select=*&pool=eq.true&complete=eq.false")) as PgTaskRow[];
  return rows
    .filter(notArchived)
    .filter((r) => !r.staff_notion_ids || r.staff_notion_ids.length === 0)
    .map((r) => mapPgTask(r, studentNames, staffNames));
}

const DAY_MS = 24 * 60 * 60 * 1000;
// lib/notion.ts의 isWithinDays와 동일한 규칙(서버 로컬 타임존이 아니라
// 항상 KST 달력일 기준 Y/M/D 비교) — 별도 export가 없어 여기서 그대로 재구현한다.
function isWithinDays(dateStr: string | null, days: number): boolean {
  if (!dateStr) return false;
  const [y, m, d] = dateStr.split("-").map(Number);
  const [ty, tm, td] = todayKST().split("-").map(Number);
  const diff = Date.UTC(ty, tm - 1, td) - Date.UTC(y, m - 1, d);
  return diff >= 0 && diff <= days * DAY_MS;
}

type DailyAgg = { total: number; present: number; hwDone: number; vocabPass: number };

async function studentDailyAggMap(): Promise<Map<string, DailyAgg>> {
  const rows = await pgFetch("daily_records", "select=student_notion_ids,attendance,homework_done,vocab_result");
  const map = new Map<string, DailyAgg>();
  for (const r of rows) {
    const sid = (r.student_notion_ids as string[] | null)?.[0];
    if (!sid) continue;
    const cur = map.get(sid) ?? { total: 0, present: 0, hwDone: 0, vocabPass: 0 };
    cur.total += 1;
    if (r.attendance !== "결석") cur.present += 1;
    if (r.homework_done) cur.hwDone += 1;
    if (r.vocab_result === "통과") cur.vocabPass += 1;
    map.set(sid, cur);
  }
  return map;
}

type LatestExam = { date: string; score: number | null; subject: string | null; examName: string };

async function studentLatestExamMap(): Promise<Map<string, LatestExam>> {
  const rows = await pgFetch("exam_scores", "select=student_notion_ids,exam_date,score,subject,exam_name");
  const map = new Map<string, LatestExam>();
  for (const r of rows) {
    const sid = (r.student_notion_ids as string[] | null)?.[0];
    const date = r.exam_date as string | null;
    if (!sid || !date) continue;
    const existing = map.get(sid);
    if (!existing || date > existing.date) {
      map.set(sid, { date, score: (r.score as number | null) ?? null, subject: (r.subject as string | null) ?? null, examName: (r.exam_name as string) ?? "" });
    }
  }
  return map;
}

async function classNamePgMap(): Promise<Map<string, string>> {
  const rows = await pgFetch("classes", "select=id,notion_id,name,source_payload");
  return new Map(
    rows.filter(notArchived).map((r) => [displayId(r), stripClassSuffix((r.name as string) ?? "")])
  );
}

export type PgStudentRecord = ReturnType<typeof mapPgStudent>;

function mapPgStudent(
  r: Record<string, unknown>,
  aggMap: Map<string, DailyAgg>,
  examMap: Map<string, LatestExam>,
  classNames: Map<string, string>
) {
  const notionId = displayId(r);
  const classIds = (r.class_notion_ids as string[]) ?? [];
  const agg = aggMap.get(notionId);
  const enrolledAt = (r.attendance_started_on as string | null) ?? null;
  const levelLv = r.level_lv;
  return {
    id: notionId,
    name: r.name as string,
    school: (r.school as string) ?? "",
    grade: (r.grade as string | null) ?? null,
    status: (r.status as string | null) ?? null,
    phone: (r.phone as string | null) ?? null,
    parentPhone: (r.guardian_phone as string | null) ?? null,
    classIds,
    classNames: classIds.map((id) => classNames.get(id) ?? "알수없음"),
    attendanceRate: agg && agg.total > 0 ? agg.present / agg.total : null,
    homeworkRate: agg && agg.total > 0 ? agg.hwDone / agg.total : null,
    vocabPassRate: agg && agg.total > 0 ? agg.vocabPass / agg.total : null,
    registeredAt: (r.enrolled_on as string | null) ?? null,
    enrolledAt,
    isNew: isWithinDays(enrolledAt, 30),
    tuitionDay: (r.fee_day as number | null) ?? null,
    learningLevel: (r.learning_level as string) ?? "",
    levelOverride: levelLv === null || levelLv === undefined || levelLv === "" ? null : Number(levelLv),
    memo: (r.memo as string) ?? "",
    action: (r.action as string) ?? "",
    actionOwner: (r.action_assignee_text as string) ?? "",
    actionAlarmDate: (r.action_alarm_on as string | null) ?? null,
    latestExam: examMap.get(notionId) ?? null,
  };
}

export async function pgSearchStudents(query: string, classId?: string, includeInactive = false) {
  const [rows, aggMap, examMap, classNames] = await Promise.all([
    pgFetch("students", "select=*"),
    studentDailyAggMap(),
    studentLatestExamMap(),
    classNamePgMap(),
  ]);
  let mapped = rows.filter(notArchived).map((r) => mapPgStudent(r, aggMap, examMap, classNames));
  if (query) mapped = mapped.filter((s) => s.name.includes(query));
  if (!includeInactive) mapped = mapped.filter((s) => s.status !== "퇴원" && s.status !== "휴원");
  if (classId) mapped = mapped.filter((s) => s.classIds.includes(classId));
  return mapped;
}

export type NlRosterStudent = {
  id: string;
  name: string;
  school: string;
  grade: string | null;
  status: string | null;
  classIds: string[];
};

// 자연어 입력 roster 전용 — pgSearchStudents는 daily_records/exam_scores
// 테이블 전체를 스캔해 출석률/최근성적을 붙이는데(mapPgStudent), 자연어
// 입력은 이름/학교/학년/상태/반 매칭에만 쓰고 그 두 집계는 전혀 안 쓴다.
// 실측 결과 그 두 전체조회가 nl-roster 조회 시간(2.7초)의 대부분을
// 차지해서(2026-09-19, staff.md PART 8) 그 부분을 아예 빼고 students
// 테이블만 읽는 가벼운 버전을 따로 둔다.
export async function pgListNlRosterStudents(): Promise<NlRosterStudent[]> {
  const rows = await pgFetch("students", "select=id,notion_id,name,school,grade,status,class_notion_ids,source_payload");
  return rows.filter(notArchived).map((r) => ({
    id: displayId(r),
    name: r.name as string,
    school: (r.school as string) ?? "",
    grade: (r.grade as string | null) ?? null,
    status: (r.status as string | null) ?? null,
    classIds: (r.class_notion_ids as string[]) ?? [],
  }));
}

export async function pgGetStudent(id: string): Promise<PgStudentRecord | null> {
  // id는 notion_id(legacy)일 수도, postgres-primary가 방금 만든 자체 uuid일
  // 수도 있다 — displayId()가 만드는 값과 대칭을 맞춰 둘 다 매칭한다.
  const enc = encodeURIComponent(id);
  const [rows, aggMap, examMap, classNames] = await Promise.all([
    pgFetch("students", `or=(notion_id.eq.${enc},id.eq.${enc})&select=*`),
    studentDailyAggMap(),
    studentLatestExamMap(),
    classNamePgMap(),
  ]);
  const row = rows[0];
  return row ? mapPgStudent(row, aggMap, examMap, classNames) : null;
}

export async function pgListManuals(opts: { status?: string } = {}) {
  const rows = await pgFetch("manuals", opts.status ? `select=*&status=eq.${encodeURIComponent(opts.status)}` : "select=*");
  return rows.filter(notArchived).map((r) => ({
    id: r.notion_id,
    title: r.title,
    category: r.category ?? "",
    targetRoles: r.target_roles ?? [],
    status: r.status ?? "DRAFT",
    sourceVideoUrl: r.video_url,
    summary: r.summary ?? "",
    createdBy: r.author ?? "",
    createdAt: r.source_payload?.notion_created_time ?? r.created_at ?? null,
  }));
}
