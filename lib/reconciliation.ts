// Notion(정본) <-> Supabase(미러) 실시간 대조 도구. dual-write(lib/supabaseRepo.ts)가
// 계속 정상 동작하는지 운영 중에 주기적으로 확인하고, 실패 큐(dual_write_failures)를
// 재처리하는 영구 운영 도구다 — 마이그레이션 1회성 러너와 달리 계속 남아있는다.
import { notion, DB, listClasses, listStaff, listPoolTasks, listManuals } from "./notion";
import { SOURCES, OPTIONAL_SOURCES, TABLE, makeT, payload, rel } from "@/supabase/scripts/migrate_notion_to_supabase.mjs";
import { dualWriteEntity, branchCode } from "./supabaseRepo";

// listClasses/listStaff/listPoolTasks/listManuals는 내부적으로
// getDbProvider()(ACADEMY_DB_PROVIDER env)를 보고 Notion/Postgres 중 하나를
// 고른다. provider를 실제로 뒤집기 전에, 이 요청 하나 안에서만 잠깐 env를
// 바꿔가며 두 경로의 결과를 비교해 미리 검증한다(shadow-read). 요청이
// 끝나면 반드시 원래 값으로 되돌린다.
async function withProvider<T>(provider: "notion" | "postgres", fn: () => Promise<T>): Promise<T> {
  const prev = process.env.ACADEMY_DB_PROVIDER;
  process.env.ACADEMY_DB_PROVIDER = provider;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.ACADEMY_DB_PROVIDER;
    else process.env.ACADEMY_DB_PROVIDER = prev;
  }
}

function diffArrays(notionSide: any[], pgSide: any[], keyField = "id"): { onlyInNotion: string[]; onlyInPg: string[]; fieldMismatches: any[] } {
  const notionByKey = new Map(notionSide.map((r) => [r[keyField], r]));
  const pgByKey = new Map(pgSide.map((r) => [r[keyField], r]));
  const onlyInNotion = [...notionByKey.keys()].filter((k) => !pgByKey.has(k));
  const onlyInPg = [...pgByKey.keys()].filter((k) => !notionByKey.has(k));
  const fieldMismatches: any[] = [];
  for (const [key, nRow] of notionByKey) {
    const pRow = pgByKey.get(key);
    if (!pRow) continue;
    for (const field of Object.keys(nRow)) {
      const a = JSON.stringify(nRow[field] ?? null);
      const b = JSON.stringify(pRow[field] ?? null);
      if (a !== b) fieldMismatches.push({ id: key, field, notion: nRow[field], postgres: pRow[field] });
    }
  }
  return { onlyInNotion, onlyInPg, fieldMismatches: fieldMismatches.slice(0, 50) };
}

async function compareDomain<T extends { id: string }>(name: string, load: (provider: "notion" | "postgres") => Promise<T[]>) {
  try {
    const [notionSide, pgSide] = await Promise.all([withProvider("notion", () => load("notion")), withProvider("postgres", () => load("postgres"))]);
    return { domain: name, notionCount: notionSide.length, postgresCount: pgSide.length, ...diffArrays(notionSide, pgSide) };
  } catch (err) {
    // 예: 이 지점에 MANUAL DB가 아직 없음(NOTION_DB_MANUAL 미설정) — 그
    // 도메인만 스킵하고 나머지 비교는 계속 진행한다.
    return { domain: name, skipped: err instanceof Error ? err.message : String(err) };
  }
}

export async function shadowReadCompare() {
  const [classes, staff, poolTasks, manuals] = await Promise.all([
    compareDomain("classes", () => listClasses()),
    compareDomain("staff", () => listStaff()),
    compareDomain("poolTasks", () => listPoolTasks()),
    compareDomain("manuals", () => listManuals()),
  ]);
  return { classes, staff, poolTasks, manuals };
}

type Env = { url: string; key: string };
function supabaseEnv(): Env | null {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}
function headers(env: Env) {
  return { apikey: env.key, Authorization: `Bearer ${env.key}` };
}

