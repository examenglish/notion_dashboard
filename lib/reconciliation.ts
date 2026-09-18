// Notion(정본) <-> Supabase(미러) 실시간 대조 도구. dual-write(lib/supabaseRepo.ts)가
// 계속 정상 동작하는지 운영 중에 주기적으로 확인하고, 실패 큐(dual_write_failures)를
// 재처리하는 영구 운영 도구다 — 마이그레이션 1회성 러너와 달리 계속 남아있는다.
import { notion, DB } from "./notion";
import { SOURCES, OPTIONAL_SOURCES, TABLE, makeT, payload, rel } from "@/supabase/scripts/migrate_notion_to_supabase.mjs";
import { dualWriteEntity, branchCode } from "./supabaseRepo";

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
    sources.push(await reconcileSource(env, branchId, entity, dbId));
  }
  return { branch, branchId, sources };
}

/** dual_write_failures 큐에서 아직 안 풀린 항목들을 다시 시도한다. */
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
