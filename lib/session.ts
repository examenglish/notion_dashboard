// Uses Web Crypto (globalThis.crypto.subtle) instead of Node's `crypto`
// module so this file works both in normal Node routes and in the Edge
// Runtime used by middleware.ts.

export const SESSION_COOKIE = "academy_session";

export type SessionData = {
  staffId: string;
  name: string;
  role: string | null;
  issuedAt: number;
  mustChangePin?: boolean;
};

// middleware.ts forwards the verified staff name as an x-staff-name header
// (percent-encoded, since header values must be ByteStrings) so API routes
// can stamp 입력자 / check "본인만 수정가능" without re-verifying the
// session cookie themselves.
export function readStaffName(req: { headers: Headers }): string {
  const raw = req.headers.get("x-staff-name");
  return raw ? decodeURIComponent(raw) : "";
}

export function readStaffId(req: { headers: Headers }): string {
  return req.headers.get("x-staff-id") ?? "";
}

export function readStaffRole(req: { headers: Headers }): string {
  const raw = req.headers.get("x-staff-role");
  return raw ? decodeURIComponent(raw) : "";
}

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return secret;
}

// Buffer's Edge Runtime polyfill has shipped `__dirname` references in some
// Next.js/Vercel builder versions, crashing middleware at cold start. These
// stick to Web APIs (btoa/atob), which are available in both Edge and Node.
function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const b64 = btoa(binary);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const padded = b64url + "=".repeat((4 - (b64url.length % 4)) % 4);
  const b64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
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
  return bytesToBase64Url(new Uint8Array(signature));
}

export async function createSessionCookieValue(data: SessionData): Promise<string> {
  const payload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(data)));
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
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload)));
  } catch {
    return null;
  }
}
