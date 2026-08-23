import { createHmac, timingSafeEqual } from "crypto";
import "server-only";
import {
  DB,
  getRichText,
  notion,
  searchStudents,
} from "./notion";

const FIVE_MINUTES_SECONDS = 5 * 60;
const NOTION_RICH_TEXT_LIMIT = 2000;
const replayCache = new Map<string, number>();

function notionRichText(content: string) {
  const chunks = [];
  for (let offset = 0; offset < content.length; offset += NOTION_RICH_TEXT_LIMIT) {
    chunks.push({ text: { content: content.slice(offset, offset + NOTION_RICH_TEXT_LIMIT) } });
  }
  return chunks.length > 0 ? chunks : [{ text: { content: "" } }];
}

export type SlackEnvelope = {
  type?: string;
  challenge?: string;
  team_id?: string;
  event_id?: string;
  event?: SlackMessageEvent;
};

type SlackMessage = {
  type?: string;
  subtype?: string;
  channel?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  ts?: string;
  event_ts?: string;
  message?: SlackMessage;
  previous_message?: SlackMessage;
  deleted_ts?: string;
  channel_type?: string;
};

type SlackMessageEvent = SlackMessage;

export type SlackVerification =
  | { ok: true; replay: boolean }
  | { ok: false; reason: "configuration" | "timestamp" | "signature" };

function pruneReplayCache(now: number) {
  for (const [key, expiresAt] of replayCache) {
    if (expiresAt <= now) replayCache.delete(key);
  }
}

export function verifySlackRequest(rawBody: string, timestamp: string | null, signature: string | null): SlackVerification {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) return { ok: false, reason: "configuration" };

  const timestampNumber = Number(timestamp);
  const now = Math.floor(Date.now() / 1000);
  if (!timestamp || !Number.isFinite(timestampNumber) || Math.abs(now - timestampNumber) > FIVE_MINUTES_SECONDS) {
    return { ok: false, reason: "timestamp" };
  }

  const expected = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex")}`;
  if (!signature || signature.length !== expected.length) return { ok: false, reason: "signature" };
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return { ok: false, reason: "signature" };

  pruneReplayCache(now);
  if (replayCache.has(signature)) return { ok: true, replay: true };
  replayCache.set(signature, now + FIVE_MINUTES_SECONDS);
  return { ok: true, replay: false };
}

export function reserveSlackEvent(eventId: string): boolean {
  const now = Math.floor(Date.now() / 1000);
  pruneReplayCache(now);
  const key = `event:${eventId}`;
  if (replayCache.has(key)) return false;
  replayCache.set(key, now + FIVE_MINUTES_SECONDS);
  return true;
}

function parseStudentName(text: string): string | null {
  const match = text.match(/^\s*\[학생\s*:\s*([^\]\r\n]+?)\s*\]/);
  return match?.[1]?.trim() || null;
}

function messageDate(ts: string): string {
  const milliseconds = Number.parseFloat(ts) * 1000;
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : new Date().toISOString();
}

async function slackApi<T>(method: string, body: Record<string, string>): Promise<T | null> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return null;
  try {
    const response = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
    });
    const result = (await response.json()) as T & { ok?: boolean };
    return result.ok ? result : null;
  } catch (error) {
    console.error(`Slack API ${method} failed`, error instanceof Error ? error.name : "unknown_error");
    return null;
  }
}

export async function addSlackReaction(channel: string, messageTs: string, name: "white_check_mark" | "warning" | "x") {
  if (!channel || !messageTs) return;
  await slackApi("reactions.add", { channel, timestamp: messageTs, name });
}

async function getSlackMetadata(channel: string, messageTs: string, userId: string) {
  const [user, permalink] = await Promise.all([
    userId
      ? slackApi<{ user?: { real_name?: string; profile?: { display_name?: string; real_name?: string } } }>("users.info", {
          user: userId,
        })
      : Promise.resolve(null),
    slackApi<{ permalink?: string }>("chat.getPermalink", { channel, message_ts: messageTs }),
  ]);
  return {
    author:
      user?.user?.profile?.display_name || user?.user?.profile?.real_name || user?.user?.real_name || userId || "알 수 없음",
    permalink: permalink?.permalink ?? "",
  };
}

async function findRecordByMessageTs(messageTs: string) {
  const result: any = await notion.dataSources.query({
    data_source_id: DB.SLACK_RECORDS,
    filter: { property: "MessageTS", rich_text: { equals: messageTs } },
    page_size: 1,
  });
  return result.results[0] as any | undefined;
}

