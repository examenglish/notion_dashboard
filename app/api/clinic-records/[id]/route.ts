import { NextRequest, NextResponse } from "next/server";
import { updateClinicRecord } from "@/lib/notion";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  const { checked } = body ?? {};
  await updateClinicRecord(params.id, { checked });
  return NextResponse.json({ ok: true });
}
