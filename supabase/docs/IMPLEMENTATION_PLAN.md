# 단계별 구현 계획

## 1. 스키마 확정 및 적용

실제 Notion database property schema를 읽기 전용으로 수집해 현재의 `확인 필요` 항목을 해소한다. staging Supabase에 `schema/001_initial_schema.sql`을 적용하고 제약, 인덱스, 권한을 점검한다. 이때 RLS는 아직 비활성이며 anon/authenticated 접근 권한을 부여하지 않는다.

## 2. dual-write 준비

기존 `lib/notion.ts` 뒤에 저장소 인터페이스 또는 명시적 dual-write adapter를 설계하고, 요청 ID·재시도·부분 실패 기록·대사 큐를 마련한다. Notion은 계속 정본이다. STAFF PIN과 세션/RBAC/RLS 전환 설계는 별도 보안 검토를 거친다. 준비는 하되 이번 단계에서는 정본 앱을 수정하거나 dual-write를 켜지 않는다.

## 3. 순수 COPY 및 검증

credential을 승인된 방식으로 주입한 뒤 스크립트를 먼저 dry-run한다. 매핑/미해결 relation 보고서를 검토한 다음 `--execute`로 staging에 멱등 upsert한다. `VALIDATION_PLAN.md`에 따라 15개 소스의 수량, ID 집합, 필드 표본, FK, 재실행 멱등성을 검증한다. Notion은 전 과정에서 읽기 전용이다.

## 4. 후속 단계 — 이번 범위 밖

dual-write 활성화, 운영 관찰, backfill delta 처리, read 경로 전환, Supabase Auth/RLS 적용, production cutover, Notion 쓰기 중단 및 최종 롤백 창 결정은 모두 이번 산출물 범위 밖이다. 각 단계는 별도 승인과 runbook 후 진행한다.

## 완료 기준

- 15개 소스가 모두 명시적으로 매핑되고 미확정 속성이 보고된다.
- dry-run은 외부 시스템을 변경하지 않는다.
- execute COPY를 반복해도 notion_id/관계 복합키 기준 중복이 없다.
- staging Supabase 프로젝트의 anon/authenticated 역할 기본 권한(`public` 스키마 GRANT)을 확인하고, RLS 활성화 전까지 PII 테이블에 대한 의도치 않은 접근 권한이 없는지 확인한다.
- 검증 결과가 승인되기 전에는 다음 단계로 진행하지 않는다.

## 가정(assumption)

- credential은 구현/검토가 끝난 뒤 별도 안전 채널로 제공된다.
- staging Supabase에서 먼저 시험할 수 있다.

## 확인 필요(open question)

- dual-write의 정본 우선순위, 실패 재시도와 충돌 해결 규칙.
- staging/production 프로젝트 구성과 배포 승인자.
- 인증 전환 일정, RLS 정책, 최종 cutover 성공 기준.
