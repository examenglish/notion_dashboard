import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionCookieValue } from "./lib/session";

// Routes that must work before a session exists.
const PUBLIC_API_PATHS = ["/api/login", "/api/staff"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/api/") && PUBLIC_API_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const raw = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySessionCookieValue(raw);
  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Staff who haven't set their own PIN yet (still on the temporary 1111)
  // are locked to /change-pin until they do — everything else redirects
  // there first, except the change-pin flow itself and logout.
  const isChangePinRoute = pathname === "/change-pin" || pathname === "/api/change-pin" || pathname === "/api/logout";
  if (session.mustChangePin && !isChangePinRoute) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "비밀번호를 먼저 변경해주세요." }, { status: 403 });
    }
    return NextResponse.redirect(new URL("/change-pin", req.url));
  }

  // Forward the verified identity to API routes (e.g. so they can stamp
  // 입력자 on new records, or check "본인만 수정가능" on edits) without
  // each route re-verifying the session cookie itself. Header values must
  // be ByteStrings (Latin-1 range), so the Korean name has to be
  // percent-encoded — decode with decodeURIComponent on the reading side.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-staff-name", encodeURIComponent(session.name));
  requestHeaders.set("x-staff-id", session.staffId);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/dashboard/:path*", "/input/:path*", "/exam-prep/:path*", "/api/:path*", "/change-pin"],
};
