import { createHmac, timingSafeEqual } from "crypto";
import "server-only";
import { searchStudents } from "./notion";
import { SLASH_COMMANDS, runNaturalLanguageCommand, runUnifiedNlInput } from "./nl-input";
import { pgInsertRow, pgPatchById, pgQueryRaw, pgResolveRelationId } from "./supabaseRepo";

const FIVE_MINUTES_SECONDS = 5 * 60;
const replayCache = new Map<string, number>();

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

// secret 기본값은 학생기록 봇(SLACK_SIGNING_SECRET). 파일 자동보관 앱은 자기 signing secret을 넘긴다.
export function verifySlackRequest(
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
  secret = process.env.SLACK_SIGNING_SECRET
): SlackVerification {
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

/** 전달 실패 시 예약을 풀어 Slack 재전송이 다시 처리되게 한다. */
export function releaseSlackEvent(eventId: string) {
  replayCache.delete(`event:${eventId}`);
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
    const result = (await response.json()) as T & { ok?: boolean; error?: string };
    if (!result.ok) console.error(`Slack API ${method} not ok`, result.error ?? "unknown_error");
    return result.ok ? result : null;
  } catch (error) {
    console.error(`Slack API ${method} failed`, error instanceof Error ? error.name : "unknown_error");
    return null;
  }
}

export async function addSlackReaction(
  channel: string,
  messageTs: string,
  name: "white_check_mark" | "warning" | "x" | "clipboard" | "question"
) {
  if (!channel || !messageTs) return;
  await slackApi("reactions.add", { channel, timestamp: messageTs, name });
}

// AI 업무운영 시스템의 첫 아웃바운드 발신(섹션15) — 이 파일은 지금까지 인바운드
// (Slack → 앱)만 처리했다. NORMAL 완료는 여기서 절대 호출하지 않는다(알림
// 폭탄 방지) — 호출부(app/api/tasks/**)가 REVIEW/URGENT/신규배정에만 쓴다.
// SLACK_TASK_CHANNEL_ID가 설정되어 있지 않으면 조용히 아무 일도 하지 않는다
// (기존 배포가 이 env var 없이도 그대로 동작해야 하므로).
export async function postSlackMessage(channel: string | undefined, text: string): Promise<void> {
  if (!channel) return;
  await slackApi("chat.postMessage", { channel, text });
}

