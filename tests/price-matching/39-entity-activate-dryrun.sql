-- DRY-RUN (rolled back) of the owner's two clicks for ONE entity, as the owner (super admin):
--   1. «الخدمات ولوائح الأسعار» → the list → «الاستيراد والمراجعة» → the batch → «استبعاد دفعة الاستيراد بالكامل…»
--      = price_import_command('discard_batch', {list_id, list_revision, id, revision})
--   2. «جهات التعاقد» → the entity → its contract → «تفعيل العقد» = contracting_contract_activate(contract)
-- Then: the list is active, the link is active, and the contract prices a sample of 5 services the way reception would.
-- Usage: psql -v ON_ERROR_STOP=1 -v list='قائمة أسعار مصر لتامينات الحياة' -v owner=<auth.users id of the owner> -f this file
-- Optional: -v feed=/tmp/ckf_body.sql to also inline the #912 RPC and show the WhatsApp lines (default /dev/null).
begin;
\if :{?feed}
\i :feed
\endif
select l.id list_id, l.revision list_rev, b.id batch_id, b.revision batch_rev, c.id contract_id
from clinic_prices.lists l join public.contracting_entity_contracts c on c.price_list_id = l.id
left join clinic_prices.batches b on b.list_id = l.id and b.status = 'draft'
where l.name = :'list' and l.deleted_at is null order by b.created_at limit 1 \gset
select 'before' part, json_build_object('list_status', (select status from clinic_prices.lists where id = :'list_id'),
  'draft_batches', (select count(*) from clinic_prices.batches where list_id = :'list_id' and status = 'draft'),
  'items', (select count(*) from clinic_prices.items where list_id = :'list_id'),
  'contract_status', (select status from public.contracting_entity_contracts where id = :'contract_id'),
  'contract_dates', (select json_build_array(start_date, end_date) from public.contracting_entity_contracts where id = :'contract_id'),
  'link', (select price_list_link_status from public.contracting_entity_contracts where id = :'contract_id'))::text;
select set_config('request.jwt.claims', json_build_object('sub', :'owner', 'role', 'authenticated')::text, true);
set local role authenticated;
select 'actor' part, json_build_object('admin', public.my_admin_id() is not null, 'role', public.my_role())::text;
select 'step1_discard_batch' part, public.price_import_command('discard_batch',
  json_build_object('list_id', :'list_id', 'list_revision', :'list_rev', 'id', :'batch_id', 'revision', :'batch_rev')::jsonb)::text
  where :'batch_id' <> '';
select 'step2_activate' part, public.contracting_contract_activate(:'contract_id')::text;
reset role;
select 'after' part, json_build_object('list_status', (select status from clinic_prices.lists where id = :'list_id'),
  'items', (select count(*) from clinic_prices.items where list_id = :'list_id'),
  'contract_status', (select status from public.contracting_entity_contracts where id = :'contract_id'),
  'link', (select price_list_link_status from public.contracting_entity_contracts where id = :'contract_id'))::text;
select set_config('dr.contract', :'contract_id', true);
create temp table s5 on commit drop as
  select s.id, s.name, s.base_price from clinic_prices.items i join public.pricing_services s on s.id = i.service_id and s.active
  where i.list_id = :'list_id' order by s.name limit 5;
do $$ declare r record; cash numeric; p jsonb; out jsonb := '[]';
begin
  for r in select * from s5 loop
    begin
      cash := (clinic_prices.resolve(r.id, r.base_price, (now() at time zone 'Africa/Cairo')::date, null)->>'price')::numeric;
      p := clinic_prices.resolve(r.id, cash, (now() at time zone 'Africa/Cairo')::date, current_setting('dr.contract')::uuid);
      out := out || jsonb_build_object('service', r.name, 'cash', cash, 'contract_price', p->>'price', 'source', p->>'source');
    exception when others then out := out || jsonb_build_object('service', r.name, 'error', sqlerrm); end;
  end loop;
  raise notice 'sample_prices %', out;
end $$;
\if :{?feed}
select 'whatsapp_lines' part, (select jsonb_build_object('has_list', e->'has_list', 'first3', jsonb_path_query_array(e->'lines', '$[0 to 2]'), 'more', e->'more')
  from jsonb_array_elements(public.clinic_knowledge_feed()->'entities') e
  where e->>'entity' = (select ce.name from public.contracting_entities ce join public.contracting_entity_contracts c on c.entity_id = ce.id where c.id = :'contract_id'))::text;
\endif
rollback;
