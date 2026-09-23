// EXAM AI 파일 인덱스(file_archives, 007 migration) — Slack 파일 자동보관 + 자연어 파일검색.
//
// 역할 분리:
//  - Slack: 직원이 파일을 올리는 곳(장기 저장소 아님)
//  - n8n: Slack 파일 다운로드 → Google Drive 업로드 → 이 모듈의 archive API 호출(운반만)
//  - Google Drive: 원본 binary 장기 보관(EXAM AI는 Drive 자격증명을 갖지 않음)
//  - EXAM AI: 메타데이터 정본 + 지점/공용 범위 + 자연어 검색
//
// 보안: EXAM AI ↔ n8n 호출은 FILE_ARCHIVE_SECRET HMAC-SHA256 서명(`v1=hex`, 타임스탬프 5분창).
// 지점은 n8n이 보낸 값을 믿지 않고, 이 배포의 지점 코드 + Slack 팀→지점 매핑(SLACK_FILE_ARCHIVE_TEAMS,
// 선택적으로 채널 제한 SLACK_FILE_ARCHIVE_CHANNELS)으로 서버가 다시 검증한다. Slack 토큰·Drive 자격증명은 저장/전달/응답하지 않는다.
import { createHmac, timingSafeEqual } from "crypto";
import {
  branchCode,
  currentBranchId,
  pgGetByNotionId,
  pgInsertRow,
  pgQueryBranchOrShared,
  pgQueryRaw,
} from "./supabaseRepo";

const SIGNATURE_WINDOW_SEC = 300;

// ---------------------------------------------------------------------------
// 설정(환경변수) — 값은 코드에 두지 않는다.
// ---------------------------------------------------------------------------
function archiveSecret(): string | null {
  return process.env.FILE_ARCHIVE_SECRET || null;
}

/** "K=v,K=v" → Map(K → v) */
function pairMap(value: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of (value ?? "").split(",")) {
    const [key, code] = part.split("=").map((v) => v?.trim());
    if (key && code) map.set(key, code);
  }
  return map;
}

/** "T0SAJIK=sajik,T0GEUMJ=geumjeong" → Map(Slack team → branch code). 지점은 Slack 워크스페이스로 구분한다. */
export function archiveTeamMap(): Map<string, string> {
  return pairMap(process.env.SLACK_FILE_ARCHIVE_TEAMS);
}

/** (선택) "C0123=sajik,..." — 설정하면 이 채널만 보관한다(채널 → 지점). 비우면 팀의 모든 채널. */
export function archiveChannelMap(): Map<string, string> {
  return pairMap(process.env.SLACK_FILE_ARCHIVE_CHANNELS);
}

/**
 * Slack 팀(+선택 채널 제한) → 지점 코드. fail closed: SLACK_FILE_ARCHIVE_TEAMS에 없는 팀은 항상 null
 * (기본 지점·SLACK_TEAM_ID·배포 지점으로 대체하지 않는다). 채널 제한을 켜면 채널 지점도 팀 지점과 같아야 한다.
 */
export function resolveArchiveBranch(teamId: string | undefined, channelId: string | undefined): string | null {
  if (!teamId || !channelId) return null;
  const teamCode = archiveTeamMap().get(teamId);
  if (!teamCode) return null;
  const channels = archiveChannelMap();
  if (channels.size > 0 && channels.get(channelId) !== teamCode) return null;
  return teamCode;
}

/**
 * 지점 → 등록 API 주소. "sajik=https://a,geumjeong=https://b"(FILE_ARCHIVE_BRANCH_URLS)에 명시된 https 주소만 쓴다.
 * 요청이 들어온 도메인(공용 Slack gateway)이나 다른 지점 주소로 대체하지 않는다 — 없으면 null.
 */
