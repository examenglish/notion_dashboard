// 세션 유효성(직원 활성 여부) 확인 — middleware(Edge)와 서버 컴포넌트(getSession) 공용.
// HMAC 서명 쿠키 구조는 그대로 두고, 요청마다 staff 행을 Supabase REST로 한 번 읽어
//  - 비활성(resigned) 직원이면 거부
//  - staff.source_payload.auth.sessionsValidAfter(비활성화/재활성화/비밀번호 재설정 시각)보다
//    먼저 발급된 쿠키면 거부(재활성화해도 옛 쿠키는 되살아나지 않고 새로 로그인해야 함)
// 새 컬럼 없이 기존 source_payload(jsonb)를 쓴다. Edge에서도 돌도록 fetch/Web API만 쓴다.

export type SessionCheck = "ok" | "inactive" | "error";

let cachedBranch: { code: string; id: string } | null = null;

async function branchIdFor(url: string, key: string, code: string): Promise<string | null> {
  if (cachedBranch?.code === code) return cachedBranch.id;
  const r = await fetch(`${url}/rest/v1/branches?code=eq.${encodeURIComponent(code)}&select=id&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`branch lookup ${r.status}`);
  const rows = (await r.json()) as { id: string }[];
  if (!rows[0]) return null;
  cachedBranch = { code, id: rows[0].id };
  return rows[0].id;
}

export async function checkSessionActive(session: { staffId: string; issuedAt: number }): Promise<SessionCheck> {
  // Postgres가 정본이 아닌 환경(로컬/Notion 모드)은 기존 동작 그대로.
  if (process.env.ACADEMY_DB_PROVIDER !== "postgres") return "ok";
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const code = process.env.ACADEMY_BRANCH_ID ?? process.env.MIGRATION_BRANCH_CODE;
  if (!url || !key || !code) return "ok";
  try {
    const branchId = await branchIdFor(url, key, code);
    if (!branchId) return "inactive";
    const id = encodeURIComponent(session.staffId);
    const r = await fetch(
      `${url}/rest/v1/staff?branch_id=eq.${branchId}&or=(notion_id.eq.${id},id.eq.${id})` +
        `&select=resigned,valid_after:source_payload->auth->>sessionsValidAfter&limit=1`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: "no-store" }
    );
    if (!r.ok) return "error";
    const rows = (await r.json()) as { resigned?: boolean; valid_after?: string | null; source_payload?: { auth?: { sessionsValidAfter?: number | string } } }[];
    const row = rows[0];
    // 현재 지점에 없는 직원(삭제/다른 지점)의 쿠키는 쓸 수 없다.
    if (!row || row.resigned) return "inactive";
    const validAfter = Number(row.valid_after ?? row.source_payload?.auth?.sessionsValidAfter ?? 0);
    if (validAfter && !(session.issuedAt >= validAfter)) return "inactive";
    return "ok";
  } catch {
    return "error";
  }
}
