import { NextResponse } from "next/server";
import { completeScheduleEntry } from "@/lib/notion";

export const dynamic = "force-dynamic";

export async function PATCH(_req: Request, { params }: { params: { id: string } }) {
  await completeScheduleEntry(params.id);
  return NextResponse.json({ ok: true });
}
