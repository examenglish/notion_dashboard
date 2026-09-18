import { NextRequest, NextResponse } from "next/server";
import { readStaffId, readStaffRole } from "@/lib/session";
import { listMyTasks, listPoolTasks, listReviewInbox, getBasicChecklist, listCompletedToday } from "@/lib/notion";
import { todayKST } from "@/lib/date";

export const dynamic = "force-dynamic";

// scope=mine(기본)|pool|review|checklist — 내 업무 화면(TaskBoardClient)이
// 섹션별로 나눠 호출한다.
export async function GET(req: NextRequest) {
  const staffId = readStaffId(req);
  if (!staffId) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const scope = req.nextUrl.searchParams.get("scope") ?? "mine";

  if (scope === "pool") {
    return NextResponse.json({ tasks: await listPoolTasks() });
  }
  if (scope === "review") {
    const role = readStaffRole(req);
    if (role !== "원장" && role !== "행정") {
      return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
    }
    return NextResponse.json({ tasks: await listReviewInbox() });
  }
  if (scope === "checklist") {
    return NextResponse.json({ items: await getBasicChecklist(staffId, todayKST()) });
  }
  if (scope === "completed") {
    return NextResponse.json({ tasks: await listCompletedToday(staffId, todayKST()) });
  }
  return NextResponse.json({ tasks: await listMyTasks(staffId) });
}
