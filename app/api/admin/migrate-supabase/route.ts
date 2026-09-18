import { NextRequest, NextResponse } from "next/server";
import { runMigration } from "@/supabase/scripts/migrate_notion_to_supabase.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

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
  const expected = process.env.MIGRATION_ADMIN_SECRET;
  const provided = req.headers.get("x-migration-secret");
  if (!expected || !provided || provided !== expected) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const branch = process.env.MIGRATION_BRANCH_CODE;
  if (!branch) {
    return NextResponse.json({ ok: false, error: "MIGRATION_BRANCH_CODE가 설정되지 않았습니다." }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
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
