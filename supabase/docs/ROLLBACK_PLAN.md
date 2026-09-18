# COPY 단계 롤백 계획

## 전제

이번 단계는 Supabase 스키마 생성과 Notion→Supabase 단방향 COPY뿐이며 production cutover는 하지 않는다. 마이그레이션 스크립트는 Notion API에 조회만 수행하고 Notion 페이지를 생성·수정·삭제하지 않는다. 따라서 문제가 생겨도 정본 Notion은 영향을 받지 않아 롤백 위험이 낮다.

## 롤백 절차

COPY 데이터만 다시 받을 경우 FK 의존 순서의 역순으로 대상 테이블을 `TRUNCATE ... RESTART IDENTITY CASCADE`하고 수정한 스크립트로 재실행한다. 전용 Supabase 프로젝트/스키마이고 초기 스키마 자체를 폐기할 경우 해당 테이블과 `activity_type` enum을 `DROP`한 뒤 migration을 다시 적용하면 충분하다.

실행 전 대상 프로젝트 URL과 프로젝트 식별자를 재확인하고, 같은 스키마를 다른 앱이 사용 중이면 `CASCADE`를 사용하지 않는다. 삭제 전에 수량 검증 결과와 실패 로그를 보존한다. 이 저장소의 SQL을 자동으로 production에 실행하지 않는다.

cutover 또는 dual-write 이후에는 이 절차만으로 충분하지 않지만, 그 단계는 현재 범위 밖이다.

## 가정(assumption)

- Supabase 사본을 아직 사용자 트래픽이나 production 쓰기가 사용하지 않는다.
- COPY 대상 테이블에 Notion 외부에서 생성된 보존 대상 데이터가 없다.

## 확인 필요(open question)

- 실제 Supabase 프로젝트가 마이그레이션 전용인지, 공유 객체가 있는지.
- 롤백 실행 권한자와 승인 절차.
- COPY 로그 및 검증 산출물의 보관 위치.
