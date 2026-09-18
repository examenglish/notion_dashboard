import { NextRequest, NextResponse } from "next/server";
import { runMigration } from "@/supabase/scripts/migrate_notion_to_supabase.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// 일회성 Notion -> Supabase 마이그레이션 러너. 이 지점(사직/금정) production
// 배포는 이미 실제 NOTION_TOKEN/NOTION_DB_*를 갖고 있으므로, 여기서는 그
// production runtime의 process.env를 그대로 사용해 supabase/scripts/
// migrate_notion_to_supabase.mjs의 검증된 로직(REVIEW_RESULT: PASS)을
// 그대로 호출한다. 이 파일 자체는 마이그레이션 완료 후 제거된다.
//
// 인증: MIGRATION_ADMIN_SECRET(Vercel 환경변수, 이 배포에서만 아는 값)을
// 아는 사람만 호출 가능. 시크릿이 없거나 틀리면 404로 응답해 엔드포인트의
// 존재 자체를 드러내지 않는다. branch는 클라이언트가 지정할 수 없고, 이
// 배포에 설정된 MIGRATION_BRANCH_CODE로 고정된다(사직/금정 교차 기록 방지).
//
//   curl -X POST https://<배포주소>/api/admin/migrate-supabase \
//     -H "X-Migration-Secret: <MIGRATION_ADMIN_SECRET>" \
//     -H "Content-Type: application/json" \
//     -d '{"execute":false}'
export async function POST(req: NextRequest) {
  // 대시보드 복사-붙여넣기로 앞뒤 공백/개행이 섞여 들어오는 경우가 흔해서
  // 양쪽 다 trim 후 비교한다.
  const expected = process.env.MIGRATION_ADMIN_SECRET?.trim();
  const provided = req.headers.get("x-migration-secret")?.trim();
  if (!expected || !provided || provided !== expected) {
    // 값 자체는 절대 로그에 남기지 않고, 길이만 남겨 공백/누락 여부만 진단한다.
    console.error("migrate-supabase: secret mismatch", {
      expectedConfigured: !!expected,
      expectedLength: expected?.length ?? 0,
      providedLength: provided?.length ?? 0,
    });
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const branch = process.env.MIGRATION_BRANCH_CODE;
  if (!branch) {
    return NextResponse.json({ ok: false, error: "MIGRATION_BRANCH_CODE가 설정되지 않았습니다." }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));

  if (body?.validate === true) {
    return handleValidate(branch);
  }

  const execute = body?.execute === true;

  try {
    const result = await runMigration({ branch, execute });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "마이그레이션 실행 중 오류가 발생했습니다.";
    console.error("migrate-supabase failed", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

// 읽기 전용 검증: Supabase에 실제로 들어간 행 수를 branch_id별로 세서
// 반환한다(Notion에는 접근하지 않음). 호출 측(나)이 직접 얻은 Notion
// read count와 대조해 소스별 수량 일치 + branch 격리를 확인하는 데 쓴다.
const VALIDATE_TABLES = [
  "students", "classes", "class_progress", "daily_records", "briefings",
  "exam_scores", "counseling_entries", "admin_inbox_entries", "tasks", "staff",
  "clinic_records", "material_tasks", "exam_preps", "school_exam_ranges",
  "slack_records", "manuals", "manual_steps",
  "class_students", "class_staff", "class_schedules", "staff_work_schedules",
];

async function handleValidate(branch: string) {
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ ok: false, error: "Supabase 자격증명이 설정되지 않았습니다." }, { status: 500 });
  }
  const headers = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };

  const branchRes = await fetch(`${supabaseUrl}/rest/v1/branches?select=id&code=eq.${encodeURIComponent(branch)}`, { headers });
  if (!branchRes.ok) {
    return NextResponse.json({ ok: false, error: `branch lookup failed (${branchRes.status})` }, { status: 500 });
  }
  const branchRows = (await branchRes.json()) as { id: string }[];
  if (!branchRows.length) {
    return NextResponse.json({ ok: false, error: `branch not found: ${branch}` }, { status: 500 });
  }
  const branchId = branchRows[0].id;

  async function countFor(table: string, filterBranchId: string | null) {
    const url = filterBranchId
      ? `${supabaseUrl}/rest/v1/${table}?select=id&branch_id=eq.${filterBranchId}`
      : `${supabaseUrl}/rest/v1/${table}?select=id`;
    const r = await fetch(url, { method: "HEAD", headers: { ...headers, Prefer: "count=exact", Range: "0-0" } });
    if (!r.ok) return null;
    const range = r.headers.get("content-range"); // "0-0/N" 형태
    const total = range?.split("/")[1];
    return total === undefined || total === "*" ? null : Number(total);
  }

  const counts: Record<string, { thisBranch: number | null; total: number | null }> = {};
  for (const table of VALIDATE_TABLES) {
    const [thisBranch, total] = await Promise.all([countFor(table, branchId), countFor(table, null)]);
    counts[table] = { thisBranch, total };
  }

  return NextResponse.json({ ok: true, branch, branchId, counts });
}
