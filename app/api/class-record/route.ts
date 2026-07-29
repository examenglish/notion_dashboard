import { NextRequest, NextResponse } from "next/server";
import { createClassProgress } from "@/lib/notion";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { classId, date, progress, homework, vocabRange, notes } = body ?? {};

  if (!classId || !date || !progress) {
    return NextResponse.json({ error: "반, 날짜, 진도내용은 필수입니다." }, { status: 400 });
  }

  const result = await createClassProgress({
    classId,
    date,
    progress,
    homework: homework ?? "",
    vocabRange: vocabRange ?? "",
    notes: notes ?? "",
  });

  return NextResponse.json({ ok: true, ...result });
}
