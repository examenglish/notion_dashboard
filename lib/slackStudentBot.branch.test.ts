// Slack 학생기록봇(/api/slack/events) 지점 격리 — 같은 코드가 사직/금정 배포에 각자의
// SLACK_TEAM_ID·SLACK_SIGNING_SECRET·ACADEMY_BRANCH_ID로 뜬다. 실제 라우트 + processSlackEvent를
// branch 스코프 fake Supabase 위에서 돌리고, Supabase slack_records에 쓰인 행(학생 연결)을 확인한다.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "crypto";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_cache: (fn: any) => fn, revalidateTag: vi.fn() }));
const { pagesCreate, waitUntil } = vi.hoisted(() => ({ pagesCreate: vi.fn(), waitUntil: vi.fn() })); // pagesCreate: Notion 쓰기 0건 확인용
vi.mock("@vercel/functions", () => ({ waitUntil }));
const { parseUnifiedInput } = vi.hoisted(() => ({ parseUnifiedInput: vi.fn() }));
vi.mock("@/lib/anthropic", async (orig) => ({ ...(await orig<typeof import("@/lib/anthropic")>()), parseUnifiedInput }));
vi.mock("@notionhq/client", () => ({
  Client: vi.fn().mockImplementation(function Client() {
    return {
      pages: { create: pagesCreate, update: vi.fn().mockResolvedValue({ id: "n", properties: {} }), retrieve: vi.fn().mockResolvedValue(null) },
      dataSources: { query: vi.fn().mockResolvedValue({ results: [] }) },
    };
  }),
}));

type Row = Record<string, any>;
let students: Row[];
let slackRecords: Row[];
let learningRecords: Row[];
// PostgREST jsonb 경로 필터(source_payload->slack->>messageTs=eq.X, ...->eventIds=cs.[..])를 흉내 낸다.
function jsonPath(row: Row, key: string): unknown {
  const parts = key.split(/->>?/);
  let cur: any = row[parts[0]];
  for (const p of parts.slice(1)) cur = cur == null ? undefined : Array.isArray(cur) ? cur[Number(p)] : cur[p];
  return cur;
}
function fakeFetch() {
  return vi.fn(async (url: string, init?: any) => {
    if (url.startsWith("https://slack.com/api/")) return new Response(JSON.stringify({ ok: true }), { status: 200 });
    const u = new URL(url);
    const table = u.pathname.replace("/rest/v1/", "");
    if (table === "branches") {
      const code = u.searchParams.get("code")?.replace(/^eq\./, "");
      return new Response(JSON.stringify(code === "sajik" ? [{ id: "b-sajik" }] : code === "geumjeong" ? [{ id: "b-gj" }] : []), { status: 200 });
    }
    const method = (init?.method ?? "GET").toUpperCase();
    if (table === "student_learning_records" && method === "POST") {
      const rows = JSON.parse(init.body).map((r: Row) => ({ id: `lr-${learningRecords.length + 1}`, ...r }));
      learningRecords.push(...rows);
      return new Response(JSON.stringify(rows), { status: 201 });
    }
    if (table === "slack_records" && method === "POST") {
      const rows = JSON.parse(init.body).map((r: Row) => ({ id: `sr-${slackRecords.length + 1}`, ...r }));
      slackRecords.push(...rows);
      return new Response(JSON.stringify(rows), { status: 201 });
    }
    const bid = u.searchParams.get("branch_id")?.replace(/^eq\./, "");
    let rows = (table === "students" ? students : table === "slack_records" ? slackRecords : []).filter((r) => !bid || r.branch_id === bid);
    for (const [k, v] of u.searchParams.entries()) {
      if (!k.includes("->")) continue;
      rows = rows.filter((r) => {
        const cell = jsonPath(r, k);
        if (v.startsWith("eq.")) return String(cell ?? "") === v.slice(3);
        if (v.startsWith("cs.")) return Array.isArray(cell) && (JSON.parse(v.slice(3)) as unknown[]).every((x) => cell.includes(x));
        return false;
      });
    }
    if (table === "slack_records" && method === "PATCH") {
      const id = u.searchParams.get("id")?.replace(/^eq\./, "");
      const hit = slackRecords.filter((r) => r.id === id && r.branch_id === bid);
      hit.forEach((r) => Object.assign(r, JSON.parse(init.body)));
      return new Response(JSON.stringify(hit), { status: 200 });
    }
    if (table === "students" && u.searchParams.get("select") === "id,notion_id") return new Response(JSON.stringify(rows.map((r) => ({ id: r.id, notion_id: r.notion_id }))), { status: 200 });
    return new Response(JSON.stringify(rows), { status: 200 });
  });
}

const BRANCHES = {
  sajik: { team: "T_SAJIK", secret: "sajik-signing", channel: "G_SAJIK" },
  geumjeong: { team: "T0541B6DBKP", secret: "gj-signing", channel: "G_GJ" },
} as const;
type Code = keyof typeof BRANCHES;

