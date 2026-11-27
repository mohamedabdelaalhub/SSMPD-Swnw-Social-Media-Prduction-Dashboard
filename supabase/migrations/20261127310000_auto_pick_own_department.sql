-- Masa auto booking puts «كشف أخصائي أمراض الدم والمناعة» on consults of OTHER doctors (owner bug 2026-11-27, relayed by main
-- chat 7 from Mazen: «اي حالة بتتسجل كشف من علي ماسا بيتحول لي الداش نفس نوع الكشف دا اخصائي المناعه و الدم», booking of
-- د.أحمد مصطفى).
-- Cause: 20261126050000_restricted_doctor_scope redefined clinic_reception.serves_service as provider_serves_code, which
-- returns TRUE for every BASIC service (كشف / استشارة / متابعة) of ANY department — right for manual booking (owner rule:
-- basics open to every doctor) but wrong for the AUTO picker: clinic_reception.auto_time_service v4 (20261126040000) step 4
-- takes «the department's consultation» from every service the doctor serves, ordered by consult_rank first, so the
-- shortest / alphabetically first «كشف أخصائي…» of the WHOLE clinic won for every doctor without an exact name match; and
-- step 3 (the doctor's most used consultation) then kept repeating it from those bookings.
-- Fix: serves_service (used ONLY by the auto picker) = membership (home department, provider_departments, or a scope row
-- for the code — its definition before 20261126050000) AND provider_serves_code (so a RESTRICTED department still offers only
-- its scoped codes + basics). Manual booking, the snapshot and every gate keep provider_serves_code unchanged.
-- Existing appointments are NOT touched: tests/auto-pick-own-department-live-rollback.sql lists the open ones whose
-- auto-picked service is outside the doctor's departments, for reception to fix with «تغيير الخدمة».
-- Rollback: supabase/rollbacks/20261127310000_auto_pick_own_department.rollback.sql
do $$ begin
  if to_regclass('clinic_reception.auto_pick_saved_defs') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
  if to_regprocedure('clinic_reception.provider_serves_code(uuid,text,text,date)') is null
     or to_regprocedure('clinic_reception.serves_service(uuid,text,text)') is null then raise exception 'طبّق 20261126050000 أولاً'; end if;
  if pg_get_functiondef('clinic_reception.serves_service(uuid,text,text)'::regprocedure) not like '%provider_serves_code%' then
    raise exception 'serves_service مش النسخة المتوقعة (20261126050000) — راجع التعريف الحي'; end if;
end $$;
begin;
create table clinic_reception.auto_pick_saved_defs(sig text primary key, def text not null, saved_at timestamptz not null default now());
alter table clinic_reception.auto_pick_saved_defs enable row level security;
revoke all on clinic_reception.auto_pick_saved_defs from public, anon, authenticated;
insert into clinic_reception.auto_pick_saved_defs(sig, def)
  values ('clinic_reception.serves_service(uuid,text,text)', pg_get_functiondef('clinic_reception.serves_service(uuid,text,text)'::regprocedure));

-- the auto picker's candidates: the doctor's OWN departments (or an explicit scope row), still under the restriction rule
create or replace function clinic_reception.serves_service(p_provider uuid, p_department text, p_code text) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select (exists (select 1 from clinic_reception.providers p where p.id = p_provider and p.department = p_department)
       or exists (select 1 from clinic_reception.provider_departments d where d.provider_id = p_provider and d.department = p_department)
       or exists (select 1 from clinic_reception.provider_service_scopes sc where sc.provider_id = p_provider and sc.service_code = p_code))
     and clinic_reception.provider_serves_code(p_provider, p_department, p_code, null)
$$;
revoke all on function clinic_reception.serves_service(uuid, text, text) from public, anon, authenticated;
commit;
