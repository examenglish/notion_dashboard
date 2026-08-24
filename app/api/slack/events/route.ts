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

  const event = envelope.event;
  if (!event || event.channel !== process.env.SLACK_STUDENT_LOG_CHANNEL_ID) {
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
