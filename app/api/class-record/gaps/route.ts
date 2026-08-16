import { NextRequest, NextResponse } from "next/server";
import { findClassRecordGaps } from "@/lib/notion";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  const includeExamClasses = req.nextUrl.searchParams.get("includeExamClasses") === "1";
  if (!from || !to) {
    return NextResponse.json({ error: "from, to 날짜가 필요합니다." }, { status: 400 });
  }
  try {
    const gaps = await findClassRecordGaps(from, to, includeExamClasses);
    return NextResponse.json({ gaps });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "조회에 실패했습니다." }, { status: 400 });
  }
}
