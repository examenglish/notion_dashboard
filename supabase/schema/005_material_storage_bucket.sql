-- 자료제작(material_tasks) 원본파일을 Notion File Upload API 대신
-- Supabase Storage에 저장하기 위한 private bucket 생성(staff.md PART 17).
--
-- 이 앱은 client-side에서 Supabase anon/authenticated key로 Storage에
-- 직접 접근하지 않는다 — 업로드/서명URL 발급 전부 서버(lib/supabaseStorage.ts)가
-- SUPABASE_SERVICE_ROLE_KEY로만 수행한다(service_role은 RLS를 무조건
-- 우회하므로 storage.objects에 별도 RLS 정책을 추가하지 않아도 안전하다 —
-- 대신 bucket 자체를 public=false로 만들어 인증 없는 직접 URL 접근을
-- 원천 차단하고, 지점 격리는 애플리케이션 코드가 객체 경로 접두사
-- "<branch>/materials/..."로 강제한다).
--
-- 사직/금정은 branch_id로 격리된 같은 Supabase 프로젝트를 쓰므로 이
-- 파일은 (다른 schema 마이그레이션들처럼) 한 번만 실행하면 된다.

begin;

insert into storage.buckets (id, name, public, file_size_limit)
values ('materials', 'materials', false, 10485760) -- 10MB, 앱 자체 업로드 제한(4MB)보다 여유
on conflict (id) do nothing;

commit;
