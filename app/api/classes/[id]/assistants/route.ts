import { NextRequest, NextResponse } from "next/server";
import { assignClassAssistants } from "@/lib/notion";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  const assistantIds = Array.isArray(body?.assistantIds) ? body.assistantIds : [];
  await assignClassAssistants(params.id, assistantIds);
  return NextResponse.json({ ok: true });
}
