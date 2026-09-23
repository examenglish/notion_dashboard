// Slack 파일 자동보관 + 자연어 파일검색 — 실제 라우트/라이브러리를 branch 스코프 fake Supabase
// 위에서 검증(LLM은 mock). n8n/Drive는 외부이므로 n8n이 보내는 서명 요청과 EXAM AI가 n8n에
// 보내는 전달 요청을 그대로 재현한다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "crypto";
import { NextRequest } from "next/server";
import type { UnifiedIntent } from "@/lib/anthropic";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_cache: (fn: any) => fn, revalidateTag: vi.fn() }));
vi.mock("@notionhq/client", () => ({
  Client: vi.fn().mockImplementation(function Client() {
    return {
      pages: { create: vi.fn().mockResolvedValue({ id: "n" }), update: vi.fn().mockResolvedValue({}), retrieve: vi.fn().mockResolvedValue(null) },
      dataSources: { query: vi.fn().mockResolvedValue({ results: [] }) },
    };
  }),
}));
const { parseUnifiedInput } = vi.hoisted(() => ({ parseUnifiedInput: vi.fn() }));
vi.mock("@/lib/anthropic", async (orig) => ({ ...(await orig<typeof import("@/lib/anthropic")>()), parseUnifiedInput }));

type Row = Record<string, any>;
function matchClause(clause: string, row: Row): boolean {
  const neg = clause.match(/^([a-z_]+)\.not\.(.*)$/);
  if (neg) return !matchClause(`${neg[1]}.${neg[2]}`, row);
  const m = clause.match(/^([a-z_]+)\.(eq|is|cs|in|gte|lt|lte)\.(.*)$/);
  if (!m) throw new Error(`unsupported ${clause}`);
  const [, col, op, raw] = m;
  const v = decodeURIComponent(raw);
  const cell = row[col];
  if (op === "eq") {
    if (v === "true" || v === "false") return cell === (v === "true");
    if (Array.isArray(cell)) return `{${cell.join(",")}}` === v;
    return String(cell ?? "") === v;
  }
  if (op === "is") return raw === "null" ? cell === null || cell === undefined : false;
  if (op === "cs") return Array.isArray(cell) && cell.includes(v.replace(/^\{|\}$/g, ""));
  if (op === "in") return v.replace(/^\(|\)$/g, "").split(",").includes(String(cell ?? ""));
  if (op === "gte") return String(cell ?? "") >= v;
  if (op === "lt") return String(cell ?? "") < v;
  if (op === "lte") return String(cell ?? "") <= v;
  return false;
}
function applyFilters(rows: Row[], sp: URLSearchParams): Row[] {
  let out = rows;
  for (const [k, val] of sp.entries()) {
    if (["select", "limit", "order"].includes(k)) continue;
    if (k === "or") {
      const clauses = val.replace(/^\(|\)$/g, "").split(/,(?=[a-z_]+\.)/);
      out = out.filter((r) => clauses.some((c) => matchClause(c, r)));
      continue;
    }
    out = out.filter((r) => matchClause(`${k}.${val}`, r));
  }
  return out;
}
let tables: Record<string, Row[]>;
let insertFailures = 0;
const n8nCalls: { url: string; headers: Record<string, string>; body: string }[] = [];
function fakeFetch() {
  return vi.fn(async (url: string, init?: any) => {
    if (url.startsWith("https://n8n.example")) {
      n8nCalls.push({ url, headers: init.headers, body: init.body });
      return new Response("ok", { status: process.env.__N8N_DOWN ? 502 : 200 });
    }
    const u = new URL(url);
    const table = u.pathname.replace("/rest/v1/", "");
    const method = (init?.method ?? "GET").toUpperCase();
    if (table === "branches") {
      const code = u.searchParams.get("code")?.replace(/^eq\./, "");
      return new Response(JSON.stringify(code === "sajik" ? [{ id: "b-sajik" }] : code === "geumjeong" ? [{ id: "b-gj" }] : []), { status: 200 });
    }
    tables[table] ??= [];
    if (method === "GET") return new Response(JSON.stringify(applyFilters(tables[table], u.searchParams)), { status: 200 });
    if (method === "POST") {
      if (table === "file_archives" && insertFailures > 0) {
        insertFailures--;
        return new Response('{"message":"db down"}', { status: 500 });
      }
      const items = JSON.parse(init.body);
      for (const it of items) {
        if (table === "file_archives" && tables[table].some((r) => r.branch_id === it.branch_id && r.slack_file_id === it.slack_file_id && r.slack_team_id === it.slack_team_id)) {
          return new Response('{"code":"23505"}', { status: 409 });
        }
      }
      const now = new Date().toISOString();
      const inserted = items.map((it: Row, i: number) => ({ id: `gen-${table}-${tables[table].length + i}`, created_at: now, updated_at: now, ...it }));
      tables[table].push(...inserted);
      return new Response(JSON.stringify(inserted), { status: 201 });
    }
    if (method === "PATCH") {
      const body = JSON.parse(init.body);
      const matched = applyFilters(tables[table], u.searchParams);
      matched.forEach((r) => Object.assign(r, body));
      return new Response(JSON.stringify(matched), { status: 200 });
    }
    return new Response("[]", { status: 200 });
  });
}

