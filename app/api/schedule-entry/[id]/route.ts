import { NextRequest, NextResponse } from "next/server";
import { completeScheduleEntry, updateScheduleEntry } from "@/lib/notion";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  if (body && (body.date || body.time !== undefined || body.ownerName !== undefined)) {
    await updateScheduleEntry(params.id, body);
    return NextResponse.json({ ok: true });
  }
  await completeScheduleEntry(params.id);
  return NextResponse.json({ ok: true });
}
