-- READ ONLY. For each union/insurer reference list linked to a contract: everything that would still block or break
-- «تفعيل العقد» (contracting_contract_activate → decide_list → link) once its last rows are decided, plus what would make
-- its prices fail at reception (clinic_prices.resolve requires the contract dates to cover the day).
-- Unreviewed / deferred / proposed are counted separately. List names are shown (business data); no patient data.
begin read only;
select 'per_list' part, jsonb_agg(jsonb_build_object(
  'list', l.name, 'mode', l.mode, 'list_valid', jsonb_build_array(l.valid_from, l.valid_to),
  'contract_status', c.status, 'contract_dates', jsonb_build_array(c.start_date, c.end_date),
  'contract_dates_cover_today', c.start_date is not null and (now() at time zone 'Africa/Cairo')::date between c.start_date and coalesce(c.end_date, '9999-12-31'),
  'billing', c.booking_billing_kind, 'coverage', c.booking_coverage, 'link', c.price_list_link_status,
  'items', (select count(*) from clinic_prices.items i where i.list_id = l.id),
  'items_without_price', (select count(*) from clinic_prices.items i where i.list_id = l.id and i.fixed_price is null),
  'items_inactive_service', (select count(*) from clinic_prices.items i join public.pricing_services s on s.id = i.service_id where i.list_id = l.id and not s.active),
  'alias_conflicts', (select count(*) from clinic_prices.items i join clinic_prices.aliases a on a.scope_key = 'list:' || l.id::text and a.unit = i.unit
                        and (a.external_name = i.external_name or i.external_code <> '' and a.external_code = i.external_code)
                      where i.list_id = l.id and i.external_name <> '' and a.service_id <> i.service_id),
  'draft_batches', (select count(*) from clinic_prices.batches b where b.list_id = l.id and b.status = 'draft'),
  'unreviewed', (select count(*) from clinic_prices.batches b cross join lateral jsonb_array_elements(b.rows) r where b.list_id = l.id and b.status = 'draft'
                   and not coalesce((r->>'confirmed')::boolean, false) and coalesce(r->>'review_status', '') not in ('deferred', 'proposed')),
  'deferred', (select count(*) from clinic_prices.batches b cross join lateral jsonb_array_elements(b.rows) r where b.list_id = l.id and b.status = 'draft' and r->>'review_status' = 'deferred'),
  'proposed', (select count(*) from clinic_prices.batches b cross join lateral jsonb_array_elements(b.rows) r where b.list_id = l.id and b.status = 'draft' and r->>'review_status' = 'proposed'),
  'excluded_terms', (select count(*) from jsonb_array_elements(c.price_list_terms) t where coalesce((t->>'excluded')::boolean, false)))
  order by l.name)
from clinic_prices.lists l join public.contracting_entity_contracts c on c.price_list_id = l.id
where l.deleted_at is null and l.list_kind = 'reference';
rollback;
