// 매뉴얼 WRITE postgres-primary 전환(staff.md PART 16) 검증. 같은 기법:
// Notion SDK는 완전히 mock, Supabase REST는 인메모리 fake fetch.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { notionInstances } = vi.hoisted(() => ({ notionInstances: [] as any[] }));

vi.mock("@notionhq/client", () => ({
  Client: vi.fn().mockImplementation(function Client() {
    const instance = {
      pages: {
        create: vi.fn().mockImplementation(async () => ({ id: `notion-mock-${Math.random().toString(36).slice(2)}` })),
        update: vi.fn().mockResolvedValue({}),
        retrieve: vi.fn().mockResolvedValue(null),
      },
      dataSources: { query: vi.fn().mockResolvedValue({ results: [] }) },
    };
    notionInstances.push(instance);
    return instance;
  }),
}));

type Row = Record<string, any>;

function matchClause(clause: string, row: Row): boolean {
  const m = clause.match(/^([a-z_]+)\.(eq|cs|is|in)\.(.*)$/);
  if (!m) throw new Error(`fake-supabase: unsupported clause "${clause}"`);
  const [, col, op, rawVal] = m;
  const cell = row[col];
  if (op === "eq") {
    const decoded = decodeURIComponent(rawVal);
    if (decoded === "true" || decoded === "false") return cell === (decoded === "true");
    return String(cell ?? "") === decoded;
  }
  if (op === "is") return rawVal === "null" ? cell === null || cell === undefined : false;
  if (op === "cs") {
    const v = decodeURIComponent(rawVal.replace(/^\{/, "").replace(/\}$/, ""));
    return Array.isArray(cell) && cell.includes(v);
  }
  if (op === "in") {
    const vals = rawVal
      .replace(/^\(/, "")
      .replace(/\)$/, "")
      .split(",")
      .map((v) => decodeURIComponent(v));
    return vals.includes(String(cell ?? ""));
  }
  return false;
}

function applyFilters(rows: Row[], searchParams: URLSearchParams): Row[] {
  let out = rows;
  for (const [key, value] of searchParams.entries()) {
    if (key === "select" || key === "order" || key === "limit") continue;
    if (key === "or") {
      const inner = value.replace(/^\(/, "").replace(/\)$/, "");
      const clauses = inner.split(/,(?=[a-z_]+\.)/);
      out = out.filter((row) => clauses.some((c) => matchClause(c, row)));
      continue;
    }
    out = out.filter((row) => matchClause(`${key}.${value}`, row));
  }
  return out;
}

function makeFakeSupabase(tables: Record<string, Row[]>) {
  let idCounter = 0;
  return vi.fn(async (url: string, init?: any) => {
    const u = new URL(url);
    const table = u.pathname.replace("/rest/v1/", "");
    const method = (init?.method || "GET").toUpperCase();
    if (table === "branches") {
      const code = u.searchParams.get("code")?.replace(/^eq\./, "");
      const id = code === "sajik" ? "branch-sajik" : code === "geumjeong" ? "branch-geumjeong" : null;
      return new Response(JSON.stringify(id ? [{ id }] : []), { status: 200 });
    }
    tables[table] = tables[table] ?? [];
    if (method === "GET") {
      return new Response(JSON.stringify(applyFilters(tables[table], u.searchParams)), { status: 200 });
    }
    if (method === "POST") {
      const body = JSON.parse(init.body as string);
      const items = Array.isArray(body) ? body : [body];
      const inserted = items.map((item: Row) => ({ id: `gen-${++idCounter}`, notion_id: null, ...item }));
      tables[table].push(...inserted);
      return new Response(JSON.stringify(inserted), { status: 201 });
    }
    if (method === "PATCH") {
      const body = JSON.parse(init.body as string);
      const matched = applyFilters(tables[table], u.searchParams);
      for (const row of matched) Object.assign(row, body);
      return new Response(JSON.stringify(matched), { status: 200 });
    }
    return new Response("[]", { status: 200 });
  });
}

