-- Live rollback check for 20261127310000_auto_pick_own_department.sql. ONE transaction ending in ROLLBACK, run as postgres.
-- Nothing is kept: no function change, no booking, no message. Appointments are only READ.
-- (a) READ-ONLY before the body: Masa auto-booked appointments since 2026-11-26 whose service is outside the doctor's own
--     departments (home / provider_departments / scope row), and today's pick for «كشف جديد» of every active live doctor.
-- (b) the migration body (between the markers, without begin / commit).
-- (c) after: no doctor's pick is outside his departments; Dr Ahmed Mostafa's pick; how many picks changed / became NULL
--     (= staff picks once in «حجوزات تحتاج استكمال»); the OPEN wrong appointments listed for reception. Summary table LAST.
begin;
savepoint apod_live_guard;
select set_config('apod_live.in_txn', 'yes', true);
do $$ begin
  if current_setting('apod_live.in_txn', true) is distinct from 'yes' then
    raise exception 'NOT inside begin … rollback — nothing done; run the whole file as one transaction'; end if;
end $$;
create temp table apod_live(n serial, step text, expected text, actual text, ok boolean);
create function pg_temp.apod_member(p_provider uuid, p_department text, p_code text) returns boolean language sql stable as $f$
  select exists (select 1 from clinic_reception.providers p where p.id = p_provider and p.department = p_department)
      or exists (select 1 from clinic_reception.provider_departments d where d.provider_id = p_provider and d.department = p_department)
      or exists (select 1 from clinic_reception.provider_service_scopes sc where sc.provider_id = p_provider and sc.service_code = p_code)
$f$;
create temp table apod_wrong as
  select e.id ext_id, a.id appointment_id, a.status, a.starts_at, p.name doctor, p.department home, s.code, s.name service, s.department svc_dept,
         (select pt.patient_code from public.patients pt where pt.id = e.public_patient_id) patient_code
    from clinic_reception.external_bookings e
    join clinic_reception.appointments a on a.id = e.appointment_id
    join clinic_reception.providers p on p.id = a.provider_id
    join clinic_reception.services s on s.id = a.service_id
   where e.source = 'masa' and e.created_at >= '2026-11-26' and not pg_temp.apod_member(a.provider_id, s.department, s.code);
create temp table apod_before as
  select p.id provider_id, p.name, p.department, clinic_reception.auto_time_service(p.workspace_id, p.id, 'كشف جديد') svc
    from clinic_reception.providers p join clinic_reception.workspaces w on w.id = p.workspace_id and w.mode = 'live' where p.active;
insert into apod_live(step, expected, actual, ok)
select '(a) before: Masa auto-booked since 11-26 outside the doctor''s departments', 'info (the bug)',
       count(*) || ' (' || count(*) filter (where service like '%الدم%') || ' = «…الدم والمناعة»)', true from apod_wrong;
insert into apod_live(step, expected, actual, ok)
select '(a) before: doctors whose «كشف جديد» pick is outside their departments', 'info (the bug)',
       count(*) || ' of ' || (select count(*) from apod_before), true
  from apod_before b join clinic_reception.services s on s.id = b.svc where not pg_temp.apod_member(b.provider_id, s.department, s.code);
-- >>> BEGIN migration body: supabase/migrations/20261127310000_auto_pick_own_department.sql (without begin / commit) <<<
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
-- >>> END migration body <<<
create temp table apod_after as
  select b.provider_id, b.name, b.svc before_svc, clinic_reception.auto_time_service(p.workspace_id, p.id, 'كشف جديد') svc
    from apod_before b join clinic_reception.providers p on p.id = b.provider_id;
insert into apod_live(step, expected, actual, ok)
select '(c) after: picks outside the doctor''s departments', '0', count(*)::text, count(*) = 0
  from apod_after x join clinic_reception.services s on s.id = x.svc where not pg_temp.apod_member(x.provider_id, s.department, s.code);
insert into apod_live(step, expected, actual, ok)
select '(c) after: no pick is a procedure / home service', '0', count(*)::text, count(*) = 0
  from apod_after x join clinic_reception.services s on s.id = x.svc where s.is_home or not clinic_reception.consult_pickable(s.name);
insert into apod_live(step, expected, actual, ok)
select '(c) after: picks changed / now NULL (staff picks once)', 'info',
       count(*) filter (where svc is distinct from before_svc) || ' changed, ' || count(*) filter (where svc is null) || ' NULL of ' || count(*), true from apod_after;
insert into apod_live(step, expected, actual, ok)
select '(c) Dr Ahmed Mostafa: «كشف جديد» before → after', 'a consult of his own department',
       coalesce((select name from clinic_reception.services where id = x.before_svc), 'NULL') || ' → ' ||
       coalesce((select s.name || ' [' || s.department || ']' from clinic_reception.services s where s.id = x.svc), 'NULL → staff review'),
       x.svc is null or exists (select 1 from clinic_reception.services s where s.id = x.svc and pg_temp.apod_member(x.provider_id, s.department, s.code))
  from apod_after x where x.name like '%أحمد مصطفى%' or x.name like '%احمد مصطفى%';
insert into apod_live(step, expected, actual, ok)
select '(c) manual booking unchanged: basics of another department still open (provider_serves_code)', 'true',
       coalesce(bool_and(clinic_reception.provider_serves_code(x.provider_id, s.department, s.code, null))::text, 'no sample'), coalesce(bool_and(clinic_reception.provider_serves_code(x.provider_id, s.department, s.code, null)), true)
  from (select provider_id, before_svc from apod_after limit 50) x join clinic_reception.services s on s.id = x.before_svc;
-- the OPEN wrong appointments for reception («تغيير الخدمة»), read only
select 'open wrong' kind, patient_code, doctor, home, to_char(starts_at at time zone 'Africa/Cairo', 'YYYY-MM-DD HH24:MI') at_cairo, status, code, service, svc_dept
  from apod_wrong where status not in ('cancelled','no_show','completed') order by starts_at;
select step, expected, actual, ok from apod_live order by n;
rollback;