const SECRET = "test-file-archive-secret";
const SLACK_SECRET = "test-slack-signing";
const ARCHIVE_SLACK_SECRET = "test-archive-app-signing";
function useBranch(code: "sajik" | "geumjeong") {
  process.env.ACADEMY_BRANCH_ID = code;
  vi.resetModules();
}
beforeEach(() => {
  insertFailures = 0;
  n8nCalls.length = 0;
  delete process.env.__N8N_DOWN;
  tables = {
    staff: [
      { id: "st-minji", notion_id: "st-minji", branch_id: "b-sajik", name: "박민지", role: "조교", resigned: false, source_payload: { slackUserId: "U_MINJI" } },
      { id: "st-dir", notion_id: "st-dir", branch_id: "b-sajik", name: "서도영", role: "원장", resigned: false, source_payload: {} },
    ],
    classes: [],
    students: [],
    tasks: [{ id: "task-1", notion_id: null, branch_id: "b-sajik", type: "교재편집", title: "교재편집 - 거성중2", complete: false, staff_notion_ids: [] }],
    student_learning_records: [],
    admin_inbox_entries: [],
    file_archives: [],
  };
  vi.stubGlobal("fetch", fakeFetch());
  Object.assign(process.env, {
    SUPABASE_URL: "https://fake.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    ACADEMY_DB_PROVIDER: "postgres",
    ACADEMY_STUDENT_READ_PROVIDER: "postgres",
    SESSION_SECRET: "sess",
    FILE_ARCHIVE_SECRET: SECRET,
    SLACK_SIGNING_SECRET: SLACK_SECRET,
    SLACK_TEAM_ID: "T_ACADEMY",
    SLACK_BOT_TOKEN: "xoxb-should-never-leak",
    SLACK_FILE_ARCHIVE_SIGNING_SECRET: ARCHIVE_SLACK_SECRET,
    SLACK_FILE_ARCHIVE_TEAMS: "T_SAJIK=sajik,T_GJ=geumjeong",
    N8N_FILE_ARCHIVE_WEBHOOK_URL: "https://n8n.example/webhook/exam-ai-file-archive",
    FILE_ARCHIVE_BRANCH_URLS: "sajik=https://staffsj.example,geumjeong=https://staff.example",
  });
  useBranch("sajik");
  parseUnifiedInput.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of [
    "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ACADEMY_BRANCH_ID", "ACADEMY_DB_PROVIDER", "ACADEMY_STUDENT_READ_PROVIDER", "SESSION_SECRET",
    "FILE_ARCHIVE_SECRET", "SLACK_SIGNING_SECRET", "SLACK_TEAM_ID", "SLACK_BOT_TOKEN", "SLACK_FILE_ARCHIVE_CHANNELS", "SLACK_FILE_ARCHIVE_SIGNING_SECRET", "SLACK_FILE_ARCHIVE_TEAMS", "N8N_FILE_ARCHIVE_WEBHOOK_URL", "FILE_ARCHIVE_BRANCH_URLS",
  ]) delete process.env[k];
});

