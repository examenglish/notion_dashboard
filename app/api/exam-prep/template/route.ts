import { NextRequest, NextResponse } from "next/server";
import { getExamPrepTemplate } from "@/lib/notion";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const school = req.nextUrl.searchParams.get("school") ?? "";
  const grade = req.nextUrl.searchParams.get("grade") ?? "";
  const excludeStudentId = req.nextUrl.searchParams.get("excludeStudentId") ?? "";
  if (!school || !grade) {
    return NextResponse.json(null);
  }
  const template = await getExamPrepTemplate({ school, grade, excludeStudentId });
  return NextResponse.json(template);
}
