import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionCookieValue } from "./session";

export async function getSession() {
  const raw = cookies().get(SESSION_COOKIE)?.value;
  return verifySessionCookieValue(raw);
}
