import { NextRequest, NextResponse } from "next/server";
import { updateStaffSchedule } from "@/lib/notion";
import { readStaffRole } from "@/lib/session";

export const dynamic = "force-dynamic";

// 근무 요일/시간 설정은 원장/행정만 — 조교 본인이 스스로 근무시간을 늘려
// 놓는 걸 막기 위함.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const role = readStaffRole(req);
  if (role !== "원장" && role !== "행정") {
    return NextResponse.json({ error: "원장/행정만 근무시간을 설정할 수 있습니다." }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const workDays = Array.isArray(body?.workDays) ? body.workDays : [];
  const workStart = typeof body?.workStart === "string" ? body.workStart : "";
  const workEnd = typeof body?.workEnd === "string" ? body.workEnd : "";
  try {
    await updateStaffSchedule(params.id, { workDays, workStart, workEnd });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("updateStaffSchedule failed", params.id, err);
    return NextResponse.json({ error: "저장에 실패했습니다." }, { status: 500 });
  }
}
