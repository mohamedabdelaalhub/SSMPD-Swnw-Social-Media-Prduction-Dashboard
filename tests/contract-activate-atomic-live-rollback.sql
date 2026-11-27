-- Live check for 20261127040000 («تفعيل العقد» all-or-nothing). One transaction, ends in ROLLBACK, writes nothing.
-- Before the migration is live:
--   sed '/^begin;$/d;/^commit;$/d' supabase/migrations/20261127040000_contract_activate_atomic.sql > /tmp/caa_body.sql
--   psql -v ON_ERROR_STOP=1 -v body=/tmp/caa_body.sql -v list='قائمة أسعار مصر لتامينات الحياة' -f tests/contract-activate-atomic-live-rollback.sql
-- After it is live: -v body=/dev/null.
-- Part A, the owner (super admin bd5a528f, who did the source review): «تفعيل العقد» must be REFUSED, and the contract must
-- stay in its previous status with the list still draft and the link pending.
-- Part B (informational): every approver (super admin / financial manager) who did NOT source-review this list, i.e. who
-- may press it. No ids printed.
begin;
\i :body
select l.id list_id, c.id contract_id, c.status contract_before from clinic_prices.lists l join public.contracting_entity_contracts c on c.price_list_id = l.id
 where l.name = :'list' and l.deleted_at is null limit 1 \gset
select user_id owner_user from public.admins where id = 'bd5a528f-af8d-4ada-afe9-ce64e68b1d92' \gset
select (set_config('caa.contract', :'contract_id', false) is not null and set_config('caa.list', :'list_id', false) is not null) caa_ok \gset
select 'before' part, json_build_object('contract', :'contract_before', 'list', (select status from clinic_prices.lists where id = :'list_id'),
  'link', (select price_list_link_status from public.contracting_entity_contracts where id = :'contract_id'),
  'owner_did_source_review', exists (select 1 from clinic_prices.audit where list_id = :'list_id' and action = 'source_review' and actor_id = 'bd5a528f-af8d-4ada-afe9-ce64e68b1d92'))::text;
select set_config('request.jwt.claims', json_build_object('sub', :'owner_user', 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table caa(k text, v text) on commit drop;
do $$ begin
  perform public.contracting_contract_activate(current_setting('caa.contract')::uuid);
  insert into caa values ('result', 'ACCEPTED');
exception when others then insert into caa values ('result', 'REFUSED: ' || sqlerrm); end $$;
reset role;
select 'owner_press' part, v from caa where k = 'result';
select 'after' part, json_build_object('contract', c.status, 'unchanged', c.status = :'contract_before', 'list', l.status, 'link', c.price_list_link_status)::text
  from public.contracting_entity_contracts c join clinic_prices.lists l on l.id = c.price_list_id where c.id = :'contract_id';
select 'who_may_press' part, json_agg(json_build_object('role', a.role, 'name', coalesce(nullif(a.name, ''), a.email)) order by a.role)::text
  from public.admins a where a.active and a.role in ('super_admin', 'financial_manager')
   and not exists (select 1 from clinic_prices.audit x where x.list_id = :'list_id' and x.action = 'source_review' and x.actor_id = a.id);
do $$ begin
  if (select v from caa where k = 'result') like 'ACCEPTED%' and (select status from clinic_prices.lists where id = current_setting('caa.list')::uuid) <> 'active'
    then raise exception 'FAIL: half state (contract accepted, list not active)'; end if;
end $$;
select 'verdict' part, 'PASS (rolled back)';
rollback;
