import { NextRequest, NextResponse } from "next/server";
import { completeScheduleEntry, deleteScheduleEntry, updateScheduleEntry } from "@/lib/notion";
import { readStaffRole } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  try {
    if (
      body &&
      (body.date || body.time !== undefined || body.ownerName !== undefined || body.note !== undefined || body.title !== undefined)
    ) {
      await updateScheduleEntry(params.id, body);
      return NextResponse.json({ ok: true });
    }
    await completeScheduleEntry(params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("updateScheduleEntry/completeScheduleEntry failed", params.id, body, err);
    const message = err instanceof Error ? err.message : "저장에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const role = readStaffRole(req);
  if (role !== "원장" && role !== "행정") {
    return NextResponse.json({ error: "삭제는 원장·행정만 할 수 있습니다." }, { status: 403 });
  }
  await deleteScheduleEntry(params.id);
  return NextResponse.json({ ok: true });
}
