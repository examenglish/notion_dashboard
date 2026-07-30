// Uses Web Crypto (globalThis.crypto.subtle) instead of Node's `crypto`
// module so this file works both in normal Node routes and in the Edge
// Runtime used by middleware.ts.

export const SESSION_COOKIE = "academy_session";

export type SessionData = {
  staffId: string;
  name: string;
  role: string | null;
  issuedAt: number;
};

// middleware.ts forwards the verified staff name as an x-staff-name header
// (percent-encoded, since header values must be ByteStrings) so API routes
// can stamp 입력자 / check "본인만 수정가능" without re-verifying the
// session cookie themselves.
export function readStaffName(req: { headers: Headers }): string {
  const raw = req.headers.get("x-staff-name");
  return raw ? decodeURIComponent(raw) : "";
}

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return secret;
}

function toBase64Url(bytes: ArrayBuffer): string {
  const b64 = Buffer.from(bytes).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacKey(): Promise<CryptoKey> {
  const keyData = new TextEncoder().encode(getSecret());
  return crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
}

async function sign(payload: string): Promise<string> {
  const key = await hmacKey();
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return toBase64Url(signature);
}

export async function createSessionCookieValue(data: SessionData): Promise<string> {
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  const signature = await sign(payload);
  return `${payload}.${signature}`;
}

export async function verifySessionCookieValue(
  value: string | undefined
): Promise<SessionData | null> {
  if (!value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;
  const expected = await sign(payload);
  if (expected.length !== signature.length || expected !== signature) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}
