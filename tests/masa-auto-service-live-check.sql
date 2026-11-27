-- «فحص الاختيار التلقائي لخدمة ماسا» (main chat 7, 2026-11-27, after the «كشف أخصائي أمراض الدم والمناعة» bug).
-- RUN THIS (inside the migration's own live rolled-back dry-run, AFTER its body) with ANY migration that touches
-- clinic_reception.serves_service, auto_time_service, provider_serves_code, auto_book_service(_for), consult_*, or doctors'
-- departments / scope rows. Standalone it checks the live state as it is now. ONE transaction ending in ROLLBACK; reads only.
begin;
savepoint masa_chk_guard;
select set_config('masa_chk.in_txn', 'yes', true);
do $$ begin
  if current_setting('masa_chk.in_txn', true) is distinct from 'yes' then
    raise exception 'NOT inside begin … rollback — nothing done; run the whole file as one transaction'; end if;
end $$;
-- >>> BEGIN masa-auto-service-check (same text in tests/masa-auto-service-live-check.sql; CI: tests/masa-auto-service-guard.cjs) <<<
-- Re-runs the auto picker on the REAL Masa bookings of the last 7 days and compares the department of the picked service with
-- the doctor's own departments (home / provider_departments / scope row). Expected: 0 outside. Reads only.
create function pg_temp.masa_chk_member(p_provider uuid, p_department text, p_code text) returns boolean language sql stable as $f$
  select exists (select 1 from clinic_reception.providers p where p.id = p_provider and p.department = p_department)
      or exists (select 1 from clinic_reception.provider_departments d where d.provider_id = p_provider and d.department = p_department)
      or exists (select 1 from clinic_reception.provider_service_scopes sc where sc.provider_id = p_provider and sc.service_code = p_code)
$f$;
create temp table masa_chk as
  select e.id, e.provider_id, s.department svc_dept, s.code, s.name svc_name, s.is_home, s.placeholder
    from clinic_reception.external_bookings e
    join clinic_reception.providers p on p.id = e.provider_id
    left join clinic_reception.services s on s.id = clinic_reception.auto_time_service(p.workspace_id, e.provider_id, e.needed_service)
   where e.source = 'masa' and e.created_at >= now() - interval '7 days';
create temp table masa_chk_result(n serial, step text, expected text, actual text, ok boolean);
insert into masa_chk_result(step, expected, actual, ok)
select 'masa check: Masa bookings of the last 7 days re-picked', '> 0 (info)',
       count(*) || ' (' || count(*) filter (where code is null) || ' → staff review)', true from masa_chk;
insert into masa_chk_result(step, expected, actual, ok)
select 'masa check: picked service outside the doctor''s departments', '0', count(*)::text, count(*) = 0
  from masa_chk where code is not null and not pg_temp.masa_chk_member(provider_id, svc_dept, code);
insert into masa_chk_result(step, expected, actual, ok)
select 'masa check: picked a home / placeholder / non-consult service for a consult text', '0', count(*)::text, count(*) = 0
  from masa_chk c join clinic_reception.external_bookings e on e.id = c.id
 where c.code is not null and clinic_reception.consult_kind(e.needed_service) is not null
   and (c.is_home or coalesce(c.placeholder, false) or not clinic_reception.consult_pickable(c.svc_name));
-- >>> END masa-auto-service-check <<<
select step, expected, actual, ok from masa_chk_result order by n;
rollback;
