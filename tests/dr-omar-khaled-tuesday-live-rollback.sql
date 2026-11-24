-- Live rollback check for docs/ops/2026-11-24-dr-omar-khaled-tuesday.sql. ONE transaction ending in ROLLBACK, as postgres.
-- Applies the ops body, then as Mazen (reception) books د. عمر خالد on the next Monday and the next Tuesday at 17:30 Cairo
-- (Tuesday 17:30 was outside his old 18:00 window) with «كشف الأخصائي» 0001371, and checks the service price is 500.
begin;
-- >>> paste docs/ops/2026-11-24-dr-omar-khaled-tuesday.sql here WITHOUT its own begin / commit <<<
create temp table om_live(n serial, step text, expected text, actual text, ok boolean);
do $$
declare mazen uuid := 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb'; p record; ws uuid; svc record; pat uuid; d date; t timestamptz; r jsonb; err text; dows int[] := array[1, 2];
  x int; today date := (now() at time zone 'Africa/Cairo')::date;
begin
  select pr.* into p from clinic_reception.providers pr join clinic_reception.workspaces w on w.id = pr.workspace_id and w.mode = 'live'
   where pr.id::text like '4f1132cd%' and pr.name like '%عمر خالد%';
  ws := p.workspace_id;
  insert into om_live(step, expected, actual, ok) values ('schedule', '1 17:00–21:00 | 2 17:00–21:00',
    (select string_agg(dow || ' ' || to_char(starts, 'HH24:MI') || '–' || to_char(ends, 'HH24:MI'), ' | ' order by dow, starts) from clinic_reception.weekly_slots where provider_id = p.id),
    (select string_agg(dow || ' ' || to_char(starts, 'HH24:MI') || '–' || to_char(ends, 'HH24:MI'), ' | ' order by dow, starts) from clinic_reception.weekly_slots where provider_id = p.id) = '1 17:00–21:00 | 2 17:00–21:00');
  select s.* into svc from clinic_reception.services s where s.workspace_id = ws and s.code = '0001371' and s.active;
  insert into om_live(step, expected, actual, ok) values ('كشف الأخصائي 0001371 price', '500', coalesce(svc.price::text, 'missing'), svc.price = 500);
  select id into pat from clinic_reception.patients where workspace_id = ws order by created_at limit 1;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', mazen, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', mazen::text, true);
  foreach x in array dows loop
    d := today + 1 + ((x - extract(dow from today + 1)::int + 7) % 7);
    t := (d + time '17:30') at time zone 'Africa/Cairo';
    begin execute 'set local role authenticated';
      r := public.clinic_reception_command(ws, 'book', jsonb_build_object('patient_id', pat, 'provider_id', p.id, 'service_id', svc.id, 'starts_at', t, 'same_day_ok', true), gen_random_uuid());
      execute 'reset role'; err := 'ok';
    exception when others then execute 'reset role'; err := sqlerrm; end;
    insert into om_live(step, expected, actual, ok) values ('Mazen books ' || case x when 1 then 'Monday ' else 'Tuesday ' end || d || ' 17:30', 'ok', err, err = 'ok');
  end loop;
end $$;
select step, expected, actual, ok from om_live order by n;
rollback;
