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

  // 원장이 /api/admin/setup을 아직 실행하지 않았으면 새 속성(업무풀/원장확인
  // 등)으로 필터링하는 쿼리가 실패한다 — 화면을 깨뜨리지 않고 빈 목록 +
  // setupNeeded 플래그로 알려준다(app/director/tasks/page.tsx가 초기 로드
  // 시점엔 이미 안내를 보여주므로, 이건 그 이후의 재조회 실패를 위한 안전망).
  try {
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
  } catch (err) {
    console.error("GET /api/tasks failed (setup likely needed)", scope, err);
    return NextResponse.json({ tasks: [], items: [], setupNeeded: true });
  }
}
