# Offline dry-run 보고서

실행 명령: `node scripts/migrate_notion_to_supabase.mjs --fixtures fixtures/`

이 결과는 **합성 fixture 기반이며 라이브 Notion 데이터가 아니다**. fixture 모드에서는 `NOTION_TOKEN` 및 DB ID가 필요 없고 Notion fetch를 건너뛰며, `--execute`와 함께 사용할 수 없게 차단했다. Supabase 요청은 발생하지 않았다.

| source | read | transformed | skipped | error | unresolved |
|---|---:|---:|---:|---:|---:|
| CLASS | 2 | 2 | 0 | 0 | 0 |
| STUDENT | 2 | 2 | 0 | 0 | 0 |
| CLASS_PROGRESS | 2 | 2 | 0 | 0 | 0 |
| DAILY_RECORD | 2 | 2 | 0 | 0 | 0 |
| BRIEFING | 2 | 2 | 0 | 0 | 0 |
| EXAM_SCORE | 2 | 2 | 0 | 0 | 0 |
| COUNSELING | 2 | 2 | 0 | 0 | 0 |
| ADMIN_INBOX | 2 | 2 | 0 | 0 | 0 |
| TODO | 2 | 2 | 0 | 0 | 0 |
| STAFF | 2 | 2 | 0 | 0 | 0 |
| CLINIC | 2 | 2 | 0 | 0 | 1 |
| MATERIAL | 2 | 2 | 0 | 0 | 0 |
| EXAM_PREP | 2 | 2 | 0 | 1 | 0 |
| SCHOOL_EXAM_RANGE | 2 | 2 | 0 | 0 | 0 |
| SLACK_RECORDS | 2 | 2 | 0 | 0 | 0 |
| CLASS_STUDENTS (파생) | 2 | 2 | 0 | 0 | 0 |
| CLASS_STAFF (파생) | 3 | 3 | 0 | 0 | 0 |
| CLASS_SCHEDULES (파생) | 2 | 1 | 1 | 0 | 1 |
| STAFF_WORK_SCHEDULES (파생) | 2 | 1 | 1 | 0 | 1 |
| **합계** | **39** | **37** | **2** | **1** | **3** |

오류/미해결 경로는 의도한 fixture로 확인했다.

- CLASS_SCHEDULES: `요일별담당교사` 직렬화 파싱 실패 1건
- STAFF_WORK_SCHEDULES: `근무시간표` 직렬화 파싱 실패 1건
- CLINIC: `조교 → STAFF` 대상 page ID 부재 1건
- EXAM_PREP: `데이터` JSON.parse 실패 1건. 원문을 `_parse_error/raw`로 보존함

fixture 모드는 각 Notion page에 결정적 UUID를 할당해 `notion_id → UUID` 메모리 맵을 만든다. 이 맵으로 원본 테이블의 모든 스키마상 FK와 네 파생 테이블의 FK를 채웠다. `CLASS.소속학생` 2건, `CLASS.담당조교` 1건, `CLASS.담당교사` 이름 매칭 2건, 유효한 요일별 교사 1건, 유효한 근무시간 1건이 각각 실제 파생행으로 변환되었다. 실행 모드는 Supabase의 기존 `id,notion_id`를 먼저 페이지 단위로 읽고 신규 page에 UUID를 선할당한 뒤 같은 변환을 수행한다.

## 자체 검증 기록

- `node --check`로 migration/fixture 생성 스크립트 문법 통과, `git diff --check` 통과.
- 감사 당시 읽기 전용 참조 경로(이 저장소의 스냅샷, 구 경로 `/opt/academy-sajik-live`) 기준 사전 stat 166개 항목을 최종 상태와 비교했고 변경 0건, 누락 0건이었다. 금정 지점의 별도 저장소(구 경로 `/opt/academy-geumjeong-live`)에도 쓰기 작업을 수행하지 않았다.
- fixture의 PIN은 실제 값이 아닌 명시적 `REDACTED_FIXTURE`이며 migration payload에서 `PIN`/`pin` property를 제거한다.
- `secret_…`, `ntn_…`, `Bearer <영숫자>` 패턴을 `.git` 제외 전체 산출물에서 검사해 실제 값 후보 0건이었다.

## 변경 파일 목록

- `docs/REAL_SCHEMA_AUDIT.md`, `docs/DRYRUN_REPORT.md`, `docs/SCHEMA_DESIGN.md`, `docs/EXTERNAL_MAPPING.md`
- `schema/001_initial_schema.sql`
- `scripts/migrate_notion_to_supabase.mjs`

fixture의 `CLASS.소속학생/담당조교`와 `STUDENT.소속반` 샘플은 이미 채워져 있어 변경하지 않았다. 기존 미추적 작업 메타데이터·로그 파일은 커밋에 포함하거나 수정하지 않았다.
