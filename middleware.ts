import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionCookieValue } from "./lib/session";

// Routes that must work before a session exists. /api/cron/* is called by
// Vercel Cron (no login cookie) — each route under it authenticates itself
// via the CRON_SECRET bearer token instead.
//
// "/api/staff" (exact) is the login screen's name list, fetched before any
// cookie exists — but "/api/staff/[id]" (e.g. the work-schedule PATCH) must
// stay behind auth, so it's deliberately NOT in here. A plain startsWith
// match on "/api/staff" used to swallow "/api/staff/[id]" too and skip
// attaching x-staff-role, which made every role check on that subroute see
// an empty role and 403 even for 원장.
const PUBLIC_API_EXACT_PATHS = ["/api/login", "/api/staff"];
const PUBLIC_API_PREFIX_PATHS = ["/api/cron/"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    pathname.startsWith("/api/") &&
    (PUBLIC_API_EXACT_PATHS.includes(pathname) || PUBLIC_API_PREFIX_PATHS.some((p) => pathname.startsWith(p)))
  ) {
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
  requestHeaders.set("x-staff-role", encodeURIComponent(session.role ?? ""));
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/dashboard/:path*", "/input/:path*", "/exam-prep/:path*", "/api/:path*", "/change-pin"],
};
