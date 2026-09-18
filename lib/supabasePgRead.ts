// Postgres(Supabase) 기반 READ 경로. ACADEMY_DB_PROVIDER=postgres일 때만
// lib/notion.ts의 일부 목록 조회 함수가 이쪽을 탄다. 반환하는 "id"는 항상
// Postgres PK가 아니라 notion_id다 — write 경로(lib/notion.ts의 create/
// update 함수들)가 여전히 Notion page id를 받아 notion.pages.update를
// 호출하므로, READ만 먼저 전환된 과도기에도 "목록에서 고른 항목을 수정"이
// 그대로 동작해야 하기 때문이다.
//
// 주의: Notion의 rollup 속성(학생 누적출석률/숙제제출률/단어테스트통과율
// 등)은 Supabase에 미러링되지 않는다(Notion 서버가 relation을 따라 실시간
// 집계하는 값이라 우리 T() 매핑 대상이 아님) — 그래서 학생 목록/상세처럼
// 그 값을 쓰는 화면은 이 파일에 아직 옮기지 않았다. 여기 있는 함수들은
// 전부 그 문제와 무관한(순수 저장 필드만 쓰는) 목록들이다.
import { branchCode } from "./supabaseRepo";
import { taskTypeFromLabel } from "./tasks";

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

// teachers/day_teachers는 원본 텍스트 그대로 돌려준다 — splitTeachers/
// parseDayTeachers(lib/format.ts)로 파싱하는 건 호출부(lib/notion.ts)가
// Notion 경로와 동일하게 담당한다.
export async function pgListClassesRaw() {
  const rows = await pgFetch("classes", "select=*");
  return rows.filter(notArchived).map((r) => ({
    id: r.notion_id as string,
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
    .map((r) => ({ id: r.notion_id, name: r.name, role: r.role, workHoursRaw: r.work_schedule ?? "" }));
}

export async function pgStudentNameMap(): Promise<Map<string, string>> {
  const rows = await pgFetch("students", "select=notion_id,name");
  return new Map(rows.map((r) => [r.notion_id, r.name]));
}

export async function pgStaffNameMap(): Promise<Map<string, string>> {
  const rows = await pgFetch("staff", "select=notion_id,name");
  return new Map(rows.map((r) => [r.notion_id, r.name]));
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
