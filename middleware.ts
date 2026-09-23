import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionCookieValue } from "./lib/session";
import { checkSessionActive } from "./lib/sessionGuard";

// Routes that must work before a session exists. /api/cron/* is called by
// Vercel Cron (no login cookie) — each route under it authenticates itself
// via the CRON_SECRET bearer token instead.
//
// "/api/staff" GET (exact path) is the login screen's name list, fetched
// before any cookie exists. POST to that same path is 강사/조교 계정
// 등록이라 원장/행정만 써야 하므로 반드시 인증을 거쳐야 한다 — 메소드를
// 안 가리고 경로만으로 예외를 주면 등록 요청도 인증을 건너뛰어 x-staff-role이
// 빈 값이 되고, route.ts의 역할 체크가 누구에게나(원장 포함) 403을 낸다.
//
// "/api/staff/[id]" (e.g. the work-schedule PATCH) must stay behind auth,
// so it's deliberately NOT in here. A plain startsWith match on "/api/staff"
// used to swallow "/api/staff/[id]" too and skip attaching x-staff-role,
// which made every role check on that subroute see an empty role and 403
// even for 원장.
// "/api/admin/reconciliation"도 /api/cron/*와 같은 이유로 쿠키 인증을
// 건너뛴다 — 세션 쿠키 없이 호출되고, 라우트 자체가 MIGRATION_ADMIN_SECRET
// 헤더로 스스로 인증한다(불일치 시 404). 일회성 마이그레이션 러너와 달리
// 이 경로는 dual-write 운영 도구로 계속 남는다.
// "/api/files/archive"는 n8n 전용(파일 인덱스 등록) — 쿠키 대신 FILE_ARCHIVE_SECRET HMAC 서명으로
// 라우트가 스스로 인증한다(서명 없으면 401).
const PUBLIC_API_EXACT_PATHS = ["/api/login", "/api/slack/events", "/api/admin/reconciliation", "/api/files/archive"];
const PUBLIC_API_PREFIX_PATHS = ["/api/cron/"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // TEMP: local preview-only bypass, set via BYPASS_AUTH=1 env on the dev
  // server process. Not committed to affect any deployed environment.
  if (process.env.BYPASS_AUTH === "1") {
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set("x-staff-name", encodeURIComponent("프리뷰"));
    requestHeaders.set("x-staff-id", "preview");
    requestHeaders.set("x-staff-role", encodeURIComponent("원장"));
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const isPublicStaffList = pathname === "/api/staff" && req.method === "GET";
  if (
    pathname.startsWith("/api/") &&
    (isPublicStaffList ||
      PUBLIC_API_EXACT_PATHS.includes(pathname) ||
      PUBLIC_API_PREFIX_PATHS.some((p) => pathname.startsWith(p)))
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

  // 서명이 유효해도 직원이 비활성화됐거나(퇴사) 비활성화/재활성화/비밀번호 재설정 이후에
  // 발급된 쿠키가 아니면 거부한다 — 모든 보호 API와 middleware 대상 페이지에 공통 적용.
  // DB 확인이 실패하면 열어두지 않고 거부한다(fail-closed).
  const active = await checkSessionActive(session);
  if (active !== "ok") {
    const message =
      active === "inactive" ? "계정이 비활성화되었거나 로그인이 만료되었습니다. 다시 로그인해 주세요." : "로그인 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.";
    const res = pathname.startsWith("/api/")
      ? NextResponse.json({ error: message }, { status: active === "inactive" ? 401 : 503 })
      : NextResponse.redirect(new URL("/login", req.url));
    if (active === "inactive") res.cookies.delete(SESSION_COOKIE);
    return res;
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
