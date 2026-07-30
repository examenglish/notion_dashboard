import { NextRequest, NextResponse } from "next/server";
import { updateCounselingEntry } from "@/lib/notion";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { counselor, date, transcript, summary, followUp } = body;
  await updateCounselingEntry(params.id, { counselor, date, transcript, summary, followUp });
  return NextResponse.json({ ok: true });
}
