-- 사직/금정 두 지점이 하나의 Supabase 프로젝트를 공유하되 branch_id로 데이터를
-- 격리하는 멀티지점 구조. 001_initial_schema.sql 적용 직후, 데이터 이전 전에 적용한다.
-- 근거: 두 지점은 서로 다른 Notion 워크스페이스(별도 NOTION_TOKEN/DB ID)를 쓰므로
-- Notion page id 자체의 충돌 가능성은 사실상 없지만(Notion UUID는 전역 유일),
-- 스키마 차원에서도 branch_id로 명시적으로 격리해 앱 버그로 인한 교차 조회/FK
-- 오염을 DB 제약으로 막는다.

begin;

create table branches (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);
comment on column branches.code is '앱 env ACADEMY_BRANCH_ID 값과 1:1 대응. 예: sajik, geumjeong.';

insert into branches (code, name) values ('sajik', '사직'), ('geumjeong', '금정');

-- 17개 source 대응 테이블 + 4개 파생 테이블 + manuals/manual_steps 전부에 branch_id 추가.
alter table staff add column branch_id uuid references branches(id);
alter table students add column branch_id uuid references branches(id);
alter table classes add column branch_id uuid references branches(id);
alter table class_students add column branch_id uuid references branches(id);
alter table class_staff add column branch_id uuid references branches(id);
alter table class_schedules add column branch_id uuid references branches(id);
alter table staff_work_schedules add column branch_id uuid references branches(id);
alter table class_progress add column branch_id uuid references branches(id);
alter table daily_records add column branch_id uuid references branches(id);
alter table exam_scores add column branch_id uuid references branches(id);
alter table briefings add column branch_id uuid references branches(id);
alter table counseling_entries add column branch_id uuid references branches(id);
alter table admin_inbox_entries add column branch_id uuid references branches(id);
alter table clinic_records add column branch_id uuid references branches(id);
alter table material_tasks add column branch_id uuid references branches(id);
alter table tasks add column branch_id uuid references branches(id);
alter table exam_preps add column branch_id uuid references branches(id);
alter table school_exam_ranges add column branch_id uuid references branches(id);
alter table slack_records add column branch_id uuid references branches(id);
alter table manuals add column branch_id uuid references branches(id);
alter table manual_steps add column branch_id uuid references branches(id);

-- 테이블이 비어 있는 시점(migration 실행 전)에 적용하므로 not null로 바로 확정한다.
alter table staff alter column branch_id set not null;
alter table students alter column branch_id set not null;
alter table classes alter column branch_id set not null;
alter table class_students alter column branch_id set not null;
alter table class_staff alter column branch_id set not null;
alter table class_schedules alter column branch_id set not null;
alter table staff_work_schedules alter column branch_id set not null;
alter table class_progress alter column branch_id set not null;
alter table daily_records alter column branch_id set not null;
alter table exam_scores alter column branch_id set not null;
alter table briefings alter column branch_id set not null;
alter table counseling_entries alter column branch_id set not null;
alter table admin_inbox_entries alter column branch_id set not null;
alter table clinic_records alter column branch_id set not null;
alter table material_tasks alter column branch_id set not null;
alter table tasks alter column branch_id set not null;
alter table exam_preps alter column branch_id set not null;
alter table school_exam_ranges alter column branch_id set not null;
alter table slack_records alter column branch_id set not null;
alter table manuals alter column branch_id set not null;
alter table manual_steps alter column branch_id set not null;

-- 전역 unique(notion_id) -> 지점별 복합 unique(branch_id, notion_id)로 교체.
alter table staff drop constraint staff_notion_id_key, add constraint staff_branch_notion_id_key unique(branch_id, notion_id);
alter table students drop constraint students_notion_id_key, add constraint students_branch_notion_id_key unique(branch_id, notion_id);
alter table classes drop constraint classes_notion_id_key, add constraint classes_branch_notion_id_key unique(branch_id, notion_id);
alter table class_students drop constraint class_students_notion_id_key, add constraint class_students_branch_notion_id_key unique(branch_id, notion_id);
alter table class_staff drop constraint class_staff_notion_id_key, add constraint class_staff_branch_notion_id_key unique(branch_id, notion_id);
alter table class_schedules drop constraint class_schedules_notion_id_key, add constraint class_schedules_branch_notion_id_key unique(branch_id, notion_id);
alter table staff_work_schedules drop constraint staff_work_schedules_notion_id_key, add constraint staff_work_schedules_branch_notion_id_key unique(branch_id, notion_id);
alter table class_progress drop constraint class_progress_notion_id_key, add constraint class_progress_branch_notion_id_key unique(branch_id, notion_id);
alter table daily_records drop constraint daily_records_notion_id_key, add constraint daily_records_branch_notion_id_key unique(branch_id, notion_id);
alter table exam_scores drop constraint exam_scores_notion_id_key, add constraint exam_scores_branch_notion_id_key unique(branch_id, notion_id);
alter table briefings drop constraint briefings_notion_id_key, add constraint briefings_branch_notion_id_key unique(branch_id, notion_id);
alter table counseling_entries drop constraint counseling_entries_notion_id_key, add constraint counseling_entries_branch_notion_id_key unique(branch_id, notion_id);
alter table admin_inbox_entries drop constraint admin_inbox_entries_notion_id_key, add constraint admin_inbox_entries_branch_notion_id_key unique(branch_id, notion_id);
alter table clinic_records drop constraint clinic_records_notion_id_key, add constraint clinic_records_branch_notion_id_key unique(branch_id, notion_id);
alter table material_tasks drop constraint material_tasks_notion_id_key, add constraint material_tasks_branch_notion_id_key unique(branch_id, notion_id);
alter table tasks drop constraint tasks_notion_id_key, add constraint tasks_branch_notion_id_key unique(branch_id, notion_id);
alter table exam_preps drop constraint exam_preps_notion_id_key, add constraint exam_preps_branch_notion_id_key unique(branch_id, notion_id);
alter table school_exam_ranges drop constraint school_exam_ranges_notion_id_key, add constraint school_exam_ranges_branch_notion_id_key unique(branch_id, notion_id);
alter table slack_records drop constraint slack_records_notion_id_key, add constraint slack_records_branch_notion_id_key unique(branch_id, notion_id);
alter table manuals drop constraint manuals_notion_id_key, add constraint manuals_branch_notion_id_key unique(branch_id, notion_id);
alter table manual_steps drop constraint manual_steps_notion_id_key, add constraint manual_steps_branch_notion_id_key unique(branch_id, notion_id);

create index staff_branch_idx on staff(branch_id);
create index students_branch_idx on students(branch_id);
create index classes_branch_idx on classes(branch_id);
create index tasks_branch_idx on tasks(branch_id);
create index daily_records_branch_idx on daily_records(branch_id, record_date desc);
create index briefings_branch_idx on briefings(branch_id, record_date desc);
create index counseling_branch_idx on counseling_entries(branch_id, record_date desc);
create index manuals_branch_idx on manuals(branch_id);

commit;
