-- «فعّل العقود»: for every current union/insurer price list (reference, draft, linked to a non-expired contract, with items),
-- as the OWNER (super admin bd5a528f…, real JWT):
--   1. close its open import batch = price_import_command('discard_batch')  (screen: «استبعاد دفعة الاستيراد بالكامل…»)
--   2. «تفعيل العقد» = contracting_contract_activate(contract)             (screen: «جهات التعاقد» → العقد → «تفعيل العقد»)
--   3. assert contract active, list active, link active, price_list 'active', no message
--   4. price 3 sample services per entity with clinic_prices.resolve(today)
-- APPLY version of 40 (identical except this line and the last line, COMMIT). Run ONLY after 40 passed and the owner said «فعّل العقود».
-- Usage: psql -v ON_ERROR_STOP=1 -v expect=8 -f tests/price-matching/40-activate-entity-contracts-dryrun.sql
begin;
select user_id owner_user from public.admins where id = 'bd5a528f-af8d-4ada-afe9-ce64e68b1d92' and active \gset
create temp table ac on commit drop as
  select l.id list_id, l.name list_name, l.revision list_rev, b.id batch_id, b.revision batch_rev, c.id contract_id, c.booking_billing_kind billing,
         null::text step1, null::jsonb step2
  from clinic_prices.lists l
  join public.contracting_entity_contracts c on c.price_list_id = l.id and c.status not in ('expired', 'suspended', 'cancelled')
  left join lateral (select b.id, b.revision from clinic_prices.batches b where b.list_id = l.id and b.status = 'draft' order by b.created_at limit 1) b on true
  where l.list_kind = 'reference' and l.status = 'draft' and l.deleted_at is null
    and exists (select 1 from clinic_prices.items i where i.list_id = l.id);
grant all on ac to authenticated;
select set_config('ac.expect', :'expect', true);
do $$ begin
  if (select count(*) from ac) <> current_setting('ac.expect')::int then raise exception 'expected % lists, found %: %', current_setting('ac.expect'), (select count(*) from ac), (select string_agg(list_name, ' | ') from ac); end if;
  if exists (select 1 from ac a join clinic_prices.batches b on b.list_id = a.list_id and b.status = 'draft'
             cross join lateral jsonb_array_elements(b.rows) r
             where not coalesce((r->>'confirmed')::boolean, false) and coalesce(r->>'review_status', '') not in ('deferred', 'proposed'))
    then raise exception 'a list still has unreviewed rows; finish «مراجعة أسماء الجهات» first'; end if;
end $$;
select 'before' part, json_agg(json_build_object('list', list_name, 'billing', billing, 'has_batch', batch_id is not null) order by list_name)::text from ac;

select set_config('request.jwt.claims', json_build_object('sub', :'owner_user', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ declare a record; begin
  if public.my_admin_id() is distinct from 'bd5a528f-af8d-4ada-afe9-ce64e68b1d92'::uuid then raise exception 'not running as the owner'; end if;
  for a in select * from ac order by list_name loop
    if a.batch_id is not null then
      perform public.price_import_command('discard_batch', jsonb_build_object('list_id', a.list_id, 'list_revision', a.list_rev, 'id', a.batch_id, 'revision', a.batch_rev));
      update ac set step1 = 'discarded' where list_id = a.list_id;
    end if;
    update ac set step2 = public.contracting_contract_activate(a.contract_id) where list_id = a.list_id;
  end loop;
end $$;
reset role;

select 'after' part, json_agg(json_build_object('list', a.list_name, 'batch', a.step1, 'price_list', a.step2->>'price_list', 'message', a.step2->>'price_list_message',
  'contract', c.status, 'list_status', l.status, 'link', c.price_list_link_status,
  'open_batches', (select count(*) from clinic_prices.batches b where b.list_id = a.list_id and b.status = 'draft'),
  'items', (select count(*) from clinic_prices.items i where i.list_id = a.list_id)) order by a.list_name)::text
from ac a join public.contracting_entity_contracts c on c.id = a.contract_id join clinic_prices.lists l on l.id = a.list_id;
do $$ declare a record; s record; cash numeric; p jsonb; bad int := 0; out jsonb := '[]';
begin
  for a in select x.*, c.status cst, l.status lst, c.price_list_link_status lnk from ac x join public.contracting_entity_contracts c on c.id = x.contract_id
           join clinic_prices.lists l on l.id = x.list_id order by x.list_name loop
    if a.cst <> 'active' or a.lst <> 'active' or a.lnk <> 'active' or a.step2->>'price_list' <> 'active' or nullif(a.step2->>'price_list_message', '') is not null then
      raise exception 'FAIL %: contract %, list %, link %, price_list %, message %', a.list_name, a.cst, a.lst, a.lnk, a.step2->>'price_list', a.step2->>'price_list_message'; end if;
    for s in select sv.id, sv.base_price from clinic_prices.items i join public.pricing_services sv on sv.id = i.service_id and sv.active
             where i.list_id = a.list_id order by sv.name limit 3 loop
      begin
        cash := (clinic_prices.resolve(s.id, s.base_price, (now() at time zone 'Africa/Cairo')::date, null)->>'price')::numeric;
        p := clinic_prices.resolve(s.id, cash, (now() at time zone 'Africa/Cairo')::date, a.contract_id);
        out := out || jsonb_build_object('list', a.list_name, 'cash', cash, 'contract_price', p->>'price', 'source', p->>'source');
      exception when others then bad := bad + 1; out := out || jsonb_build_object('list', a.list_name, 'error', sqlerrm); end;
    end loop;
  end loop;
  raise notice 'samples %', out;
  if bad > 0 then raise exception 'FAIL: % sample prices could not be resolved', bad; end if;
end $$;
select 'verdict' part, 'PASS: ' || (select count(*) from ac) || ' contracts, lists and links active';
commit;
