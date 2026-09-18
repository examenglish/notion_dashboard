import { NextRequest, NextResponse } from "next/server";
import { notion, DB } from "@/lib/notion";
import { readStaffRole } from "@/lib/session";

export const dynamic = "force-dynamic";

// 원장 전용 일회성 설정 API — 이 세션(개발 환경)에는 실제 Notion 자격증명이
// 없어 여기서 직접 실행해볼 수 없다. 배포된 앱에서 원장으로 로그인한 뒤
// (개발자도구/curl로) POST 호출하면, 실제 자격증명을 가진 프로덕션 서버가
// 대신 실행한다. 몇 번을 호출해도 안전하도록(멱등) 이미 있는 속성/DB는
// 건드리지 않는다.
//
//   curl -X POST https://<배포주소>/api/admin/setup \
//     -H "Content-Type: application/json" \
//     -b "academy_session=<로그인 쿠키 값>" \
//     -d '{"manualParentPageId":"<매뉴얼 DB를 만들 Notion 페이지 ID>"}'
//
// manualParentPageId를 생략하면 TODO 스키마 추가만 하고 매뉴얼 DB 생성은
// 건너뛴다. 응답의 manual.dataSourceId/manualStep.dataSourceId를
// NOTION_DB_MANUAL / NOTION_DB_MANUAL_STEP 환경변수로 등록해야 매뉴얼
// 기능이 동작한다.

const TODO_NEW_PROPERTIES: Record<string, any> = {
  결과값: { rich_text: {} },
  긴급여부: { checkbox: {} },
  원장확인: { checkbox: {} },
  업무풀: { checkbox: {} },
};

// 속성 하나씩 개별 호출로 추가한다 — 한 번에 여러 개를 보내면 그중 하나만
// 잘못돼도(예: 워크스페이스 정책상 특정 타입 제한) 전체가 실패해 "아무것도
// 안 바뀐 것처럼" 보이는 문제가 있었다. 하나씩 시도하면 나머지는 성공하고,
// 실패한 것만 정확히 원인과 함께 보고할 수 있다.
async function ensureTodoSchema(): Promise<{ added: string[]; failed: { name: string; error: string }[]; alreadyPresent: string[] }> {
  const ds: any = await notion.dataSources.retrieve({ data_source_id: DB.TODO });
  const existing = new Set(Object.keys(ds.properties ?? {}));

  const wanted: Record<string, any> = {
    ...TODO_NEW_PROPERTIES,
    상위업무: { relation: { data_source_id: DB.TODO, type: "single_property", single_property: {} } },
  };

  const added: string[] = [];
  const failed: { name: string; error: string }[] = [];
  const alreadyPresent: string[] = [];

  for (const [name, config] of Object.entries(wanted)) {
    if (existing.has(name)) {
      alreadyPresent.push(name);
      continue;
    }
    try {
      await notion.dataSources.update({ data_source_id: DB.TODO, properties: { [name]: config } } as any);
      added.push(name);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("ensureTodoSchema: failed to add property", name, message);
      failed.push({ name, error: message });
    }
  }
  return { added, failed, alreadyPresent };
}

async function ensureManualDatabases(parentPageId: string | undefined) {
  if (DB.MANUAL && DB.MANUAL_STEP) {
    return { skipped: "이미 설정되어 있습니다(NOTION_DB_MANUAL/NOTION_DB_MANUAL_STEP)." };
  }
  if (!parentPageId) return { skipped: "manualParentPageId가 없어 건너뜁니다." };

  const manualDb: any = await notion.databases.create({
    parent: { type: "page_id", page_id: parentPageId },
    title: [{ type: "text", text: { content: "AI 매뉴얼" } }],
    initial_data_source: {
      properties: {
        제목: { title: {} },
        카테고리: { select: { options: [] } },
        대상역할: { multi_select: { options: [{ name: "원장" }, { name: "행정" }, { name: "강사" }, { name: "조교" }] } },
        상태: { select: { options: [{ name: "DRAFT" }, { name: "REVIEW" }, { name: "PUBLISHED" }] } },
        원본영상: { url: {} },
        요약: { rich_text: {} },
        작성자: { rich_text: {} },
        생성일: { created_time: {} },
        수정일: { last_edited_time: {} },
      },
    } as any,
  });
  const manualDataSourceId = manualDb.data_sources?.[0]?.id;

  const manualStepDb: any = await notion.databases.create({
    parent: { type: "page_id", page_id: parentPageId },
    title: [{ type: "text", text: { content: "AI 매뉴얼 단계" } }],
    initial_data_source: {
      properties: {
        제목: { title: {} },
        매뉴얼: { relation: { data_source_id: manualDataSourceId, type: "single_property", single_property: {} } },
        순서: { number: {} },
        설명: { rich_text: {} },
        스크린샷: { url: {} },
        영상타임스탬프: { rich_text: {} },
        주의사항: { rich_text: {} },
        관련경로: { rich_text: {} },
        키워드: { rich_text: {} },
      },
    } as any,
  });
  const manualStepDataSourceId = manualStepDb.data_sources?.[0]?.id;

  return {
    manual: { databaseId: manualDb.id, dataSourceId: manualDataSourceId },
    manualStep: { databaseId: manualStepDb.id, dataSourceId: manualStepDataSourceId },
  };
}

export async function POST(req: NextRequest) {
  const role = readStaffRole(req);
  if (role !== "원장") {
    return NextResponse.json({ error: "원장만 실행할 수 있습니다." }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const manualParentPageId = typeof body?.manualParentPageId === "string" ? body.manualParentPageId : undefined;

  let todoResult;
  try {
    todoResult = await ensureTodoSchema();
  } catch (err) {
    console.error("admin setup: ensureTodoSchema failed entirely", err);
    const message = err instanceof Error ? err.message : "TODO 속성 조회/추가 중 오류가 발생했습니다.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  let manualResult: any = { skipped: "확인 중 오류" };
  try {
    manualResult = await ensureManualDatabases(manualParentPageId);
  } catch (err) {
    console.error("admin setup: ensureManualDatabases failed", err);
    manualResult = { error: err instanceof Error ? err.message : "매뉴얼 DB 생성 중 오류가 발생했습니다." };
  }

  return NextResponse.json({ ok: true, todo: todoResult, manual: manualResult });
}
