import { NextRequest, NextResponse } from "next/server";
import { updateStudentInfo } from "@/lib/notion";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { studentId, enrolledAt, tuitionDay, learningLevel, action, actionAlarmDate } = body ?? {};
  if (!studentId) {
    return NextResponse.json({ error: "studentId는 필수입니다." }, { status: 400 });
  }
  await updateStudentInfo({
    studentId,
    enrolledAt: enrolledAt || undefined,
    tuitionDay: tuitionDay === "" || tuitionDay === undefined ? undefined : Number(tuitionDay),
    learningLevel,
    action,
    actionAlarmDate: actionAlarmDate || undefined,
  });
  return NextResponse.json({ ok: true });
}
