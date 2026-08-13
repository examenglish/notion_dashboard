import { NextRequest, NextResponse } from "next/server";
import { getAssistantClinicRecordsByDate } from "@/lib/notion";
import { readStaffId } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const assistantId = readStaffId(req);
  if (!assistantId) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  const date = req.nextUrl.searchParams.get("date");
  if (!date) {
    return NextResponse.json({ error: "날짜를 선택해주세요." }, { status: 400 });
  }
  try {
    const records = await getAssistantClinicRecordsByDate(assistantId, date);
    return NextResponse.json(records);
  } catch (err) {
    console.error("getAssistantClinicRecordsByDate failed", assistantId, date, err);
    return NextResponse.json({ error: "기록을 불러오지 못했습니다." }, { status: 500 });
  }
}
