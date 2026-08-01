import { NextRequest, NextResponse } from "next/server";
import { createExamScore } from "@/lib/notion";
import { todayKST } from "@/lib/date";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { studentId: string } }) {
  const body = await req.json().catch(() => null);
  const examName = typeof body?.examName === "string" ? body.examName.trim() : "";
  const score = typeof body?.score === "number" ? body.score : NaN;
  if (!examName || Number.isNaN(score)) {
    return NextResponse.json({ error: "시험명과 점수는 필수입니다." }, { status: 400 });
  }
  await createExamScore({
    studentId: params.studentId,
    examName,
    subject: typeof body?.subject === "string" && body.subject ? body.subject : undefined,
    score,
    date: typeof body?.date === "string" && body.date ? body.date : todayKST(),
  });
  return NextResponse.json({ ok: true });
}
