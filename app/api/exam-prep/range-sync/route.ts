import { NextRequest, NextResponse } from "next/server";
import { getExamRangeSyncPreview, syncExamRange } from "@/lib/notion";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const school = req.nextUrl.searchParams.get("school") ?? "";
  const grade = req.nextUrl.searchParams.get("grade") ?? "";
  const excludeStudentId = req.nextUrl.searchParams.get("excludeStudentId") ?? "";
  if (!school || !grade) return NextResponse.json([]);
  const preview = await getExamRangeSyncPreview({ school, grade, excludeStudentId });
  return NextResponse.json(preview);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.school !== "string" || typeof body.grade !== "string" || typeof body.examRange !== "string") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  try {
    const updated = await syncExamRange({
      school: body.school,
      grade: body.grade,
      excludeStudentId: typeof body.excludeStudentId === "string" ? body.excludeStudentId : "",
      examRange: body.examRange,
    });
    return NextResponse.json({ updated });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "동기화에 실패했습니다." }, { status: 500 });
  }
}
