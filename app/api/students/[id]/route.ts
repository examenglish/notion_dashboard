import { NextResponse } from "next/server";
import { getStudent, getStudentDailyRecords, getStudentExamScores } from "@/lib/notion";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const [student, dailyRecords, examScores] = await Promise.all([
    getStudent(params.id),
    getStudentDailyRecords(params.id),
    getStudentExamScores(params.id),
  ]);
  return NextResponse.json({ student, dailyRecords, examScores });
}
