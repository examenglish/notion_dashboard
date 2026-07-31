import { NextRequest, NextResponse } from "next/server";
import { notion, getRichText, updateAdminInboxEntry } from "@/lib/notion";
import { readStaffName } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const { type, content, startDate, endDate, owner, done } = body;

  // 담당자 지정 / 처리완료 표시는 운영 상태 변경이라 누구나 할 수 있게 열어두고,
  // 실제 내용(유형/내용/날짜) 수정만 입력한 본인으로 제한한다.
  const isContentEdit = type !== undefined || content !== undefined || startDate !== undefined || endDate !== undefined;
  if (isContentEdit) {
    const page = await notion.pages.retrieve({ page_id: params.id });
    const enteredBy = getRichText(page as any, "입력자");
    const staffName = readStaffName(req);
    if (enteredBy && enteredBy !== staffName) {
      return NextResponse.json({ error: "본인이 입력한 항목만 수정할 수 있습니다." }, { status: 403 });
    }
  }

  await updateAdminInboxEntry(params.id, { type, content, startDate, endDate, owner, done });
  return NextResponse.json({ ok: true });
}
