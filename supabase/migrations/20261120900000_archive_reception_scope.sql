-- Owner 2026-11-19: reception + customer service get patient-archive access «حسب حدود الوظيفة», approved limits:
--   view the whole patient file; edit basic data only; upload ID / insurance documents only; never delete; never touch medical
--   records (visits, prescriptions, reports, results); every view / download / upload / edit is logged in archive_access_log.
-- Implementation: a NEW flag admins.has_archive_reception_access (has_archive_access = full archive stays untouched).
--   * Reads: reception/CS already read the medical tables through can_access_leads() in the SELECT policies; the patient row + file
--     list / download / upload go through edge functions (service role), which now also accept this flag (upload limited to
--     id_document / insurance) and log view / download / upload.
--   * Deletes and medical writes already require has_archive_access() / can_manage_all_content() in RLS: unchanged.
--   * public.patients UPDATE: can_access_leads() lets reception update any column directly, so a guard now limits DIRECT client
--     updates (role authenticated) by anyone without full archive / content-management rights to the basic columns, and logs 'edit'.
--     Server-side SECURITY DEFINER paths (e.g. clinic_reception_patient_basic) are not affected.
-- Rollback: supabase/rollbacks/20261120900000_archive_reception_scope.rollback.sql
begin;

do $$ begin
  if to_regclass('public.archive_access_log') is null or to_regprocedure('public.has_archive_access()') is null then raise exception 'مكونات الأرشيف غير موجودة'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'admins' and column_name = 'has_archive_reception_access') then
    raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

alter table public.admins add column has_archive_reception_access boolean not null default false;

create function public.has_archive_reception_access() returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce((select a.has_archive_reception_access from public.admins a where a.user_id = auth.uid() and a.active), false)
$$;
revoke all on function public.has_archive_reception_access() from public, anon;
grant execute on function public.has_archive_reception_access() to authenticated;

-- allow the 'edit' action in the archive log (keeps every value the live constraint already allows)
do $$
declare d text;
begin
  select pg_get_constraintdef(c.oid) into d from pg_constraint c where c.conrelid = 'public.archive_access_log'::regclass and c.conname = 'archive_access_log_action_check';
  if d is null then raise exception 'archive_access_log_action_check مش موجود'; end if;
  if position('''edit''' in d) = 0 then
    if position('ARRAY[' in d) = 0 then raise exception 'شكل قيد archive_access_log غير متوقع: %', d; end if;
    alter table public.archive_access_log drop constraint archive_access_log_action_check;
    execute 'alter table public.archive_access_log add constraint archive_access_log_action_check ' || regexp_replace(d, '\]\)', ', ''edit''::text])');
  end if;
end $$;

create function public.archive_log_patient_edit(p_patient uuid) returns void language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if pg_trigger_depth() = 0 then raise exception 'الدالة دي بتشتغل من التريجر بس'; end if;
  insert into public.archive_access_log(patient_id, employee_id, action) values (p_patient, public.my_admin_id(), 'edit');
end $$;
revoke all on function public.archive_log_patient_edit(uuid) from public, anon, authenticated;

-- SECURITY INVOKER on purpose: current_user is the caller's role, so only direct client updates are checked
create function public.patients_basic_scope_guard() returns trigger language plpgsql set search_path = pg_catalog, public as $$
declare changed text;
begin
  if current_user <> 'authenticated' then return new; end if;
  if public.has_archive_access() or public.can_manage_all_content() then return new; end if;
  select string_agg(n.key, '، ' order by n.key) into changed
    from jsonb_each(to_jsonb(new)) n
   where n.value is distinct from (to_jsonb(old) -> n.key)
     and n.key not in ('full_name','phone','phone_normalized','email','age','gender','medical_record_no','last_visit_date','sent_to_nursing_at','updated_at');
  if changed is not null then
    raise exception 'صلاحيتك بتسمح بتعديل البيانات الأساسية بس (الاسم، التليفون، السن، النوع). الحقول دي محتاجة أرشيف كامل: %', changed;
  end if;
  perform public.archive_log_patient_edit(new.id);
  return new;
end $$;
grant execute on function public.archive_log_patient_edit(uuid) to authenticated;
create trigger patients_basic_scope_guard before update on public.patients for each row execute function public.patients_basic_scope_guard();

commit;
