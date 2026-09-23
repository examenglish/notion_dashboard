// 원장 직원 계정 관리(비밀번호 재설정/활성·비활성/목록) — 실제 API 라우트 핸들러를
// branch 스코프 fake Supabase 위에서 호출해 검증한다. x-staff-* 헤더는 운영에서 middleware가
// 서명 쿠키를 검증한 뒤 넣는 값과 같은 형태로 준다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next/cache", () => ({ unstable_cache: (fn: any) => fn, revalidateTag: vi.fn() }));

const { notionCalls, pageCookie } = vi.hoisted(() => ({ notionCalls: [] as any[], pageCookie: { value: "" } }));
// 서버 컴포넌트 getSession()이 읽는 쿠키(페이지 접근 경로)
vi.mock("next/headers", () => ({ cookies: () => ({ get: () => (pageCookie.value ? { value: pageCookie.value } : undefined) }) }));
vi.mock("@notionhq/client", () => ({
  Client: vi.fn().mockImplementation(function Client() {
    return {
      pages: {
        create: vi.fn().mockImplementation(async (a: any) => (notionCalls.push(["create", a]), { id: "notion-new" })),
        update: vi.fn().mockImplementation(async (a: any) => (notionCalls.push(["update", a]), {})),
        retrieve: vi.fn().mockResolvedValue(null),
      },
      dataSources: { query: vi.fn().mockResolvedValue({ results: [] }) },
    };
  }),
}));