// 배포 하나를 흉내 낸다: 그 지점의 env만 설정하고 모듈을 새로 읽는다(replay 캐시도 배포별).
function deploy(code: Code) {
  const b = BRANCHES[code];
  Object.assign(process.env, {
    ACADEMY_BRANCH_ID: code,
    SLACK_TEAM_ID: b.team,
    SLACK_SIGNING_SECRET: b.secret,
    SLACK_STUDENT_LOG_CHANNEL_ID: b.channel,
  });
  vi.resetModules();
}

let seq = 0;
function slackRequest(code: Code, opts: { team?: string; secret?: string; eventId?: string; text?: string } = {}) {
  const b = BRANCHES[code];
  seq++;
  const body = JSON.stringify({
    type: "event_callback",
    team_id: opts.team ?? b.team,
    event_id: opts.eventId ?? `Ev${seq}`,
    event: { type: "message", channel: b.channel, channel_type: "group", user: "U1", ts: `1790000000.${String(seq).padStart(6, "0")}`, text: opts.text ?? "[학생: 김민수] 단어 재시험" },
  });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = `v0=${createHmac("sha256", opts.secret ?? b.secret).update(`v0:${ts}:${body}`).digest("hex")}`;
  return new NextRequest("https://staff.example/api/slack/events", {
    method: "POST",
    body,
    headers: { "x-slack-request-timestamp": ts, "x-slack-signature": sig, "content-type": "application/json" },
  });
}

function slackEdit(code: Code, ts: string, text: string, eventId: string, deleted = false) {
  const b = BRANCHES[code];
  const event = deleted
    ? { type: "message", subtype: "message_deleted", channel: b.channel, channel_type: "group", deleted_ts: ts, previous_message: { ts, user: "U1", text: "x" } }
    : { type: "message", subtype: "message_changed", channel: b.channel, channel_type: "group", message: { ts, user: "U1", text } };
  const body = JSON.stringify({ type: "event_callback", team_id: b.team, event_id: eventId, event });
  const t = String(Math.floor(Date.now() / 1000));
  const sig = `v0=${createHmac("sha256", b.secret).update(`v0:${t}:${body}`).digest("hex")}`;
  return new NextRequest("https://staff.example/api/slack/events", {
    method: "POST",
    body,
    headers: { "x-slack-request-timestamp": t, "x-slack-signature": sig, "content-type": "application/json" },
  });
}

async function post(req: NextRequest) {
  const { POST } = await import("@/app/api/slack/events/route");
  const res = await POST(req);
  await Promise.all(waitUntil.mock.calls.map(([p]) => p));
  waitUntil.mockClear();
  return res;
}
const linkedStudentIds = () => slackRecords.map((r) => r.student_notion_ids);

beforeEach(() => {
  pagesCreate.mockReset().mockResolvedValue({ id: "slack-record", properties: {} });
  slackRecords = [];
  learningRecords = [];
  parseUnifiedInput.mockReset().mockResolvedValue([]);
  waitUntil.mockReset();
  students = [
    { id: "s-sajik-kim", notion_id: "s-sajik-kim", branch_id: "b-sajik", name: "김민수", status: "재원", class_notion_ids: [] },
    { id: "s-gj-kim", notion_id: "s-gj-kim", branch_id: "b-gj", name: "김민수", status: "재원", class_notion_ids: [] },
    { id: "s-sajik-lee", notion_id: "s-sajik-lee", branch_id: "b-sajik", name: "이서준", status: "재원", class_notion_ids: [] },
  ];
  vi.stubGlobal("fetch", fakeFetch());
  Object.assign(process.env, {
    SUPABASE_URL: "https://fake.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    ACADEMY_DB_PROVIDER: "postgres",
    ACADEMY_STUDENT_READ_PROVIDER: "postgres",
    NOTION_TOKEN: "fake-notion-token",
    SLACK_BOT_TOKEN: "xoxb-test",
  });
});

