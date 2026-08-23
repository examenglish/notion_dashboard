import { NextRequest, NextResponse } from "next/server";
import { getStudentsPeriodReports } from "@/lib/notion";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const studentIds = Array.isArray(body?.studentIds) ? body.studentIds.filter((id: unknown) => typeof id === "string") : [];
  const from = typeof body?.from === "string" ? body.from : "";
  const to = typeof body?.to === "string" ? body.to : "";
  if (studentIds.length === 0) {
    return NextResponse.json({ error: "대상 학생을 선택해 주세요." }, { status: 400 });
  }
  if (!from || !to) {
    return NextResponse.json({ error: "기간(시작일~종료일)을 입력해 주세요." }, { status: 400 });
  }
  const reports = await getStudentsPeriodReports(studentIds, from, to);
  return NextResponse.json(reports);
}
