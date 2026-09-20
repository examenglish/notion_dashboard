// PIN 해시 저장/검증 — Postgres staff.pin_hash 컬럼용. 4~6자리 숫자 PIN은
// 엔트로피가 낮아(최대 10^6가지) 일반 비밀번호용 해시와 같은 감각으로
// 다루면 안 된다. scrypt는 Node 내장(추가 의존성 없음)이면서 메모리-하드라
// 오프라인 무차별 대입 비용을 크게 늘린다 — 낮은 엔트로피를 완전히 상쇄하진
// 못하지만(그건 사실상 불가능하다), 로그인 시도 자체는 서버 API 라우트를
// 거치므로 온라인 무차별 대입은 별도로 rate limit이 필요하면 그쪽에서 막을 일.
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number }
) => Promise<Buffer>;

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;

/** 저장 형식: scrypt$N$r$p$salt(base64)$hash(base64) — 파라미터를 같이 저장해두면 나중에 비용을 올려도 기존 해시를 계속 검증할 수 있다. */
export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(pin, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export async function verifyPin(pin: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");
  const N = Number(nStr), r = Number(rStr), p = Number(pStr);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p) || expected.length === 0) return false;
  const derived = await scrypt(pin, salt, expected.length, { N, r, p });
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
