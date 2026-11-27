-- READ ONLY. «قائمة أسعار نقابة التجاريين»: the 27 rows confirmed in the open import file whose service is not a list item
-- (24) or that have no service at all (3). Shows the row as written in the entity's file, its price, the service it was
-- confirmed to (name), and its row index in the batch. List/service names only; no patient data. Ends in ROLLBACK.
begin read only;
select 'rows' part, jsonb_agg(jsonb_build_object('idx', x.idx, 'file_name', x.r->>'name', 'file_code', x.r->>'code', 'price', x.r->>'price',
  'unit', x.r->>'unit', 'confirmed_to', (select s.name from public.pricing_services s where s.id::text = x.r->>'service_id'),
  'service_active', (select s.active from public.pricing_services s where s.id::text = x.r->>'service_id'),
  'kind', case when coalesce(x.r->>'service_id', '') = '' then 'no_service' else 'not_in_list' end) order by x.idx)
from clinic_prices.lists l join clinic_prices.batches b on b.list_id = l.id and b.status = 'draft'
cross join lateral (select (o.n - 1)::int idx, o.r from jsonb_array_elements(b.rows) with ordinality o(r, n)) x
where l.name = 'قائمة أسعار نقابة التجاريين' and l.deleted_at is null and coalesce((x.r->>'confirmed')::boolean, false)
  and not exists (select 1 from clinic_prices.items i where i.list_id = l.id and i.service_id::text = x.r->>'service_id');
rollback;