let tables: Record<string, Row[]>;

function seedBaseline() {
  tables = { manuals: [], manual_steps: [] };
}

beforeEach(() => {
  notionInstances.length = 0;
  seedBaseline();
  vi.stubGlobal("fetch", makeFakeSupabase(tables));
  process.env.SUPABASE_URL = "https://fake.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-key";
  process.env.ACADEMY_BRANCH_ID = "sajik";
  process.env.ACADEMY_DB_PROVIDER = "postgres";
  // requireManualDb()/requireManualStepDb()/listPublishedStepsByPath의 가드는
  // provider와 무관하게 이 두 env var로 "매뉴얼 기능이 설정됐는지"를 판단한다
  // (listManuals의 기존 설계 그대로) — 값 자체는 postgres 경로에서 안 쓰인다.
  process.env.NOTION_DB_MANUAL = "fake-manual-db";
  process.env.NOTION_DB_MANUAL_STEP = "fake-manual-step-db";
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.ACADEMY_BRANCH_ID;
  delete process.env.ACADEMY_DB_PROVIDER;
  delete process.env.NOTION_DB_MANUAL;
  delete process.env.NOTION_DB_MANUAL_STEP;
});

async function freshNotion() {
  return import("@/lib/notion");
}

function sampleStep(overrides: Partial<Parameters<Awaited<ReturnType<typeof freshNotion>>["createManualSteps"]>[1][number]> = {}) {
  return {
    order: 1,
    title: "1단계: 로그인",
    description: "로그인 화면에서 아이디/비번 입력",
    screenshot: "",
    videoTimestamp: "00:05",
    warning: "",
    relatedPath: "",
    keywords: "",
    ...overrides,
  };
}

describe("createManualDraft / createManualSteps / listManualSteps — postgres-primary", () => {
  it("매뉴얼 생성(native PG UUID) 직후 바로 step을 만들 수 있다(dual-id resolve)", async () => {
    const notion = await freshNotion();
    const manualId = await notion.createManualDraft({
      title: "학생등록 방법",
      category: "학생관리",
      targetRoles: ["행정"],
      sourceVideoUrl: "",
      summary: "요약",
      createdBy: "원장",
    });
    expect(manualId).toBeTruthy();
    expect(tables.manuals).toHaveLength(1);
    expect(tables.manuals[0].notion_id).toBeNull(); // 아직 미러 전

    await notion.createManualSteps(manualId, [sampleStep()]);
    expect(tables.manual_steps).toHaveLength(1);
    expect(tables.manual_steps[0].manual_id).toBe(tables.manuals[0].id); // native FK 정확히 연결
    expect(tables.manual_steps[0].title).toBe("1단계: 로그인"); // title 컬럼 저장 확인

    const steps = await notion.listManualSteps(manualId);
    expect(steps).toHaveLength(1);
    expect(steps[0].title).toBe("1단계: 로그인");
  });

  it("legacy notion_id 매뉴얼에도 step을 정상적으로 붙일 수 있다", async () => {
    tables.manuals.push({
      id: "pg-manual-1",
      notion_id: "notion-manual-1",
      branch_id: "branch-sajik",
      title: "출결 체크 방법",
      category: "출결",
      target_roles: [],
      status: "DRAFT",
      video_url: "",
      summary: "",
      author: "원장",
    });
    const notion = await freshNotion();
    await notion.createManualSteps("notion-manual-1", [sampleStep({ title: "1단계: 출결화면 진입" })]);
    expect(tables.manual_steps[0].manual_id).toBe("pg-manual-1");
    expect(tables.manual_steps[0].manual_notion_ids).toEqual(["notion-manual-1"]);

    const steps = await notion.listManualSteps("notion-manual-1");
    expect(steps).toHaveLength(1);
    expect(steps[0].title).toBe("1단계: 출결화면 진입");
  });

  it("branch isolation: 다른 지점 매뉴얼의 step은 절대 안 섞인다", async () => {
    tables.manuals.push(
      { id: "pg-manual-sajik", notion_id: null, branch_id: "branch-sajik", title: "사직 매뉴얼", category: "", target_roles: [], status: "DRAFT", video_url: "", summary: "", author: "" },
      { id: "pg-manual-geumjeong", notion_id: null, branch_id: "branch-geumjeong", title: "금정 매뉴얼", category: "", target_roles: [], status: "DRAFT", video_url: "", summary: "", author: "" }
    );
    tables.manual_steps.push(
      { id: "step-sajik", notion_id: null, branch_id: "branch-sajik", manual_id: "pg-manual-sajik", manual_notion_ids: ["pg-manual-sajik"], step_order: 1, title: "사직 단계", description: "", screenshot_url: null, video_timestamp: "", caution: "", related_path: "", keywords: "" },
      { id: "step-geumjeong", notion_id: null, branch_id: "branch-geumjeong", manual_id: "pg-manual-geumjeong", manual_notion_ids: ["pg-manual-geumjeong"], step_order: 1, title: "금정 단계", description: "", screenshot_url: null, video_timestamp: "", caution: "", related_path: "", keywords: "" }
    );
    const notion = await freshNotion();
    const steps = await notion.listManualSteps("pg-manual-sajik");
    expect(steps.map((s) => s.title)).toEqual(["사직 단계"]);
  });

  it("Notion mirror가 실패해도 매뉴얼/step 저장 자체는 성공한다", async () => {
    const notion = await freshNotion();
    const client = notionInstances[notionInstances.length - 1];
    client.pages.create.mockRejectedValue(new Error("Notion down"));
    const manualId = await notion.createManualDraft({
      title: "실패 테스트",
      category: "",
      targetRoles: [],
      sourceVideoUrl: "",
      summary: "",
      createdBy: "",
    });
    await notion.createManualSteps(manualId, [sampleStep()]);
    expect(tables.manuals).toHaveLength(1);
    expect(tables.manual_steps).toHaveLength(1);
  });
});

