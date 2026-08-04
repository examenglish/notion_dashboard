import { NextRequest, NextResponse } from "next/server";
import { deleteStudentActionAlarm } from "@/lib/notion";
import { readStaffRole } from "@/lib/session";

export const dynamic = "force-dynamic";

// "오늘의 일정 > 학습레벨/조치사항" 알람 삭제. 원장만 가능.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  if (readStaffRole(req) !== "원장") {
    return NextResponse.json({ error: "삭제는 원장만 할 수 있습니다." }, { status: 403 });
  }
  await deleteStudentActionAlarm(params.id);
  return NextResponse.json({ ok: true });
}
