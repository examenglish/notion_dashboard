import { NextRequest, NextResponse } from "next/server";
import { getMakeupScheduleStatus } from "@/lib/notion";
import { readStaffId, readStaffRole } from "@/lib/session";

export const dynamic = "force-dynamic";

// 행정/원장은 전체 보강·재시 확정 현황을, 그 외(강사/조교)는 본인에게
// 배정된 것만 본다. 로그인 안 된 요청은 빈 목록.
export async function GET(req: NextRequest) {
  const staffId = readStaffId(req);
  const role = readStaffRole(req);
  const isAdminLike = role === "행정" || role === "원장";

  if (!isAdminLike && !staffId) {
    return NextResponse.json({ scope: "mine", items: [] });
  }

  const items = await getMakeupScheduleStatus(isAdminLike ? {} : { staffId });
  return NextResponse.json({ scope: isAdminLike ? "all" : "mine", items });
}
