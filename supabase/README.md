# Supabase Migration Prep — 사직 academy-webapp

## 현재 상태 (2026-09-18 기준)

- **원본 migration 기준 commit**: 별도 workspace `supabase-migration-sajik`의 `56ac054 fix relation normalization migration` — 이 저장소 `supabase/`로 통합됨. 앞으로 별도 workspace는 사용하지 않고 이 디렉터리가 정본이다.
- **과거 독립 검토 결과**: `REVIEW_RESULT: PASS` — static code trace(원본 `lib/notion.ts`/`lib/examPrep.ts` 전체 읽기)와 fixture dry-run 결과 대조 방식으로 검토됨.
- **실행 이력**: 실제 운영 Notion 데이터에 migration이 실행된 적 없음. 실제 Supabase production 데이터에도 실행된 적 없음. 지금까지는 **fixture 기반 dry-run만** 진행됨(`docs/DRYRUN_REPORT.md`, 이 저장소로 통합 후 2026-09-18에 재검증 완료 — 15 소스/4 파생 테이블 수치가 원본과 동일하게 재현됨).
- **감사 이후 drift**: 원본 감사(위 commit 기준)는 당시 `lib/notion.ts` 3873행 스냅샷을 근거로 했다. 현재 이 저장소의 `lib/notion.ts`는 4414행이며, TODO/STAFF에 신규 property가 추가되었고 MANUAL/MANUAL_STEP 두 개의 신규 Notion DB(화면녹화 AI 매뉴얼 기능)가 생겼다. 전체 내역은 [`docs/DRIFT_ANALYSIS.md`](docs/DRIFT_ANALYSIS.md) 참고. **Phase 1 반영 완료(2026-09-18)**: `schema/001_initial_schema.sql`에 `tasks.{outcome,urgent,director_ack,pool,parent_task_id,parent_task_notion_ids}`, `staff.resigned`, `manuals`/`manual_steps` 테이블을 추가했고, `scripts/migrate_notion_to_supabase.mjs`는 17개 소스(MANUAL/MANUAL_STEP은 env var가 없으면 조용히 건너뛰는 optional source)를 처리하도록 갱신했다. fixture 17종 전체 dry-run 재검증 통과(MANUAL/MANUAL_STEP 각 2 read/2 transformed/0 error, 기존 13개 소스는 원본과 동일한 결과 유지).
- 원본 감사 시점 읽기 전용 참조 경로였던 `/opt/academy-sajik-live`는 이 저장소(academy-webapp, 사직) 자체의 당시 스냅샷이었다. 이제 이 저장소가 정본이며, 별도 read-only 참조 경로는 사용하지 않는다.

