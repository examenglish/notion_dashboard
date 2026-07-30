import { NextRequest, NextResponse } from "next/server";
import { notion, getRichText, updateAdminInboxEntry } from "@/lib/notion";
import { readStaffName } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const page = await notion.pages.retrieve({ page_id: params.id });
  const enteredBy = getRichText(page as any, "입력자");
  const staffName = readStaffName(req);
  if (enteredBy && enteredBy !== staffName) {
    return NextResponse.json({ error: "본인이 입력한 항목만 수정할 수 있습니다." }, { status: 403 });
  }

  const { type, content, startDate, endDate } = body;
  await updateAdminInboxEntry(params.id, { type, content, startDate, endDate });
  return NextResponse.json({ ok: true });
}