// 신규 업무 배정 알림(섹션15) — app/api/tasks/from-text, app/api/tasks/[id]/followup
// 양쪽에서 재사용한다. SLACK_TASK_CHANNEL_ID 미설정 시 조용히 아무 일도 하지 않는다.
export function notifyTaskAssignments(tasks: { typeLabel: string; studentName: string; ownerName: string | null; pool: boolean }[]): void {
  const channel = process.env.SLACK_TASK_CHANNEL_ID;
  if (!channel) return;
  for (const t of tasks) {
    if (!t.ownerName) continue;
    // Slack 실패가 업무 저장/배정 결과에 영향을 주지 않도록 기록만 한다.
    postSlackMessage(channel, `📌 새 업무: ${t.typeLabel}${t.studentName ? " · " + t.studentName : ""} → ${t.ownerName}`).catch((err) =>
      console.error("[slack] notifyTaskAssignments failed", { typeLabel: t.typeLabel, owner: t.ownerName, message: err instanceof Error ? err.message : String(err) })
    );
  }
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

// Slack 기록 정본은 Supabase slack_records(현재 배포 지점 branch_id로만 읽고 쓴다). Slack 식별자는
// source_payload.slack에 둔다. Notion 시절에 만들어진 행(source_payload.properties.MessageTS)도 찾아서
// 수정/삭제가 이어지게 한다.
type SlackRecordRow = Record<string, unknown> & { id: string; source_payload?: { slack?: { eventIds?: string[] } } & Record<string, unknown> };
const enc = encodeURIComponent;

async function findRecordByMessageTs(channel: string, messageTs: string): Promise<SlackRecordRow | undefined> {
  const rows = await pgQueryRaw(
    "SLACK_RECORDS",
    `source_payload->slack->>messageTs=eq.${enc(messageTs)}&source_payload->slack->>channelId=eq.${enc(channel)}&limit=1`
  );
  if (rows[0]) return rows[0] as SlackRecordRow;
  const legacy = await pgQueryRaw("SLACK_RECORDS", `source_payload->properties->MessageTS->rich_text->0->>plain_text=eq.${enc(messageTs)}&limit=1`);
  return legacy[0] as SlackRecordRow | undefined;
}

async function eventAlreadyHandled(eventId: string): Promise<boolean> {
  const rows = await pgQueryRaw("SLACK_RECORDS", `source_payload->slack->eventIds=cs.${enc(JSON.stringify([eventId]))}&limit=1`);
  return rows.length > 0;
}

function eventIdsWith(row: SlackRecordRow | undefined, eventId: string): string[] {
  return Array.from(new Set([...(row?.source_payload?.slack?.eventIds ?? []), eventId])).slice(-50);
}

async function resolveStudent(text: string) {
  const parsedName = parseStudentName(text);
  if (!parsedName) return { parsedName: "", studentId: null, linkStatus: "학생태그없음" };

  const rawMatches = await searchStudents(parsedName, undefined, true);
  const exact = rawMatches.filter((student) => student.name.trim() === parsedName);
  if (exact.length === 1) return { parsedName, studentId: exact[0].id, linkStatus: "연결" };
  if (exact.length > 1) return { parsedName, studentId: null, linkStatus: "동명이인" };

  // 완전일치 후보가 없으면, 학생명 끝의 동명이인 구분용 숫자(예: "서지민1")를
  // 무시하고 한 번 더 매칭한다. 정확히 한 명일 때만 자동 연결하고, 둘 이상이면
  // 동명이인으로 남겨 오연결을 방지한다.
  const stripSuffixDigits = (name: string) => name.trim().replace(/\d+$/, "");
  const fuzzy = rawMatches.filter((student) => stripSuffixDigits(student.name) === parsedName);
  if (fuzzy.length === 1) return { parsedName, studentId: fuzzy[0].id, linkStatus: "연결" };
  return { parsedName, studentId: null, linkStatus: fuzzy.length === 0 ? "미일치" : "동명이인" };
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
  const existing = await findRecordByMessageTs(channel, normalized.messageTs);
  const slackPayload = (userId: string) => ({
    ...(existing?.source_payload ?? {}),
    slack: { teamId: envelope.team_id ?? "", channelId: channel, messageTs: normalized.messageTs, userId, eventIds: eventIdsWith(existing, eventId) },
  });

  if (normalized.action === "삭제") {
    if (!existing) return;
    const prevUser = String((existing.source_payload?.slack as { userId?: string } | undefined)?.userId ?? "");
    await pgPatchById("SLACK_RECORDS", existing.id, { status: "삭제", source_payload: slackPayload(prevUser) });
    return;
  }

  const resolved = await resolveStudent(normalized.text);
  const userId = normalized.message.user ?? event.user ?? "";
  const metadata = await getSlackMetadata(channel, normalized.messageTs, userId);
  const titleName = resolved.parsedName || "미연결 기록";
  const row = {
    title: `${titleName} Slack 기록`,
    student_notion_ids: resolved.studentId ? [resolved.studentId] : [],
    student_id: resolved.studentId ? await pgResolveRelationId("STUDENT", resolved.studentId) : null,
    written_at: messageDate(normalized.messageTs),
    original: normalized.text,
    author: metadata.author,
    permalink: metadata.permalink || null,
    status: normalized.action,
    link_status: resolved.linkStatus,
    source_payload: { ...slackPayload(userId), studentName: resolved.parsedName },
  };

  if (existing) {
    await pgPatchById("SLACK_RECORDS", existing.id, row);
  } else {
    await pgInsertRow("SLACK_RECORDS", row);
  }
  // [학생: 이름] 태그 메시지는 기존대로 학생 연결 결과를 반응으로 알린다.
  if (resolved.parsedName) await addSlackReaction(channel, normalized.messageTs, resolved.studentId ? "white_check_mark" : "warning");

  // 새 메시지에만(수정본 재처리는 안 함) "!보강 이름 시간"처럼 인식되는
  // 태그가 맨 앞에 붙어 있으면, 자연어 입력 박스와 같은 파이프라인으로
  // 보강/결석/상담/조치 등 실제 업무 DB에도 구조화해서 저장한다. 태그 없는
  // 메시지는 원문 아카이브(위)만 남고 구조화 저장은 시도하지 않는다 —
  // AI가 임의로 추측해 엉뚱한 DB에 잘못 적재하는 일을 막기 위한 의도적 게이트.
  // 자연어 입력 박스와 달리 "/"를 안 쓰는 이유: Slack은 "/"로 시작하는
  // 메시지를 자체 슬래시 명령으로 가로채서, 그 문법을 채팅창에 그대로
  // 타이핑할 수 없다. "!"는 Slack이 가로채지 않는다.
  if (!existing && normalized.action === "활성") {
    const tagMatch = normalized.text.match(/^\s*!\s*(\S+)\s+([\s\S]+)$/);
    const command = tagMatch ? SLASH_COMMANDS[tagMatch[1]] : undefined;
    console.log("Slack 태그 감지", eventId, tagMatch?.[1], !!command);
    if (command) {
      try {
        const result = await runNaturalLanguageCommand(tagMatch![2].trim(), {
          staffName: metadata.author,
          forceTool: command.tool,
          forcedScheduleType: command.scheduleType,
          forcedInboxType: command.inboxType,
        });
        console.log("Slack 태그 처리 결과", eventId, result.kind);
        if (result.kind === "saved") {
          await addSlackReaction(channel, normalized.messageTs, "clipboard");
        } else if (result.kind === "ai_error" || result.kind === "save_error") {
          await addSlackReaction(channel, normalized.messageTs, "x");
        } else {
          await addSlackReaction(channel, normalized.messageTs, "question");
        }
      } catch (error) {
        console.error("Slack 자연어 명령 처리 실패", eventId, error instanceof Error ? error.name : "unknown_error");
        await addSlackReaction(channel, normalized.messageTs, "x");
      }
    } else if (!resolved.parsedName) {
      // 태그 없는 자유 문장("김민수 단어 재시험")은 EXAM AI 입력창과 같은 runUnifiedNlInput으로
      // 처리한다(학생 기록 → student_learning_records, 이 배포 지점 학생만). 되묻기가 필요하면 ❓만 남긴다
      // (Slack에서는 이어서 답할 화면이 없으므로 저장하지 않음). 메시지 수정·삭제는 다시 처리하지 않는다.
      try {
        const staff = await staffForSlackUser(userId, metadata.author);
        const result = await runUnifiedNlInput(normalized.text, { staffName: staff?.name ?? metadata.author, staffId: staff?.id, role: staff?.role });
        if (result.tasks.length > 0) notifyTaskAssignments(result.tasks);
        const statuses = result.outcomes.map((o) => o.status);
        console.log("Slack 자연어 기록 결과", eventId, statuses.join(","));
        const reaction = statuses.includes("실패") ? "x" : statuses.includes("확인필요") ? "question" : statuses.length ? "white_check_mark" : null;
        if (reaction) await addSlackReaction(channel, normalized.messageTs, reaction);
      } catch (error) {
        console.error("Slack 자연어 기록 처리 실패", eventId, error instanceof Error ? error.name : "unknown_error");
        await addSlackReaction(channel, normalized.messageTs, "x");
      }
    }
  }
}

// Slack 작성자 → 이 지점 직원(staff.source_payload.slackUserId 우선, 없으면 Slack 표시 이름과 같은 이름).
async function staffForSlackUser(userId: string, displayName: string): Promise<{ id: string; name: string; role?: string } | null> {
  const rows = await pgQueryRaw("STAFF", "resigned=is.false").catch(() => []);
  const row =
    rows.find((r) => userId && (r.source_payload as { slackUserId?: string } | null)?.slackUserId === userId) ??
    rows.find((r) => String(r.name ?? "").trim() === displayName.trim());
  return row ? { id: String(row.notion_id ?? row.id), name: String(row.name ?? ""), role: (row.role as string | null) ?? undefined } : null;
}
