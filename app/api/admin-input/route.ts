import { NextRequest, NextResponse } from "next/server";
import { createAdminInboxEntry } from "@/lib/notion";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { type, studentId, content, startDate, endDate } = body ?? {};

  if (!type || !content) {
    return NextResponse.json({ error: "유형과 내용은 필수입니다." }, { status: 400 });
  }

  await createAdminInboxEntry({
    type,
    studentId: studentId || null,
    content,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
  });

  return NextResponse.json({ ok: true });
}
