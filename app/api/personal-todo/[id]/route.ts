import { NextRequest, NextResponse } from "next/server";
import { updatePersonalTodo, completeScheduleEntry } from "@/lib/notion";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  if (body && (body.content !== undefined || body.date)) {
    await updatePersonalTodo(params.id, { content: body.content, date: body.date });
    return NextResponse.json({ ok: true });
  }
  await completeScheduleEntry(params.id);
  return NextResponse.json({ ok: true });
}
