import { NextRequest, NextResponse } from "next/server";
import { createClinicRecord, getRecentClinicRecords } from "@/lib/notion";
import { readStaffId } from "@/lib/session";
import { todayKST } from "@/lib/date";

export const dynamic = "force-dynamic";

export async function GET() {
  const records = await getRecentClinicRecords();
  return NextResponse.json(records);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { studentIds, teacherId, date, content, nextPrep } = body ?? {};
  const assistantId = readStaffId(req);
  if (!assistantId) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (!Array.isArray(studentIds) || studentIds.length === 0 || !content) {
    return NextResponse.json({ error: "학생과 진행내용은 필수입니다." }, { status: 400 });
  }
  await createClinicRecord({
    assistantId,
    studentIds,
    teacherId: teacherId || undefined,
    date: date || todayKST(),
    content,
    nextPrep: nextPrep ?? "",
  });
  return NextResponse.json({ ok: true });
}
