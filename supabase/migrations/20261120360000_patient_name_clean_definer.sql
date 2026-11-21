-- Hotfix (applied live 2026-11-21 18:56Z by main chat 4, owner «صلح كل حاجة من فضلك»); this file records it.
-- 20261120240000 added trigger patient_basics_clean → psychcare.patient_name_clean() as SECURITY INVOKER. Staff (role
-- authenticated) have no USAGE on schema psychcare, so every patient insert / full_name update from the dashboard (archive
-- «مريض جديد» / «تعديل البيانات», reception booking, auto-book) failed with «permission denied for schema psychcare».
-- Fix: the trigger function runs as SECURITY DEFINER with a fixed search_path (same body). Idempotent.
begin;
create or replace function psychcare.patient_name_clean() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.full_name is not null then new.full_name := psychcare.clean_name(new.full_name); end if;
  return new;
end $$;
revoke all on function psychcare.patient_name_clean() from public, anon, authenticated;
commit;
