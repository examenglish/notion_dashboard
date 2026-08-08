import { NextRequest, NextResponse } from "next/server";
import { checkInAttendance } from "@/lib/notion";

export const dynamic = "force-dynamic";

// 조교·행정용 빠른 결석/단어통과 체크 — 진도 없이 저장 가능.
// 기존 반/날짜 기록이 있으면 출결/단어테스트결과만 덧입히고, 없으면 골격만
// 만들어서 담당교사가 "오늘 수업 기록"에서 나중에 이어 쓸 수 있게 한다.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const classId = typeof body?.classId === "string" ? body.classId : "";
  const date = typeof body?.date === "string" ? body.date : "";
  if (!classId || !date) {
    return NextResponse.json({ error: "반, 날짜는 필수입니다." }, { status: 400 });
  }
  const result = await checkInAttendance({
    classId,
    date,
    perStudent: body?.perStudent ?? {},
    extraStudentIds: Array.isArray(body?.extraStudentIds) ? body.extraStudentIds : [],
    period: typeof body?.period === "string" && body.period ? body.period : undefined,
  });
  return NextResponse.json({ ok: true, ...result });
}
