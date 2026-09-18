import { NextRequest, NextResponse } from "next/server";
import { listPublishedStepsByPath } from "@/lib/notion";

export const dynamic = "force-dynamic";

// "? 사용방법"(섹션23) — 현재 화면 경로와 정확히 일치하는 게시된 매뉴얼
// 단계만 돌려준다. DB.MANUAL_STEP이 아직 없으면 조용히 빈 배열.
export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path") ?? "";
  if (!path) return NextResponse.json({ steps: [] });
  const steps = await listPublishedStepsByPath(path);
  return NextResponse.json({ steps });
}
