-- Live check for 20261127070000 («تفعيل العقد» refuses expired / rejected / past end date). One transaction, ends in ROLLBACK.
-- Before it is live:
--   sed '/^begin;$/d;/^commit;$/d' supabase/migrations/20261127070000_contract_activate_refuse_terminal.sql > /tmp/art_body.sql
--   psql -v ON_ERROR_STOP=1 -v body=/tmp/art_body.sql -f tests/contract-activate-refuse-terminal-live-rollback.sql
-- After it is live: -v body=/dev/null. Runs as the financial manager (any active financial_manager with a login).
-- Cases (each on a real contract, changed only inside this transaction): an expired contract; the same contract set to
-- rejected; a negotiating contract whose end date is moved to yesterday. Every press must be REFUSED and leave the status as it was.
begin;
\i :body
select a.user_id fm_user from public.admins a where a.active and a.user_id is not null and a.role = 'financial_manager' order by a.id limit 1 \gset
select id c_exp from public.contracting_entity_contracts where status = 'expired' order by id limit 1 \gset
select id c_neg from public.contracting_entity_contracts where status = 'negotiating' order by id limit 1 \gset
select (set_config('art.exp', :'c_exp', false) is not null and set_config('art.neg', :'c_neg', false) is not null) ok \gset
create temp table art(k text primary key, v text) on commit drop;
grant all on art to authenticated;
create function pg_temp.press(k text, c uuid) returns void language plpgsql as $$
begin
  begin perform public.contracting_contract_activate(c); insert into art values (k, 'ACCEPTED');
  exception when others then insert into art values (k, 'REFUSED: ' || sqlerrm); end;
end $$;
grant execute on function pg_temp.press(text, uuid) to authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'fm_user', 'role', 'authenticated')::text, true);
set local role authenticated;
select pg_temp.press('1_expired', current_setting('art.exp')::uuid);
reset role;
update public.contracting_entity_contracts set status = 'rejected' where id = :'c_exp';
select set_config('request.jwt.claims', json_build_object('sub', :'fm_user', 'role', 'authenticated')::text, true);
set local role authenticated;
select pg_temp.press('2_rejected', current_setting('art.exp')::uuid);
reset role;
update public.contracting_entity_contracts set end_date = (now() at time zone 'Africa/Cairo')::date - 1 where id = :'c_neg';
select set_config('request.jwt.claims', json_build_object('sub', :'fm_user', 'role', 'authenticated')::text, true);
set local role authenticated;
select pg_temp.press('3_past_end_date', current_setting('art.neg')::uuid);
reset role;
select 'presses' part, json_object_agg(k, v order by k)::text from art;
select 'statuses_after' part, json_build_object('expired_case', (select status from public.contracting_entity_contracts where id = :'c_exp'),
  'past_end_case', (select status from public.contracting_entity_contracts where id = :'c_neg'))::text;
do $$ begin
  if exists (select 1 from art where v not like 'REFUSED:%') then raise exception 'FAIL: a terminal contract was accepted: %', (select json_object_agg(k, v) from art); end if;
  if (select status from public.contracting_entity_contracts where id = current_setting('art.neg')::uuid) <> 'negotiating' then raise exception 'FAIL: status changed'; end if;
end $$;
select 'verdict' part, 'PASS (rolled back)';
rollback;
