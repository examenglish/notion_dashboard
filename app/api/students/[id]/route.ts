import { NextRequest, NextResponse } from "next/server";
import { getStudent, getStudentDailyRecords, getStudentExamScores, updateStudentFull } from "@/lib/notion";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const [student, dailyRecords, examScores] = await Promise.all([
    getStudent(params.id),
    getStudentDailyRecords(params.id),
    getStudentExamScores(params.id),
  ]);
  return NextResponse.json({ student, dailyRecords, examScores });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { name, school, grade, status, phone, parentPhone, registeredAt, enrolledAt, tuitionDay, learningLevel, classIds, memo } = body;
  await updateStudentFull(params.id, {
    name,
    school,
    grade,
    status,
    phone,
    parentPhone,
    registeredAt,
    enrolledAt,
    tuitionDay: tuitionDay === "" || tuitionDay === undefined ? undefined : Number(tuitionDay),
    learningLevel,
    classIds,
    memo,
  });
  return NextResponse.json({ ok: true });
}
