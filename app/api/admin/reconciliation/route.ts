import { NextRequest, NextResponse } from "next/server";
import { runReconciliation, retryDualWriteFailures } from "@/lib/reconciliation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// Notion(정본) <-> Supabase(dual-write 미러) 상시 대조/재처리 도구.
// 일회성이었던 /api/admin/migrate-supabase와 달리 이 엔드포인트는 계속
// 남는다 — dual-write가 운영 중 계속 정상인지 주기적으로 확인하는 용도.
//
// 인증: MIGRATION_ADMIN_SECRET(마이그레이션 때 등록한 값, 계속 재사용)을
// 아는 사람만 호출 가능. 불일치 시 404.
//
//   curl -X POST https://<배포주소>/api/admin/reconciliation \
//     -H "X-Migration-Secret: <MIGRATION_ADMIN_SECRET>" \
//     -H "Content-Type: application/json" \
//     -d '{"mode":"report"}'   # 또는 {"mode":"retry-failures"}
export async function POST(req: NextRequest) {
  const expected = process.env.MIGRATION_ADMIN_SECRET?.trim();
  const provided = req.headers.get("x-migration-secret")?.trim();
  if (!expected || !provided || provided !== expected) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const mode = body?.mode === "retry-failures" ? "retry-failures" : "report";

  try {
    if (mode === "retry-failures") {
      const result = await retryDualWriteFailures(body?.limit ?? 50);
      return NextResponse.json({ ok: true, mode, ...result });
    }
    const result = await runReconciliation();
    if ("error" in result) return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
    return NextResponse.json({ ok: true, mode, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "reconciliation 중 오류가 발생했습니다.";
    console.error("reconciliation failed", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
