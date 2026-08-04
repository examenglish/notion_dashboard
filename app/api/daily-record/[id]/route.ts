import { NextRequest, NextResponse } from "next/server";
import { deleteDailyRecordEntry } from "@/lib/notion";
import { readStaffRole } from "@/lib/session";

export const dynamic = "force-dynamic";

// 학생별 전체기록(진도/과제 기록)의 개별 행 삭제 — 반 전체 진도가 아니라
// 그 학생의 출결/과제 행 하나만 지운다. 원장만 가능.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  if (readStaffRole(req) !== "원장") {
    return NextResponse.json({ error: "삭제는 원장만 할 수 있습니다." }, { status: 403 });
  }
  await deleteDailyRecordEntry(params.id);
  return NextResponse.json({ ok: true });
}
