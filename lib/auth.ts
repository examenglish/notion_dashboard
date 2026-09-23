import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionCookieValue } from "./session";
import { checkSessionActive } from "./sessionGuard";

export async function getSession() {
  // TEMP: mirrors middleware.ts's local preview-only BYPASS_AUTH bypass so
  // Server Components (which read the cookie directly, not the middleware
  // headers) see a session too. Not committed to affect any deployed
  // environment.
  if (process.env.BYPASS_AUTH === "1") {
    return { staffId: "preview", name: "프리뷰", role: "원장", issuedAt: Date.now() };
  }
  const raw = cookies().get(SESSION_COOKIE)?.value;
  const session = await verifySessionCookieValue(raw);
  if (!session) return null;
  // /director/* 등 middleware 대상이 아닌 페이지도 비활성 직원/무효화된 세션은 로그인 전 상태로 본다.
  return (await checkSessionActive(session)) === "ok" ? session : null;
}
