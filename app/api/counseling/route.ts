import { NextRequest, NextResponse } from "next/server";
import { createCounselingEntry, getRecentCounseling } from "@/lib/notion";
import { todayKST } from "@/lib/date";
import { readStaffName } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const items = await getRecentCounseling();
  return NextResponse.json(items);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { studentId, counselor, date, transcript, summary, followUp } = body ?? {};
  if (!studentId || !summary) {
    return NextResponse.json({ error: "학생과 요약 내용은 필수입니다." }, { status: 400 });
  }
  await createCounselingEntry({
    studentId,
    counselor: counselor ?? "",
    date: date || todayKST(),
    transcript: transcript ?? "",
    summary,
    followUp: followUp ?? "",
    enteredBy: readStaffName(req) || undefined,
  });
  return NextResponse.json({ ok: true });
}
