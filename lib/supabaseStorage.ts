// Supabase Storage 연동 — 자료제작(material_tasks) 원본파일을 Notion File
// Upload API 대신 여기 저장한다(staff.md PART 17). 이 코드베이스의 기존
// 관례대로 @supabase/supabase-js SDK 없이 Storage REST API를 직접
// fetch한다(lib/supabaseRepo.ts/lib/supabasePgRead.ts와 동일 패턴).
//
// 격리 원칙: 모든 객체 경로는 반드시 "<branchCode>/materials/..."로
// 시작한다 — 업로드도 서명 URL 발급도 이 prefix를 벗어난 경로는 거부해서,
// 한 지점이 다른 지점 파일에 접근할 방법 자체를 코드로 막는다(사직/금정이
// 하나의 Supabase 프로젝트를 공유하므로 버킷도 공유하지만, RLS가 아니라
// 애플리케이션 레벨에서 경로 접두사로 강제한다 — 이 앱은 client-side에서
// anon key로 Storage에 직접 접근하지 않고 항상 이 서버 모듈만 거치므로
// 충분하다).
import { randomUUID } from "crypto";
import { branchCode } from "./supabaseRepo";

const BUCKET = "materials";

function supabaseEnv(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

function sanitizeFilename(name: string): string {
  // Storage 경로에 안전하지 않은 문자(공백/슬래시/특수문자)만 밑줄로 바꾸고,
  // 너무 긴 이름은 뒤쪽(확장자 포함)만 남긴다.
  return name.replace(/[^\w.\-가-힣]/g, "_").slice(-120) || "파일";
}

export type StoredMaterialFile = {
  path: string; // "<branch>/materials/<uuid>-<filename>"
  name: string;
  size: number;
  contentType: string;
  uploadedAt: string;
};

function requireBranchPath(path: string, branch: string): void {
  if (!path.startsWith(`${branch}/`)) {
    throw new Error("다른 지점의 파일 경로에는 접근할 수 없습니다.");
  }
}

/** 원본 바이트를 이 지점의 prefix 아래에 올리고, 나중에 서명 URL을 만들 때 쓸 경로를 돌려준다. */
export async function uploadMaterialFileToStorage(filename: string, contentType: string, data: Blob): Promise<StoredMaterialFile> {
  const env = supabaseEnv();
  const branch = branchCode();
  if (!env || !branch) throw new Error("Supabase Storage가 설정되지 않았습니다.");
  const path = `${branch}/materials/${randomUUID()}-${sanitizeFilename(filename)}`;
  const bytes = await data.arrayBuffer();
  const r = await fetch(`${env.url}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      apikey: env.key,
      Authorization: `Bearer ${env.key}`,
      "Content-Type": contentType || "application/octet-stream",
      "x-upsert": "false",
    },
    body: bytes,
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`Supabase Storage 업로드 실패 (${r.status}): ${body.slice(0, 300)}`);
  }
  return { path, name: filename, size: bytes.byteLength, contentType: contentType || "application/octet-stream", uploadedAt: new Date().toISOString() };
}

/** private bucket이라 직접 URL이 없다 — 열람할 때마다 만료 시간이 있는 서명 URL을 새로 발급한다. */
export async function createSignedMaterialFileUrl(path: string, expiresInSeconds = 3600): Promise<string | null> {
  const env = supabaseEnv();
  const branch = branchCode();
  if (!env || !branch) return null;
  try {
    requireBranchPath(path, branch);
  } catch {
    return null; // 다른 지점 경로 — 조용히 실패(호출부는 파일 링크 없음으로 처리)
  }
  const r = await fetch(`${env.url}/storage/v1/object/sign/${BUCKET}/${path}`, {
    method: "POST",
    headers: { apikey: env.key, Authorization: `Bearer ${env.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: expiresInSeconds }),
  });
  if (!r.ok) return null;
  const data = (await r.json().catch(() => null)) as { signedURL?: string } | null;
  if (!data?.signedURL) return null;
  return `${env.url}/storage/v1${data.signedURL}`;
}