function signed(body: string, secret = SECRET) {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = `v1=${createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex")}`;
  return { ts, sig };
}
function archiveBody(over: Record<string, unknown> = {}) {
  return {
    branchCode: "sajik", teamId: "T_SAJIK", channelId: "C_SAJIK", messageTs: "1790000000.000100", threadTs: "",
    fileId: "F0ABCDEF1", userId: "U_MINJI", uploaderName: "Minji (Slack)", messageText: "거성중2 중간고사 어순배열 수정본입니다",
    originalFilename: "거성중2_어순배열_수정본.pdf", mimeType: "application/pdf", fileSize: 12345, uploadedAt: new Date().toISOString(),
    driveFileId: "1AbCdEfGhIjKlMnOp", driveUrl: "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view", driveFolderId: "FOLDER0001",
    ...over,
  };
}
async function postArchive(bodyObj: Record<string, unknown>, opts: { secret?: string; unsigned?: boolean } = {}) {
  const { POST } = await import("@/app/api/files/archive/route");
  const body = JSON.stringify(bodyObj);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (!opts.unsigned) {
    const s = signed(body, opts.secret);
    headers["x-exam-ai-timestamp"] = s.ts;
    headers["x-exam-ai-signature"] = s.sig;
  }
  const res = await POST(new NextRequest("http://localhost/api/files/archive", { method: "POST", headers, body }));
  return { status: res.status, body: await res.json() };
}
async function ask(text: string, intents: Partial<UnifiedIntent>[]) {
  parseUnifiedInput.mockResolvedValueOnce(intents.map((i) => ({ route: "clarify", students: [], instruction: "", ...i })));
  const { runUnifiedNlInput } = await import("@/lib/nl-input");
  return runUnifiedNlInput(text, { staffName: "서도영", staffId: "st-dir", role: "원장" });
}

describe("저장(n8n → EXAM AI archive API)", () => {
  it("1. 사직 Slack PDF → 사직 archive(visibility branch, 업로더는 연결된 직원명)", async () => {
    const r = await postArchive(archiveBody());
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ ok: true, status: "created", driveFileId: "1AbCdEfGhIjKlMnOp" });
    expect(tables.file_archives).toHaveLength(1);
    expect(tables.file_archives[0]).toMatchObject({
      branch_id: "b-sajik", visibility: "branch", source: "slack", slack_file_id: "F0ABCDEF1", uploader_name: "박민지", uploader_staff_id: "st-minji",
      original_filename: "거성중2_어순배열_수정본.pdf", drive_file_id: "1AbCdEfGhIjKlMnOp",
    });
    expect(tables.file_archives[0]).not.toHaveProperty("notion_id");
  });

  it("2. 금정 Slack PDF → 금정 배포에서 금정 archive", async () => {
    useBranch("geumjeong");
    const r = await postArchive(archiveBody({ branchCode: "geumjeong", teamId: "T_GJ", channelId: "C_GJ", fileId: "F0GJFILE01", driveFileId: "1GjDriveFile0001" }));
    expect(r.status).toBe(201);
    expect(tables.file_archives[0]).toMatchObject({ branch_id: "b-gj", visibility: "branch" });
  });

  it("3. 같은 Slack 파일 두 번 → archive 1개(두 번째는 기존 반환), 선조회 GET도 archived", async () => {
    await postArchive(archiveBody());
    const again = await postArchive(archiveBody({ driveFileId: "1OtherDriveFile99" }));
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ status: "existing", driveFileId: "1AbCdEfGhIjKlMnOp" });
    expect(tables.file_archives).toHaveLength(1);
    const { GET } = await import("@/app/api/files/archive/route");
    const search = "?teamId=T_SAJIK&fileId=F0ABCDEF1";
    const s = signed(search);
    const res = await GET(new NextRequest(`http://localhost/api/files/archive${search}`, { headers: { "x-exam-ai-timestamp": s.ts, "x-exam-ai-signature": s.sig } }));
    expect(await res.json()).toMatchObject({ archived: true, driveFileId: "1AbCdEfGhIjKlMnOp" });
  });

  it("4. Drive 업로드 실패(=Drive 정보 없음) → 완료 archive 생성 안 됨", async () => {
    const r = await postArchive(archiveBody({ driveFileId: "", driveUrl: "" }));
    expect(r.status).toBe(400);
    expect(tables.file_archives).toHaveLength(0);
  });

  it("5. DB 등록 실패 후 재시도 → 중복 없이 1개", async () => {
    insertFailures = 1;
    expect((await postArchive(archiveBody())).status).toBe(500);
    expect(tables.file_archives).toHaveLength(0);
    expect((await postArchive(archiveBody())).status).toBe(201);
    expect((await postArchive(archiveBody())).status).toBe(200);
    expect(tables.file_archives).toHaveLength(1);
  });

  it("관련 업무는 이 지점에 있는 업무일 때만 연결", async () => {
    await postArchive(archiveBody({ relatedTaskId: "task-1" }));
    await postArchive(archiveBody({ fileId: "F0ZZZZZZ2", driveFileId: "1SecondDriveFile", relatedTaskId: "no-such-task" }));
    expect(tables.file_archives.map((r) => r.related_task_id)).toEqual(["task-1", null]);
  });
});

