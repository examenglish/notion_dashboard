-- EXAM AI 파일 인덱스(file_archives) — Slack에 올라온 파일(및 향후 Drive backfill)의
-- 메타데이터 정본. 파일 원본(binary)은 Google Drive에만 있고 여기엔 Drive file id/URL만 둔다.
-- 사직/금정은 같은 Supabase 프로젝트를 branch_id로 격리해 쓰므로 한 번만 실행한다.
--
-- visibility: 'branch'(해당 지점만 검색, 기본값) | 'shared'(사직·금정 모두 검색).
-- 자동 분류로 shared가 되지 않는다 — 명시적 공유만(향후 기능).
-- 서버는 service_role 키로만 접근한다(RLS 우회). RLS를 켜고 정책을 두지 않아
-- anon/authenticated 키의 직접 접근은 막는다.

begin;

create table file_archives (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id),
  visibility text not null default 'branch' check (visibility in ('branch', 'shared')),
  -- slack | drive_backfill
  source text not null check (source in ('slack', 'drive_backfill')),
  slack_team_id text,
  slack_channel_id text,
  slack_message_ts text,
  slack_thread_ts text,
  slack_file_id text,
  slack_user_id text,
  uploader_name text,
  -- 업로더가 EXAM AI 직원으로 연결되면 staff id(notion_id 또는 pg id). 없으면 null.
  uploader_staff_id text,
  message_text text,
  original_filename text not null,
  mime_type text,
  file_size bigint,
  drive_file_id text not null,
  drive_url text not null,
  drive_folder_id text,
  -- 관련 업무(tasks.id). 향후 Slack 업무 알림 thread에 올라온 결과물 연결용.
  related_task_id uuid references tasks(id) on delete set null,
  -- 향후 AI 분류(학교/학년/학기/시험/자료유형/과목/태그). 확신 없으면 비워둔다.
  classification jsonb not null default '{}'::jsonb,
  uploaded_at timestamptz,
  archived_at timestamptz not null default now(),
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table file_archives is 'EXAM AI 파일 인덱스. 원본은 Google Drive, 여기엔 메타데이터만. visibility 기본 branch.';

-- 같은 Slack 파일은 지점당 1행(Slack 이벤트 재전송·n8n 재시도 중복 방지).
create unique index file_archives_branch_slack_file_key
  on file_archives (branch_id, source, slack_team_id, slack_file_id)
  where slack_file_id is not null;
-- 같은 Drive 파일은 지점당 1행(backfill 재실행·재등록 중복 방지).
create unique index file_archives_branch_drive_file_key on file_archives (branch_id, drive_file_id);
create index file_archives_branch_uploaded_idx on file_archives (branch_id, uploaded_at desc);
create index file_archives_shared_uploaded_idx on file_archives (uploaded_at desc) where visibility = 'shared';

alter table file_archives enable row level security;

commit;
