import { NextRequest, NextResponse } from "next/server";
import { runReconciliation, retryDualWriteFailures, shadowReadCompare, planOrProvisionGeumjeongDatabases, writeSmokeTest } from "@/lib/reconciliation";
import { notion } from "@/lib/notion";

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
  const mode: string = ["retry-failures", "list-databases", "shadow-read", "provision-geumjeong-dbs", "write-smoke-test"].includes(
    body?.mode
  )
    ? body.mode
    : "report";

  try {
    if (mode === "retry-failures") {
      const result = await retryDualWriteFailures(body?.limit ?? 50);
      return NextResponse.json({ ok: true, mode, ...result });
    }
    if (mode === "shadow-read") {
      const result = await shadowReadCompare();
      return NextResponse.json({ ok: true, mode, ...result });
    }
    if (mode === "write-smoke-test") {
      const result = await writeSmokeTest();
      return NextResponse.json({ mode, ...result });
    }
    if (mode === "provision-geumjeong-dbs") {
      const result = await planOrProvisionGeumjeongDatabases(body?.execute === true);
      return NextResponse.json({ ok: true, mode, ...result });
    }
    if (mode === "list-databases") {
      // 읽기 전용 진단: 이 integration이 실제로 접근 가능한 데이터베이스
      // 목록을 보여준다. NOTION_DB_* 환경변수의 ID가 실제 워크스페이스와
      // 안 맞을 때(예: geumjeong의 MATERIAL/EXAM_PREP/SCHOOL_EXAM_RANGE/
      // SLACK_RECORDS), 올바른 data_source_id를 추측이 아니라 실제 목록에서
      // 확인하기 위한 용도다. Notion에 쓰기는 전혀 하지 않는다.
      const results: { id: string; title: string; dataSourceIds: string[] }[] = [];
      let cursor: string | undefined;
      do {
        const res: any = await notion.search({
          filter: { property: "object", value: "data_source" } as any,
          start_cursor: cursor,
          page_size: 100,
        } as any);
        for (const r of res.results as any[]) {
          const title = (r.title ?? []).map((t: any) => t.plain_text).join("") || "(제목없음)";
          results.push({ id: r.id, title, dataSourceIds: [r.id] });
        }
        cursor = res.has_more ? res.next_cursor : undefined;
      } while (cursor);
      return NextResponse.json({ ok: true, mode, databases: results });
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