describe("Slack 이벤트(File Archive 앱) → n8n 전달", () => {
  // tsOffset: Slack 재전송은 새 타임스탬프/서명으로 온다
  async function slackPost(path: string, body: string, secret = ARCHIVE_SLACK_SECRET, tsOffset = 0) {
    const { POST } = await import(path === "events" ? "@/app/api/slack/events/route" : "@/app/api/slack/file-archive/route");
    const ts = String(Math.floor(Date.now() / 1000) + tsOffset);
    const sig = `v0=${createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex")}`;
    const res = await POST(new NextRequest(`https://staffsj.example/api/slack/${path}`, {
      method: "POST", headers: { "x-slack-request-timestamp": ts, "x-slack-signature": sig }, body,
    }));
    return { status: res.status, body: await res.json() };
  }
  const envelope = (event: Record<string, unknown>, team = "T_SAJIK", eventId = `Ev${Math.random()}`) =>
    JSON.stringify({ type: "event_callback", team_id: team, event_id: eventId, event });
  const slackEvent = (event: Record<string, unknown>, team = "T_SAJIK") => slackPost("file-archive", envelope(event, team));
  const fileEvent = (over: Record<string, unknown> = {}) => ({
    type: "message", subtype: "file_share", channel: "C_SAJIK", user: "U_MINJI", ts: "1790000000.000100", text: "거성중2 어순배열 수정본입니다",
    files: [{ id: "F0ABCDEF1", name: "거성중2_어순배열.pdf", mimetype: "application/pdf", size: 100, created: 1790000000, url_private_download: "https://files.slack.com/secret-url" }],
    ...over,
  });

  it("url_verification challenge 응답, 서명 틀리면 401(학생기록 봇 secret으로 서명해도 거부)", async () => {
    const challenge = JSON.stringify({ type: "url_verification", challenge: "abc123" });
    expect(await slackPost("file-archive", challenge)).toEqual({ status: 200, body: { challenge: "abc123" } });
    expect((await slackPost("file-archive", challenge, SLACK_SECRET)).status).toBe(401);
    delete process.env.SLACK_FILE_ARCHIVE_SIGNING_SECRET;
    expect((await slackPost("file-archive", challenge)).status).toBe(503);
  });

  it("사직 워크스페이스 파일 → 서명해서 n8n 전달(Slack 토큰·다운로드 URL 미포함), 금정 워크스페이스 → 금정 등록 주소", async () => {
    const r = await slackEvent(fileEvent());
    expect(r).toEqual({ status: 200, body: { ok: true, archive: 1 } });
    expect(n8nCalls).toHaveLength(1);
    const call = n8nCalls[0];
    expect(call.body).not.toContain("xoxb");
    expect(call.body).not.toContain("files.slack.com");
    const job = JSON.parse(call.body);
    expect(job).toMatchObject({
      version: 1, branchCode: "sajik", callbackUrl: "https://staffsj.example/api/files/archive", teamId: "T_SAJIK", channelId: "C_SAJIK",
      messageTs: "1790000000.000100", threadTs: "", userId: "U_MINJI", messageText: "거성중2 어순배열 수정본입니다",
      files: [{ id: "F0ABCDEF1", name: "거성중2_어순배열.pdf", mimeType: "application/pdf", size: 100 }],
    });
    expect(call.headers["x-exam-ai-signature"]).toBe(`v1=${createHmac("sha256", SECRET).update(`${call.headers["x-exam-ai-timestamp"]}.${call.body}`).digest("hex")}`);
    await slackEvent(fileEvent({ channel: "C_GJ_ANY" }), "T_GJ");
    expect(JSON.parse(n8nCalls[1].body)).toMatchObject({ branchCode: "geumjeong", teamId: "T_GJ", callbackUrl: "https://staff.example/api/files/archive" });
  });

  it("같은 event_id 재전송 → 한 번만 전달, n8n 실패 → 503 후 재전송은 다시 전달", async () => {
    const body = envelope(fileEvent(), "T_SAJIK", "EvSAME1");
    expect((await slackPost("file-archive", body)).status).toBe(200);
    expect((await slackPost("file-archive", body, ARCHIVE_SLACK_SECRET, 1)).body).toMatchObject({ duplicate: true });
    expect(n8nCalls).toHaveLength(1);

    process.env.__N8N_DOWN = "1";
    const failing = envelope(fileEvent(), "T_SAJIK", "EvFAIL1");
    expect((await slackPost("file-archive", failing)).status).toBe(503);
    delete process.env.__N8N_DOWN;
    expect((await slackPost("file-archive", failing, ARCHIVE_SLACK_SECRET, 1)).status).toBe(200);
    expect(n8nCalls).toHaveLength(3); // 성공 1 + 실패 1 + 재전송 성공 1
  });

  it("매핑 안 된 팀·봇 메시지·파일 없는 메시지·file_shared는 200 무시, 채널 제한 시 목록 밖 채널 무시", async () => {
    for (const r of [
      await slackEvent(fileEvent(), "T_OTHER"),
      await slackEvent(fileEvent({ bot_id: "B1" })),
      await slackEvent(fileEvent({ subtype: undefined, files: [] })),
      await slackEvent({ type: "file_shared", file_id: "F0ABCDEF1", channel_id: "C_SAJIK", user_id: "U_MINJI" }),
    ]) expect(r).toEqual({ status: 200, body: { ok: true, ignored: true } });
    process.env.SLACK_FILE_ARCHIVE_CHANNELS = "C_SAJIK=sajik";
    expect((await slackEvent(fileEvent({ channel: "C_UNKNOWN" }))).body).toMatchObject({ ignored: true });
    expect((await slackEvent(fileEvent())).body).toMatchObject({ archive: 1 });
    expect(n8nCalls).toHaveLength(1);
  });

  it("학생기록 봇 endpoint(/api/slack/events)는 파일 메시지를 n8n으로 보내지 않는다", async () => {
    await slackPost("events", envelope(fileEvent(), "T_ACADEMY"), SLACK_SECRET);
    expect(n8nCalls).toHaveLength(0);
  });
});

