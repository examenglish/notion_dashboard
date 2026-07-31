import { NextRequest, NextResponse } from "next/server";
import { updateStaffPin } from "@/lib/notion";
import { createSessionCookieValue, SESSION_COOKIE } from "@/lib/session";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const newPin = typeof body?.newPin === "string" ? body.newPin : "";
  if (!/^\d{4,6}$/.test(newPin)) {
    return NextResponse.json({ error: "4~6자리 숫자로 입력해주세요." }, { status: 400 });
  }
  if (newPin === "1111") {
    return NextResponse.json({ error: "임시 비밀번호(1111)는 다시 사용할 수 없습니다. 새 번호를 정해주세요." }, { status: 400 });
  }

  await updateStaffPin(session.staffId, newPin);

  const cookieValue = await createSessionCookieValue({
    staffId: session.staffId,
    name: session.name,
    role: session.role,
    issuedAt: Date.now(),
    mustChangePin: false,
  });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return res;
}