describe("Slack 학생기록봇 지점 격리", () => {
  it("사직 배포: 사직 Slack 기록은 사직 학생에만 연결된다(회귀 없음)", async () => {
    deploy("sajik");
    const res = await post(slackRequest("sajik"));
    expect(res.status).toBe(200);
    expect(linkedStudentIds()).toEqual([["s-sajik-kim"]]);
  });

  it("금정 배포: 금정 team_id(T0541B6DBKP) 기록은 금정 학생으로 생성된다", async () => {
    deploy("geumjeong");
    const res = await post(slackRequest("geumjeong"));
    expect(res.status).toBe(200);
    expect(linkedStudentIds()).toEqual([["s-gj-kim"]]);
  });

  it("금정에 없는 학생 이름은 사직 학생으로 연결하지 않는다(미일치로만 남김)", async () => {
    deploy("geumjeong");
    await post(slackRequest("geumjeong", { text: "[학생: 이서준] 숙제 안함" }));
    expect(linkedStudentIds()).toEqual([[]]);
    expect(slackRecords[0]).toMatchObject({ branch_id: "b-gj", link_status: "미일치", student_id: null });
  });

  it("사직 이벤트는 금정 배포에서, 금정 이벤트는 사직 배포에서 거부된다(다른 지점으로 fallback 없음)", async () => {
    deploy("geumjeong");
    expect((await post(slackRequest("sajik"))).status).toBe(401); // 사직 signing secret은 금정 앱에서 무효
    expect((await post(slackRequest("geumjeong", { team: BRANCHES.sajik.team }))).status).toBe(403);
    deploy("sajik");
    expect((await post(slackRequest("geumjeong"))).status).toBe(401);
    expect((await post(slackRequest("sajik", { team: BRANCHES.geumjeong.team }))).status).toBe(403);
    expect(slackRecords).toHaveLength(0);
  });

  it("unknown team 차단 / 잘못된 signature 차단", async () => {
    deploy("geumjeong");
    expect((await post(slackRequest("geumjeong", { team: "T_UNKNOWN" }))).status).toBe(403);
    expect((await post(slackRequest("geumjeong", { secret: "wrong" }))).status).toBe(401);
    expect(slackRecords).toHaveLength(0);
  });

  it("같은 Slack event 재전송은 한 번만 기록한다", async () => {
    deploy("geumjeong");
    await post(slackRequest("geumjeong", { eventId: "EvDup" }));
    const again = await post(slackRequest("geumjeong", { eventId: "EvDup" }));
    expect(await again.json()).toMatchObject({ duplicate: true });
    expect(slackRecords).toHaveLength(1);
  });

  it("Supabase에만 저장(Notion 쓰기 0건), 같은 메시지 수정·삭제는 같은 행을 갱신", async () => {
    deploy("geumjeong");
    await post(slackRequest("geumjeong", { eventId: "EvNew" }));
    expect(slackRecords).toHaveLength(1);
    expect(slackRecords[0]).toMatchObject({ branch_id: "b-gj", student_id: "s-gj-kim", status: "활성", link_status: "연결", original: "[학생: 김민수] 단어 재시험" });
    expect(slackRecords[0].source_payload.slack).toMatchObject({ teamId: "T0541B6DBKP", channelId: "G_GJ", eventIds: ["EvNew"] });
    const ts = slackRecords[0].source_payload.slack.messageTs;
    // 모듈 캐시를 새로 읽어도(다른 인스턴스) Supabase에 남은 event id로 중복을 막는다
    vi.resetModules();
    await post(slackRequest("geumjeong", { eventId: "EvNew" }));
    expect(slackRecords).toHaveLength(1);
    await post(slackEdit("geumjeong", ts, "[학생: 김민수] 단어 재시험 통과", "EvEdit"));
    await post(slackEdit("geumjeong", ts, "", "EvDel", true));
    expect(slackRecords).toHaveLength(1);
    expect(slackRecords[0]).toMatchObject({ status: "삭제", original: "[학생: 김민수] 단어 재시험 통과" });
    expect(slackRecords[0].source_payload.slack.eventIds).toEqual(["EvNew", "EvEdit", "EvDel"]);
    expect(pagesCreate).not.toHaveBeenCalled();
  });

  it("전환 전(Notion 복사본) 행도 MessageTS로 찾아 수정한다", async () => {
    deploy("sajik");
    slackRecords.push({ id: "legacy-1", branch_id: "b-sajik", notion_id: "n-legacy", status: "활성", source_payload: { properties: { MessageTS: { rich_text: [{ plain_text: "1700000000.000001" }] } } } });
    await post(slackEdit("sajik", "1700000000.000001", "[학생: 김민수] 본문 암기 미완", "EvLegacy"));
    expect(slackRecords).toHaveLength(1);
    expect(slackRecords[0]).toMatchObject({ id: "legacy-1", status: "수정", student_id: "s-sajik-kim", notion_id: "n-legacy" });
  });

  it("태그 없는 자연어('김민수 단어 재시험')는 EXAM AI 학생기록으로 이 지점 학생에만 저장된다", async () => {
    deploy("geumjeong");
    parseUnifiedInput.mockResolvedValue([
      { route: "student_record", students: ["김민수"], instruction: "", recordType: "vocab", assessmentName: "단어시험", retestRequired: true },
    ]);
    await post(slackRequest("geumjeong", { text: "김민수 단어 재시험" }));
    expect(learningRecords).toHaveLength(1);
    expect(learningRecords[0]).toMatchObject({ branch_id: "b-gj", student_notion_ids: ["s-gj-kim"], record_type: "vocab", raw_text: "김민수 단어 재시험" });
    expect(slackRecords).toHaveLength(1); // 원문 Slack 기록도 남는다

    // 금정에 없는 이름(사직 학생 이서준)은 사직 학생으로 저장하지 않는다
    parseUnifiedInput.mockResolvedValue([{ route: "student_record", students: ["이서준"], instruction: "", recordType: "homework", completed: false }]);
    await post(slackRequest("geumjeong", { text: "이서준 숙제 안함" }));
    expect(learningRecords).toHaveLength(1);
  });
});
