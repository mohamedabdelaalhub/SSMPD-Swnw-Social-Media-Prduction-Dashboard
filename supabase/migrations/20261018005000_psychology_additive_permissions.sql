begin;
-- Specialty is an additive role. Existing module/row policies remain authoritative.
drop trigger if exists psychology_role_isolation on public.admins;
drop trigger if exists psychology_extra_role_isolation on public.admin_extra_roles;
drop function if exists psychcare.check_role_isolation();
do $$declare r record;begin
 for r in select tablename from pg_policies where schemaname='public' and policyname='psychology_isolated' loop
  execute format('drop policy psychology_isolated on public.%I',r.tablename);
 end loop;
end $$;
create or replace function public.has_archive_access() returns boolean language sql stable security definer set search_path=public as $$select coalesce((select has_archive_access from public.admins where user_id=auth.uid() and active limit 1),false) or public.has_role('super_admin')$$;
create or replace function public.has_archive_review_access() returns boolean language sql stable security definer set search_path=public as $$select coalesce((select has_archive_review_access from public.admins where user_id=auth.uid() and active limit 1),false) or public.has_role('super_admin')$$;
create or replace function public.can_access_leads() returns boolean language sql stable security definer set search_path=public as $$select public.has_role('reception') or public.has_role('customer_service') or public.has_role('general_manager') or public.has_role('super_admin')$$;
create or replace function psychcare.full_access(p uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$select public.can_manage_all_content() or public.has_archive_access() or public.has_archive_review_access() or (public.has_archive_view_only() and public.is_assigned_doctor_for_patient(p)) or exists(select 1 from psychcare.requests where patient_id=p and requested_by=public.my_admin_id() and status='approved' and expires_at>now())$$;
-- Keep private functions private after replacement. Public helper ACLs are unchanged.
revoke all on function psychcare.full_access(uuid) from public,anon,authenticated;
commit;
