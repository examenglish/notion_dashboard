import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionCookieValue } from "./session";

export async function getSession() {
  // TEMP: mirrors middleware.ts's local preview-only BYPASS_AUTH bypass so
  // Server Components (which read the cookie directly, not the middleware
  // headers) see a session too. Not committed to affect any deployed
  // environment.
  if (process.env.BYPASS_AUTH === "1") {
    return { staffId: "preview", name: "프리뷰", role: "원장", issuedAt: Date.now() };
  }
  const raw = cookies().get(SESSION_COOKIE)?.value;
  return verifySessionCookieValue(raw);
}
