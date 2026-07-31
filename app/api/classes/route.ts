import { NextRequest, NextResponse } from "next/server";
import { createClass, listClasses } from "@/lib/notion";

export const dynamic = "force-dynamic";

export async function GET() {
  const classes = await listClasses();
  return NextResponse.json(classes);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const name = (body?.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "반이름을 입력해 주세요." }, { status: 400 });
  }
  const classId = await createClass({
    name,
    teacher: body?.teacher || undefined,
    days: Array.isArray(body?.days) ? body.days : undefined,
    time: body?.time || undefined,
    level: body?.level || undefined,
  });
  return NextResponse.json({ ok: true, classId });
}
