import { NextRequest, NextResponse } from "next/server";
import { updateClass } from "@/lib/notion";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { name, teacher, days, time, level } = body;
  if (name !== undefined && !String(name).trim()) {
    return NextResponse.json({ error: "반이름을 입력해 주세요." }, { status: 400 });
  }
  await updateClass(params.id, {
    name: name !== undefined ? String(name).trim() : undefined,
    teacher,
    days,
    time,
    level,
  });
  return NextResponse.json({ ok: true });
}