type Row = Record<string, any>;
function matchClause(clause: string, row: Row): boolean {
  const neg = clause.match(/^([a-z_]+)\.not\.(.*)$/);
  if (neg) return !matchClause(`${neg[1]}.${neg[2]}`, row);
  const m = clause.match(/^([a-z_]+)\.(eq|is|cs)\.(.*)$/);
  if (!m) throw new Error(`unsupported ${clause}`);
  const [, col, op, raw] = m;
  const v = decodeURIComponent(raw);
  const cell = row[col];
  if (op === "eq") {
    if (v === "true" || v === "false") return cell === (v === "true");
    return String(cell ?? "") === v;
  }
  if (op === "is") return raw === "null" ? cell === null || cell === undefined : false;
  if (op === "cs") return Array.isArray(cell) && cell.includes(v.replace(/^\{|\}$/g, ""));
  return false;
}
function applyFilters(rows: Row[], sp: URLSearchParams): Row[] {
  let out = rows;
  for (const [k, val] of sp.entries()) {
    if (k === "select" || k === "limit" || k === "order") continue;
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
function fakeSupabase() {
  return vi.fn(async (url: string, init?: any) => {
    const u = new URL(url);
    const table = u.pathname.replace("/rest/v1/", "");
    const method = (init?.method ?? "GET").toUpperCase();
    if (table === "branches") {
      const code = u.searchParams.get("code")?.replace(/^eq\./, "");
      return new Response(JSON.stringify(code === "sajik" ? [{ id: "b-sajik" }] : code === "geumjeong" ? [{ id: "b-gj" }] : []), { status: 200 });
    }
    tables[table] ??= [];
    if (method === "GET") return new Response(JSON.stringify(applyFilters(tables[table], u.searchParams)), { status: 200 });
    if (method === "PATCH") {
      const body = JSON.parse(init.body);
      const matched = applyFilters(tables[table], u.searchParams);
      matched.forEach((r) => Object.assign(r, body));
      return new Response(JSON.stringify(matched), { status: 200 });
    }
    if (method === "POST") {
      const items = JSON.parse(init.body);
      const inserted = items.map((it: Row, i: number) => ({ id: `gen-${tables[table].length + i}`, ...it }));
      tables[table].push(...inserted);
      return new Response(JSON.stringify(inserted), { status: 201 });
    }
    return new Response("[]", { status: 200 });
  });
}

let hashPin: (p: string) => Promise<string>;
let verifyPin: (p: string, h: string) => Promise<boolean>;

beforeEach(async () => {
  notionCalls.length = 0;
  ({ hashPin, verifyPin } = await import("@/lib/pinAuth"));
  const h = await hashPin("1234");
  tables = {
    staff: [
      { id: "st-dir", notion_id: "st-dir", branch_id: "b-sajik", name: "서도영", role: "원장", pin_hash: h, resigned: false, must_change_password: false },
      { id: "st-minji", notion_id: "st-minji", branch_id: "b-sajik", name: "박민지", role: "조교", pin_hash: h, resigned: false, must_change_password: false, work_schedule: "월=14:00-22:00" },
      { id: "st-admin", notion_id: null, branch_id: "b-sajik", name: "이행정", role: "행정", pin_hash: h, resigned: false, must_change_password: false },
      { id: "st-gj", notion_id: "st-gj", branch_id: "b-gj", name: "금정조교", role: "조교", pin_hash: h, resigned: false, must_change_password: false },
    ],
    classes: [{ id: "c1", notion_id: "c1", branch_id: "b-sajik", name: "고2 이사벨A", assistant_notion_ids: ["st-minji"], student_notion_ids: [] }],
    tasks: [{ id: "t1", notion_id: null, branch_id: "b-sajik", type: "암기확인", staff_notion_ids: ["st-minji"], complete: false }],
  };
  vi.stubGlobal("fetch", fakeSupabase());
  process.env.SUPABASE_URL = "https://fake.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
  process.env.ACADEMY_BRANCH_ID = "sajik";
  process.env.ACADEMY_DB_PROVIDER = "postgres";
  process.env.SESSION_SECRET = "test-secret";
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ACADEMY_BRANCH_ID", "ACADEMY_DB_PROVIDER", "SESSION_SECRET"]) delete process.env[k];
});

function req(url: string, method: string, as: { id: string; role: string; name?: string } | null, body?: unknown) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (as) {
    headers["x-staff-id"] = as.id;
    headers["x-staff-role"] = encodeURIComponent(as.role);
    headers["x-staff-name"] = encodeURIComponent(as.name ?? "");
  }
  return new NextRequest(`http://localhost${url}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
}
const DIRECTOR = { id: "st-dir", role: "원장", name: "서도영" };
const ASSISTANT = { id: "st-minji", role: "조교", name: "박민지" };
const ADMIN = { id: "st-admin", role: "행정", name: "이행정" };
const staff = (id: string) => tables.staff.find((s) => s.id === id)!;

async function resetAs(as: typeof DIRECTOR | null, id: string, newPin = "5678", confirmPin = newPin) {
  const { POST } = await import("@/app/api/staff/[id]/password/route");
  const res = await POST(req(`/api/staff/${id}/password`, "POST", as, { newPin, confirmPin }), { params: { id } });
  return { status: res.status, body: await res.json() };
}

describe("원장 직원 계정 관리", () => {
  it("원장 → 조교 비밀번호 재설정: scrypt 해시만 저장, 다음 로그인 때 변경 강제, 응답에 비밀번호/해시 없음", async () => {
    const r = await resetAs(DIRECTOR, "st-minji");
    expect(r).toEqual({ status: 200, body: { ok: true } });
    expect(staff("st-minji").pin_hash).toMatch(/^scrypt\$/);
    expect(await verifyPin("5678", staff("st-minji").pin_hash)).toBe(true);
    expect(await verifyPin("1234", staff("st-minji").pin_hash)).toBe(false);
    expect(staff("st-minji").must_change_password).toBe(true);
    // Notion 미러에도 평문 PIN을 쓰지 않는다
    expect(JSON.stringify(notionCalls)).not.toContain("5678");
    expect(JSON.stringify(notionCalls)).not.toContain('"PIN"');
  });

  it("원장 → 행정(notion_id 없는 계정) 비밀번호 재설정 성공", async () => {
    expect((await resetAs(DIRECTOR, "st-admin")).status).toBe(200);
    expect(await verifyPin("5678", staff("st-admin").pin_hash)).toBe(true);
  });

  it("조교·행정·비로그인은 다른 직원 비밀번호를 바꿀 수 없다(서버 역할 검증)", async () => {
    const before = staff("st-dir").pin_hash;
    expect((await resetAs(ASSISTANT, "st-dir")).status).toBe(403);
    expect((await resetAs(ADMIN, "st-minji")).status).toBe(403);
    expect((await resetAs(null, "st-minji")).status).toBe(403);
    expect(staff("st-dir").pin_hash).toBe(before);
  });

  it("다른 지점 직원 계정은 변경 불가(404, 값 그대로)", async () => {
    const before = staff("st-gj").pin_hash;
    expect((await resetAs(DIRECTOR, "st-gj")).status).toBe(404);
    expect(staff("st-gj").pin_hash).toBe(before);
    const { PATCH } = await import("@/app/api/staff/[id]/route");
    const res = await PATCH(req("/api/staff/st-gj", "PATCH", DIRECTOR, { resigned: true }), { params: { id: "st-gj" } });
    expect(res.status).toBe(404);
    expect(staff("st-gj").resigned).toBe(false);
  });

  it("입력 검증: 확인 불일치/형식 오류는 거부", async () => {
    expect((await resetAs(DIRECTOR, "st-minji", "5678", "5679")).status).toBe(400);
    expect((await resetAs(DIRECTOR, "st-minji", "12", "12")).status).toBe(400);
  });

  it("계정 목록(원장 전용): 이름·역할·로그인ID·상태만, 비밀번호/해시 없음, 현재 지점만, 비활성 포함", async () => {
    staff("st-admin").resigned = true;
    const { GET } = await import("@/app/api/staff/accounts/route");
    const res = await GET(req("/api/staff/accounts", "GET", DIRECTOR));
    const body = await res.json();
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/pin_hash|scrypt\$|password|"hash"/i);
    for (const a of body.accounts) expect(Object.keys(a).sort()).toEqual(["active", "id", "loginId", "mustChangePin", "name", "role"]);
    expect(body.accounts.map((a: any) => [a.name, a.role, a.loginId, a.active])).toEqual([
      ["박민지", "조교", "박민지", true],
      ["서도영", "원장", "서도영", true],
      ["이행정", "행정", "이행정", false],
    ]);
    expect((await GET(req("/api/staff/accounts", "GET", ADMIN))).status).toBe(403);
    expect((await GET(req("/api/staff/accounts", "GET", ASSISTANT))).status).toBe(403);
  });

  it("평문 비밀번호를 로그로 남기지 않는다", async () => {
    const spies = (["log", "error", "warn", "info"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    await resetAs(DIRECTOR, "st-minji", "9137", "9137");
    await resetAs(ASSISTANT, "st-dir", "9137", "9137");
    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    expect(logged).not.toContain("9137");
    spies.forEach((s) => s.mockRestore());
  });

  it("비활성화: 원장만, 행정/조교 거부, 본인 계정 비활성화 거부, 비활성 계정은 로그인 차단 → 재활성화 후 로그인", async () => {
    const { PATCH } = await import("@/app/api/staff/[id]/route");
    expect((await PATCH(req("/api/staff/st-minji", "PATCH", ADMIN, { resigned: true }), { params: { id: "st-minji" } })).status).toBe(403);
    expect((await PATCH(req("/api/staff/st-minji", "PATCH", ASSISTANT, { resigned: true }), { params: { id: "st-minji" } })).status).toBe(403);
    expect((await PATCH(req("/api/staff/st-dir", "PATCH", DIRECTOR, { resigned: true }), { params: { id: "st-dir" } })).status).toBe(400);
    expect((await PATCH(req("/api/staff/st-minji", "PATCH", DIRECTOR, { resigned: true }), { params: { id: "st-minji" } })).status).toBe(200);
    expect(staff("st-minji").resigned).toBe(true);

    const login = await import("@/app/api/login/route");
    const blocked = await login.POST(req("/api/login", "POST", null, { name: "박민지", pin: "1234" }));
    expect(blocked.status).toBe(401);

    await PATCH(req("/api/staff/st-minji", "PATCH", DIRECTOR, { resigned: false }), { params: { id: "st-minji" } });
    const ok = await login.POST(req("/api/login", "POST", null, { name: "박민지", pin: "1234" }));
    expect(ok.status).toBe(200);
  });

  it("근무시간 설정은 기존처럼 원장/행정 모두 가능(범위 밖 기능 보존)", async () => {
    const { PATCH } = await import("@/app/api/staff/[id]/route");
    const res = await PATCH(req("/api/staff/st-minji", "PATCH", ADMIN, { workHours: { 화: { start: "15:00", end: "21:00" } } }), { params: { id: "st-minji" } });
    expect(res.status).toBe(200);
  });

  it("계정 등록은 원장만(행정 거부), PIN은 로그인과 같은 4~6자리, 평문 PIN은 Notion에 쓰지 않음", async () => {
    const { POST } = await import("@/app/api/staff/route");
    expect((await POST(req("/api/staff", "POST", ADMIN, { name: "새조교", role: "조교", pin: "2468" }))).status).toBe(403);
    expect((await POST(req("/api/staff", "POST", DIRECTOR, { name: "새조교", role: "조교", pin: "24681357" }))).status).toBe(400);
    const ok = await POST(req("/api/staff", "POST", DIRECTOR, { name: "새조교", role: "조교", pin: "2468" }));
    expect(ok.status).toBe(200);
    await new Promise((r) => setTimeout(r, 0));
    expect(JSON.stringify(notionCalls)).not.toContain("2468");
  });

  it("기존 계정 로그인 regression + 본인 PIN 변경도 해시만(Notion 평문 없음)", async () => {
    const login = await import("@/app/api/login/route");
    const res = await login.POST(req("/api/login", "POST", null, { name: "서도영", pin: "1234" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("academy_session=");
    const wrong = await login.POST(req("/api/login", "POST", null, { name: "서도영", pin: "0000" }));
    expect(wrong.status).toBe(401);

    const notion = await import("@/lib/notion");
    await notion.updateStaffPin("st-minji", "4321");
    expect(await verifyPin("4321", staff("st-minji").pin_hash)).toBe(true);
    expect(staff("st-minji").must_change_password).toBe(false);
    expect(JSON.stringify(notionCalls)).not.toContain("4321");
  });

  it("재설정·비활성화 후에도 직원 식별자와 반 담당조교·업무 담당자 연결이 그대로", async () => {
    await resetAs(DIRECTOR, "st-minji");
    const { PATCH } = await import("@/app/api/staff/[id]/route");
    await PATCH(req("/api/staff/st-minji", "PATCH", DIRECTOR, { resigned: true }), { params: { id: "st-minji" } });
    await PATCH(req("/api/staff/st-minji", "PATCH", DIRECTOR, { resigned: false }), { params: { id: "st-minji" } });
    expect(staff("st-minji")).toMatchObject({ id: "st-minji", notion_id: "st-minji", role: "조교", work_schedule: "월=14:00-22:00" });
    expect(tables.classes[0].assistant_notion_ids).toEqual(["st-minji"]);
    expect(tables.tasks[0].staff_notion_ids).toEqual(["st-minji"]);
  });
});


describe("비활성화/재설정 시 기존 세션 즉시 차단(서명 쿠키 유지 + 서버 활성 확인)", () => {
  async function loginCookie(name: string, pin = "1234"): Promise<string> {
    const login = await import("@/app/api/login/route");
    const res = await login.POST(req("/api/login", "POST", null, { name, pin }));
    expect(res.status).toBe(200);
    const m = (res.headers.get("set-cookie") ?? "").match(/academy_session=([^;]+)/);
    return decodeURIComponent(m![1]);
  }
  async function hit(path: string, cookie: string, method = "GET") {
    const { middleware } = await import("@/middleware");
    return middleware(new NextRequest(`http://localhost${path}`, { method, headers: { cookie: `academy_session=${cookie}` } }));
  }
  const passed = (res: Response) => res.headers.get("x-middleware-next") === "1";
  async function setResigned(id: string, resigned: boolean) {
    const { PATCH } = await import("@/app/api/staff/[id]/route");
    const res = await PATCH(req(`/api/staff/${id}`, "PATCH", DIRECTOR, { resigned }), { params: { id } });
    expect(res.status).toBe(200);
  }

  it("로그인 → 쿠키 → 비활성화 → 기존 쿠키로 보호 API·자연어 입력·직원관리·행정실·업무 전부 거부(401) → 재활성화해도 옛 쿠키 거부 → 새 로그인 정상", async () => {
    const cookie = await loginCookie("박민지");
    expect(passed(await hit("/api/students", cookie))).toBe(true);

    await new Promise((r) => setTimeout(r, 2));
    await setResigned("st-minji", true);
    for (const [path, method] of [
      ["/api/students", "GET"],
      ["/api/students/stu-1", "PATCH"],
      ["/api/ai-input", "POST"],
      ["/api/tasks?scope=mine", "GET"],
      ["/api/tasks/t1/complete", "POST"],
      ["/api/staff/accounts", "GET"],
      ["/api/admin-inbox", "GET"],
      ["/api/class-record", "POST"],
    ]) {
      const res = await hit(path, cookie, method);
      expect(res.status, `${method} ${path}`).toBe(401);
      expect(res.headers.get("set-cookie") ?? "").toContain("academy_session=;");
    }
    // middleware 대상 페이지는 로그인으로
    const page = await hit("/dashboard", cookie);
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toContain("/login");
    // /director/* 페이지(getSession 경로)도 세션 없음
    pageCookie.value = cookie;
    const { getSession } = await import("@/lib/auth");
    expect(await getSession()).toBeNull();

    await new Promise((r) => setTimeout(r, 2));
    await setResigned("st-minji", false);
    expect((await hit("/api/students", cookie)).status).toBe(401);
    expect(await getSession()).toBeNull();

    await new Promise((r) => setTimeout(r, 2));
    const fresh = await loginCookie("박민지");
    expect(passed(await hit("/api/students", fresh))).toBe(true);
    pageCookie.value = fresh;
    expect((await getSession())?.name).toBe("박민지");
    pageCookie.value = "";
  });

  it("다른 직원·원장 세션은 영향 없음, 다른 지점 직원 쿠키는 이 지점에서 쓸 수 없음", async () => {
    const director = await loginCookie("서도영");
    const admin = await loginCookie("이행정");
    await new Promise((r) => setTimeout(r, 2));
    await setResigned("st-minji", true);
    expect(passed(await hit("/api/students", director))).toBe(true);
    expect(passed(await hit("/api/students", admin))).toBe(true);

    // 금정 직원으로 서명된 쿠키(같은 SESSION_SECRET 가정)라도 사직 배포에선 거부
    const { createSessionCookieValue } = await import("@/lib/session");
    const gj = await createSessionCookieValue({ staffId: "st-gj", name: "금정조교", role: "조교", issuedAt: Date.now() });
    expect((await hit("/api/students", gj)).status).toBe(401);
    expect(staff("st-gj").resigned).toBe(false);
  });

  it("원장 본인 계정 비활성화 방지 유지", async () => {
    const { PATCH } = await import("@/app/api/staff/[id]/route");
    const res = await PATCH(req("/api/staff/st-dir", "PATCH", DIRECTOR, { resigned: true }), { params: { id: "st-dir" } });
    expect(res.status).toBe(400);
    expect(staff("st-dir").resigned).toBe(false);
  });

  it("원장 비밀번호 재설정은 그 직원의 기존 세션을 끊고, 새 비밀번호로 다시 로그인하면 정상(본인 PIN 변경 경로로)", async () => {
    const cookie = await loginCookie("박민지");
    await new Promise((r) => setTimeout(r, 2));
    expect((await resetAs(DIRECTOR, "st-minji", "5678")).status).toBe(200);
    expect((await hit("/api/students", cookie)).status).toBe(401);
    await new Promise((r) => setTimeout(r, 2));
    const fresh = await loginCookie("박민지", "5678");
    // 재설정 후엔 본인 PIN 변경부터(기존 mustChangePin 흐름)
    expect((await hit("/api/students", fresh)).status).toBe(403);
    expect(passed(await hit("/api/change-pin", fresh, "POST"))).toBe(true);
  });

  it("정상 직원의 기존 로그인과 보호 API 접근은 그대로(DB 확인 1회 추가만)", async () => {
    const cookie = await loginCookie("이행정");
    expect(passed(await hit("/api/tasks?scope=mine", cookie))).toBe(true);
    expect(passed(await hit("/api/ai-input", cookie, "POST"))).toBe(true);
  });

  it("DB 확인 실패 시 열어두지 않는다(fail-closed, 503)", async () => {
    const cookie = await loginCookie("박민지");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 500 })));
    const res = await hit("/api/students", cookie);
    expect(res.status).toBe(503);
  });
});
