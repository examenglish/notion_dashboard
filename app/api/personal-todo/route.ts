import { NextRequest, NextResponse } from "next/server";
import { createPersonalTodo } from "@/lib/notion";
import { readStaffId } from "@/lib/session";
import { todayKST } from "@/lib/date";

export const dynamic = "force-dynamic";

// staffId는 항상 세션에서만 읽는다(요청 바디로 받지 않음) — 그래야 다른
// 직원 이름으로 개인 할일을 몰래 남기는 게 원천적으로 불가능하다.
export async function POST(req: NextRequest) {
  const staffId = readStaffId(req);
  if (!staffId) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  if (!content) {
    return NextResponse.json({ error: "내용을 입력해 주세요." }, { status: 400 });
  }
  const date = typeof body?.date === "string" && body.date ? body.date : todayKST();
  await createPersonalTodo({ staffId, content, date });
  return NextResponse.json({ ok: true });
}