async function eventAlreadyHandled(eventId: string): Promise<boolean> {
  const result: any = await notion.dataSources.query({
    data_source_id: DB.SLACK_RECORDS,
    filter: { property: "처리EventID", rich_text: { contains: eventId } },
    page_size: 1,
  });
  return result.results.length > 0;
}

function eventIdsWith(page: any, eventId: string): string {
  const existing = getRichText(page, "처리EventID").split(",").filter(Boolean);
  return Array.from(new Set([...existing, eventId])).slice(-50).join(",");
}

async function resolveStudent(text: string) {
  const parsedName = parseStudentName(text);
  if (!parsedName) return { parsedName: "", studentId: null, linkStatus: "학생태그없음" };
  const candidates = (await searchStudents(parsedName, undefined, true)).filter((student) => student.name.trim() === parsedName);
  if (candidates.length === 1) return { parsedName, studentId: candidates[0].id, linkStatus: "연결" };
  return { parsedName, studentId: null, linkStatus: candidates.length === 0 ? "미일치" : "동명이인" };
}

function normalizeEvent(event: SlackMessageEvent) {
  if (event.subtype === "message_changed") {
    const message = event.message ?? {};
    return { action: "수정", message, messageTs: message.ts ?? "", text: message.text ?? "" } as const;
  }
  if (event.subtype === "message_deleted") {
    return {
      action: "삭제",
      message: event.previous_message ?? {},
      messageTs: event.deleted_ts ?? event.previous_message?.ts ?? "",
      text: event.previous_message?.text ?? "",
    } as const;
  }
  return { action: "활성", message: event, messageTs: event.ts ?? "", text: event.text ?? "" } as const;
}

export function shouldIgnoreSlackEvent(event: SlackMessageEvent): boolean {
  const normalized = normalizeEvent(event);
  const allowedSubtype = !event.subtype || event.subtype === "message_changed" || event.subtype === "message_deleted";
  return (
    event.type !== "message" ||
    event.channel_type !== "group" ||
    !allowedSubtype ||
    !!event.bot_id ||
    event.subtype === "bot_message" ||
    !!normalized.message.bot_id ||
    normalized.message.subtype === "bot_message"
  );
}

export async function processSlackEvent(envelope: SlackEnvelope): Promise<void> {
  const event = envelope.event;
  const eventId = envelope.event_id;
  if (!event || !eventId || shouldIgnoreSlackEvent(event)) return;
  if (await eventAlreadyHandled(eventId)) return;

  const channel = event.channel ?? "";
  const normalized = normalizeEvent(event);
  if (!normalized.messageTs) return;
  const existing = await findRecordByMessageTs(normalized.messageTs);

  if (normalized.action === "삭제") {
    if (!existing) return;
    await notion.pages.update({
      page_id: existing.id,
      properties: {
        상태: { select: { name: "삭제" } },
        처리EventID: { rich_text: [{ text: { content: eventIdsWith(existing, eventId) } }] },
      } as any,
    });
    return;
  }

  const resolved = await resolveStudent(normalized.text);
  const userId = normalized.message.user ?? event.user ?? "";
  const metadata = await getSlackMetadata(channel, normalized.messageTs, userId);
  const titleName = resolved.parsedName || "미연결 기록";
  const commonProperties: any = {
    제목: { title: [{ text: { content: `${titleName} Slack 기록` } }] },
    학생: { relation: resolved.studentId ? [{ id: resolved.studentId }] : [] },
    학생명: { rich_text: notionRichText(resolved.parsedName) },
    원문: { rich_text: notionRichText(normalized.text) },
    Slack작성자: { rich_text: [{ text: { content: metadata.author } }] },
    작성자ID: { rich_text: [{ text: { content: userId } }] },
    작성시각: { date: { start: messageDate(normalized.messageTs) } },
    원문링크: metadata.permalink ? { url: metadata.permalink } : { url: null },
    상태: { select: { name: normalized.action } },
    연결상태: { select: { name: resolved.linkStatus } },
    TeamID: { rich_text: [{ text: { content: envelope.team_id ?? "" } }] },
    ChannelID: { rich_text: [{ text: { content: channel } }] },
    MessageTS: { rich_text: [{ text: { content: normalized.messageTs } }] },
    처리EventID: { rich_text: [{ text: { content: existing ? eventIdsWith(existing, eventId) : eventId } }] },
  };

  if (existing) {
    await notion.pages.update({ page_id: existing.id, properties: commonProperties });
  } else {
    await notion.pages.create({ parent: { data_source_id: DB.SLACK_RECORDS } as any, properties: commonProperties });
  }
  await addSlackReaction(channel, normalized.messageTs, resolved.studentId ? "white_check_mark" : "warning");
}