async function resolveBranchId(env: Env, code: string): Promise<string | null> {
  const r = await fetch(`${env.url}/rest/v1/branches?select=id&code=eq.${encodeURIComponent(code)}`, { headers: headers(env) });
  if (!r.ok) return null;
  const rows = (await r.json()) as { id: string }[];
  return rows[0]?.id ?? null;
}

async function notionAllPages(dataSourceId: string): Promise<any[]> {
  const out: any[] = [];
  let cursor: string | undefined;
  do {
    const res: any = await notion.dataSources.query({ data_source_id: dataSourceId, page_size: 100, start_cursor: cursor } as any);
    out.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return out;
}

async function supabaseAllRows(env: Env, table: string, branchId: string): Promise<any[]> {
  const out: any[] = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await fetch(`${env.url}/rest/v1/${table}?select=*&branch_id=eq.${branchId}`, {
      headers: { ...headers(env), Range: `${offset}-${offset + 999}` },
    });
    if (!r.ok) throw new Error(`Supabase read ${table} failed (${r.status})`);
    const rows = await r.json();
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

export type SourceReport = {
  entity: string;
  notionCount: number;
  supabaseCount: number;
  missingInSupabase: string[]; // notion_id들 — Notion엔 있는데 Supabase엔 없음
  extraInSupabase: string[]; // Supabase엔 있는데 방금 조회한 Notion 결과엔 없음(대개 archived 처리 지연)
  fieldMismatches: { notionId: string; field: string; notion: unknown; supabase: unknown }[];
  skipped?: string; // 예: DB id 미설정
};

/**
 * 소스 하나에 대해 Notion 전량과 Supabase 미러를 대조한다. 샘플이 아니라
 * 전량 대조하되(레코드 수가 아주 크지 않다는 전제), 필드 비교는 처음 20건만
 * 한다(전량 필드비교는 시간이 오래 걸리고, missingInSupabase/extraInSupabase
 * 전량 대조가 더 중요한 신호이기 때문).
 */
async function reconcileSource(env: Env, branchId: string, entity: string, dbIdEnvValue: string | undefined): Promise<SourceReport> {
  if (!dbIdEnvValue) {
    return { entity, notionCount: 0, supabaseCount: 0, missingInSupabase: [], extraInSupabase: [], fieldMismatches: [], skipped: "no database ID configured" };
  }
  const [notionPages, supabaseRows] = await Promise.all([
    notionAllPages(dbIdEnvValue),
    supabaseAllRows(env, TABLE[entity as keyof typeof TABLE], branchId),
  ]);
  const supabaseByNotionId = new Map<string, any>(supabaseRows.filter((r) => r.notion_id).map((r) => [r.notion_id, r]));
  const notionIds = new Set(notionPages.map((p) => p.id));

  const missingInSupabase = notionPages.filter((p) => !supabaseByNotionId.has(p.id)).map((p) => p.id);
  const extraInSupabase = supabaseRows.filter((r) => r.notion_id && !notionIds.has(r.notion_id)).map((r) => r.notion_id);

  // 필드 비교(첫 20건): relation 필드는 실시간 ids 조회가 필요해 dual-write와
  // 동일한 방식(대상 테이블 lookup)으로 first/mapped를 구성한다.
  const fieldMismatches: SourceReport["fieldMismatches"] = [];
  const sample = notionPages.filter((p) => supabaseByNotionId.has(p.id)).slice(0, 20);
  if (sample.length) {
    const { targets } = await import("@/supabase/scripts/migrate_notion_to_supabase.mjs");
    const fieldTargets = (targets as Record<string, Record<string, string>>)[entity];
    const idCache = new Map<string, Map<string, string>>();
    async function resolveIds(table: string, ids: string[]): Promise<Map<string, string>> {
      const uniq = [...new Set(ids)];
      if (!uniq.length) return new Map();
      const r = await fetch(`${env.url}/rest/v1/${table}?select=id,notion_id&notion_id=in.(${uniq.map(encodeURIComponent).join(",")})&branch_id=eq.${branchId}`, { headers: headers(env) });
      if (!r.ok) return new Map();
      const rows = (await r.json()) as { id: string; notion_id: string }[];
      return new Map(rows.map((r2) => [r2.notion_id, r2.id]));
    }
    for (const page of sample) {
      const idMap = new Map<string, Map<string, string>>();
      if (fieldTargets) {
        const byTarget = new Map<string, Set<string>>();
        for (const [field, targetEntity] of Object.entries(fieldTargets)) {
          const ids = rel(page, field) as string[];
          if (!ids.length) continue;
          if (!byTarget.has(targetEntity)) byTarget.set(targetEntity, new Set());
          ids.forEach((id) => byTarget.get(targetEntity)!.add(id));
        }
        for (const [targetEntity, idSet] of byTarget) {
          const key = `${targetEntity}:${[...idSet].sort().join(",")}`;
          if (!idCache.has(key)) idCache.set(key, await resolveIds(TABLE[targetEntity as keyof typeof TABLE], [...idSet]));
          idMap.set(targetEntity, idCache.get(key)!);
        }
      }
      const first = (t: string, ids: string[]) => { for (const id of ids) { const v = idMap.get(t)?.get(id); if (v) return v; } return null; };
      const mapped = (t: string, ids: string[]) => ids.map((id) => idMap.get(t)?.get(id)).filter(Boolean) as string[];
      const T = makeT({ first, mapped, issue: () => {} }) as Record<string, (x: any) => Record<string, unknown>>;
      const expected = T[entity](page);
      const actual = supabaseByNotionId.get(page.id);
      for (const [field, value] of Object.entries(expected)) {
        if (field === "exam_data") continue; // JSONB 자유 형식 — 문자열 비교 부적절, 건너뜀
        const actualValue = actual[field];
        const same = Array.isArray(value)
          ? Array.isArray(actualValue) && JSON.stringify([...value].sort()) === JSON.stringify([...actualValue].sort())
          : JSON.stringify(value ?? null) === JSON.stringify(actualValue ?? null);
        if (!same) fieldMismatches.push({ notionId: page.id, field, notion: value, supabase: actualValue });
      }
    }
  }

  return {
    entity,
    notionCount: notionPages.length,
    supabaseCount: supabaseRows.length,
    missingInSupabase,
    extraInSupabase,
    fieldMismatches,
  };
}

export async function runReconciliation(): Promise<{ branch: string; branchId: string; sources: SourceReport[] } | { error: string }> {
  const env = supabaseEnv();
  const branch = branchCode();
  if (!env || !branch) return { error: "Supabase/branch 설정이 없습니다." };
  const branchId = await resolveBranchId(env, branch);
  if (!branchId) return { error: `branch not found: ${branch}` };

  const sources: SourceReport[] = [];
  for (const [entity, envKey] of SOURCES) {
    if (OPTIONAL_SOURCES.has(entity) && !(DB as Record<string, string | undefined>)[entity]) {
      sources.push({ entity, notionCount: 0, supabaseCount: 0, missingInSupabase: [], extraInSupabase: [], fieldMismatches: [], skipped: "optional source not configured" });
      continue;
    }
    const dbId = (DB as Record<string, string | undefined>)[entity];
    try {
      sources.push(await reconcileSource(env, branchId, entity, dbId));
    } catch (err) {
      // 소스 하나의 Notion 조회 실패(예: 잘못된 data source ID)가 나머지
      // 16개 소스 대조를 막지 않게 한다 — supabase/scripts/migrate_notion_to_supabase.mjs와
      // 동일한 격리 원칙.
      sources.push({
        entity,
        notionCount: 0,
        supabaseCount: 0,
        missingInSupabase: [],
        extraInSupabase: [],
        fieldMismatches: [],
        skipped: `error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
  return { branch, branchId, sources };
}

/** dual_write_failures 큐에서 아직 안 풀린 항목들을 다시 시도한다. */
// 금정 워크스페이스에 아직 없는 4개 DB(자료제작/시험대비/학교별시험범위/
// Slack 학생기록)를 사직의 것과 "동일한 구조"로 새로 만든다. relation
// 속성(요청자/담당자→직원, 학생→학생마스터)은 사직 DB를 그대로 복사하면
// 사직 직원/학생을 가리키게 되므로, 금정 자신의 직원/학생마스터 DB를
// 가리키도록 다시 연결한다. execute=false(기본)면 아무것도 만들지 않고
// "무엇을 어떻게 만들 것인지"만 보고한다.
const PROVISION_TARGETS: { key: string; sajikTitleContains: string }[] = [
  { key: "MATERIAL", sajikTitleContains: "교재" },
  { key: "EXAM_PREP", sajikTitleContains: "학생시험대비" },
  { key: "SCHOOL_EXAM_RANGE", sajikTitleContains: "학교별시험범위" },
  { key: "SLACK_RECORDS", sajikTitleContains: "Slack" },
];

async function findAccessiblePages(): Promise<{ id: string; title: string }[]> {
  const results: { id: string; title: string }[] = [];
  let cursor: string | undefined;
  do {
    const res: any = await notion.search({
      filter: { property: "object", value: "page" } as any,
      start_cursor: cursor,
      page_size: 100,
    } as any);
    for (const r of res.results as any[]) {
      const titleProp = Object.values(r.properties ?? {}).find((p: any) => p?.type === "title") as any;
      const title = (titleProp?.title ?? []).map((t: any) => t.plain_text).join("") || "(제목없음)";
      results.push({ id: r.id, title });
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return results;
}

async function findAllDataSources(): Promise<{ id: string; title: string }[]> {
  const results: { id: string; title: string }[] = [];
  let cursor: string | undefined;
  do {
    const res: any = await notion.search({
      filter: { property: "object", value: "data_source" } as any,
      start_cursor: cursor,
      page_size: 100,
    } as any);
    for (const r of res.results as any[]) {
      const title = (r.title ?? []).map((t: any) => t.plain_text).join("") || "(제목없음)";
      results.push({ id: r.id, title });
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return results;
}

function remapRelationProperties(properties: Record<string, any>, remap: Record<string, string>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [name, config] of Object.entries(properties)) {
    if (config?.type === "relation") {
      const targetOldId = config.relation?.data_source_id;
      const newTargetId = targetOldId ? remap[targetOldId] : undefined;
      if (!newTargetId) {
        // 이 relation이 가리키는 대상을 금정 쪽으로 못 찾았으면(예상 밖
        // 대상), 안전을 위해 이 속성 자체를 새 DB에서는 빼고 이름만 rich_text로
        // 남겨 데이터 구조가 깨지지 않게 한다 — 추측으로 아무 데나 연결하지 않는다.
        out[name] = { rich_text: {} };
        continue;
      }
      // dual_property(양방향 sync)는 원본 쪽 동기화 속성 이름까지 다시
      // 만들어야 해서 복잡하고 오류 위험이 크다 — single_property(단방향)로
      // 통일한다. 이 4개 DB의 relation은 어차피 앱 코드가 단방향으로만
      // 읽으므로(targets 매핑) 기능상 차이가 없다.
      out[name] = { relation: { data_source_id: newTargetId, type: "single_property", single_property: {} } };
      continue;
    }
    if (config?.type === "created_time" || config?.type === "last_edited_time" || config?.type === "formula" || config?.type === "rollup") {
      // 계산/자동 속성은 그대로 복사하면 새 DB 생성 API가 거부하거나
      // 의미 없는 값이 된다 — 안전하게 건너뛴다(사직 쪽에도 이 4개 DB엔
      // 안 쓰였을 가능성이 높지만 방어적으로 처리).
      continue;
    }
    if (name === "title" || config?.type === "title") {
      out[name] = { title: {} };
      continue;
    }
    out[name] = config;
  }
  return out;
}

export async function planOrProvisionGeumjeongDatabases(execute: boolean) {
  const allSources = await findAllDataSources();
  const sajik = (needle: string) => allSources.find((d) => d.title.includes("사직") && d.title.includes(needle));
  const geumjeong = (needle: string) => allSources.find((d) => d.title.includes("금정") && d.title.includes(needle));

  const geumjeongStaff = geumjeong("직원계정");
  const geumjeongStudent = geumjeong("학생마스터");
  const geumjeongAnchor = geumjeong("반") ?? geumjeong("직원계정"); // parent page 추정용
  if (!geumjeongStaff || !geumjeongStudent || !geumjeongAnchor) {
    return { error: "금정의 직원계정/학생마스터/기준 DB를 찾지 못했습니다 — 임의 진행하지 않습니다.", found: allSources.map((s) => s.title) };
  }

  // 기존 금정 DB의 부모를 타고 올라가는 방식은 중간 블록이 integration에
  // 공유되지 않아 실패했다(권한 전파가 페이지 단위라 중첩 블록은 못 봄).
  // 대신 integration이 직접 접근 가능한(=검색되는) "금정" 페이지를 찾아
  // 그 아래에 만든다.
  const pages = await findAccessiblePages();
  const parentPage = pages.find((p) => p.title.includes("금정")) ?? pages[0];
  if (!parentPage) {
    return { error: "새 DB를 만들 부모 페이지를 하나도 찾지 못했습니다 — 임의 진행하지 않습니다." };
  }
  const parentPageId = parentPage.id;

  const sajikStaff = sajik("직원계정");
  const sajikStudent = sajik("학생마스터");
  const relationRemap: Record<string, string> = {};
  if (sajikStaff) relationRemap[sajikStaff.id] = geumjeongStaff.id;
  if (sajikStudent) relationRemap[sajikStudent.id] = geumjeongStudent.id;

  const plan: { key: string; sajikTitle: string; sajikId: string; newTitle: string; skipped?: string }[] = [];
  const created: { key: string; newDataSourceId: string; newTitle: string }[] = [];

  for (const target of PROVISION_TARGETS) {
    const already = DB[target.key as keyof typeof DB];
    let alreadyWorks = false;
    if (already) {
      try {
        await notion.dataSources.retrieve({ data_source_id: already });
        alreadyWorks = true;
      } catch {
        alreadyWorks = false; // 설정은 돼있지만 존재하지 않는 ID — 새로 만들 필요가 있다.
      }
    }
    const src = sajik(target.sajikTitleContains);
    if (!src) {
      plan.push({ key: target.key, sajikTitle: "(찾지 못함)", sajikId: "", newTitle: "", skipped: "사직 원본 DB를 찾지 못함" });
      continue;
    }
    const newTitle = src.title.replace("사직", "금정");
    if (alreadyWorks) {
      plan.push({ key: target.key, sajikTitle: src.title, sajikId: src.id, newTitle, skipped: `이미 NOTION_DB_${target.key}(${already})가 정상 동작함 — 건드리지 않음` });
      continue;
    }
    const existingGeumjeong = allSources.find((d) => d.title === newTitle);
    if (existingGeumjeong) {
      plan.push({ key: target.key, sajikTitle: src.title, sajikId: src.id, newTitle, skipped: `이미 같은 이름의 금정 DB가 존재함(${existingGeumjeong.id}) — 새로 만들지 않음, 이 ID를 env로 등록하면 됨` });
      continue;
    }
    plan.push({ key: target.key, sajikTitle: src.title, sajikId: src.id, newTitle });

    if (execute) {
      const sourceSchema: any = await notion.dataSources.retrieve({ data_source_id: src.id });
      const properties = remapRelationProperties(sourceSchema.properties ?? {}, relationRemap);
      const createdDb: any = await notion.databases.create({
        parent: { type: "page_id", page_id: parentPageId },
        title: [{ type: "text", text: { content: newTitle } }],
        initial_data_source: { properties } as any,
      });
      const newId = createdDb.data_sources?.[0]?.id;
      created.push({ key: target.key, newDataSourceId: newId, newTitle });
    }
  }

  return { execute, parentPageId, plan, created };
}

/**
 * WRITE 정본 전환(ACADEMY_DB_PROVIDER=postgres) 검증용 — 실제 프로덕션에
 * 안전하고 되돌릴 수 있는 테스트 레코드 1건을 만들어서, dual-write가
 * 실제로 Postgres에 올바른 branch_id로 반영되는지 확인한 뒤 즉시
 * archive(soft-delete, 기존 앱의 삭제 방식과 동일)한다. 실제 학생/직원
 * 데이터는 전혀 건드리지 않는다 — TODO(개인할일) 테스트 레코드 1건만
 * 생성/확인/보관 처리한다.
 */
export async function writeSmokeTest() {
  const env = supabaseEnv();
  const branch = branchCode();
  if (!env || !branch) return { ok: false, error: "Supabase/branch 설정이 없습니다." };
  const branchId = await resolveBranchId(env, branch);
  if (!branchId) return { ok: false, error: `branch not found: ${branch}` };

  const staffRes: any = await notion.dataSources.query({ data_source_id: DB.STAFF, page_size: 1 } as any);
  const staffPage = staffRes.results[0];
  if (!staffPage) return { ok: false, error: "테스트에 쓸 직원 레코드를 찾지 못했습니다." };

  const marker = `[자동검증-삭제가능] write-smoke-test ${new Date().toISOString()}`;
  const created: any = await notion.pages.create({
    parent: { data_source_id: DB.TODO } as any,
    properties: {
      제목: { title: [{ text: { content: marker } }] },
      유형: { select: { name: "개인할일" } },
      담당자: { relation: [{ id: staffPage.id }] },
      예정일: { date: { start: new Date().toISOString().slice(0, 10) } },
      완료여부: { checkbox: false },
      우선순위: { select: { name: "보통" } },
    } as any,
  });
  await dualWriteEntity("TODO", created);

  const check = await fetch(`${env.url}/rest/v1/tasks?notion_id=eq.${created.id}&select=*`, { headers: headers(env) });
  const rows = (await check.json()) as any[];
  const row = rows[0] ?? null;
  const verified = !!row && row.branch_id === branchId && row.notion_id === created.id;

  // 다른 branch에 안 섞였는지: 전체(branch 무관) 조회에서 정확히 1건만
  // 나와야 한다(사직/금정 둘 다에 같은 notion_id가 있을 수 없으므로).
  const crossBranchLeak = rows.length !== 1;

  const archived: any = await notion.pages.update({ page_id: created.id, archived: true });
  await dualWriteEntity("TODO", archived);

  return {
    ok: true,
    branch,
    branchId,
    notionId: created.id,
    supabaseRow: row,
    verified,
    crossBranchLeak,
    cleanedUp: true,
  };
}

export async function retryDualWriteFailures(limit = 50): Promise<{ retried: number; resolved: number; stillFailing: number }> {
  const env = supabaseEnv();
  const branch = branchCode();
  if (!env || !branch) return { retried: 0, resolved: 0, stillFailing: 0 };
  const branchId = await resolveBranchId(env, branch);
  if (!branchId) return { retried: 0, resolved: 0, stillFailing: 0 };

  const r = await fetch(
    `${env.url}/rest/v1/dual_write_failures?select=*&branch_id=eq.${branchId}&resolved=eq.false&order=created_at.asc&limit=${limit}`,
    { headers: headers(env) },
  );
  if (!r.ok) return { retried: 0, resolved: 0, stillFailing: 0 };
  const rows = (await r.json()) as { id: string; entity: string; notion_id: string | null }[];

  let resolved = 0;
  let stillFailing = 0;
  for (const row of rows) {
    if (!row.notion_id || row.entity.includes(":delete")) {
      // 삭제 실패나 notion_id 없는 실패는 자동 재시도 대상이 아니다 — 수동 검토.
      stillFailing++;
      continue;
    }
    try {
      const page = await notion.pages.retrieve({ page_id: row.notion_id });
      await dualWriteEntity(row.entity as any, page);
      await fetch(`${env.url}/rest/v1/dual_write_failures?id=eq.${row.id}`, {
        method: "PATCH",
        headers: { ...headers(env), "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ resolved: true }),
      });
      resolved++;
    } catch {
      await fetch(`${env.url}/rest/v1/dual_write_failures?id=eq.${row.id}`, {
        method: "PATCH",
        headers: { ...headers(env), "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ attempts: 999, last_attempted_at: new Date().toISOString() }),
      }).catch(() => {});
      stillFailing++;
    }
  }
  return { retried: rows.length, resolved, stillFailing };
}
