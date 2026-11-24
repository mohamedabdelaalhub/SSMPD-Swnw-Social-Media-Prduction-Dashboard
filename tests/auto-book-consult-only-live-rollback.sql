-- Live rollback check for 20261124210000_auto_book_consult_only.sql. ONE transaction ending in ROLLBACK, as postgres.
-- (a) READ-ONLY count: open / future appointments created by the auto-booking account whose service is NOT consultation-type.
-- (b) Applies the migration body inside the transaction and shows, for every active provider, the service the picker returns
--     with no named / saved service, before vs after (only rows that change are listed + a summary). Nothing is kept.
begin;
create temp table ab_live(n serial, step text, expected text, actual text, ok boolean);
create temp table ab_before as
  select p.id provider_id, p.name, p.department, clinic_reception.auto_time_service(p.workspace_id, p.id, null) svc
    from clinic_reception.providers p join clinic_reception.workspaces w on w.id = p.workspace_id and w.mode = 'live' where p.active;
-- >>> paste supabase/migrations/20261124210000_auto_book_consult_only.sql here WITHOUT its own begin / commit <<<
do $$ declare sys uuid; n int; m int; tot int; begin
  select system_admin_id into sys from clinic_reception.auto_book_settings where id;
  select count(*), count(*) filter (where not clinic_reception.is_consult_name(s.name)) into tot, n
    from clinic_reception.appointments a join clinic_reception.services s on s.id = a.service_id
   where a.created_by = sys and a.status not in ('cancelled', 'no_show', 'completed') and a.starts_at >= date_trunc('day', now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo';
  insert into ab_live(step, expected, actual, ok) values ('open/future auto-booked appointments with a NON-consultation service (read-only)', 'count (for main chat)', n || ' of ' || tot, true);
  select count(*) into m from ab_before b where b.svc is distinct from clinic_reception.auto_time_service((select workspace_id from clinic_reception.providers where id = b.provider_id), b.provider_id, null);
  insert into ab_live(step, expected, actual, ok) values ('providers whose fallback service changes', 'count', m::text, true);
  select count(*) into n from ab_before b, lateral (select clinic_reception.auto_time_service((select workspace_id from clinic_reception.providers where id = b.provider_id), b.provider_id, null) v) x
   join clinic_reception.services s on s.id = x.v where not clinic_reception.is_consult_name(s.name)
     and not exists (select 1 from clinic_reception.auto_book_services d where d.provider_id = b.provider_id);
  insert into ab_live(step, expected, actual, ok) values ('after: unsaved fallback that is NOT consultation-type', '0', n::text, n = 0);
end $$;
select step, expected, actual, ok from ab_live order by n;
-- the providers whose fallback changes (old → new; new NULL = staff picks it once in «حجوزات تحتاج استكمال»)
select b.name, b.department, so.name old_service, sn.name new_service
  from ab_before b
  left join clinic_reception.services so on so.id = b.svc
  left join lateral (select clinic_reception.auto_time_service((select workspace_id from clinic_reception.providers where id = b.provider_id), b.provider_id, null) v) x on true
  left join clinic_reception.services sn on sn.id = x.v
 where b.svc is distinct from x.v order by b.department, b.name;
-- the open / future auto-booked appointments with a non-consultation service (ids only, no patient data)
select left(a.id::text, 8) appt, (a.starts_at at time zone 'Africa/Cairo')::date day, pr.name doctor, s.code, s.name service
  from clinic_reception.appointments a join clinic_reception.services s on s.id = a.service_id join clinic_reception.providers pr on pr.id = a.provider_id
 where a.created_by = (select system_admin_id from clinic_reception.auto_book_settings where id)
   and a.status not in ('cancelled', 'no_show', 'completed') and a.starts_at >= date_trunc('day', now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo'
   and not clinic_reception.is_consult_name(s.name) order by 2, 3;
rollback;