export function archiveCallbackUrl(code: string): string | null {
  for (const part of (process.env.FILE_ARCHIVE_BRANCH_URLS ?? "").split(",")) {
    const i = part.indexOf("=");
    if (i <= 0 || part.slice(0, i).trim() !== code) continue;
    const base = part.slice(i + 1).trim().replace(/\/$/, "");
    return /^https:\/\/[^/?#]+$/.test(base) ? `${base}/api/files/archive` : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 서명
// ---------------------------------------------------------------------------
export function signArchive(secret: string, timestamp: string, payload: string): string {
  return `v1=${createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex")}`;
}

export type ArchiveAuth = { ok: true } | { ok: false; status: number; reason: string };

export function verifyArchiveSignature(payload: string, timestamp: string | null, signature: string | null, nowSec = Math.floor(Date.now() / 1000)): ArchiveAuth {
  const secret = archiveSecret();
  if (!secret) return { ok: false, status: 503, reason: "not_configured" };
  if (!timestamp || !signature || !/^\d+$/.test(timestamp)) return { ok: false, status: 401, reason: "missing_signature" };
  if (Math.abs(nowSec - Number(timestamp)) > SIGNATURE_WINDOW_SEC) return { ok: false, status: 401, reason: "stale_timestamp" };
  const expected = Buffer.from(signArchive(secret, timestamp, payload));
  const got = Buffer.from(signature);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return { ok: false, status: 401, reason: "bad_signature" };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 등록(n8n → EXAM AI) — 멱등
// ---------------------------------------------------------------------------
export type ArchiveInput = {
  branchCode: string;
  teamId: string;
  channelId: string;
  messageTs?: string;
  threadTs?: string;
  fileId: string;
  userId?: string;
  uploaderName?: string;
  messageText?: string;
  originalFilename: string;
  mimeType?: string;
  fileSize?: number;
  uploadedAt?: string;
  driveFileId: string;
  driveUrl: string;
  driveFolderId?: string;
  relatedTaskId?: string;
};

const DRIVE_URL = /^https:\/\/(drive|docs)\.google\.com\//;
const SECRET_IN_URL = /(access_token|[?&]key=|[?&]token=|[?&]sig=)/i;

export function validateArchiveInput(body: unknown): { ok: true; input: ArchiveInput } | { ok: false; reason: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof b[k] === "string" ? (b[k] as string).trim() : "");
  const input: ArchiveInput = {
    branchCode: str("branchCode"),
    teamId: str("teamId"),
    channelId: str("channelId"),
    messageTs: str("messageTs") || undefined,
    threadTs: str("threadTs") || undefined,
    fileId: str("fileId"),
    userId: str("userId") || undefined,
    uploaderName: str("uploaderName").slice(0, 100) || undefined,
    messageText: str("messageText").slice(0, 4000) || undefined,
    originalFilename: str("originalFilename").slice(0, 500),
    mimeType: str("mimeType").slice(0, 200) || undefined,
    fileSize: typeof b.fileSize === "number" && Number.isFinite(b.fileSize) && b.fileSize >= 0 ? Math.floor(b.fileSize) : undefined,
    uploadedAt: str("uploadedAt") && !Number.isNaN(Date.parse(str("uploadedAt"))) ? new Date(str("uploadedAt")).toISOString() : undefined,
    driveFileId: str("driveFileId"),
    driveUrl: str("driveUrl"),
    driveFolderId: str("driveFolderId") || undefined,
    relatedTaskId: str("relatedTaskId") || undefined,
  };
  if (!input.branchCode || !input.teamId || !input.channelId) return { ok: false, reason: "missing_slack_context" };
  if (!/^F[A-Z0-9]{6,}$/.test(input.fileId)) return { ok: false, reason: "invalid_slack_file_id" };
  if (!input.originalFilename) return { ok: false, reason: "missing_filename" };
  if (!/^[A-Za-z0-9_-]{10,}$/.test(input.driveFileId)) return { ok: false, reason: "invalid_drive_file_id" };
  if (!DRIVE_URL.test(input.driveUrl) || SECRET_IN_URL.test(input.driveUrl)) return { ok: false, reason: "invalid_drive_url" };
  return { ok: true, input };
}

/** 이 배포(지점)에서 받아도 되는 Slack 파일인지 — n8n이 보낸 지점을 그대로 믿지 않는다. */
export function checkArchiveScope(input: Pick<ArchiveInput, "branchCode" | "teamId" | "channelId">): { ok: true } | { ok: false; reason: string } {
  const myCode = branchCode();
  if (!myCode || input.branchCode !== myCode) return { ok: false, reason: "branch_mismatch" };
  if (resolveArchiveBranch(input.teamId, input.channelId) !== myCode) return { ok: false, reason: "team_or_channel_not_mapped_to_branch" };
  return { ok: true };
}

export type ArchiveRecord = {
  id: string;
  status: "created" | "existing";
  driveFileId: string;
  driveUrl: string;
};

function toRecord(row: Record<string, unknown>, status: ArchiveRecord["status"]): ArchiveRecord {
  return { id: String(row.id), status, driveFileId: String(row.drive_file_id), driveUrl: String(row.drive_url) };
}

export async function findSlackArchive(teamId: string, fileId: string): Promise<Record<string, unknown> | null> {
  const rows = await pgQueryRaw(
    "FILE_ARCHIVE",
    `source=eq.slack&slack_team_id=eq.${encodeURIComponent(teamId)}&slack_file_id=eq.${encodeURIComponent(fileId)}`
  );
  return rows[0] ?? null;
}

// Slack 사용자 → EXAM AI 직원(staff.source_payload.slackUserId가 명시적으로 연결된 경우만).
async function staffBySlackUser(userId: string | undefined): Promise<{ id: string; name: string } | null> {
  if (!userId) return null;
  const rows = await pgQueryRaw("STAFF", "id=not.is.null");
  const row = rows.find((r) => (r.source_payload as { slackUserId?: string } | null)?.slackUserId === userId);
  return row ? { id: String(row.notion_id ?? row.id), name: String(row.name ?? "") } : null;
}

/** 멱등 등록: 같은 Slack 파일이 이미 있으면 기존 행을 돌려주고 새로 만들지 않는다. visibility는 항상 branch. */
export async function registerSlackArchive(input: ArchiveInput): Promise<ArchiveRecord> {
  const existing = await findSlackArchive(input.teamId, input.fileId);
  if (existing) return toRecord(existing, "existing");

  const staff = await staffBySlackUser(input.userId);
  let relatedTaskId: string | null = null;
  if (input.relatedTaskId) {
    const task = await pgGetByNotionId("TODO", input.relatedTaskId).catch(() => null);
    relatedTaskId = task ? String(task.id) : null; // 이 지점에 있는 업무만 연결
  }
  try {
    const row = await pgInsertRow("FILE_ARCHIVE", {
      visibility: "branch",
      source: "slack",
      slack_team_id: input.teamId,
      slack_channel_id: input.channelId,
      slack_message_ts: input.messageTs ?? null,
      slack_thread_ts: input.threadTs ?? null,
      slack_file_id: input.fileId,
      slack_user_id: input.userId ?? null,
      uploader_name: staff?.name || input.uploaderName || null,
      uploader_staff_id: staff?.id ?? null,
      message_text: input.messageText ?? null,
      original_filename: input.originalFilename,
      mime_type: input.mimeType ?? null,
      file_size: input.fileSize ?? null,
      drive_file_id: input.driveFileId,
      drive_url: input.driveUrl,
      drive_folder_id: input.driveFolderId ?? null,
      related_task_id: relatedTaskId,
      classification: {},
      uploaded_at: input.uploadedAt ?? null,
      source_payload: { registeredBy: "n8n" },
    });
    return { id: row.id, status: "created", driveFileId: input.driveFileId, driveUrl: input.driveUrl };
  } catch (err) {
    // 동시 재시도로 유니크 인덱스에 걸린 경우 — 먼저 들어간 행을 돌려준다.
    const again = await findSlackArchive(input.teamId, input.fileId).catch(() => null);
    if (again) return toRecord(again, "existing");
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Slack 파일 이벤트 → n8n 전달(EXAM AI가 Slack 서명을 검증한 뒤)
// ---------------------------------------------------------------------------
export type SlackFileEvent = {
  type?: string;
  subtype?: string;
  channel?: string;
  user?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  bot_id?: string;
  files?: { id?: string; name?: string; title?: string; mimetype?: string; size?: number; created?: number; mode?: string }[];
};

export type ArchiveJob = {
  version: 1;
  eventId: string;
  branchCode: string;
  callbackUrl: string;
  teamId: string;
  channelId: string;
  messageTs: string;
  threadTs: string;
  userId: string;
  messageText: string;
  files: { id: string; name: string; mimeType: string; size: number; createdAt: string }[];
};

export type ArchiveJobResult =
  | { ok: true; job: ArchiveJob }
  | { ok: false; reason: "not_file_message" | "channel_not_allowed" | "branch_url_not_configured" };

/**
 * 보관 대상 파일 메시지면 n8n에 보낼 작업을 만든다. Slack 다운로드 URL/토큰은 넣지 않는다.
 * 팀 등록 여부는 호출부(공용 gateway)가 먼저 archiveTeamMap()으로 확인한다.
 */
export function buildArchiveJob(envelope: { team_id?: string; event_id?: string }, event: SlackFileEvent): ArchiveJobResult {
  if (event.type !== "message" || event.bot_id || event.subtype === "bot_message") return { ok: false, reason: "not_file_message" };
  if (event.subtype && event.subtype !== "file_share") return { ok: false, reason: "not_file_message" };
  const files = (event.files ?? []).filter((f) => f.id && f.mode !== "tombstone" && f.mode !== "external");
  if (files.length === 0) return { ok: false, reason: "not_file_message" };
  const code = resolveArchiveBranch(envelope.team_id, event.channel);
  if (!code || !envelope.team_id) return { ok: false, reason: "channel_not_allowed" };
  const callbackUrl = archiveCallbackUrl(code);
  if (!callbackUrl) return { ok: false, reason: "branch_url_not_configured" };
  return { ok: true, job: {
    version: 1,
    eventId: envelope.event_id ?? "",
    branchCode: code,
    callbackUrl,
    teamId: envelope.team_id,
    channelId: event.channel ?? "",
    messageTs: event.ts ?? "",
    threadTs: event.thread_ts ?? "",
    userId: event.user ?? "",
    messageText: (event.text ?? "").slice(0, 4000),
    files: files.map((f) => ({
      id: f.id as string,
      name: (f.name || f.title || f.id) as string,
      mimeType: f.mimetype ?? "",
      size: typeof f.size === "number" ? f.size : 0,
      createdAt: f.created ? new Date(f.created * 1000).toISOString() : new Date(Number(String(event.ts ?? "0").split(".")[0]) * 1000).toISOString(),
    })),
  } };
}

/** n8n webhook으로 서명해서 보낸다. 실패하면 false — 호출부가 Slack에 5xx를 돌려 재시도하게 한다. */
export async function forwardArchiveJob(job: ArchiveJob, timeoutMs = 2500): Promise<boolean> {
  const url = process.env.N8N_FILE_ARCHIVE_WEBHOOK_URL;
  const secret = archiveSecret();
  if (!url || !secret) return false;
  const body = JSON.stringify(job);
  const ts = String(Math.floor(Date.now() / 1000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-exam-ai-timestamp": ts, "x-exam-ai-signature": signArchive(secret, ts, body) },
      body,
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// 자연어 파일 검색(읽기 전용) — 현재 지점 + shared만.
// ---------------------------------------------------------------------------
export type FileSearchFilter = {
  keywords?: string[];
  uploader?: string;
  from?: string; // YYYY-MM-DD (KST, 포함)
  to?: string; // YYYY-MM-DD (KST, 포함)
  since?: string; // ISO 시각 — "24시간 이내"처럼 지금부터 거슬러 올라가는 기간
  kind?: string; // pdf | hwp | doc | sheet | ppt | image
  branch?: string; // sajik | geumjeong — 이 배포 지점이 아니면 그 지점의 공용(shared) 자료만 남는다
};

export type FileHit = {
  id: string;
  filename: string;
  uploadedAt: string | null;
  uploader: string;
  scope: "이 지점" | "공용";
  fromOtherBranch: boolean;
  branchLabel: string;
  messageSnippet: string;
  mimeType: string;
  driveUrl: string;
  relatedTask: { id: string; label: string } | null;
};

const KIND_PATTERNS: Record<string, RegExp> = {
  pdf: /pdf/i,
  hwp: /(hwp|hangul|haansoft)/i,
  doc: /(word|msword|document|docx?)/i,
  sheet: /(sheet|excel|xlsx?|csv)/i,
  ppt: /(presentation|powerpoint|pptx?)/i,
  image: /^image\//i,
};
const EXT_PATTERNS: Record<string, RegExp> = {
  pdf: /\.pdf$/i,
  hwp: /\.hwpx?$/i,
  doc: /\.docx?$/i,
  sheet: /\.(xlsx?|csv)$/i,
  ppt: /\.pptx?$/i,
  image: /\.(png|jpe?g|gif|webp|heic)$/i,
};
const kstStart = (d: string) => new Date(`${d}T00:00:00+09:00`).toISOString();
// Mac에서 올린 파일명은 한글이 자모 분리(NFD)로 저장되는 경우가 많다 — NFC로 맞춰야 "이사벨"이 일치한다.
const norm = (v: string) => v.normalize("NFC").replace(/\s+/g, "").toLowerCase();
// 검색어에서 의미 없는 말("파일", "자료", 조사 등)은 빼고 비교한다.
const STOPWORDS = new Set(["파일", "자료", "문서", "첨부", "찾아줘", "찾아", "보여줘", "검색", "올린", "올라온", "최종본"]);
const BRANCH_LABEL: Record<string, string> = { sajik: "사직", geumjeong: "금정" };

/** 자연어 속 지점 언급("사직에서", "금정 자료") → 지점 코드. 없으면 undefined. */
export function fileBranchFromText(text: string): string | undefined {
  if (/사직/.test(text) && !/금정/.test(text)) return "sajik";
  if (/금정/.test(text) && !/사직/.test(text)) return "geumjeong";
  return undefined;
}

/**
 * 상대 날짜 표현 → KST 기간(YYYY-MM-DD, 양끝 포함). 주는 월요일 시작. 표현이 없으면 null.
 * AI가 날짜를 추측해 넣어도 문장에 기간이 없으면 기간 필터를 걸지 않기 위해 원문에서 직접 계산한다.
 */
export function fileDateRange(text: string, today: string): { from: string; to: string } | null {
  const t = text.replace(/\s+/g, "");
  const d = new Date(`${today}T00:00:00Z`);
  const fmt = (x: Date) => x.toISOString().slice(0, 10);
  const add = (n: number) => fmt(new Date(d.getTime() + n * 86400000));
  const dow = (d.getUTCDay() + 6) % 7; // 월=0
  const monthStart = (offset: number) => fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1)));
  const monthEnd = (offset: number) => fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset + 1, 0)));
  if (/(그저께|그제)/.test(t)) return { from: add(-2), to: add(-2) };
  if (/어제/.test(t)) return { from: add(-1), to: add(-1) };
  if (/오늘/.test(t)) return { from: today, to: today };
  if (/(지난주|저번주)/.test(t)) return { from: add(-dow - 7), to: add(-dow - 1) };
  if (/이번주/.test(t)) return { from: add(-dow), to: today };
  if (/(지난달|저번달)/.test(t)) return { from: monthStart(-1), to: monthEnd(-1) };
  if (/이번달/.test(t)) return { from: monthStart(0), to: today };
  return null;
}

/** "24시간 이내", "최근 3일", "2주 안에"처럼 지금부터 거슬러 올라가는 기간 → 시작 시각(ISO)과 표시 라벨. 없으면 null. */
export function fileRelativeWindow(text: string, now: Date = new Date()): { since: string; label: string } | null {
  const t = text.replace(/\s+/g, "");
  const m = t.match(/(\d{1,3})(시간|일|주|개월|달)(?:이내|내|안|동안|사이)/) ?? t.match(/(?:최근|지난)(\d{1,3})(시간|일|주|개월|달)/);
  const n = m ? Number(m[1]) : 0;
  if (!m || !n) return null;
  const hours = m[2] === "시간" ? n : m[2] === "일" ? n * 24 : m[2] === "주" ? n * 168 : n * 720;
  return { since: new Date(now.getTime() - hours * 3600000).toISOString(), label: `최근 ${n}${m[2] === "달" ? "개월" : m[2]}` };
}

export async function searchFileArchives(filter: FileSearchFilter, limit = 50): Promise<FileHit[]> {
  const myBranch = await currentBranchId();
  const parts: string[] = [];
  if (filter.since) parts.push(`uploaded_at=gte.${encodeURIComponent(filter.since)}`);
  if (filter.from) parts.push(`uploaded_at=gte.${encodeURIComponent(kstStart(filter.from))}`);
  if (filter.to) parts.push(`uploaded_at=lt.${encodeURIComponent(new Date(new Date(kstStart(filter.to)).getTime() + 86400000).toISOString())}`);
  parts.push("order=uploaded_at.desc", "limit=1000");
  const rows = await pgQueryBranchOrShared("FILE_ARCHIVE", parts.join("&"));

  const keywords = (filter.keywords ?? []).map((k) => k.trim()).filter((k) => k && !STOPWORDS.has(k));
  const uploader = (filter.uploader ?? "").trim().replace(/(쌤|선생님|조교님|조교|님)$/, "");
  const kind = filter.kind && KIND_PATTERNS[filter.kind] ? filter.kind : "";
  const myCode = branchCode() ?? "";
  const otherCode = Object.keys(BRANCH_LABEL).find((c) => c !== myCode) ?? "";
  const branchOf = (r: Record<string, unknown>) => (r.branch_id === myBranch ? myCode : otherCode);
  // 관련성: 파일명에 맞으면 2점, 메시지/업로더/분류/형식/채널에 맞으면 1점. 검색어가 여러 개면 하나라도
  // 맞는 파일을 모두 보여주고(애매하면 여러 개), 더 많이 맞는 파일 → 최신 순으로 정렬한다.
  const scored: { r: Record<string, unknown>; score: number }[] = [];
  for (const r of rows) {
    if (filter.branch && branchOf(r) !== filter.branch) continue;
    if (uploader && !norm(String(r.uploader_name ?? "")).includes(norm(uploader))) continue;
    if (kind && !(KIND_PATTERNS[kind].test(String(r.mime_type ?? "")) || EXT_PATTERNS[kind].test(String(r.original_filename ?? "")))) continue;
    const name = norm(String(r.original_filename ?? ""));
    const rest = norm(
      [r.message_text, r.uploader_name, r.mime_type, r.slack_channel_id, JSON.stringify(r.classification ?? {})].map((v) => String(v ?? "")).join(" ")
    );
    let score = 0;
    for (const k of keywords.map(norm)) score += name.includes(k) ? 2 : rest.includes(k) ? 1 : 0;
    if (keywords.length && score === 0) continue;
    scored.push({ r, score });
  }
  const at = (r: Record<string, unknown>) => String(r.uploaded_at ?? r.created_at ?? "");
  scored.sort((a, b) => b.score - a.score || at(b.r).localeCompare(at(a.r)));
  const top = scored.slice(0, limit).map((x) => x.r);

  const taskIds = Array.from(new Set(top.map((r) => r.related_task_id).filter(Boolean) as string[]));
  const tasks = taskIds.length ? await pgQueryRaw("TODO", `id=in.(${taskIds.map(encodeURIComponent).join(",")})`).catch(() => []) : [];
  const taskLabel = new Map(tasks.map((t) => [String(t.id), `${t.type ?? "업무"}${t.title ? ` · ${t.title}` : ""}${t.complete ? " (완료)" : ""}`]));

  return top.map((r) => ({
    id: String(r.id),
    filename: String(r.original_filename ?? ""),
    uploadedAt: (r.uploaded_at as string | null) ?? (r.created_at as string | null) ?? null,
    uploader: String(r.uploader_name ?? "알 수 없음"),
    scope: r.visibility === "shared" ? "공용" : "이 지점",
    fromOtherBranch: r.branch_id !== myBranch,
    branchLabel: BRANCH_LABEL[branchOf(r)] ?? "",
    messageSnippet: String(r.message_text ?? "").replace(/\s+/g, " ").slice(0, 80),
    mimeType: String(r.mime_type ?? ""),
    // 저장 시 검증한 Drive URL만(자격증명 없는 공유 링크) — 서버 프록시 없음
    driveUrl: DRIVE_URL.test(String(r.drive_url ?? "")) ? String(r.drive_url) : "",
    relatedTask: r.related_task_id ? { id: String(r.related_task_id), label: taskLabel.get(String(r.related_task_id)) ?? "관련 업무" } : null,
  }));
}
