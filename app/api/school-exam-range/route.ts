import { NextRequest, NextResponse } from "next/server";
import { getSchoolExamRange, getSchoolExamRangeHistory, upsertSchoolExamRange, type CategoryUnits } from "@/lib/notion";
import { TEXT_CATEGORIES, type TextCategory } from "@/lib/examPrep";

export const dynamic = "force-dynamic";

function parseUnitsBody(body: any): Record<TextCategory, CategoryUnits> {
  const result = {} as Record<TextCategory, CategoryUnits>;
  const raw = body?.units && typeof body.units === "object" ? body.units : {};
  for (const cat of TEXT_CATEGORIES) {
    const entry = raw[cat];
    result[cat] = {
      name: typeof entry?.name === "string" ? entry.name : "",
      units: Array.isArray(entry?.units) ? entry.units.filter((u: unknown) => typeof u === "string") : [],
    };
  }
  return result;
}

// 학생 시트(읽기 전용 표시)와 "학교별 시험범위 입력" 화면이 공유하는 조회
// API — 최신 값과 이력을 한 번에 내려준다.
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

// "학교별 시험범위 입력" 화면에서만 호출 — 학교+학년 단위로 시험범위/단원
// 틀을 갱신한다. 개별 학생 시트에서는 이 값을 절대 쓰지 않는다(읽기 전용).
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
      units: parseUnitsBody(body),
    });
    return NextResponse.json(entry);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "저장에 실패했습니다." }, { status: 500 });
  }
}
