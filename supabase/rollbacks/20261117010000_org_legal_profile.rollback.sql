-- Rollback for 20261117010000_org_legal_profile.sql (تاب بيانات الشركة والفروع).
-- ⚠️ بيمسح البيانات المكتوبة في التاب. الملفات في bucket org-legal-documents مش بتتمسح هنا
-- (Storage API بس هو اللي يمسحها) — الـbucket بيفضل خاص ومن غير أي policy قراءة بعد الرجوع.
-- فروع inventory_branches مش بتتلمس (ملك المخزن).
begin;
drop policy if exists "org legal documents read" on storage.objects;
drop policy if exists "org legal documents upload" on storage.objects;
drop policy if exists "org legal documents delete" on storage.objects;
drop function if exists public.org_branch_create(text);
drop function if exists public.org_branches();
drop table if exists public.org_documents;
drop table if exists public.org_branch_details;
drop table if exists public.org_company;
drop table if exists public.org_audit;
drop function if exists public.org_touch_and_audit();
drop function if exists public.org_data_access();
commit;
