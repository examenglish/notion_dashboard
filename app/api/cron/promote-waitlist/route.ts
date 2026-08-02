import { NextRequest, NextResponse } from "next/server";
import { promoteWaitlistedStudents } from "@/lib/notion";
import { todayKST } from "@/lib/date";

export const dynamic = "force-dynamic";

// Vercel Cron이 매일 새벽 호출 — 대기생 중 등원일이 도래한 학생을 재원으로
// 전환한다. 이 경로는 middleware의 로그인 세션 검사에서 제외되므로(공개
// 경로), 대신 Vercel이 보내는 Authorization: Bearer $CRON_SECRET 헤더로
// 인증한다. 크론 설정은 vercel.json 참고.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  const promoted = await promoteWaitlistedStudents(todayKST());
  return NextResponse.json({ ok: true, promotedCount: promoted.length, promoted });
}
