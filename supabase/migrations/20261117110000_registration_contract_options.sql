-- Owner (2026-11-16): new-patient form «جهة التعاقد» showed only «مريض مباشر — بدون جهة» at reception.
-- The form read contracting_entity_contracts directly; RLS lets only contract managers read it, so reception got 0 rows.
-- Read-only list for staff who can register patients: active contracts valid today (Cairo), contract id + entity name only
-- (no prices, discounts, cashback or terms). Same access rule as list_contracts_for_patient_visit.
create or replace function public.list_active_contracts_for_registration()
returns table(contract_id uuid, entity_name text, start_date date, end_date date)
language plpgsql stable security definer set search_path = public as $$
declare d date := (now() at time zone 'Africa/Cairo')::date;
begin
  if not (public.has_archive_access() or public.can_manage_contracting_entities()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select c.id, e.name, c.start_date, c.end_date
    from public.contracting_entity_contracts c
    join public.contracting_entities e on e.id = c.entity_id
    where c.status = 'active' and (c.start_date is null or c.start_date <= d) and (c.end_date is null or c.end_date >= d)
    order by e.name;
end $$;
revoke all on function public.list_active_contracts_for_registration() from public, anon;
grant execute on function public.list_active_contracts_for_registration() to authenticated;
