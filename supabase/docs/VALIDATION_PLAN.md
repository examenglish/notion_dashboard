# COPY 검증 계획

## 실행 전 기준선

Notion은 읽기 전용 API로 각 데이터소스의 전체 페이지를 pagination하여 ID 목록과 레코드 수를 기록한다. archived/in_trash 포함 여부를 명시하고, Supabase 대상은 COPY 직전 동일 조건의 수를 기록한다. 로그 통합 테이블은 전체 수뿐 아니라 `activity_type`별 수를 비교한다.

## 자동 대조

1. 소스별 Notion page ID 집합과 대상 `notion_id` 집합의 차집합을 계산한다. 누락, 예상 밖 추가, 중복은 모두 실패로 처리한다.
2. CLASS/STUDENT/STAFF를 먼저 검증한 뒤 FK 미연결 수를 집계한다. `class_students`는 양쪽 relation에서 얻은 고유 쌍의 수와 비교한다.
3. 각 소스에서 결정론적으로 표본을 뽑는다. 예: notion_id 정렬 후 처음/중간/마지막 및 고정 해시 bucket. 이름, 날짜, 상태, 숫자, relation ID와 JSONB 원문을 비교한다.
4. 날짜는 ISO 날짜, 숫자는 명시적 decimal, rich_text는 원문 조각을 합친 값으로 canonicalize한 뒤 비교한다.
5. 재실행 후 행 수가 증가하지 않고 같은 `notion_id`의 변경값만 갱신되는지 확인한다.

15개 소스 각각에 대해 `source_count`, `target_count`, `missing_ids`, `extra_ids`, `sample_mismatches`, `unresolved_relations`를 결과물로 남긴다. BRIEFING/COUNSELING/ADMIN_INBOX/CLINIC/MATERIAL은 각각 discriminator로 필터링한다. 검증이 모두 통과하기 전에는 cutover하지 않는다.

## 수동 표본 검토

개인정보가 포함될 수 있으므로 결과에는 전체 연락처나 내용을 출력하지 않고 마스킹 값 또는 해시를 사용한다. 운영 담당자는 학생, 반, 직원과 로그 5종에서 소수 표본을 Notion UI와 읽기 전용 Supabase 질의로 대조한다. 시험점수는 학생별 최신 1건 계산 결과도 기존 동작과 비교한다.

## 가정(assumption)

- 검증 중 Notion 변경을 막거나, 동일한 시작 시각 기준 snapshot을 얻을 수 있다.
- 원본 JSONB 저장이 허용되며 접근은 제한된다.

## 확인 필요(open question)

- Notion API에서 archived/in_trash 페이지를 COPY 범위에 포함할지.
- 허용할 동시 수정 window와 재검증 기준 시각.
- 개인정보 마스킹 규칙, 검증 결과 보관 위치와 보존 기간.
