-- Live check for 20261127050000 («تفعيل العقد» auto-closes a finished import file). One transaction, ends in ROLLBACK.
-- Needs 20261127040000 live. Before 050000 is live:
--   sed '/^begin;$/d;/^commit;$/d' supabase/migrations/20261127050000_contract_activate_auto_close_batch.sql > /tmp/acb_body.sql
--   psql -v ON_ERROR_STOP=1 -v body=/tmp/acb_body.sql -v list='قائمة أسعار مصر لتامينات الحياة' -f tests/contract-activate-auto-close-live-rollback.sql
-- After it is live: -v body=/dev/null.
-- Steps (all rolled back):
--   A. one undecided row is added to the list's open file → the financial manager presses «تفعيل العقد» → REFUSED «فاضل 1 سطر…», nothing changes;
--   B. that row is removed again → the owner presses → REFUSED by the four-eyes rule (he linked the names), file still open, nothing changes;
--   C. the financial manager (no source review on this list) presses → contract + list + link active, file auto-closed, 3 sample prices resolve.
-- Prints statuses/counts only.
begin;
\i :body
select l.id list_id, c.id contract_id, c.status contract_before from clinic_prices.lists l join public.contracting_entity_contracts c on c.price_list_id = l.id
 where l.name = :'list' and l.deleted_at is null limit 1 \gset
select b.id batch_id from clinic_prices.batches b where b.list_id = :'list_id' and b.status = 'draft' order by b.created_at limit 1 \gset
select user_id owner_user from public.admins where id = 'bd5a528f-af8d-4ada-afe9-ce64e68b1d92' \gset
select a.user_id fm_user from public.admins a where a.active and a.user_id is not null and a.role = 'financial_manager'
   and not exists (select 1 from clinic_prices.audit x where x.list_id = :'list_id' and x.action = 'source_review' and x.actor_id = a.id) order by a.id limit 1 \gset
select (set_config('acb.contract', :'contract_id', false) is not null) ok \gset
create temp table acb(k text primary key, v text) on commit drop;
grant all on acb to authenticated;
create temp table acb_rows on commit drop as select rows from clinic_prices.batches where id = :'batch_id';
select 'before' part, json_build_object('contract', :'contract_before', 'list', (select status from clinic_prices.lists where id = :'list_id'),
  'open_files', (select count(*) from clinic_prices.batches where list_id = :'list_id' and status = 'draft'),
  'fm_found', :'fm_user' <> '')::text;
-- A
update clinic_prices.batches set rows = rows || '[{"name":"سطر اختبار لسه ماتحددش","price":"1"}]'::jsonb where id = :'batch_id';
select set_config('request.jwt.claims', json_build_object('sub', :'fm_user', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin perform public.contracting_contract_activate(current_setting('acb.contract')::uuid); insert into acb values ('A', 'ACCEPTED');
exception when others then insert into acb values ('A', 'REFUSED: ' || sqlerrm); end $$;
reset role;
select 'A_fm_with_undecided_row' part, v from acb where k = 'A';
select 'A_after' part, json_build_object('contract', c.status, 'list', l.status, 'link', c.price_list_link_status,
  'open_files', (select count(*) from clinic_prices.batches where list_id = l.id and status = 'draft'))::text
  from public.contracting_entity_contracts c join clinic_prices.lists l on l.id = c.price_list_id where c.id = :'contract_id';
-- B
update clinic_prices.batches set rows = (select rows from acb_rows) where id = :'batch_id';
select set_config('request.jwt.claims', json_build_object('sub', :'owner_user', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin perform public.contracting_contract_activate(current_setting('acb.contract')::uuid); insert into acb values ('B', 'ACCEPTED');
exception when others then insert into acb values ('B', 'REFUSED: ' || sqlerrm); end $$;
reset role;
select 'B_owner' part, v from acb where k = 'B';
select 'B_after' part, json_build_object('contract', c.status, 'list', l.status, 'link', c.price_list_link_status,
  'open_files', (select count(*) from clinic_prices.batches where list_id = l.id and status = 'draft'))::text
  from public.contracting_entity_contracts c join clinic_prices.lists l on l.id = c.price_list_id where c.id = :'contract_id';
-- C
select set_config('request.jwt.claims', json_build_object('sub', :'fm_user', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ declare r jsonb; begin r := public.contracting_contract_activate(current_setting('acb.contract')::uuid); insert into acb values ('C', r::text);
exception when others then insert into acb values ('C', 'REFUSED: ' || sqlerrm); end $$;
reset role;
select 'C_fm' part, v from acb where k = 'C';
select 'C_after' part, json_build_object('contract', c.status, 'list', l.status, 'link', c.price_list_link_status,
  'open_files', (select count(*) from clinic_prices.batches where list_id = l.id and status = 'draft'),
  'auto_close_audit', (select count(*) from clinic_prices.audit where list_id = l.id and action = 'auto_close_batch'),
  'items', (select count(*) from clinic_prices.items where list_id = l.id))::text
  from public.contracting_entity_contracts c join clinic_prices.lists l on l.id = c.price_list_id where c.id = :'contract_id';
do $$ declare s record; cash numeric; out jsonb := '[]'; bad int := 0; cid uuid := current_setting('acb.contract')::uuid;
begin
  for s in select sv.id, sv.base_price from clinic_prices.items i join public.pricing_services sv on sv.id = i.service_id and sv.active
           where i.list_id = (select price_list_id from public.contracting_entity_contracts where id = cid) order by sv.name limit 3 loop
    begin
      cash := (clinic_prices.resolve(s.id, s.base_price, (now() at time zone 'Africa/Cairo')::date, null)->>'price')::numeric;
      out := out || jsonb_build_object('cash', cash, 'contract_price', clinic_prices.resolve(s.id, cash, (now() at time zone 'Africa/Cairo')::date, cid)->>'price');
    exception when others then bad := bad + 1; out := out || jsonb_build_object('error', sqlerrm); end;
  end loop;
  raise notice 'C_samples %', out;
  if (select v from acb where k = 'A') not like 'REFUSED: %فاضل%' then raise exception 'FAIL A: %', (select v from acb where k = 'A'); end if;
  if (select v from acb where k = 'C') like 'REFUSED%' then raise exception 'FAIL C: %', (select v from acb where k = 'C'); end if;
  if (select status from clinic_prices.lists where id = (select price_list_id from public.contracting_entity_contracts where id = cid)) <> 'active' then raise exception 'FAIL C: list not active'; end if;
  if bad > 0 then raise exception 'FAIL C: % sample prices did not resolve', bad; end if;
end $$;
select 'verdict' part, 'PASS (rolled back)';
rollback;
