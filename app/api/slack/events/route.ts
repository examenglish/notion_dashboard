import { waitUntil } from "@vercel/functions";
import { NextRequest, NextResponse } from "next/server";
import {
  addSlackReaction,
  processSlackEvent,
  reserveSlackEvent,
  shouldIgnoreSlackEvent,
  type SlackEnvelope,
  verifySlackRequest,
} from "@/lib/slack";
import { buildArchiveJob, forwardArchiveJob, type SlackFileEvent } from "@/lib/fileArchive";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const verification = verifySlackRequest(
    rawBody,
    req.headers.get("x-slack-request-timestamp"),
    req.headers.get("x-slack-signature")
  );
  if (!verification.ok) {
    const status = verification.reason === "configuration" ? 503 : 401;
    return NextResponse.json({ error: `slack_${verification.reason}` }, { status });
  }
  if (verification.replay) return NextResponse.json({ ok: true, duplicate: true });

  let envelope: SlackEnvelope;
  try {
    envelope = JSON.parse(rawBody) as SlackEnvelope;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (envelope.type === "url_verification") {
    return NextResponse.json({ challenge: envelope.challenge ?? "" });
  }
  if (envelope.team_id !== process.env.SLACK_TEAM_ID) {
    return NextResponse.json({ error: "workspace_not_allowed" }, { status: 403 });
  }

  // 파일 자동보관: 매핑된 채널의 파일 첨부 메시지는 n8n(Slack 다운로드 → Drive → 파일 인덱스)으로
  // 서명해서 넘긴다. Slack 토큰/다운로드 URL은 넘기지 않는다. 전달 실패면 5xx로 응답해 Slack이
  // 재전송하게 한다(n8n 쪽은 Slack file id 기준 멱등이라 재전송돼도 중복 보관되지 않음).
  const archiveJob = envelope.event ? buildArchiveJob(envelope, envelope.event as SlackFileEvent, req.nextUrl.origin) : null;
  if (archiveJob) {
    const forwarded = await forwardArchiveJob(archiveJob);
    if (!forwarded) {
      console.error("slack file archive forward failed", envelope.event_id);
      return NextResponse.json({ error: "archive_forward_failed" }, { status: 503 });
    }
    return NextResponse.json({ ok: true, archive: archiveJob.files.length });
  }

  const allowedChannels = (process.env.SLACK_STUDENT_LOG_CHANNEL_ID ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const event = envelope.event;
  if (!event || !allowedChannels.includes(event.channel ?? "")) {
    return NextResponse.json({ ok: true, ignored: true });
  }
  if (shouldIgnoreSlackEvent(event)) return NextResponse.json({ ok: true, ignored: true });
  if (!envelope.event_id || !reserveSlackEvent(envelope.event_id)) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  waitUntil(
    processSlackEvent(envelope).catch((error) => {
      console.error(
        "Slack student record processing failed",
        envelope.event_id,
        error instanceof Error ? error.name : "unknown_error"
      );
      const messageTs = event.subtype === "message_changed" ? event.message?.ts : event.ts;
      return addSlackReaction(event.channel ?? "", messageTs ?? "", "x");
    })
  );
  return NextResponse.json({ ok: true });
}
