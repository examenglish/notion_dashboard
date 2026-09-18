# Supabase 초기 스키마 설계

## 범위와 원칙

이 설계는 `INVESTIGATION_NOTES.md`에서 코드가 실제 참조한다고 확인된 15개 Notion 데이터소스를 기준으로 한다. 아직 자격증명과 실제 데이터베이스 속성 정의를 확인하지 않았으므로, 확인된 필드만 명시 컬럼으로 만들고 나머지는 `source_payload JSONB`에 원형 보존한다. 단, STAFF의 평문 PIN은 payload에서도 제외한다. JSONB는 영구 도메인 모델이 아니라 COPY의 무손실성과 후속 매핑 확인을 위한 안전망이다.

| Notion 데이터소스 | 대상 테이블 |
|---|---|
| CLASS | `classes`, 관계 파생 `class_students`, `class_staff`, `class_schedules` |
| STUDENT | `students` |
| CLASS_PROGRESS | `class_progress` |
| DAILY_RECORD | `daily_records` |
| BRIEFING | `briefings` |
| EXAM_SCORE | `exam_scores` |
| COUNSELING | `counseling_entries` |
| ADMIN_INBOX | `admin_inbox_entries` |
| TODO | `tasks` |
| STAFF | `staff`, 파생 `staff_work_schedules` |
| CLINIC | `clinic_records` |
| MATERIAL | `material_tasks` |
| EXAM_PREP | `exam_preps` |
| SCHOOL_EXAM_RANGE | `school_exam_ranges` |
| SLACK_RECORDS | `slack_records` |

CLASS의 `소속학생` relation을 `class_students` 다대다 관계의 정본으로 사용하고, STUDENT의 역방향 `소속반`도 notion ID 배열로 보존·검증한다. 반의 담당조교 relation은 `class_staff`에 역할과 함께 저장한다. 담당교사 문자열은 STAFF와 연결되는 경우 `class_staff` 및 요일별 `class_schedules.teacher_id`로 정규화한다. 연결에 실패한 원문은 `source_payload`에 남겨 데이터 유실을 막는다.

`CLASS_PROGRESS`, `DAILY_RECORD`, `SCHOOL_EXAM_RANGE`, `SLACK_RECORDS`는 조사 노트에 상세 속성이 없으므로 최소 FK와 원문 payload만 둔다. `EXAM_PREP`은 확인된 일반 속성과 `데이터` JSON을 명시 컬럼으로 옮긴다. 나머지 구체 컬럼 확장은 실제 Notion 스키마를 읽기 전에는 확인 필요다.

실제 적재는 기존 Supabase 행의 `notion_id → UUID`를 먼저 조회하고 신규 UUID를 선할당한 뒤 FK를 채운다. fixture dry-run도 결정적 UUID 메모리 맵으로 같은 경로를 실행한다. `갱신일`은 `exam_preps.updated_on date`로만 보존하며, TODO는 실제 필드에 대응하는 `memo/complete`만 사용해 중복 컬럼을 두지 않는다.

## 직렬화 rich_text 판단

- `담당교사`: 이름의 콤마 구분 문자열은 질의 및 참조 무결성에 부적합하므로 최종적으로 `class_staff`로 정규화한다. 동명이인과 철자 차이를 자동 추정하지 않고, 유일하게 일치할 때만 STAFF FK를 만든다. 원문도 payload에 보존한다.
- `요일별담당교사`: 요일×교시별 교사 배정은 `class_schedules(weekday, period, teacher_id)`로 정규화한다. 요일·교시별 조회와 교사 변경이 원자적으로 가능해진다.
- CLASS의 `요일`과 `시간`: 요일은 스케줄 행으로 만든다. 조사 노트로는 시간의 요일별 구조가 확인되지 않아 `time_text`를 그대로 보존하며, 시작/종료 시각 분리는 확인 후 수행한다.
- STAFF의 `근무시간표`: `staff_work_schedules`의 요일별 행으로 정규화하되, 개별 값은 형식이 확인되지 않아 `work_hours_text`로 보존한다.

즉, 관계와 반복 구조는 정규화하지만 아직 형식이 불명확한 시간 값은 문자열을 유지한다. 기존 파서와 실제 표본으로 형식을 확정한 뒤 `time`/기간 컬럼으로 바꿀 수 있다.

## 로그, 할 일, 보안

학생 중심 로그 5종은 공통 필드가 겹치므로 `activities`와 enum discriminator로 합친다. 유형별 속성은 `extra`, 원본 전체는 `source_payload`에 둔다. 개인 할 일은 수명주기와 소유자가 다르므로 `tasks`로 분리하고 `staff_id`를 둔다.

`activities.extra`는 미확정 상태이며 실제 속성명 확인 후 보강 필요하다. 현재는 공통 후보 중 `text`/`date`/`checkbox`로 안전하게 추출 가능한 값만 담으며, 특히 조사 노트에 상세 속성명이 없는 CLINIC/MATERIAL의 매핑은 실제 스키마 확인이 필요하다.

STAFF의 기존 평문 PIN은 그대로 옮기지 않는다. `pin_hash`만 마련했으나 해시 알고리즘, Supabase Auth 연계, 초기 자격 증명 전환 절차는 이번 범위 밖이다. RLS도 정책을 잘못 확정하는 위험을 피하기 위해 SQL 주석 골격만 두고 비활성 상태로 유지한다. 그동안 공개 클라이언트 권한을 부여하지 않아야 한다.

## 가정(assumption)

- Notion 원문 전체를 `source_payload`에 저장해 미확정 속성을 보존할 수 있다.
- 환경변수에 설정된 ID를 Notion `data_source_id`로 간주한다.
- ISO 요일 숫자 1(월)~7(일)을 내부 표준으로 사용한다.
- COPY 단계에는 물리 삭제 동기화가 필요하지 않다.

## 확인 필요(open question)

- 15개 데이터소스의 실제 property schema, relation cardinality, 빈 값 관례.
- 환경변수 값이 실제 `data_source_id`인지(구형 `database_id`일 가능성 포함). `--execute` 전 자격증명으로 최소 1개 소스의 GET 응답을 확인한다.
- 담당교사 이름과 STAFF의 동명이인 처리 및 요일/시간 직렬화 문법.
- 롤업 3종을 저장할지 SQL 집계/뷰로 재계산할지.
- PIN 인증 전환, 역할 목록, RLS 정책 및 개인정보 열람 범위.

## 2단계 실 코드 감사 반영

정본 `lib/notion.ts`의 전체 query/filter/create/update/read helper를 기준으로 명시 컬럼을 확장했다. CLINIC은 조교·담당학생·담당강사·관련업무와 기록 필드를, MATERIAL은 요청자·담당자·작업내용·작업률·상태·마감일·URL·files를 전용 테이블에 보존한다. EXAM_PREP의 잘못 추정된 CLASS FK와 SCHOOL_EXAM_RANGE의 잘못 추정된 STUDENT FK는 제거했다. 모든 코드상 relation은 fixture dry-run에서도 대상 page ID 존재 여부를 검사한다. 상세 근거는 `REAL_SCHEMA_AUDIT.md`에 있다.
