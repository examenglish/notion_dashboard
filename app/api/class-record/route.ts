import { NextRequest, NextResponse } from "next/server";
import { createClassProgress } from "@/lib/notion";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { classId, date, subjects, progress, homework, nextAssignment, notice, perStudent } = body ?? {};

  if (!classId || !date || !progress) {
    return NextResponse.json({ error: "반, 날짜, 진도내용은 필수입니다." }, { status: 400 });
  }

  const result = await createClassProgress({
    classId,
    date,
    subjects: Array.isArray(subjects) ? subjects : [],
    progress,
    homework: homework ?? "",
    nextAssignment: nextAssignment ?? "",
    notice: notice ?? "",
    perStudent: perStudent ?? {},
  });

  return NextResponse.json({ ok: true, ...result });
}
