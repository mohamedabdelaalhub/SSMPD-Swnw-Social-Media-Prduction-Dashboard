-- Live rollback test for 20261127150000_snapshot_shift_ended.sql. Run as postgres with -v body=<migration without begin/commit>, BEFORE the apply.
-- ONE transaction, ends ROLLBACK. Acts as Mazen (reception). Prints, per «shifts» row of the live reception snapshot: open/ended flags only.
begin;
\i :body
create temp table o(step text, actual text, ok boolean); grant all on o to authenticated;
create temp table wsx as select id from clinic_reception.workspaces where mode = 'live' limit 1; grant select on wsx to authenticated;
create temp table fin as select id, status, ended_at is not null ended from clinic_finance.shifts; grant select on fin to authenticated;
select set_config('request.jwt.claims', json_build_object('sub','f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb','role','authenticated')::text, true) is not null;
set local role authenticated;
do $$ declare x jsonb; n int; m int; bad int; begin
  x := public.clinic_reception_snapshot((select id from wsx));
  select count(*), count(*) filter (where s ? 'ended_at') into n, m from jsonb_array_elements(x->'shifts') s;
  insert into o values ('1 every shifts row has ended_at key', n || ' rows · ' || m || ' with key', n > 0 and n = m);
  select count(*) into bad from jsonb_array_elements(x->'shifts') s join fin f on f.id = (s->>'id')::uuid
   where (s->>'ended_at' is not null) <> f.ended;
  insert into o values ('2 ended_at matches clinic_finance.shifts', 'mismatches ' || bad, bad = 0);
  select count(*) into n from jsonb_array_elements(x->'shifts') s where s->>'status' = 'open' and s->>'ended_at' is null;
  select count(*) into m from jsonb_array_elements(x->'shifts') s where s->>'status' = 'open' and s->>'ended_at' is not null;
  insert into o values ('3 open running vs handed-over', 'running ' || n || ' · handed-over ' || m, true);
  insert into o values ('4 other keys kept', (select string_agg(k, ',' order by k) from jsonb_object_keys(x) k), x ? 'shifts' and x ? 'home_visit_split');
end $$;
reset role;
insert into o values ('5 grants', 'auth ' || has_function_privilege('authenticated','public.clinic_reception_snapshot(uuid,date,date)','execute') || ' anon ' || has_function_privilege('anon','public.clinic_reception_snapshot(uuid,date,date)','execute'),
  has_function_privilege('authenticated','public.clinic_reception_snapshot(uuid,date,date)','execute') and not has_function_privilege('anon','public.clinic_reception_snapshot(uuid,date,date)','execute'));
select step, left(actual, 160) actual, ok from o;
rollback;
