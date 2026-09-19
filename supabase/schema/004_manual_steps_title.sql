-- manual_steps에 title 컬럼이 빠져 있던 걸 보강한다.
--
-- 근거(추측 아님, 코드로 확인함):
--  - supabase/scripts/migrate_notion_to_supabase.mjs의 MANUAL_STEP T() 매퍼가
--    title: title(x,'제목')를 반환한다(Notion MANUAL_STEP 데이터소스의 실제
--    title-type 속성 "제목"을 그대로 옮긴 것).
--  - lib/notion.ts의 ManualStepRecord/mapManualStepPage/createManualSteps/
--    updateManualStep이 이 값을 "단계 제목"으로 실제로 읽고 쓴다.
--  - components/manuals/ManualUploadClient.tsx(업로드 화면의 "단계 제목" 입력)와
--    ManualReviewClient.tsx(검토 화면)가 화면에서 이 값을 그대로 편집한다.
--  => title은 잘못 들어간 필드가 아니라 001_initial_schema.sql 작성 당시
--     빠뜨린 실제 필요 컬럼이다. 매퍼를 지우는 게 아니라 컬럼을 추가하는
--     쪽이 맞다.
--
-- NOT NULL을 걸지 않는 이유: 이 마이그레이션 작성 시점에 manual_steps가
-- production에 실제로 몇 행 있는지 이 세션에서 직접 확인할 수 없었다
-- (NOTION_DB_MANUAL/NOTION_DB_MANUAL_STEP이 Vercel production env에
-- 아직 없다는 것만 확인됨 — PART 1/PART 5 참고, 즉 지금까지 이 경로로 실제
-- 쓰기가 일어난 적이 없을 가능성이 높지만 "없다"고 단정하지 않는다).
-- 기존 행이 있어도 이 ALTER는 항상 안전하게 적용된다.
begin;

alter table manual_steps add column if not exists title text;

commit;
