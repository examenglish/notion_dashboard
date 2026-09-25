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
    console.log("[slack-events] rejected", verification.reason);
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
    console.log("[slack-events] team mismatch");
    return NextResponse.json({ error: "workspace_not_allowed" }, { status: 403 });
  }

  // 기존 기록 채널(SLACK_STUDENT_LOG_CHANNEL_ID)은 그대로 두고, 추가 채널은 SLACK_STUDENT_LOG_EXTRA_CHANNEL_IDS에.
  const allowedChannels = `${process.env.SLACK_STUDENT_LOG_CHANNEL_ID ?? ""},${process.env.SLACK_STUDENT_LOG_EXTRA_CHANNEL_IDS ?? ""}`
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const event = envelope.event;
  // 진단: 무시/처리 분기를 한 줄로 남긴다(채널 ID·이벤트 종류만, 메시지 본문·토큰 없음).
  const diag = {
    event_id: envelope.event_id,
    type: event?.type,
    subtype: event?.subtype ?? null,
    channel: event?.channel,
    channel_type: event?.channel_type,
    bot: !!event?.bot_id,
    allowed_channels: allowedChannels.length,
    channel_allowed: allowedChannels.includes(event?.channel ?? ""),
  };
  if (!event || !allowedChannels.includes(event.channel ?? "")) {
    console.log("[slack-events] ignored: channel not allowed", JSON.stringify(diag));
    return NextResponse.json({ ok: true, ignored: true });
  }
  if (shouldIgnoreSlackEvent(event)) {
    console.log("[slack-events] ignored: filter", JSON.stringify(diag));
    return NextResponse.json({ ok: true, ignored: true });
  }
  if (!envelope.event_id || !reserveSlackEvent(envelope.event_id)) {
    console.log("[slack-events] duplicate", JSON.stringify(diag));
    return NextResponse.json({ ok: true, duplicate: true });
  }
  console.log("[slack-events] processing", JSON.stringify(diag));

  waitUntil(
    processSlackEvent(envelope).catch((error) => {
      console.error(
        "Slack student record processing failed",
        envelope.event_id,
        error instanceof Error ? `${error.name}: ${error.message.slice(0, 300)}` : "unknown_error"
      );
      const messageTs = event.subtype === "message_changed" ? event.message?.ts : event.ts;
      return addSlackReaction(event.channel ?? "", messageTs ?? "", "x");
    })
  );
  return NextResponse.json({ ok: true });
}
