import { NextRequest, NextResponse } from "next/server";
import { readStaffRole } from "@/lib/session";
import { analyzeManualFrames } from "@/lib/manual-ai";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 업로드된 key frame(스크린샷) URL들을 AI로 분석해 단계별 초안을 만든다.
// 아직 Notion에 아무것도 저장하지 않는다 — 관리자가 검토 화면에서 확인한
// 뒤 /api/manuals(POST)로 실제 등록한다(섹션21, AI 결과 자동 공개 금지).
export async function POST(req: NextRequest) {
  const role = readStaffRole(req);
  if (role !== "원장" && role !== "행정" && role !== "강사") {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const frames = Array.isArray(body?.frames) ? body.frames : [];
  if (frames.length === 0) {
    return NextResponse.json({ error: "분석할 스크린샷이 없습니다." }, { status: 400 });
  }
  try {
    const result = await analyzeManualFrames(frames);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("manual analyze failed", err);
    return NextResponse.json({ error: "AI 분석 중 오류가 발생했습니다." }, { status: 502 });
  }
}
