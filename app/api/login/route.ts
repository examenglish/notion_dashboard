import { NextRequest, NextResponse } from "next/server";
import { findStaffByNameAndPin } from "@/lib/notion";
import { createSessionCookieValue, SESSION_COOKIE } from "@/lib/session";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name : "";
  const pin = typeof body?.pin === "string" ? body.pin : "";

  if (!name || !/^\d{4,6}$/.test(pin)) {
    return NextResponse.json({ error: "이름과 4~6자리 PIN을 입력해주세요." }, { status: 400 });
  }

  // PIN check happens here, server-side only, against Notion DB⑲. The
  // Notion token and every staff PIN stay on the server at all times.
  const staff = await findStaffByNameAndPin(name, pin);
  if (!staff) {
    return NextResponse.json({ error: "이름 또는 PIN이 올바르지 않습니다." }, { status: 401 });
  }

  const cookieValue = await createSessionCookieValue({
    staffId: staff.id,
    name: staff.name,
    role: staff.role,
    issuedAt: Date.now(),
    mustChangePin: staff.mustChangePin,
  });

  const res = NextResponse.json({ ok: true, name: staff.name, role: staff.role, mustChangePin: staff.mustChangePin });
  res.cookies.set(SESSION_COOKIE, cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12, // 12 hours
  });
  return res;
}
