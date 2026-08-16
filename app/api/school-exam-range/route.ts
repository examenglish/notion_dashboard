import { NextRequest, NextResponse } from "next/server";
import { getSchoolExamRange, getSchoolExamRangeHistory, upsertSchoolExamRange } from "@/lib/notion";

export const dynamic = "force-dynamic";

// 학생 시트(읽기 전용 표시)와 "학교 찾기" 관리 화면이 공유하는 조회 API —
// 최신 값과 이력을 한 번에 내려준다.
export async function GET(req: NextRequest) {
  const school = req.nextUrl.searchParams.get("school") ?? "";
  const grade = req.nextUrl.searchParams.get("grade") ?? "";
  if (!school || !grade) {
    return NextResponse.json({ latest: null, history: [] });
  }
  const [latest, history] = await Promise.all([
    getSchoolExamRange(school, grade),
    getSchoolExamRangeHistory(school, grade),
  ]);
  return NextResponse.json({ latest, history });
}

// "학교 찾기" 관리 화면에서만 호출 — 학교+학년 단위로 시험범위를 갱신한다.
// 개별 학생 시트에서는 이 값을 절대 쓰지 않는다(읽기 전용).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (
    !body ||
    typeof body.school !== "string" ||
    typeof body.grade !== "string" ||
    typeof body.examTitle !== "string" ||
    typeof body.examRange !== "string" ||
    !body.school.trim() ||
    !body.grade.trim() ||
    !body.examTitle.trim()
  ) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  try {
    const entry = await upsertSchoolExamRange({
      school: body.school,
      grade: body.grade,
      examTitle: body.examTitle,
      examRange: body.examRange,
      textbookName: typeof body.textbookName === "string" ? body.textbookName : "",
      textbookUnits: Array.isArray(body.textbookUnits) ? body.textbookUnits.filter((u: unknown) => typeof u === "string") : [],
    });
    return NextResponse.json(entry);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "저장에 실패했습니다." }, { status: 500 });
  }
}
