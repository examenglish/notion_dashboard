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

async function resolveRelationIds(table: string, notionIds: string[], branchId: string, key: string, url: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const ids = [...new Set(notionIds.filter(Boolean))];
  if (!ids.length) return map;
  const inList = ids.map((id) => encodeURIComponent(id)).join(",");
  const r = await fetch(`${url}/rest/v1/${table}?select=id,notion_id&notion_id=in.(${inList})&branch_id=eq.${branchId}`, {
    headers: authHeaders(key),
  });
  if (!r.ok) return map;
  const rows = (await r.json()) as { id: string; notion_id: string }[];
  for (const row of rows) map.set(row.notion_id, row.id);
  return map;
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