describe("자연어 파일 검색(읽기 전용, 현재 지점 + 공용)", () => {
  function seedFiles() {
    const now = Date.now();
    const iso = (daysAgo: number) => new Date(now - daysAgo * 86400000).toISOString();
    tables.file_archives.push(
      { id: "fa-1", branch_id: "b-sajik", visibility: "branch", source: "slack", original_filename: "거성중2_중간_어순배열_최종.pdf", mime_type: "application/pdf", uploader_name: "박민지", message_text: "거성중2 중간고사 어순배열 최종본", drive_url: "https://drive.google.com/file/d/AAA/view", drive_file_id: "AAA", uploaded_at: iso(8), related_task_id: "task-1", classification: {} },
      { id: "fa-2", branch_id: "b-sajik", visibility: "branch", source: "slack", original_filename: "여명중2_관계대명사.hwp", mime_type: "application/x-hwp", uploader_name: "서도영", message_text: "여명중2 시험대비", drive_url: "https://drive.google.com/file/d/BBB/view", drive_file_id: "BBB", uploaded_at: iso(1), classification: {} },
      { id: "fa-gj-private", branch_id: "b-gj", visibility: "branch", source: "slack", original_filename: "거성중2_어순배열_금정상담메모.pdf", mime_type: "application/pdf", uploader_name: "금정조교", message_text: "금정 학생 상담", drive_url: "https://drive.google.com/file/d/CCC/view", drive_file_id: "CCC", uploaded_at: iso(2), classification: {} },
      { id: "fa-gj-shared", branch_id: "b-gj", visibility: "shared", source: "slack", original_filename: "거성중2_어순배열_공용워크북.pdf", mime_type: "application/pdf", uploader_name: "금정조교", message_text: "공용 워크북", drive_url: "https://drive.google.com/file/d/DDD/view", drive_file_id: "DDD", uploaded_at: iso(3), classification: {} },
    );
  }

  it("6. '거성중2 어순배열 파일 찾아줘' → 파일 검색(AI가 업무로 잘못 분류해도), 업무·학생기록 0건", async () => {
    seedFiles();
    const res = await ask("거성중2 어순배열 파일 찾아줘", [{ intentClass: "action", route: "task", taskType: "교재편집", instruction: "거성중2 어순배열 찾기" }]);
    expect(res.outcomes[0].route).toBe("file_search");
    expect(res.outcomes[0].files!.map((f) => f.id).sort()).toEqual(["fa-1", "fa-gj-shared"]);
    expect(tables.tasks).toHaveLength(1);
    expect(tables.student_learning_records).toHaveLength(0);
    const hit = res.outcomes[0].files!.find((f) => f.id === "fa-1")!;
    expect(hit).toMatchObject({ filename: "거성중2_중간_어순배열_최종.pdf", uploader: "박민지", scope: "이 지점", driveUrl: "https://drive.google.com/file/d/AAA/view" });
    expect(hit.relatedTask?.label).toContain("교재편집");
  });

  it("7. '지난주 민지쌤이 올린 PDF 찾아줘' → 기간·업로더·형식 필터", async () => {
    seedFiles();
    const day = (n: number) => new Date(Date.now() + 9 * 3600000 - n * 86400000).toISOString().slice(0, 10);
    const res = await ask("지난주 민지쌤이 올린 PDF 찾아줘", [
      { intentClass: "query", route: "file_search", fileKeywords: [], fileUploader: "민지쌤", fileKind: "pdf", historyFrom: day(10), historyTo: day(5) },
    ]);
    expect(res.outcomes[0].files!.map((f) => f.id)).toEqual(["fa-1"]);
  });

  it("8/9. 사직 사용자: 사직 + 공용만, 금정 private 불가", async () => {
    seedFiles();
    const { searchFileArchives } = await import("@/lib/fileArchive");
    const ids = (await searchFileArchives({ keywords: ["거성중2"] })).map((f) => f.id);
    expect(ids).toContain("fa-1");
    expect(ids).toContain("fa-gj-shared");
    expect(ids).not.toContain("fa-gj-private");
    const shared = (await searchFileArchives({ keywords: ["공용워크북"] }))[0];
    expect(shared).toMatchObject({ scope: "공용", fromOtherBranch: true });
  });

  it("10. 금정 사용자: 금정 + 공용(사직 private 불가)", async () => {
    seedFiles();
    useBranch("geumjeong");
    const { searchFileArchives } = await import("@/lib/fileArchive");
    const ids = (await searchFileArchives({})).map((f) => f.id).sort();
    expect(ids).toEqual(["fa-gj-private", "fa-gj-shared"]);
  });

  it("'여명중2 중간고사 자료 보여줘'를 일정 조회로 잘못 분류해도 파일 검색, '자료 찾아서 출력해줘'는 업무로 유지", async () => {
    seedFiles();
    const r1 = await ask("여명중2 자료 보여줘", [{ intentClass: "query", route: "schedule_view" }]);
    expect(r1.outcomes[0].route).toBe("file_search");
    expect(r1.outcomes[0].files!.map((f) => f.id)).toEqual(["fa-2"]);
    const { writeGuardSignals } = await import("@/lib/nl-input");
    expect(writeGuardSignals("거성중2 자료 찾아서 15부 출력해줘").fileSearch).toBe(false);
    expect(writeGuardSignals("어제 Slack에 올라온 파일 찾아줘").fileSearch).toBe(true);
  });

  it("검색은 GET만(읽기 전용)", async () => {
    seedFiles();
    const methods: string[] = [];
    const base = globalThis.fetch as any;
    vi.stubGlobal("fetch", vi.fn(async (u: string, init?: any) => (methods.push((init?.method ?? "GET").toUpperCase()), base(u, init))));
    await ask("거성중2 파일 찾아줘", [{ intentClass: "query", route: "file_search", fileKeywords: ["거성중2"] }]);
    expect(methods.every((m) => m === "GET")).toBe(true);
  });
});

