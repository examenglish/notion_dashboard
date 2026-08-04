import { NextRequest, NextResponse } from "next/server";
import { notion, getRichText, updateCounselingEntry, deleteCounselingEntry } from "@/lib/notion";
import { readStaffName, readStaffRole } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const page = await notion.pages.retrieve({ page_id: params.id });
  const enteredBy = getRichText(page as any, "입력자");
  const staffName = readStaffName(req);
  if (enteredBy && enteredBy !== staffName && readStaffRole(req) !== "원장") {
    return NextResponse.json({ error: "본인이 입력한 항목만 수정할 수 있습니다." }, { status: 403 });
  }

  const { counselor, date, transcript, summary, followUp } = body;
  await updateCounselingEntry(params.id, { counselor, date, transcript, summary, followUp });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  if (readStaffRole(req) !== "원장") {
    return NextResponse.json({ error: "삭제는 원장만 할 수 있습니다." }, { status: 403 });
  }
  await deleteCounselingEntry(params.id);
  return NextResponse.json({ ok: true });
}
