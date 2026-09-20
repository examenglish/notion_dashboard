# Drift 분석 — 원본 감사(56ac054) 대비 현재 academy-webapp

> **2026-09-18 업데이트**: 아래 B/C 항목은 Phase 1 작업으로 `schema/001_initial_schema.sql`과 `scripts/migrate_notion_to_supabase.mjs`에 반영 완료됨(fixture dry-run 재검증 통과). 이 문서는 조사 근거 기록으로 그대로 남겨둔다.

원본 `REAL_SCHEMA_AUDIT.md`/`SCHEMA_DESIGN.md`/`schema/001_initial_schema.sql`/`scripts/migrate_notion_to_supabase.mjs`는 당시 `lib/notion.ts`(3873행) 스냅샷 기준이다. 현재 이 저장소의 `lib/notion.ts`는 4414행이다. 아래는 코드 기준(파일:라인) 재조사 결과다. 이 문서는 실제 Notion/Supabase에 아무것도 실행하지 않고, 다음 단계(Phase 1: schema/script 갱신)를 위한 입력이다.

## A. 그대로 지원됨 (수정 불필요)

CLASS, STUDENT, CLASS_PROGRESS, DAILY_RECORD, BRIEFING, EXAM_SCORE, COUNSELING, ADMIN_INBOX, CLINIC, MATERIAL, EXAM_PREP, SCHOOL_EXAM_RANGE, SLACK_RECORDS — 13개 데이터소스는 property 목록이 감사 시점과 동일하다(현재 코드의 모든 읽기/쓰기 property 문자열이 `REAL_SCHEMA_AUDIT.md`의 표와 1:1로 일치, 신규 property 없음). `schema/001_initial_schema.sql`과 `scripts/migrate_notion_to_supabase.mjs`를 그대로 사용할 수 있다.

EXAM_PREP의 `시험범위`/`시험일` write-only 필드는 여전히 코드에 남아 있지만(`lib/notion.ts:3200,3209`), SCHOOL_EXAM_RANGE가 정본이라는 원본 감사의 판단이 현재도 유효하다(수정 불필요).

반별 명단 출력(`components/ClassRosterPrintModal.tsx`, 2026-09-18 신규)은 기존 `GET /api/students?classId=` 읽기 경로만 재사용하는 UI 전용 기능이라 스키마 영향 없음.

## B. 기존 migration 수정 필요 (컬럼/변환 로직 추가, 테이블 신설 아님)

### TODO → `tasks` 테이블

신규 property 5개, 근거 `lib/notion.ts:3976-3980`(읽기), `4083`(업무풀 필터), `4092-4111`(생성 body), `4151`(상위업무 relation 필터), `4166`(원장확인 필터):

| Notion property | 타입 | 제안 컬럼 | 비고 |
|---|---|---|---|
| 결과값 | rich_text | `outcome text` | 업무 완료 결과 텍스트 |
| 긴급여부 | checkbox | `urgent boolean` | |
| 원장확인 | checkbox | `director_ack boolean` | 원장 확인 여부 |
| 업무풀 | checkbox | `pool boolean` | 담당자 미지정 공용 업무 여부 |
| 상위업무 | relation → TODO(self) | `parent_task_id uuid references tasks(id)` | self-relation, notion ID 배열은 `parent_task_notion_ids text[]`로 보존 |

`lib/tasks.ts`의 `TaskType` 신규 라벨(암기확인/숙제확인/단어재시/재시험/출력/전달/자료수집/학부모연락/보충지도/시험범위확인/자료준비/업무상담/기타업무)은 스키마 변경이 필요 없다 — `type`은 이미 `text` 컬럼이고 select 값만 늘어난 것이다.

### STAFF → `staff` 테이블

신규 property 1개, 근거 `lib/notion.ts:217`(읽기), `270-273`(`setStaffResigned`):

| Notion property | 타입 | 제안 컬럼 | 비고 |
|---|---|---|---|
| 퇴사 | checkbox | `resigned boolean not null default false` | 퇴사자는 로그인/신규 배정에서 제외되지만 과거 relation(CLINIC 등) 조회를 위해 페이지를 삭제하지 않음 — Postgres에서도 행을 삭제하지 말고 이 플래그로 필터링해야 함 |

