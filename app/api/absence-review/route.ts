import { NextRequest, NextResponse } from "next/server";
import { completeScheduleEntry, correctAbsenceToLate, getAbsenceReviewData } from "@/lib/notion";
import { readStaffRole } from "@/lib/session";
import { todayKST, shiftDate } from "@/lib/date";

export const dynamic = "force-dynamic";

function isAdminLike(role: string) {
  return role === "행정" || role === "원장";
}

// 어제 결석자 검토 팝업의 데이터 — 조회하는 순간 아직 없는 보강요청은
// getAbsenceReviewData 안에서 자동으로 만들어진다("전날 결석자 명단이
// 자동으로 보강 명단으로 이동" 요구사항).
export async function GET(req: NextRequest) {
  if (!isAdminLike(readStaffRole(req))) {
    return NextResponse.json({ date: null, items: [] });
  }
  const date = shiftDate(todayKST(), -1);
  const items = await getAbsenceReviewData(date);
  return NextResponse.json({ date, items });
}

export async function POST(req: NextRequest) {
  if (!isAdminLike(readStaffRole(req))) {
    return NextResponse.json({ error: "행정/원장만 처리할 수 있습니다." }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const action = body?.action;

  if (action === "correctToLate") {
    const { dailyRecordId, studentId, date } = body ?? {};
    if (!dailyRecordId || !studentId || !date) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }
    await correctAbsenceToLate({ dailyRecordId, studentId, date });
    return NextResponse.json({ ok: true });
  }

  if (action === "cancelMakeup") {
    const { makeupRequestId } = body ?? {};
    if (!makeupRequestId) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }
    // 실제로 지우지(보관 처리) 않고 완료 처리한다 — Notion에서 지우면 다음
    // 조회 때 "요청이 없다"고 판단해 같은 학생이 여전히 결석으로 남아있는
    // 한 즉시 다시 만들어버린다(재생성 문제). 완료 처리는 재생성을 막으면서
    // 확정 현황·오늘의 일정·결석 검토 팝업 어디에도 더는 "미확정"으로
    // 뜨지 않는다. Notion에서 아예 지우고 싶으면(원장/행정) 학생 전체기록
    // 화면의 "삭제" 버튼을 쓰면 된다 — 거긴 재생성 로직을 타지 않는 화면.
    await completeScheduleEntry(makeupRequestId);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "알 수 없는 action입니다." }, { status: 400 });
}
