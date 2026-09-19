// Notion -> Supabase 실시간 dual-write/read 엔진. lib/notion.ts의 write 함수들이
// 기존처럼 Notion에 쓰고 난 뒤, 그 결과 페이지 객체를 이 모듈에 넘겨 동일한
// 필드 매핑 규칙(supabase/scripts/migrate_notion_to_supabase.mjs, 이미 사직/금정
// 실제 이전에 검증됨)으로 Supabase에도 반영한다.
//
// 원칙:
//  - Supabase 쪽 실패가 Notion write의 성공/실패에 절대 영향을 주지 않는다.
//    (dualWriteEntity/dualDeleteEntity는 무슨 일이 있어도 throw하지 않는다.)
//  - 환경변수(SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY/ACADEMY_BRANCH_ID)가 아직
//    없는 배포(= 이 코드가 없던 시점과 동일하게)에서는 조용히 아무 일도 하지
//    않는다 — 기존 동작을 절대 바꾸지 않는다.
//  - 실패는 버리지 않는다: 1회 재시도 후에도 실패하면 dual_write_failures에
//    기록해 나중에 재처리(reconciliation)할 수 있게 한다.
import { TABLE, targets, makeT, payload, rel } from "@/supabase/scripts/migrate_notion_to_supabase.mjs";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NotionPage = any;
export type EntityKey = keyof typeof TABLE;

