import { NextRequest, NextResponse } from "next/server";
import { saveClassRecordScores } from "@/lib/notion";

export const dynamic = "force-dynamic";

// 이미 저장된 수업 기록이라도 테스트/과제 점수(성취사항)만은 원장/행정이
// 아닌 강사도 바로 추가할 수 있게 하는 전용 저장 경로 — 출결/과제여부 등
// "이미 저장된 기록은 원장/행정만 수정" 대상 필드는 절대 건드리지 않아서
// (lib/notion.ts의 saveClassRecordScores 참고) 여기엔 그 권한 체크가 없다.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const progressId = typeof body?.progressId === "string" ? body.progressId : "";
  const scores = body?.scores && typeof body.scores === "object" ? body.scores : {};
  if (!progressId) {
    return NextResponse.json({ error: "저장된 기록이 없습니다." }, { status: 400 });
  }
  const result = await saveClassRecordScores(progressId, scores);
  return NextResponse.json({ ok: true, ...result });
}
