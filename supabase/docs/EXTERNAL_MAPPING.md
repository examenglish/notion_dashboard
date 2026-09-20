# Notion 외부 ID 매핑

## 선택지 비교

각 도메인 테이블에 `notion_id UNIQUE`를 두는 방식은 조회와 upsert가 단순하고, 장애 조사 때 원본 페이지를 바로 추적할 수 있다. 반면 공급자가 늘거나 한 행에 여러 외부 ID가 붙으면 컬럼이 증가한다.

별도 `notion_id_map(table_name, row_id, notion_id)` 테이블은 여러 공급자와 다형 관계에 유연하지만 PostgreSQL FK로 서로 다른 대상 테이블을 온전히 보장하기 어렵고, 모든 COPY 및 조회에 추가 조인이 필요하다. 현재는 공급자가 Notion 하나이고 15개 소스와 대상이 고정되어 있어 복잡성의 이득이 없다.

## 최종 선택

대상 테이블마다 nullable `notion_id text UNIQUE`를 둔다. Notion 페이지에서 직접 생성되는 행은 반드시 원본 page ID를 넣고, 이를 `ON CONFLICT (notion_id) DO UPDATE`의 자연키로 사용한다. UUID `id`는 앱 내부 FK 전용이다. ID의 하이픈 표기는 변환하지 않고 API가 반환한 문자열 그대로 보존한다.

`class_students`, `class_staff`, `class_schedules`, `staff_work_schedules`는 relation 또는 직렬화 필드에서 파생되어 독립 Notion 페이지 ID가 없다. “모든 테이블에 notion_id” 원칙에 맞춰 컬럼과 UNIQUE 제약은 두되 값은 NULL이다. 이 행들은 각각의 복합 UNIQUE 키로 멱등성을 보장한다. 원본의 출처는 부모 행의 `notion_id`와 `source_payload`로 추적한다. 가짜 Notion ID를 생성하지 않는다.

현재 별도 `notion_id_map`은 만들지 않는다. 향후 다중 외부 시스템, ID 이력, 한 행의 다중 원본 요구가 생기면 도입을 재검토한다.

마이그레이션 실행 시에는 영구 매핑 테이블 대신 각 대상 테이블의 기존 `id, notion_id`를 먼저 읽어 인메모리 맵을 만든다. 신규 페이지에는 UUID를 선할당하고 원본 및 파생행의 FK를 모두 이 맵으로 해석한다. fixture 모드는 결정적 UUID로 같은 파이프라인을 검증한다. 해석되지 않은 relation이나 교사 이름은 unresolved로 기록한다.

## 가정(assumption)

- Notion page ID는 한 워크스페이스에서 안정적이며 재실행 사이에 바뀌지 않는다.
- 직접 적재 테이블의 모든 운영 행은 Notion 페이지에서 기원한다.

## 확인 필요(open question)

- 삭제/보관된 Notion 페이지의 tombstone을 별도로 추적할지.
- 장래 다른 지점 또는 외부 시스템을 같은 Supabase 프로젝트에 합칠지.
- page ID 표기 형식의 정규화가 필요한 외부 연동이 있는지.

## 2단계 감사 반영

`CLINIC.조교/담당강사`와 `MATERIAL.요청자/담당자`는 STAFF, `CLINIC.담당학생`은 STUDENT, `CLINIC.관련업무`는 TODO를 가리킨다. TODO의 `관련학생/관련반/담당자/클리닉보고`, CLASS_PROGRESS의 `생성된학생기록`, DAILY_RECORD의 `반별진도원본`도 ID 존재 검사를 거친다. EXAM_PREP에는 CLASS relation이 없고 SCHOOL_EXAM_RANGE에는 STUDENT relation이 없다.
