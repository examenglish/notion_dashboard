import { NextRequest, NextResponse } from "next/server";
import { createScheduleEntry } from "@/lib/notion";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { type, studentId, date, time, note } = body ?? {};
  if (!type || !date) {
    return NextResponse.json({ error: "유형과 날짜는 필수입니다." }, { status: 400 });
  }
  await createScheduleEntry({ type, studentId: studentId || null, date, time: time ?? "", note: note ?? "" });
  return NextResponse.json({ ok: true });
}
