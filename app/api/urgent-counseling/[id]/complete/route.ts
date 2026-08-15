import { NextRequest, NextResponse } from "next/server";
import { notion, getRelationIds, getRichText, updateAdminInboxEntry, createCounselingEntry } from "@/lib/notion";
import { readStaffName, readStaffRole } from "@/lib/session";
import { todayKST } from "@/lib/date";

export const dynamic = "force-dynamic";

// 긴급상담요청(DB⑭행정실)을 완료 처리하면서, 그 내용을 학생 상담일지(DB⑧)에도
// 남긴다 — 완료 처리 후에는 DB⑭ 목록(처리완료 필터)에서 사라지므로, 여기서
// 기록해두지 않으면 학생 전체기록의 "상담 기록"에서 이 상담 이력이 통째로
// 사라져버린다. 완료 처리는 원장만 — 실제 상담을 진행했는지 확인 없이 아무나
// 처리 표시를 눌러버리면 상담이 누락된 채로 지워질 수 있어서다.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (readStaffRole(req) !== "원장") {
    return NextResponse.json({ error: "완료 처리는 원장만 할 수 있습니다." }, { status: 403 });
  }
  const page: any = await notion.pages.retrieve({ page_id: params.id });
  const studentId = getRelationIds(page, "대상학생")[0];
  if (!studentId) {
    return NextResponse.json({ error: "연결된 학생이 없어 완료 처리할 수 없습니다." }, { status: 400 });
  }
  const content = getRichText(page, "내용");
  const owner = getRichText(page, "담당자");
  const staffName = readStaffName(req);

  await Promise.all([
    updateAdminInboxEntry(params.id, { done: true }),
    createCounselingEntry({
      studentId,
      counselor: owner || staffName || "",
      date: todayKST(),
      transcript: "",
      summary: content,
      followUp: "",
      enteredBy: staffName || undefined,
    }),
  ]);
  return NextResponse.json({ ok: true });
}
