-- EXAM AI 학생별 학습 기록(시험/단어시험/과제/암기/재시험/태도/보강/후속확인/메모)
-- 누적 저장소. 기존 daily_records(교사 수업기록 = 출결·과제여부·단어결과, 대시보드
-- 통계의 원천)와 exam_scores(학교시험 = "직전 학교시험 점수")의 의미를 바꾸지 않기
-- 위해 별도 테이블로 둔다 — EXAM AI 기록이 출결/과제 통계를 오염시키지 않는다.
--
-- 사직/금정은 같은 Supabase 프로젝트를 branch_id로 격리해 쓰므로 한 번만 실행한다.
-- 서버는 service_role 키로만 접근한다(RLS 우회). RLS를 켜고 정책을 두지 않아
-- anon/authenticated 키의 직접 접근은 막는다.

begin;

create table student_learning_records (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id),
  -- 학생/반은 다른 테이블과 같은 dual-id 규약: 네이티브 FK + (notion_id 또는 pg id) 배열.
  student_id uuid references students(id) on delete set null,
  student_notion_ids text[] not null default '{}',
  class_id uuid references classes(id) on delete set null,
  class_notion_ids text[] not null default '{}',
  class_progress_id uuid references class_progress(id) on delete set null,
  record_date date not null,
  period text,
  -- assessment(시험) | vocab(단어시험) | homework(과제) | memorization(암기)
  -- | retest(재시험 결과) | attitude(태도/특이사항) | makeup(보강 필요)
  -- | followup(추가 확인 필요) | memo(일반 메모)
  record_type text not null check (record_type in ('assessment','vocab','homework','memorization','retest','attitude','makeup','followup','memo')),
  assessment_name text,
  score numeric,
  max_score numeric,
  passed boolean,
  retest_required boolean,
  -- 과제/암기/재시험 완료 여부(해당 없으면 null)
  completed boolean,
  note text,
  follow_up text,
  -- 행동 지시로 생성된 후속 업무. tasks.source_payload.workflow.sourceRecordId로 역방향 연결.
  task_id uuid references tasks(id) on delete set null,
  entered_by text,
  raw_text text,
  -- 같은 입력 재전송 중복 방지 키(날짜·교시·학생·유형·시험명·점수·원문 기준, 앱이 계산).
  input_hash text,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table student_learning_records is 'EXAM AI 학생별 학습 기록 누적. daily_records/exam_scores와 별개(통계 오염 방지).';
comment on column student_learning_records.input_hash is '재전송 중복 방지 키. branch 내 유일.';

create index student_learning_records_branch_date_idx on student_learning_records (branch_id, record_date);
create index student_learning_records_branch_student_date_idx on student_learning_records (branch_id, student_id, record_date);
create index student_learning_records_branch_class_date_idx on student_learning_records (branch_id, class_id, record_date);
create index student_learning_records_open_retest_idx on student_learning_records (branch_id, record_date) where retest_required is true;
create unique index student_learning_records_branch_input_hash_key on student_learning_records (branch_id, input_hash) where input_hash is not null;

alter table student_learning_records enable row level security;

commit;
