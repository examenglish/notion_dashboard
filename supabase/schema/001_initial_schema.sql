-- 사직이그잼영어학원 Notion -> Supabase 초기 최소 스키마
-- 근거: docs/INVESTIGATION_NOTES.md. 실제 속성명/형식 확인 전에는 확장하지 않는다.
-- notion_id는 Notion page id 원문을 보존한다. 관계에서 파생된 행은 원본 page가 없으므로 NULL이다.

begin;

create extension if not exists pgcrypto;

create table staff (
  id uuid primary key default gen_random_uuid(),
  notion_id text unique,
  name text not null,
  role text,
  pin_hash text,
  must_change_password boolean not null default false,
  work_schedule text, work_days text[] not null default '{}',
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column staff.pin_hash is '평문 PIN은 적재하지 않는다. 해시 방식/인증 전환은 확인 필요.';

create table students (
  id uuid primary key default gen_random_uuid(),
  notion_id text unique,
  name text not null,
  school text,
  grade text,
  status text,
  phone text,
  guardian_phone text,
  enrolled_on date,
  attendance_started_on date,
  fee_day integer check (fee_day between 1 and 31),
  learning_level text,
  level_lv text,
  memo text,
  action text,
  action_assignee_text text,
  action_alarm_on date,
  class_notion_ids text[] not null default '{}',
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table classes (
  id uuid primary key default gen_random_uuid(),
  notion_id text unique,
  name text not null,
  time_text text,
  level text,
  category text,
  teachers text, day_teachers text, days text[] not null default '{}',
  student_notion_ids text[] not null default '{}', assistant_notion_ids text[] not null default '{}',
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table class_students (
  id uuid primary key default gen_random_uuid(),
  notion_id text unique,
  class_id uuid not null references classes(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (class_id, student_id)
);

create table class_staff (
  id uuid primary key default gen_random_uuid(),
  notion_id text unique,
  class_id uuid not null references classes(id) on delete cascade,
  staff_id uuid not null references staff(id) on delete restrict,
  assignment_role text not null check (assignment_role in ('teacher', 'assistant')),
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (class_id, staff_id, assignment_role)
);

create table class_schedules (
  id uuid primary key default gen_random_uuid(),
  notion_id text unique,
  class_id uuid not null references classes(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  period smallint not null check (period > 0),
  teacher_id uuid references staff(id) on delete restrict,
  time_text text,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (class_id, weekday, period)
);
comment on column class_schedules.weekday is 'ISO 요일: 1=월요일 ... 7=일요일.';

create table staff_work_schedules (
  id uuid primary key default gen_random_uuid(),
  notion_id text unique,
  staff_id uuid not null references staff(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  work_hours_text text,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (staff_id, weekday)
);

create table class_progress (
  id uuid primary key default gen_random_uuid(),
  notion_id text unique,
  class_id uuid references classes(id) on delete set null,
  record_date date,
  title text, class_notion_ids text[] not null default '{}', subjects text[] not null default '{}',
  progress_content text, homework_content text, next_test text, notice text, period text,
  student_records_created boolean, daily_record_notion_ids text[] not null default '{}',
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table daily_records (
  id uuid primary key default gen_random_uuid(),
  notion_id text unique,
  student_id uuid references students(id) on delete set null,
  record_date date,
  title text, student_notion_ids text[] not null default '{}', class_notion_ids text[] not null default '{}',
  progress_content text, attendance text, homework_done boolean, vocab_result text,
  class_progress_notion_ids text[] not null default '{}', note text, achievement text,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table exam_scores (
  id uuid primary key default gen_random_uuid(),
  notion_id text unique,
  student_id uuid references students(id) on delete set null,
  exam_date date,
  score numeric,
  subject text,
  exam_name text,
  title text, student_notion_ids text[] not null default '{}',
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table briefings (
  id uuid primary key default gen_random_uuid(),
  notion_id text unique,
  student_id uuid references students(id) on delete set null,
  title text,
  record_date date,
  briefing_type text,
  content text,
  student_notion_ids text[] not null default '{}',
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table counseling_entries (
  id uuid primary key default gen_random_uuid(), notion_id text unique,
  student_id uuid references students(id) on delete set null, title text, record_date date,
  counselor text, transcript text, content text, follow_up text, entered_by text,
  student_notion_ids text[] not null default '{}',
  source_payload jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table admin_inbox_entries (
  id uuid primary key default gen_random_uuid(), notion_id text unique,
  student_id uuid references students(id) on delete set null, title text, input_type text,
  start_date date, end_date date, content text, complete boolean, entered_by text, owner_text text,
  student_notion_ids text[] not null default '{}',
  source_payload jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table clinic_records (
  id uuid primary key default gen_random_uuid(), notion_id text unique, title text,
  assistant_id uuid references staff(id) on delete set null,
  student_ids uuid[] not null default '{}', teacher_id uuid references staff(id) on delete set null,
  task_id uuid, record_date date, content text, next_preparation text, confirmed boolean,
  assistant_notion_ids text[] not null default '{}', student_notion_ids text[] not null default '{}',
  teacher_notion_ids text[] not null default '{}', task_notion_ids text[] not null default '{}',
  source_payload jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
comment on column clinic_records.task_id is 'TODO 관련업무 FK. 테이블 생성 순환 때문에 tasks 생성 뒤 제약을 추가한다.';

create table material_tasks (
  id uuid primary key default gen_random_uuid(), notion_id text unique, title text,
  requester_id uuid references staff(id) on delete set null, owner_id uuid references staff(id) on delete set null,
  content text, progress numeric, status text, due_date date, file_location text,
  original_files jsonb not null default '[]'::jsonb,
  requester_notion_ids text[] not null default '{}', owner_notion_ids text[] not null default '{}',
  source_payload jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  notion_id text unique,
  staff_id uuid references staff(id) on delete set null,
  title text,
  due_date date,
  type text, staff_notion_ids text[] not null default '{}', student_notion_ids text[] not null default '{}',
  class_notion_ids text[] not null default '{}', time_text text, memo text, complete boolean,
  priority text, clinic_report_notion_ids text[] not null default '{}', absence_lesson text,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column tasks.memo is 'Notion TODO.메모의 정본. 중복 content 컬럼은 두지 않는다.';
comment on column tasks.complete is 'Notion TODO.완료여부의 정본. 중복 status/is_complete 컬럼은 두지 않는다.';

create table exam_preps (
  id uuid primary key default gen_random_uuid(),
  notion_id text unique,
  student_id uuid references students(id) on delete set null,
  exam_title text,
  teachers text,
  progress numeric,
  weak_points text,
  school_level text,
  exam_data jsonb,
  title text, student_notion_ids text[] not null default '{}', updated_on date,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column exam_preps.updated_on is 'Notion 갱신일은 date이며 이 컬럼 하나로 보존한다.';

create table school_exam_ranges (
  id uuid primary key default gen_random_uuid(),
  notion_id text unique,
  title text, school text, grade text, exam_title text, exam_range text,
  exam_start date, exam_end date, textbook_name text, textbook_units text,
  supplementary_name text, supplementary_units text, mock_name text, mock_units text,
  print_name text, print_units text, updated_on date,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table slack_records (
  id uuid primary key default gen_random_uuid(),
  notion_id text unique,
  student_id uuid references students(id) on delete set null,
  title text, student_notion_ids text[] not null default '{}', written_at timestamptz,
  original text, author text, permalink text, status text, link_status text,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table clinic_records add constraint clinic_records_task_id_fkey
  foreign key (task_id) references tasks(id) on delete set null;

create index class_students_student_idx on class_students(student_id);
create index briefings_student_date_idx on briefings(student_id, record_date desc);
create index counseling_student_date_idx on counseling_entries(student_id, record_date desc);
create index clinic_date_idx on clinic_records(record_date desc);
create index daily_records_student_date_idx on daily_records(student_id, record_date desc);
create index exam_scores_student_date_idx on exam_scores(student_id, exam_date desc);
create index tasks_staff_due_idx on tasks(staff_id, due_date);

-- RLS 골격: 이번 단계에는 의도적으로 활성화하지 않는다. API 인증/RBAC와 서비스 역할
-- 사용 범위를 확정한 뒤 ALTER TABLE ... ENABLE ROW LEVEL SECURITY 및 정책을 추가한다.
-- 공개 클라이언트에 테이블 권한을 부여하지 않는 것이 현재 전제이며 실제 권한은 확인 필요.
-- alter table students enable row level security;
-- create policy ...;

commit;

-- 가정(assumption)
-- 1. Notion 페이지 ID는 데이터소스 간 전역적으로 유일하며 원문 문자열로 보존한다.
-- 2. 관계 파생 테이블의 notion_id는 대응 원본 페이지가 없어 NULL을 허용한다.
--
-- 확인 필요(open question)
-- 1. 15개 데이터소스의 정확한 속성명, 타입, 필수 여부 및 relation 방향.
-- 2. 담당교사 문자열과 STAFF 페이지를 연결하는 안정적인 규칙, 시간 문자열 형식.
-- 3. PIN 해시/인증 방식, RLS 역할 모델, 삭제 보존 정책.