function supabaseEnv(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

// 스키마 주석(002_branch_scoping.sql)이 의도했던 정식 이름은 ACADEMY_BRANCH_ID다.
// 마이그레이션 러너 때 먼저 등록된 MIGRATION_BRANCH_CODE도 그대로 인식해서
// 추가 배포/설정 없이 바로 이어 쓸 수 있게 한다.
export function branchCode(): string | null {
  return process.env.ACADEMY_BRANCH_ID ?? process.env.MIGRATION_BRANCH_CODE ?? null;
}

export function getDbProvider(): "notion" | "postgres" {
  return process.env.ACADEMY_DB_PROVIDER === "postgres" ? "postgres" : "notion";
}

/**
 * 학생 목록/상세만 별도로 게이팅한다 — 나머지 READ/WRITE는 이미 검증된
 * ACADEMY_DB_PROVIDER를 그대로 따르지만, 학생 쪽은 Notion rollup(누적출석률
 * 등)을 daily_records 집계로 재구현한 새 코드라 reconciliation으로 0건
 * 불일치를 확인하기 전까지는 기존 ACADEMY_DB_PROVIDER=postgres 배포에서도
 * 자동으로 켜지면 안 된다. 검증 후 이 값만 별도로 "postgres"로 올린다.
 */
export function getStudentReadProvider(): "notion" | "postgres" {
  return process.env.ACADEMY_STUDENT_READ_PROVIDER === "postgres" ? "postgres" : "notion";
}

function authHeaders(key: string) {
  return { apikey: key, Authorization: `Bearer ${key}` };
}

let branchIdPromise: Promise<string | null> | null = null;
async function resolveBranchId(): Promise<string | null> {
  const env = supabaseEnv();
  const code = branchCode();
  if (!env || !code) return null;
  if (!branchIdPromise) {
    branchIdPromise = (async () => {
      try {
        const r = await fetch(`${env.url}/rest/v1/branches?select=id&code=eq.${encodeURIComponent(code)}`, {
          headers: authHeaders(env.key),
        });
        if (!r.ok) return null;
        const rows = (await r.json()) as { id: string }[];
        return rows[0]?.id ?? null;
      } catch {
        return null;
      }
    })();
  }
  const id = await branchIdPromise;
  if (!id) branchIdPromise = null; // 실패했으면 다음 호출에서 다시 시도
  return id;
}

/**
 * relation을 걸 때 넘어오는 식별자는 두 종류일 수 있다: 기존 Notion 페이지
 * id(legacy, notion_id 컬럼과 매칭) 또는 postgres-primary 경로가 방금
 * pgInsertRow로 만든 행의 고유 id(uuid, notion 미러가 아직 안 끝나
 * notion_id가 비어있는 상태). 어느 쪽인지 호출부가 알 필요 없게, 두 컬럼을
 * 모두 OR로 찾는다 — 두 값 공간(Notion page id / Postgres gen_random_uuid())은
 * 서로 완전히 독립적으로 생성되므로 우연히 같은 값이 다른 의미로 겹칠 확률은
 * 무시할 수 있다(기존 notion_id 전용 호출부 동작은 그대로 유지됨: 그 값은
 * 어차피 어떤 행의 id와도 우연히 같을 수 없다). branch_id 조건은 OR 바깥에
 * AND로 걸려 있어 다른 지점 행은 절대 섞이지 않는다.
 */
async function resolveRelationIds(table: string, rawIds: string[], branchId: string, key: string, url: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const ids = [...new Set(rawIds.filter(Boolean))];
  if (!ids.length) return map;
  const idSet = new Set(ids);
  const inList = ids.map((id) => encodeURIComponent(id)).join(",");
  const r = await fetch(
    `${url}/rest/v1/${table}?select=id,notion_id&branch_id=eq.${branchId}&or=(notion_id.in.(${inList}),id.in.(${inList}))`,
    { headers: authHeaders(key) }
  );
  if (!r.ok) return map;
  const rows = (await r.json()) as { id: string; notion_id: string | null }[];
  for (const row of rows) {
    if (row.notion_id && idSet.has(row.notion_id)) map.set(row.notion_id, row.id);
    if (idSet.has(row.id)) map.set(row.id, row.id);
  }
  return map;
}

/** 단건 조회/패치용 OR 필터 조각 — notion_id 또는 postgres id(uuid) 아무 쪽으로나 매칭한다. 호출부가 반드시 branch_id=eq...를 같은 쿼리에 AND로 덧붙여야 한다. */
function eitherIdFilter(id: string): string {
  const enc = encodeURIComponent(id);
  return `or=(notion_id.eq.${enc},id.eq.${enc})`;
}

async function upsertRow(table: string, row: Record<string, unknown>, env: { url: string; key: string }): Promise<void> {
  const r = await fetch(`${env.url}/rest/v1/${table}?on_conflict=branch_id,notion_id`, {
    method: "POST",
    headers: { ...authHeaders(env.key), "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([row]),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`Supabase upsert ${table} failed (${r.status}): ${body.slice(0, 500)}`);
  }
}

async function recordFailure(entity: string, notionId: string | null | undefined, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  console.error("dual-write failed (Notion write already succeeded, Supabase mirror pending)", {
    entity,
    notionId,
    message,
  });
  try {
    const env = supabaseEnv();
    const branchId = await resolveBranchId();
    if (!env || !branchId) return;
    await fetch(`${env.url}/rest/v1/dual_write_failures`, {
      method: "POST",
      headers: { ...authHeaders(env.key), "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify([{ branch_id: branchId, entity, notion_id: notionId ?? null, error: message.slice(0, 1000) }]),
    });
  } catch (e2) {
    console.error("dual-write: also failed to record dual_write_failures row", e2 instanceof Error ? e2.message : String(e2));
  }
}

async function dualWriteOnce(entityKey: EntityKey, notionPage: NotionPage): Promise<void> {
  const env = supabaseEnv();
  const branchId = await resolveBranchId();
  if (!env || !branchId) return; // 설정 전(=이 기능이 없던 것과 동일) — 조용히 skip

  const fieldTargets = (targets as Record<string, Record<string, EntityKey>>)[entityKey as string];
  const idMap = new Map<EntityKey, Map<string, string>>();
  if (fieldTargets) {
    const byTarget = new Map<EntityKey, Set<string>>();
    for (const [field, targetEntity] of Object.entries(fieldTargets)) {
      const ids = rel(notionPage, field) as string[];
      if (!ids.length) continue;
      if (!byTarget.has(targetEntity)) byTarget.set(targetEntity, new Set());
      ids.forEach((id) => byTarget.get(targetEntity)!.add(id));
    }
    for (const [targetEntity, idSet] of byTarget) {
      const table = TABLE[targetEntity];
      idMap.set(targetEntity, await resolveRelationIds(table, [...idSet], branchId, env.key, env.url));
    }
  }

  const first = (targetEntity: EntityKey, ids: string[]): string | null => {
    const m = idMap.get(targetEntity);
    for (const id of ids) {
      const v = m?.get(id);
      if (v) return v;
    }
    return null;
  };
  const mapped = (targetEntity: EntityKey, ids: string[]): string[] => {
    const m = idMap.get(targetEntity);
    return ids.map((id) => m?.get(id)).filter((v): v is string => Boolean(v));
  };
  // 배치 마이그레이션과 달리 dual-write는 단건 처리라 unresolved/error를
  // 별도로 누적할 필요가 없다 — EXAM_PREP의 JSON 파싱 실패 같은 경우도
  // T() 자체가 이미 exam_data에 {_parse_error:true, raw}로 담아 정상 upsert
  // 되게 만들어져 있으므로, 여기서는 로그만 남기고 진행을 막지 않는다.
  const issue = (_s: string, kind: string, detail: string) => {
    console.warn("dual-write transform issue", { entity: entityKey, kind, detail });
  };
  const T = makeT({ first, mapped, issue }) as Record<string, (x: NotionPage) => Record<string, unknown>>;
  const transform = T[entityKey as string];
  const row = {
    notion_id: notionPage.id,
    branch_id: branchId,
    ...transform(notionPage),
    source_payload: payload(notionPage, entityKey as string),
  };
  await upsertRow(TABLE[entityKey], row, env);
}

/**
 * Notion write가 이미 끝난 뒤 호출한다. 실패해도 절대 throw하지 않는다 —
 * 최대 2회 시도 후에도 안 되면 dual_write_failures에 기록하고 조용히 끝낸다.
 */
export async function dualWriteEntity(entityKey: EntityKey, notionPage: NotionPage): Promise<void> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await dualWriteOnce(entityKey, notionPage);
      return;
    } catch (err) {
      if (attempt === 2) {
        await recordFailure(entityKey, notionPage?.id, err);
        // WRITE 정본이 Postgres인 배포(ACADEMY_DB_PROVIDER=postgres)에서는
        // Postgres에 실제로 반영되지 못한 write를 "성공"으로 사용자에게
        // 보여주면 안 된다 — Notion에는 이미 써졌더라도(정본이 아니라
        // 비상 백업이므로) 호출부에 실패를 알려 재시도/확인을 유도한다.
        // Notion write 자체를 되돌리지는 않는다(대부분 create이고, 보상
        // delete는 별도 위험을 만든다) — dual_write_failures에 남은 기록으로
        // reconciliation이 사후 처리한다.
        if (getDbProvider() === "postgres") {
          throw err instanceof Error ? err : new Error(String(err));
        }
        return;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}

/** Notion 쪽 delete/archive가 끝난 뒤 Supabase 미러 행도 지운다. 절대 throw하지 않는다. */
export async function dualDeleteEntity(entityKey: EntityKey, notionId: string): Promise<void> {
  try {
    const env = supabaseEnv();
    const branchId = await resolveBranchId();
    if (!env || !branchId) return;
    const r = await fetch(
      `${env.url}/rest/v1/${TABLE[entityKey]}?notion_id=eq.${encodeURIComponent(notionId)}&branch_id=eq.${branchId}`,
      { method: "DELETE", headers: { ...authHeaders(env.key), Prefer: "return=minimal" } },
    );
    if (!r.ok) throw new Error(`Supabase delete ${TABLE[entityKey]} failed (${r.status})`);
  } catch (err) {
    await recordFailure(`${entityKey}:delete`, notionId, err);
  }
}

// ---------------------------------------------------------------------------
// Postgres-primary write path (WRITE 정본 전환, PART 2 STEP 2).
//
// 위 dualWriteEntity/dualDeleteEntity는 "Notion을 먼저 쓰고 그 결과 페이지를
// Postgres에 미러링"하는 기존 경로용이다. 아래 primitive들은 반대 방향 —
// "Postgres를 먼저(그리고 유일하게 성공/실패를 가르는 기준으로) 쓰고, Notion은
// 그 이후에 best-effort로 미러링"하는 새 경로용이다. 이 경로를 쓰는 호출부는
// Notion이 완전히 죽어있어도(토큰 만료/장애) 정상 응답한다.
//
// 사용 패턴(각 write 함수에서):
//   if (getDbProvider() === "postgres") {
//     await pgPatchByNotionId("COUNSELING", id, { counselor, record_date, ... }); // 실패하면 throw — 이게 성공기준
//     fireAndForget("notion:updateCounselingEntry", () => notion.pages.update({...})); // 실패해도 응답에 영향 없음
//     return;
//   }
//   // 기존 Notion-first 경로 그대로 (provider가 아직 postgres가 아닌 배포 대비)
// ---------------------------------------------------------------------------

/** 실패해도 호출부를 막지 않는 백그라운드 작업. 실패는 로그로만 남긴다(Notion이 정본이 아니게 된 이후엔 재시도 큐가 없어도 된다 — 참고용 미러이기 때문). */
export function fireAndForget(label: string, fn: () => Promise<unknown>): void {
  fn().catch((err) => {
    console.error("postgres-primary: background Notion mirror failed", {
      label,
      message: err instanceof Error ? err.message : String(err),
    });
  });
}

async function requireEnvAndBranch(): Promise<{ env: { url: string; key: string }; branchId: string }> {
  const env = supabaseEnv();
  const branchId = await resolveBranchId();
  if (!env || !branchId) throw new Error("Postgres write requested but Supabase/branch is not configured.");
  return { env, branchId };
}

/** notion_id 또는 postgres id(uuid) 중 아무 쪽으로 넘어와도 안전하게 특정 행의 컬럼을 갱신한다. 정본 경로이므로 실패 시 throw한다. */
export async function pgPatchByNotionId(entityKey: EntityKey, notionId: string, patch: Record<string, unknown>): Promise<void> {
  const { env, branchId } = await requireEnvAndBranch();
  const r = await fetch(
    `${env.url}/rest/v1/${TABLE[entityKey]}?branch_id=eq.${branchId}&${eitherIdFilter(notionId)}`,
    { method: "PATCH", headers: { ...authHeaders(env.key), "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(patch) }
  );
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`Postgres patch ${entityKey} failed (${r.status}): ${body.slice(0, 300)}`);
  }
}

/** id(uuid)로 특정 행의 컬럼을 직접 갱신한다(아직 notion_id가 없는, Postgres에서 생성된 신규 행용). */
export async function pgPatchById(entityKey: EntityKey, id: string, patch: Record<string, unknown>): Promise<void> {
  const { env, branchId } = await requireEnvAndBranch();
  const r = await fetch(
    `${env.url}/rest/v1/${TABLE[entityKey]}?id=eq.${encodeURIComponent(id)}&branch_id=eq.${branchId}`,
    { method: "PATCH", headers: { ...authHeaders(env.key), "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(patch) }
  );
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`Postgres patch ${entityKey} failed (${r.status}): ${body.slice(0, 300)}`);
  }
}

/**
 * 새 행을 Postgres에 직접 만든다(Notion 없이). notion_id는 비워두고 반환된
 * id(uuid)를 호출부가 즉시 "id"로 쓸 수 있다 — 이후 Notion 미러가 성공하면
 * pgSetNotionId로 notion_id를 채워 넣는다(선택, 실패해도 기능엔 지장 없음).
 */
export async function pgInsertRow(entityKey: EntityKey, row: Record<string, unknown>): Promise<{ id: string; notion_id: string | null }> {
  const { env, branchId } = await requireEnvAndBranch();
  const r = await fetch(`${env.url}/rest/v1/${TABLE[entityKey]}`, {
    method: "POST",
    headers: { ...authHeaders(env.key), "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify([{ branch_id: branchId, notion_id: null, ...row }]),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`Postgres insert ${entityKey} failed (${r.status}): ${body.slice(0, 300)}`);
  }
  const rows = (await r.json()) as { id: string; notion_id: string | null }[];
  return rows[0];
}

/** Notion 미러 생성이 나중에 성공했을 때만 호출하는 best-effort 보강 — 실패해도 throw하지 않는다. */
export async function pgSetNotionId(entityKey: EntityKey, pgId: string, notionId: string): Promise<void> {
  try {
    await pgPatchById(entityKey, pgId, { notion_id: notionId });
  } catch (err) {
    console.error("postgres-primary: failed to backfill notion_id", { entityKey, pgId, message: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * notion_id(legacy) 또는 postgres id(uuid, 아직 Notion 미러가 안 끝난
 * postgres-primary 신규 행)를 다른 엔티티 테이블의 실제 Postgres id(uuid)로
 * 변환한다. 이미 postgres id라면 그대로 자기 자신이 반환된다(no-op 조회로
 * 존재 확인 겸용). 못 찾으면 null.
 */
export async function pgResolveRelationId(targetEntity: EntityKey, notionId: string | null | undefined): Promise<string | null> {
  if (!notionId) return null;
  const { env, branchId } = await requireEnvAndBranch();
  const map = await resolveRelationIds(TABLE[targetEntity], [notionId], branchId, env.key, env.url);
  return map.get(notionId) ?? null;
}

/** notion_id 또는 postgres id(uuid)로 행 하나를 통째로 읽는다(notion.pages.retrieve 대체용). 없으면 null. */
export async function pgGetByNotionId(entityKey: EntityKey, notionId: string): Promise<Record<string, unknown> | null> {
  const { env, branchId } = await requireEnvAndBranch();
  const r = await fetch(
    `${env.url}/rest/v1/${TABLE[entityKey]}?branch_id=eq.${branchId}&${eitherIdFilter(notionId)}&select=*`,
    { headers: authHeaders(env.key) }
  );
  if (!r.ok) throw new Error(`Postgres read ${entityKey} failed (${r.status})`);
  const rows = (await r.json()) as Record<string, unknown>[];
  return rows[0] ?? null;
}

/** 여러 컬럼을 정확히 일치(eq)로 조합해 찾는다 — Notion filter.and 조합 조회를 대체한다. */
export async function pgQuery(entityKey: EntityKey, filters: Record<string, string>): Promise<Record<string, unknown>[]> {
  const { env, branchId } = await requireEnvAndBranch();
  const qs = Object.entries(filters)
    .map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`)
    .join("&");
  const r = await fetch(`${env.url}/rest/v1/${TABLE[entityKey]}?branch_id=eq.${branchId}&${qs}&select=*`, {
    headers: authHeaders(env.key),
  });
  if (!r.ok) throw new Error(`Postgres read ${entityKey} failed (${r.status})`);
  return (await r.json()) as Record<string, unknown>[];
}

/** eq 외의 PostgREST 연산자(cs 배열포함 등)가 필요할 때 — filterExpr은 호출부가 이미 인코딩까지 끝낸 쿼리스트링 조각이어야 한다. */
export async function pgQueryRaw(entityKey: EntityKey, filterExpr: string): Promise<Record<string, unknown>[]> {
  const { env, branchId } = await requireEnvAndBranch();
  const r = await fetch(`${env.url}/rest/v1/${TABLE[entityKey]}?branch_id=eq.${branchId}&${filterExpr}&select=*`, {
    headers: authHeaders(env.key),
  });
  if (!r.ok) throw new Error(`Postgres read ${entityKey} failed (${r.status})`);
  return (await r.json()) as Record<string, unknown>[];
}

/** 컬럼 하나를 정확히 일치(대소문자 구분)로 찾는다 — 동명이인 dedup 체크용(findStudentByName 등). */
export async function pgFindByExactColumn(entityKey: EntityKey, column: string, value: string): Promise<Record<string, unknown> | null> {
  const { env, branchId } = await requireEnvAndBranch();
  const r = await fetch(
    `${env.url}/rest/v1/${TABLE[entityKey]}?${column}=eq.${encodeURIComponent(value)}&branch_id=eq.${branchId}&select=*&limit=1`,
    { headers: authHeaders(env.key) }
  );
  if (!r.ok) throw new Error(`Postgres read ${entityKey} failed (${r.status})`);
  const rows = (await r.json()) as Record<string, unknown>[];
  return rows[0] ?? null;
}

/**
 * "삭제"를 archive로 표현하는 기존 관행(payload().archived, notArchived() 필터,
 * supabasePgRead.ts 참고)과 동일하게, source_payload.archived=true를 병합한다.
 * 행을 실제로 지우지 않는 이유는 기존 Notion-first 경로가 이미 그렇게
 * 동작해왔고(archived page도 dualWriteEntity가 upsert), READ 쪽 필터가 이미
 * 그 규약을 전제하기 때문 — 규약을 이원화하지 않는다.
 */
export async function pgArchiveByNotionId(entityKey: EntityKey, notionId: string): Promise<void> {
  const { env, branchId } = await requireEnvAndBranch();
  const getRes = await fetch(
    `${env.url}/rest/v1/${TABLE[entityKey]}?branch_id=eq.${branchId}&${eitherIdFilter(notionId)}&select=source_payload`,
    { headers: authHeaders(env.key) }
  );
  if (!getRes.ok) throw new Error(`Postgres read ${entityKey} failed (${getRes.status})`);
  const rows = (await getRes.json()) as { source_payload: Record<string, unknown> | null }[];
  const merged = { ...(rows[0]?.source_payload ?? {}), archived: true };
  await pgPatchByNotionId(entityKey, notionId, { source_payload: merged });
}
