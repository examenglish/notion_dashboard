import { NextRequest, NextResponse } from "next/server";
import { updateStaffSchedule, setStaffResigned, getStaffInBranch } from "@/lib/notion";
import { readStaffRole, readStaffId } from "@/lib/session";
import type { WorkHours } from "@/lib/format";

export const dynamic = "force-dynamic";

// 근무 요일/시간 설정, 퇴사 처리 모두 원장/행정만 — 조교 본인이 스스로
// 근무시간을 늘리거나 계정 상태를 바꾸는 걸 막기 위함.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const role = readStaffRole(req);
  if (role !== "원장" && role !== "행정") {
    return NextResponse.json({ error: "원장/행정만 처리할 수 있습니다." }, { status: 403 });
  }
  const body = await req.json().catch(() => null);

  if (typeof body?.resigned === "boolean") {
    // 계정 활성/비활성(퇴사)은 원장만. 다른 지점 직원은 대상이 아니고, 본인 계정은 잠그지 않는다.
    if (role !== "원장") {
      return NextResponse.json({ error: "원장만 계정 상태를 바꿀 수 있습니다." }, { status: 403 });
    }
    const target = await getStaffInBranch(params.id);
    if (!target) return NextResponse.json({ error: "직원을 찾을 수 없습니다." }, { status: 404 });
    if (body.resigned && target.id === readStaffId(req)) {
      return NextResponse.json({ error: "본인 계정은 비활성화할 수 없습니다." }, { status: 400 });
    }
    try {
      await setStaffResigned(params.id, body.resigned);
      return NextResponse.json({ ok: true });
    } catch (err) {
      console.error("setStaffResigned failed", params.id, err);
      return NextResponse.json({ error: "처리에 실패했습니다." }, { status: 500 });
    }
  }

  const raw = body?.workHours;
  const workHours: WorkHours = {};
  if (raw && typeof raw === "object") {
    for (const [day, range] of Object.entries(raw as Record<string, any>)) {
      const start = typeof range?.start === "string" ? range.start : "";
      const end = typeof range?.end === "string" ? range.end : "";
      if (start && end) workHours[day] = { start, end };
    }
  }
  try {
    await updateStaffSchedule(params.id, workHours);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("updateStaffSchedule failed", params.id, err);
    return NextResponse.json({ error: "저장에 실패했습니다." }, { status: 500 });
  }
}
