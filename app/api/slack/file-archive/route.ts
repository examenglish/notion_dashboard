import { NextRequest, NextResponse } from "next/server";
import { releaseSlackEvent, reserveSlackEvent, verifySlackRequest } from "@/lib/slack";
import { archiveTeamMap, buildArchiveJob, forwardArchiveJob, type SlackFileEvent } from "@/lib/fileArchive";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// "EXAM AI File Archive" Slack 앱 전용 Events URL — 사직·금정 워크스페이스 공용 gateway
// (https://slack.examenglishsj.co.kr/api/slack/file-archive). 요청 도메인/배포 지점과 무관하게
// team_id → 지점(SLACK_FILE_ARCHIVE_TEAMS), 지점 → 등록 주소(FILE_ARCHIVE_BRANCH_URLS)로만 라우팅한다.
// 학생기록 봇(/api/slack/events)과 분리해 그쪽 동작·서명 secret·채널 설정에 영향을 주지 않는다.
// 파일 첨부 메시지(message.file_share) → FILE_ARCHIVE_SECRET 서명 job을 n8n으로 전달.
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

  // 공용 gateway: 지점은 Slack team_id로만 정한다. 등록 안 된 팀은 기본 지점으로 처리하지 않고 거부(fail closed).
  if (!envelope.team_id || !archiveTeamMap().has(envelope.team_id)) {
    return NextResponse.json({ error: "workspace_not_allowed" }, { status: 403 });
  }
  const built = envelope.event ? buildArchiveJob(envelope, envelope.event) : null;
  if (!built || !built.ok) {
    if (built?.reason === "branch_url_not_configured") {
      // 설정 오류 — 다른 지점 주소나 요청 도메인으로 대체하지 않고 전달하지 않는다(설정 후 Slack 재전송으로 복구)
      console.error("slack file archive: branch callback url not configured", envelope.event_id);
      return NextResponse.json({ error: "branch_url_not_configured" }, { status: 503 });
    }
    return NextResponse.json({ ok: true, ignored: true });
  }
  const job = built.job;
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
