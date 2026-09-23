import { NextRequest, NextResponse } from "next/server";
import { releaseSlackEvent, reserveSlackEvent, verifySlackRequest } from "@/lib/slack";
import { buildArchiveJob, forwardArchiveJob, type SlackFileEvent } from "@/lib/fileArchive";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// "EXAM AI File Archive" Slack 앱 전용 Events URL. 학생기록 봇(/api/slack/events)과 분리해
// 그쪽 동작·서명 secret·채널 설정에 영향을 주지 않는다.
// 파일 첨부 메시지(message.file_share) → 지점 판별(Slack 팀) → FILE_ARCHIVE_SECRET 서명 job을 n8n으로 전달.
// Slack 토큰/다운로드 URL은 넘기지 않는다(n8n이 자기 Slack credential로 files.info 조회).
// 전달 실패면 503 → Slack 재전송. 중복은 event_id 예약 + n8n/등록 API의 Slack file id 멱등으로 막는다.
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const verification = verifySlackRequest(
    rawBody,
    req.headers.get("x-slack-request-timestamp"),
    req.headers.get("x-slack-signature"),
    process.env.SLACK_FILE_ARCHIVE_SIGNING_SECRET ?? "" // 미설정이면 학생기록 봇 secret으로 대체되지 않게
  );
  if (!verification.ok) {
    const status = verification.reason === "configuration" ? 503 : 401;
    return NextResponse.json({ error: `slack_${verification.reason}` }, { status });
  }
  if (verification.replay) return NextResponse.json({ ok: true, duplicate: true });

  let envelope: { type?: string; challenge?: string; team_id?: string; event_id?: string; event?: SlackFileEvent };
  try {
    envelope = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (envelope.type === "url_verification") {
    return NextResponse.json({ challenge: envelope.challenge ?? "" });
  }

  const job = envelope.event ? buildArchiveJob(envelope, envelope.event, req.nextUrl.origin) : null;
  if (!job) return NextResponse.json({ ok: true, ignored: true });
  if (!envelope.event_id || !reserveSlackEvent(`archive:${envelope.event_id}`)) {
    return NextResponse.json({ ok: true, duplicate: true });
  }
  const forwarded = await forwardArchiveJob(job);
  if (!forwarded) {
    releaseSlackEvent(`archive:${envelope.event_id}`);
    console.error("slack file archive forward failed", envelope.event_id);
    return NextResponse.json({ error: "archive_forward_failed" }, { status: 503 });
  }
  return NextResponse.json({ ok: true, archive: job.files.length });
}