## C. 신규 schema/table/column/relation 필요

### MANUAL, MANUAL_STEP (화면녹화 AI 매뉴얼 기능 전체가 감사 이후 신규)

근거: `lib/notion.ts:82-83`(env, optional), `4219-4225`(`requireManualDb`/`requireManualStepDb`), `4243-4253`(`mapManualPage`), `4327-4339`(`mapManualStepPage`), `4361`(순서 정렬).

```sql
create table manuals (
  id uuid primary key default gen_random_uuid(),
  notion_id text unique,
  title text not null,
  category text,
  target_roles text[] not null default '{}',
  status text, -- DRAFT | REVIEW | PUBLISHED
  video_url text, -- 실제 영상 바이너리는 Vercel Blob에 있고 Notion/Supabase엔 URL만
  summary text,
  author text,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table manual_steps (
  id uuid primary key default gen_random_uuid(),
  notion_id text unique,
  manual_id uuid references manuals(id) on delete cascade,
  manual_notion_id text,
  step_order integer not null,
  description text,
  screenshot_url text,
  video_timestamp text,
  caution text,
  related_path text, -- 앱 내 라우트 경로 (ManualHelpLink 연결용)
  keywords text,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index manual_steps_manual_order_idx on manual_steps(manual_id, step_order);
```

`scripts/migrate_notion_to_supabase.mjs`에는 `SOURCES`에 `['MANUAL','NOTION_DB_MANUAL']`, `['MANUAL_STEP','NOTION_DB_MANUAL_STEP']` 추가, `TABLE` 매핑 추가, `T[]`에 두 변환 함수 추가, `targets`에 `MANUAL_STEP:{'매뉴얼':'MANUAL'}` relation 해석 추가가 필요하다. env var가 optional이므로(`requireManualDb` 패턴) 스크립트도 두 DB ID가 없으면 건너뛰도록 예외 처리해야 한다(현재 스크립트는 SOURCES의 모든 env var가 없으면 즉시 에러를 던지므로 이 부분 수정 필요 — Phase 1 작업 항목).

## D. 더 이상 사용되지 않아 제거 가능

없음. 원본 스키마/스크립트에서 이미 사용하지 않는 컬럼(TODO의 옛 `content`/`status`/`is_complete`, EXAM_PREP의 `updated_at_notion`)은 최초 설계 때부터 제외되어 있었고, 현재 코드도 동일한 판단을 뒤집지 않는다.

## 참고: 기능 → 파일 → DB 매핑 요약

| 기능 | 대표 파일 | DB | 신규 여부 |
|---|---|---|---|
| 자연어 업무 입력 | `lib/nl-input.ts`, `components/AiUnifiedInput.tsx`, `app/api/ai-input/route.ts` | ADMIN_INBOX, TODO, COUNSELING, STUDENT | 감사 이후 신규(스키마 영향 없음, 기존 DB 재사용) |
| 업무 배정/상황판/피드백 | `lib/tasks.ts`, `lib/task-routing.ts`, `app/director/tasks/*` | TODO(신규 5개 property) | 위 B 참고 |
| AI 업무 운영("이그잼 AI") | `app/director/page.tsx`, `components/director/DirectorTopbar.tsx` | nl-input 파이프라인 재사용 | 신규 UI, 스키마 영향 없음 |
| 화면 녹화 AI 매뉴얼 | `lib/notion.ts:4213-4414`, `app/api/manuals/*` | MANUAL, MANUAL_STEP(신규) | 위 C 참고 |
| 반별 명단 출력 | `components/ClassRosterPrintModal.tsx` | STUDENT(기존 경로 재사용) | 스키마 영향 없음 |

API 라우트 수: 감사 시점 57개 → 현재 72개(+15). 전수 확인 결과 모든 라우트가 `lib/notion.ts`를 통해서만 Notion에 접근하며, `@notionhq/client`를 직접 호출하는 라우트는 없다(원본 감사의 가정이 현재도 유효).
