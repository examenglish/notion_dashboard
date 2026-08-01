import { NextRequest, NextResponse } from "next/server";
import {
  createClassProgress,
  getClassProgressForEdit,
  getPlannedAbsentStudentIds,
  resolveOrCreateClass,
  updateClassProgress,
} from "@/lib/notion";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const classId = req.nextUrl.searchParams.get("classId");
  const date = req.nextUrl.searchParams.get("date");
  if (!classId || !date) return NextResponse.json({ existing: null, plannedAbsentIds: [] });
  const [existing, plannedAbsentIds] = await Promise.all([
    getClassProgressForEdit(classId, date),
    getPlannedAbsentStudentIds(date),
  ]);
  return NextResponse.json({ existing, plannedAbsentIds });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const {
    progressId,
    classId,
    manualClassName,
    date,
    subjects,
    progress,
    homework,
    nextAssignment,
    notice,
    perStudent,
    extraStudentIds,
  } = body ?? {};

  if (!progressId || (!classId && !manualClassName) || !date || !progress) {
    return NextResponse.json({ error: "반, 날짜, 진도내용은 필수입니다." }, { status: 400 });
  }

  const resolvedClassId = classId || (await resolveOrCreateClass(manualClassName));

  await updateClassProgress({
    progressId,
    classId: resolvedClassId,
    date,
    subjects: Array.isArray(subjects) ? subjects : [],
    progress,
    homework: homework ?? "",
    nextAssignment: nextAssignment ?? "",
    notice: notice ?? "",
    perStudent: perStudent ?? {},
    extraStudentIds: Array.isArray(extraStudentIds) ? extraStudentIds : [],
  });

  return NextResponse.json({ ok: true });
}

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
    reviewDays,
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
    reviewDays: reviewDays ? Number(reviewDays) : undefined,
  });

  return NextResponse.json({ ok: true, ...result });
}
