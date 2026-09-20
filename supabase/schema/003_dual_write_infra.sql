-- dual-write 운영 인프라. Notion -> Supabase 실시간 dual-write에서 Supabase
-- 쪽 write가 실패했을 때(네트워크 오류, 일시적 제약 위반 등) 사용자 응답을
-- 막지 않고 대신 여기에 기록해, reconciliation 스크립트가 나중에 재시도/
-- 검토할 수 있게 한다. Notion 쪽 write는 이 테이블과 무관하게 이미 완료된
-- 상태다 — 즉 이 테이블에 쌓이는 건 "Notion에는 있는데 Supabase 미러링만
-- 아직 못 한" 항목이지 데이터 유실이 아니다.

begin;

create table dual_write_failures (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id),
  entity text not null,
  notion_id text,
  error text not null,
  attempts integer not null default 1,
  resolved boolean not null default false,
  created_at timestamptz not null default now(),
  last_attempted_at timestamptz not null default now()
);
create index dual_write_failures_unresolved_idx on dual_write_failures(branch_id, resolved) where not resolved;

commit;