describe("updateManualStep / deleteManualStep — postgres-primary", () => {
  beforeEach(() => {
    tables.manuals.push({
      id: "pg-manual-1",
      notion_id: "notion-manual-1",
      branch_id: "branch-sajik",
      title: "매뉴얼",
      category: "",
      target_roles: [],
      status: "DRAFT",
      video_url: "",
      summary: "",
      author: "",
    });
    tables.manual_steps.push({
      id: "pg-step-1",
      notion_id: "notion-step-1",
      branch_id: "branch-sajik",
      manual_id: "pg-manual-1",
      manual_notion_ids: ["notion-manual-1"],
      step_order: 1,
      title: "원래 제목",
      description: "원래 설명",
      screenshot_url: null,
      video_timestamp: "",
      caution: "",
      related_path: "",
      keywords: "",
      source_payload: {},
    });
  });

  it("title을 포함해 수정한 내용이 정확히 patch된다", async () => {
    const notion = await freshNotion();
    await notion.updateManualStep("notion-step-1", { title: "수정된 제목", description: "수정된 설명" });
    expect(tables.manual_steps[0].title).toBe("수정된 제목");
    expect(tables.manual_steps[0].description).toBe("수정된 설명");
  });

  it("native PG UUID로도 수정된다", async () => {
    const notion = await freshNotion();
    await notion.updateManualStep("pg-step-1", { order: 5 });
    expect(tables.manual_steps[0].step_order).toBe(5);
  });

  it("삭제하면 archive되고(soft delete) 목록에서 빠진다", async () => {
    const notion = await freshNotion();
    await notion.deleteManualStep("notion-step-1");
    expect(tables.manual_steps[0].source_payload.archived).toBe(true);
    const steps = await notion.listManualSteps("notion-manual-1");
    expect(steps).toHaveLength(0);
  });
});
