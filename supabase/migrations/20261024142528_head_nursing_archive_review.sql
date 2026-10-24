-- Head nursing is an additive archive-review role, not a super-admin role.
-- No account is assigned automatically and no patient file is approved by deployment.
begin;
alter table public.admins drop constraint admins_role_check;
alter table public.admins add constraint admins_role_check check(role in ('page_manager','designer','approver','general_manager','super_admin','reception','customer_service','nursing','sono_doctor','contract_manager','accountant','financial_manager','psychology_specialist','head_nursing'));
alter table public.admin_extra_roles drop constraint admin_extra_roles_role_check;
alter table public.admin_extra_roles add constraint admin_extra_roles_role_check check(role in ('page_manager','designer','approver','general_manager','super_admin','reception','customer_service','nursing','sono_doctor','contract_manager','accountant','financial_manager','psychology_specialist','head_nursing'));
create or replace function public.has_archive_review_access() returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce((select has_archive_review_access from public.admins where user_id=auth.uid() and active limit 1),false)
 or public.has_role('super_admin') or public.has_role('head_nursing');
$$;
revoke all on function public.has_archive_review_access() from public,anon;
grant execute on function public.has_archive_review_access() to authenticated;
commit;
