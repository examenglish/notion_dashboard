// Slack 학생기록봇(/api/slack/events) 지점 격리 — 같은 코드가 사직/금정 배포에 각자의
// SLACK_TEAM_ID·SLACK_SIGNING_SECRET·ACADEMY_BRANCH_ID로 뜬다. 실제 라우트 + processSlackEvent를
// branch 스코프 fake Supabase 위에서 돌리고, Notion 기록 생성 내용(학생 relation)을 확인한다.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "crypto";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_cache: (fn: any) => fn, revalidateTag: vi.fn() }));
const { pagesCreate, waitUntil } = vi.hoisted(() => ({ pagesCreate: vi.fn(), waitUntil: vi.fn() }));
vi.mock("@vercel/functions", () => ({ waitUntil }));
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
function fakeFetch() {
  return vi.fn(async (url: string) => {
    if (url.startsWith("https://slack.com/api/")) return new Response(JSON.stringify({ ok: true }), { status: 200 });
    const u = new URL(url);
    const table = u.pathname.replace("/rest/v1/", "");
    if (table === "branches") {
      const code = u.searchParams.get("code")?.replace(/^eq\./, "");
      return new Response(JSON.stringify(code === "sajik" ? [{ id: "b-sajik" }] : code === "geumjeong" ? [{ id: "b-gj" }] : []), { status: 200 });
    }
    const bid = u.searchParams.get("branch_id")?.replace(/^eq\./, "");
    const rows = table === "students" ? students.filter((r) => r.branch_id === bid) : [];
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

async function post(req: NextRequest) {
  const { POST } = await import("@/app/api/slack/events/route");
  const res = await POST(req);
  await Promise.all(waitUntil.mock.calls.map(([p]) => p));
  waitUntil.mockClear();
  return res;
}
const linkedStudentIds = () => pagesCreate.mock.calls.map(([arg]) => (arg.properties.학생.relation as { id: string }[]).map((r) => r.id));

beforeEach(() => {
  pagesCreate.mockReset().mockResolvedValue({ id: "slack-record", properties: {} });
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
    expect(pagesCreate).toHaveBeenCalledTimes(1);
    expect(linkedStudentIds()).toEqual([[]]);
    expect(pagesCreate.mock.calls[0][0].properties.연결상태.select.name).toBe("미일치");
  });

  it("사직 이벤트는 금정 배포에서, 금정 이벤트는 사직 배포에서 거부된다(다른 지점으로 fallback 없음)", async () => {
    deploy("geumjeong");
    expect((await post(slackRequest("sajik"))).status).toBe(401); // 사직 signing secret은 금정 앱에서 무효
    expect((await post(slackRequest("geumjeong", { team: BRANCHES.sajik.team }))).status).toBe(403);
    deploy("sajik");
    expect((await post(slackRequest("geumjeong"))).status).toBe(401);
    expect((await post(slackRequest("sajik", { team: BRANCHES.geumjeong.team }))).status).toBe(403);
    expect(pagesCreate).not.toHaveBeenCalled();
  });

  it("unknown team 차단 / 잘못된 signature 차단", async () => {
    deploy("geumjeong");
    expect((await post(slackRequest("geumjeong", { team: "T_UNKNOWN" }))).status).toBe(403);
    expect((await post(slackRequest("geumjeong", { secret: "wrong" }))).status).toBe(401);
    expect(pagesCreate).not.toHaveBeenCalled();
  });

  it("같은 Slack event 재전송은 한 번만 기록한다", async () => {
    deploy("geumjeong");
    await post(slackRequest("geumjeong", { eventId: "EvDup" }));
    const again = await post(slackRequest("geumjeong", { eventId: "EvDup" }));
    expect(await again.json()).toMatchObject({ duplicate: true });
    expect(pagesCreate).toHaveBeenCalledTimes(1);
  });
});