describe("보안", () => {
  it("11. 서명 없는/틀린 서명의 archive API → 401, 기록 없음", async () => {
    expect((await postArchive(archiveBody(), { unsigned: true })).status).toBe(401);
    expect((await postArchive(archiveBody(), { secret: "wrong" })).status).toBe(401);
    const { GET } = await import("@/app/api/files/archive/route");
    expect((await GET(new NextRequest("http://localhost/api/files/archive?teamId=T_SAJIK&fileId=F0ABCDEF1"))).status).toBe(401);
    expect(tables.file_archives).toHaveLength(0);
  });

  it("12. 잘못된 지점 매핑 → 403(n8n이 보낸 지점을 믿지 않음)", async () => {
    // 사직 배포에 금정 지점/금정 워크스페이스로 등록 시도
    expect((await postArchive(archiveBody({ branchCode: "geumjeong", teamId: "T_GJ", channelId: "C_GJ" }))).status).toBe(403);
    // 사직 지점이라 주장하지만 금정 워크스페이스
    expect((await postArchive(archiveBody({ teamId: "T_GJ" }))).status).toBe(403);
    // 매핑 안 된 Slack 팀
    expect((await postArchive(archiveBody({ teamId: "T_OTHER" }))).status).toBe(403);
    // 채널 제한을 켜면 목록 밖 채널·다른 지점 채널은 거부
    process.env.SLACK_FILE_ARCHIVE_CHANNELS = "C_SAJIK=sajik,C_GJ=geumjeong";
    expect((await postArchive(archiveBody({ channelId: "C_RANDOM" }))).status).toBe(403);
    expect((await postArchive(archiveBody({ channelId: "C_GJ" }))).status).toBe(403);
    delete process.env.SLACK_FILE_ARCHIVE_CHANNELS;
    // 자격증명이 붙은 URL/Drive가 아닌 URL
    expect((await postArchive(archiveBody({ driveUrl: "https://drive.google.com/file/d/X/view?access_token=abc" }))).status).toBe(400);
    expect((await postArchive(archiveBody({ driveUrl: "https://evil.example/x" }))).status).toBe(400);
    expect(tables.file_archives).toHaveLength(0);
  });

  it("13. 응답·로그에 secret/token 없음", async () => {
    const spies = (["log", "error", "warn", "info"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    insertFailures = 1;
    const r1 = await postArchive(archiveBody());
    const r2 = await postArchive(archiveBody());
    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    const responses = JSON.stringify([r1.body, r2.body]);
    for (const secret of [SECRET, SLACK_SECRET, ARCHIVE_SLACK_SECRET, "xoxb-should-never-leak", "service-key"]) {
      expect(logged).not.toContain(secret);
      expect(responses).not.toContain(secret);
    }
    spies.forEach((s) => s.mockRestore());
  });
});
