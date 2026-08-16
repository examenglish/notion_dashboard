import { NextRequest, NextResponse } from "next/server";
import {
  createClassProgress,
  getClassProgressForEdit,
  getPlannedAbsentStudentIds,
  resolveOrCreateClass,
  updateClassProgress,
} from "@/lib/notion";
import { readStaffRole } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const classId = req.nextUrl.searchParams.get("classId");
  const date = req.nextUrl.searchParams.get("date");
  const period = req.nextUrl.searchParams.get("period") || undefined;
  if (!classId || !date) return NextResponse.json({ existing: null, plannedAbsentIds: [] });
  const [existing, plannedAbsentIds] = await Promise.all([
    getClassProgressForEdit(classId, date, period),
    getPlannedAbsentStudentIds(date),
  ]);
  return NextResponse.json({ existing, plannedAbsentIds });
}

// 이미 저장된 진도 기록을 수정하는 것은 원장/행정만 허용한다 — 강사/조교가
// 날짜를 바꿔 다른 날 수업을 입력하다가 실수로 이전에 이미 확정된 출결/
// 단어미통과/과제미완료 기록을 덮어쓰는 사고를 막기 위한 마지막 방어선.
// (근본 원인인 날짜변경 시 상태 미초기화 버그는 InputClient.tsx에서 고쳤지만,
// 이 라우트 자체에도 그동안 권한 체크가 전혀 없었다.)
function canEditExisting(role: string): boolean {
  return role === "원장" || role === "행정";
}

export async function PATCH(req: NextRequest) {
  if (!canEditExisting(readStaffRole(req))) {
    return NextResponse.json({ error: "이미 저장된 수업 기록의 수정은 원장/행정만 가능합니다." }, { status: 403 });
  }
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
    period,
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
    period: period || undefined,
  });

  return NextResponse.json({ ok: true, ...result });
}
