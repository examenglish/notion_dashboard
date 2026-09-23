import { NextRequest, NextResponse } from "next/server";
import {
  checkArchiveScope,
  findSlackArchive,
  registerSlackArchive,
  validateArchiveInput,
  verifyArchiveSignature,
} from "@/lib/fileArchive";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// n8n 전용 파일 인덱스 API — 로그인 쿠키가 아니라 FILE_ARCHIVE_SECRET HMAC 서명으로 인증한다
// (middleware 공개 경로). 지점은 요청 값이 아니라 이 배포의 지점 + 채널 매핑으로 검증한다.
// 응답에는 id/상태/Drive 식별자만 — secret·토큰은 절대 넣지 않는다.

// GET ?teamId=&fileId= — n8n이 Drive 업로드 전에 "이미 보관됐는지" 확인(서명: `${ts}.${search}`).
export async function GET(req: NextRequest) {
  const auth = verifyArchiveSignature(req.nextUrl.search, req.headers.get("x-exam-ai-timestamp"), req.headers.get("x-exam-ai-signature"));
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: auth.status });
  const teamId = req.nextUrl.searchParams.get("teamId") ?? "";
  const fileId = req.nextUrl.searchParams.get("fileId") ?? "";
  if (!teamId || !/^F[A-Z0-9]{6,}$/.test(fileId)) return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  const row = await findSlackArchive(teamId, fileId);
  if (!row) return NextResponse.json({ archived: false });
  return NextResponse.json({ archived: true, id: row.id, driveFileId: row.drive_file_id, driveUrl: row.drive_url });
}

// POST — Drive 업로드 성공 후 메타데이터 등록(멱등: 같은 Slack 파일 재전송이면 기존 행 반환).
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const auth = verifyArchiveSignature(raw, req.headers.get("x-exam-ai-timestamp"), req.headers.get("x-exam-ai-signature"));
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: auth.status });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const v = validateArchiveInput(body);
  if (!v.ok) return NextResponse.json({ error: v.reason }, { status: 400 });
  const scope = checkArchiveScope(v.input);
  if (!scope.ok) return NextResponse.json({ error: scope.reason }, { status: 403 });
  try {
    const rec = await registerSlackArchive(v.input);
    return NextResponse.json({ ok: true, ...rec }, { status: rec.status === "created" ? 201 : 200 });
  } catch (err) {
    console.error("file archive register failed", v.input.fileId, err instanceof Error ? err.name : "error");
    return NextResponse.json({ error: "register_failed" }, { status: 500 });
  }
}
