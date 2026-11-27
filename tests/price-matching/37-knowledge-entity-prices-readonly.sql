-- READ ONLY. For the WhatsApp agent's per-entity prices (clinic-knowledge «جهات متعاقدين»): which contracts are active
-- today, which have an ACTIVE linked price list, and how many price lines each would show. Counts and shapes only:
-- entity names are replaced by E1, E2, …; no patient data. Wrap: BEGIN READ ONLY … ROLLBACK (this file does it).
begin read only;
with today as (select (now() at time zone 'Africa/Cairo')::date d),
c as (
  select c.id, c.entity_id, c.status, c.start_date, c.end_date, c.discount_percent, c.price_list_id, c.price_list_link_status,
         c.booking_billing_kind, c.booking_coverage, nullif(btrim(coalesce(c.services::text, '')), '') services,
         l.status list_status, l.list_kind, l.mode, l.fallback, l.valid_from, l.valid_to,
         (c.status = 'active' and (c.start_date is null or c.start_date <= t.d) and (c.end_date is null or c.end_date >= t.d)) active_today,
         (c.price_list_id is not null and c.price_list_link_status = 'active' and l.status = 'active' and l.deleted_at is null
           and (l.list_kind = 'reference' or t.d between l.valid_from and l.valid_to)) list_usable,
         (select count(*) from clinic_prices.items i where i.list_id = c.price_list_id) list_items,
         (select count(*) from clinic_prices.items i where i.list_id = c.price_list_id and i.fixed_price > 0) priced_items
  from public.contracting_entity_contracts c cross join today t left join clinic_prices.lists l on l.id = c.price_list_id),
e as (select entity_id, 'E' || row_number() over (order by entity_id) alias from (select distinct entity_id from c) x)
select 'summary' part, jsonb_build_object(
  'contracts', count(*), 'active_today', count(*) filter (where active_today),
  'active_with_usable_list', count(*) filter (where active_today and list_usable),
  'active_percent_only', count(*) filter (where active_today and not coalesce(list_usable, false)),
  'active_linked_but_list_not_usable', count(*) filter (where active_today and price_list_id is not null and not coalesce(list_usable, false)),
  'status_counts', (select jsonb_object_agg(s, n) from (select status s, count(*) n from c group by status) z),
  'billing_kinds', (select jsonb_object_agg(k, n) from (select booking_billing_kind k, count(*) n from c where active_today group by 1) z),
  'entity_types', (select jsonb_object_agg(t, n) from (select ce.entity_type t, count(*) n from c join public.contracting_entities ce on ce.id = c.entity_id where c.active_today group by 1) z))
from c
union all
select 'per_contract', jsonb_agg(jsonb_build_object('entity', e.alias, 'active_today', c.active_today, 'status', c.status,
  'from', c.start_date, 'to', c.end_date, 'discount', c.discount_percent, 'has_services_text', c.services is not null,
  'billing', c.booking_billing_kind, 'coverage', c.booking_coverage, 'list_link', c.price_list_link_status, 'list_status', c.list_status,
  'list_kind', c.list_kind, 'mode', c.mode, 'fallback', c.fallback, 'list_usable', c.list_usable, 'items', c.list_items, 'priced', c.priced_items)
  order by c.active_today desc, c.list_usable desc nulls last, e.alias)
from c join e using (entity_id)
union all
-- sample: the first active contract with a usable list, 5 item lines (fixed price vs the center base)
select 'sample', (select jsonb_build_object('entity', 'E-sample', 'lines', jsonb_agg(x order by x->>'service')) from (
    select jsonb_build_object('service', s.name, 'entity_name_present', i.external_name <> '', 'fixed', i.fixed_price, 'base', s.base_price) x
    from (select * from c where active_today and list_usable order by id limit 1) c
    join clinic_prices.items i on i.list_id = c.price_list_id join public.pricing_services s on s.id = i.service_id
    order by s.name limit 5) q)
union all
-- every non-deleted list: kind/status, how it links to a contract (lists.contract_id and/or contracts.price_list_id),
-- and what blocks activation (draft import batches with rows still unreviewed). Names kept: these are list names, not people.
select 'lists', jsonb_agg(jsonb_build_object('list', l.name, 'kind', l.list_kind, 'status', l.status, 'mode', l.mode,
  'from', l.valid_from, 'to', l.valid_to, 'items', (select count(*) from clinic_prices.items i where i.list_id = l.id),
  'list_contract_set', l.contract_id is not null,
  'linked_by_contracts', (select jsonb_agg(jsonb_build_object('contract_status', c.status, 'link', c.price_list_link_status))
                          from public.contracting_entity_contracts c where c.price_list_id = l.id),
  'draft_batches', (select count(*) from clinic_prices.batches b where b.list_id = l.id and b.status = 'draft'),
  'rows_unreviewed', (select count(*) from clinic_prices.batches b cross join lateral jsonb_array_elements(b.rows) r
                      where b.list_id = l.id and b.status = 'draft' and not coalesce((r->>'confirmed')::boolean, false)
                        and coalesce(r->>'review_status', '') not in ('deferred', 'proposed')),
  'rows_deferred_or_proposed', (select count(*) from clinic_prices.batches b cross join lateral jsonb_array_elements(b.rows) r
                      where b.list_id = l.id and b.status = 'draft' and coalesce(r->>'review_status', '') in ('deferred', 'proposed')))
  order by l.list_kind, l.status, l.name)
from clinic_prices.lists l where l.deleted_at is null
union all
select 'agreements_table', jsonb_build_object('exists', to_regclass('public.contracting_agreements') is not null,
  'reception_entity_contracts', case when to_regclass('clinic_reception.entity_contracts') is not null then 'exists' end);
rollback;
