import { NextRequest, NextResponse } from "next/server";
import { createClassProgress, resolveOrCreateClass } from "@/lib/notion";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const {
    classId,
    manualClassName,
    date,
    subjects,
    progress,
    homework,
    nextAssignment,
    notice,
    perStudent,
    briefingTexts,
    extraStudentIds,
  } = body ?? {};

  if ((!classId && !manualClassName) || !date || !progress) {
    return NextResponse.json({ error: "반, 날짜, 진도내용은 필수입니다." }, { status: 400 });
  }

  const resolvedClassId = classId || (await resolveOrCreateClass(manualClassName));

  const result = await createClassProgress({
    classId: resolvedClassId,
    date,
    subjects: Array.isArray(subjects) ? subjects : [],
    progress,
    homework: homework ?? "",
    nextAssignment: nextAssignment ?? "",
    notice: notice ?? "",
    perStudent: perStudent ?? {},
    briefingTexts: briefingTexts ?? undefined,
    extraStudentIds: Array.isArray(extraStudentIds) ? extraStudentIds : [],
  });

  return NextResponse.json({ ok: true, ...result });
}
