// 자료제작(material_tasks) + Supabase Storage 전환(staff.md PART 17) 검증.
// ACADEMY_MATERIAL_STORAGE_PROVIDER가 기본값(notion)일 때 운영 동작이
// 그대로 유지되는지, "supabase"로 켰을 때 실제로 Storage REST를 쓰는지
// 둘 다 확인한다. 같은 기법: Notion SDK mock + 인메모리 Supabase REST.
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
      fileUploads: {
        create: vi.fn().mockImplementation(async () => ({ id: `notion-file-${Math.random().toString(36).slice(2)}` })),
        send: vi.fn().mockResolvedValue({}),
      },
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

const storageUploads: { path: string; contentType: string | null }[] = [];

function makeFakeSupabase(tables: Record<string, Row[]>) {
  let idCounter = 0;
  return vi.fn(async (url: string, init?: any) => {
    const u = new URL(url);
    const method = (init?.method || "GET").toUpperCase();

    // Storage API — /storage/v1/object/<bucket>/<path...> (업로드) 및
    // /storage/v1/object/sign/<bucket>/<path...> (서명 URL 발급).
    if (u.pathname.startsWith("/storage/v1/object/sign/")) {
      const rest = u.pathname.replace("/storage/v1/object/sign/", "");
      const [, ...pathParts] = rest.split("/"); // [0]=bucket
      const path = pathParts.join("/");
      return new Response(JSON.stringify({ signedURL: `/object/sign/materials/${path}?token=fake` }), { status: 200 });
    }
    if (u.pathname.startsWith("/storage/v1/object/")) {
      const rest = u.pathname.replace("/storage/v1/object/", "");
      const [, ...pathParts] = rest.split("/");
      storageUploads.push({ path: pathParts.join("/"), contentType: init?.headers?.["Content-Type"] ?? null });
      return new Response(JSON.stringify({ Key: rest }), { status: 200 });
    }

    if (u.pathname === "/rest/v1/branches") {
      const code = u.searchParams.get("code")?.replace(/^eq\./, "");
      const id = code === "sajik" ? "branch-sajik" : code === "geumjeong" ? "branch-geumjeong" : null;
      return new Response(JSON.stringify(id ? [{ id }] : []), { status: 200 });
    }
    const table = u.pathname.replace("/rest/v1/", "");
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

beforeEach(() => {
  notionInstances.length = 0;
  storageUploads.length = 0;
  tables = { staff: [], material_tasks: [] };
  vi.stubGlobal("fetch", makeFakeSupabase(tables));
  process.env.SUPABASE_URL = "https://fake.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-key";
  process.env.ACADEMY_BRANCH_ID = "sajik";
  process.env.ACADEMY_DB_PROVIDER = "postgres";
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.ACADEMY_BRANCH_ID;
  delete process.env.ACADEMY_DB_PROVIDER;
  delete process.env.ACADEMY_MATERIAL_STORAGE_PROVIDER;
});

async function freshNotion() {
  return import("@/lib/notion");
}

function blob(text = "hello"): Blob {
  return new Blob([text], { type: "text/plain" });
}

describe("createFileUploadDraft / createMaterialTask — 기본값(ACADEMY_MATERIAL_STORAGE_PROVIDER 미설정 = notion)", () => {
  it("Storage로 바이트를 보내지 않고 기존 Notion File Upload API를 그대로 쓴다(운영 동작 무변경)", async () => {
    const notion = await freshNotion();
    const draft = await notion.createFileUploadDraft("작업지시서.pdf", "application/pdf", blob());
    expect(storageUploads).toHaveLength(0); // Supabase Storage 안 씀
    expect(draft.fileUploadId).toMatch(/^notion-file-/);

    await notion.createMaterialTask({
      title: "자료 준비",
      content: "내용",
      dueDate: "2026-09-25",
      fileUploadId: draft.fileUploadId,
      fileName: draft.filename,
    });
    expect(tables.material_tasks).toHaveLength(1);
    const entry = tables.material_tasks[0].original_files[0];
    expect(entry.source).toBe("notion");
    expect(entry.notionFileUploadId).toBe(draft.fileUploadId);
  });
});

describe("createFileUploadDraft / createMaterialTask / listMaterialTasks — ACADEMY_MATERIAL_STORAGE_PROVIDER=supabase", () => {
  beforeEach(() => {
    process.env.ACADEMY_MATERIAL_STORAGE_PROVIDER = "supabase";
  });

  it("업로드가 실제로 Supabase Storage(branch prefix 경로)로 간다", async () => {
    const notion = await freshNotion();
    const draft = await notion.createFileUploadDraft("작업지시서.pdf", "application/pdf", blob());
    expect(storageUploads).toHaveLength(1);
    expect(storageUploads[0].path.startsWith("sajik/materials/")).toBe(true);
    expect(draft.fileUploadId).toBe(decodeURIComponent(storageUploads[0].path));
  });

  it("생성 후 목록 조회 시 서명 URL로 파일 링크가 채워진다", async () => {
    const notion = await freshNotion();
    const draft = await notion.createFileUploadDraft("보고서.hwp", "application/octet-stream", blob());
    await notion.createMaterialTask({
      title: "보고서 준비",
      content: "내용",
      dueDate: "2026-09-25",
      fileUploadId: draft.fileUploadId,
      fileName: draft.filename,
    });
    const list = await notion.listMaterialTasks();
    expect(list).toHaveLength(1);
    expect(list[0].files).toHaveLength(1);
    expect(list[0].files[0].name).toBe("보고서.hwp");
    expect(list[0].files[0].url).toContain("/storage/v1/object/sign/materials/sajik/materials/");
  });

  it("branch isolation: 다른 지점 경로로는 서명 URL이 발급되지 않는다", async () => {
    const { createSignedMaterialFileUrl } = await import("@/lib/supabaseStorage");
    const url = await createSignedMaterialFileUrl("geumjeong/materials/some-file.pdf");
    expect(url).toBeNull();
  });

  it("Notion mirror가 실패해도 material task 생성 자체는 성공한다", async () => {
    const notion = await freshNotion();
    const client = notionInstances[notionInstances.length - 1];
    client.pages.create.mockRejectedValue(new Error("Notion down"));
    const draft = await notion.createFileUploadDraft("파일.pdf", "application/pdf", blob());
    await notion.createMaterialTask({
      title: "실패 테스트",
      content: "",
      dueDate: "2026-09-25",
      fileUploadId: draft.fileUploadId,
      fileName: draft.filename,
    });
    expect(tables.material_tasks).toHaveLength(1);
  });
});

describe("createMaterialTask/getMaterialTasksForDate — native UUID/legacy notion_id 공통 lifecycle", () => {
  it("마감일로 조회한 목록에 방금 만든 native PG UUID 작업이 뜬다", async () => {
    const notion = await freshNotion();
    await notion.createMaterialTask({ title: "오늘마감", content: "", dueDate: "2026-09-20" });
    const forDate = await notion.getMaterialTasksForDate("2026-09-20");
    expect(forDate).toHaveLength(1);
    expect(forDate[0].title).toBe("오늘마감");
  });

  it("legacy notion_id 작업도 목록 정렬에 정상적으로 섞인다", async () => {
    tables.material_tasks.push({
      id: "pg-legacy",
      notion_id: "notion-legacy",
      branch_id: "branch-sajik",
      title: "레거시 작업",
      requester_notion_ids: [],
      owner_notion_ids: [],
      content: "",
      progress: 0,
      status: "요청됨",
      due_date: "2026-09-18",
      file_location: null,
      original_files: [],
    });
    const notion = await freshNotion();
    await notion.createMaterialTask({ title: "신규 작업", content: "", dueDate: "2026-09-22" });
    const list = await notion.listMaterialTasks();
    expect(list.map((t) => t.title)).toEqual(["레거시 작업", "신규 작업"]); // 마감일 오름차순
  });
});
