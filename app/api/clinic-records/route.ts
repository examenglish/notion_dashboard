import { NextRequest, NextResponse } from "next/server";
import { createClinicRecord, getRecentClinicRecords } from "@/lib/notion";
import { readStaffId } from "@/lib/session";
import { todayKST } from "@/lib/date";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const records = await getRecentClinicRecords();
    return NextResponse.json(records);
  } catch (err) {
    console.error("getRecentClinicRecords failed", err);
    return NextResponse.json({ error: "기록을 불러오지 못했습니다." }, { status: 500 });
  }
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
  try {
    await createClinicRecord({
      assistantId,
      studentIds,
      teacherId: teacherId || undefined,
      date: date || todayKST(),
      content,
      nextPrep: nextPrep ?? "",
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("createClinicRecord failed", assistantId, studentIds, err);
    return NextResponse.json({ error: "저장에 실패했습니다. 잠시 후 다시 시도해 주세요." }, { status: 500 });
  }
}
