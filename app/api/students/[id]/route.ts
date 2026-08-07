import { NextRequest, NextResponse } from "next/server";
import { getStudent, getStudentDailyRecords, getStudentExamScores, updateStudentFull } from "@/lib/notion";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const [student, dailyRecords, examScores] = await Promise.all([
      getStudent(params.id),
      getStudentDailyRecords(params.id),
      getStudentExamScores(params.id),
    ]);
    return NextResponse.json({ student, dailyRecords, examScores });
  } catch (err) {
    // 예외가 나면 Next가 non-JSON 500을 반환해 클라이언트의 r.json()이
    // 조용히 실패한다 — 이 학생을 검색해서 담당 학생으로 등록하려던 화면
    // (조교 클리닉 입력 등)에서는 아무 반응도 없이 등록만 안 되는 것처럼
    // 보였다. JSON 에러로 원인을 남긴다.
    console.error("getStudent failed", params.id, err);
    return NextResponse.json({ error: "학생 정보를 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { name, school, grade, status, phone, parentPhone, registeredAt, enrolledAt, tuitionDay, learningLevel, levelOverride, classIds, memo } = body;
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
    levelOverride: levelOverride === undefined ? undefined : levelOverride === null ? null : Number(levelOverride),
    classIds,
    memo,
  });
  return NextResponse.json({ ok: true });
}
