-- READ ONLY. Before «تفعيل العقد» on the live union/insurer lists: rows that are CONFIRMED in the list's open import file
-- but whose service is NOT a list item (the exact set the applied 20261127050000 auto-close could drop). Expect 0 everywhere.
-- Also: confirmed rows without a service, deferred, proposed and undecided counts. List names only; no patient data.
begin read only;
select 'per_list' part, jsonb_agg(jsonb_build_object('list', l.name, 'contract_status', c.status, 'open_files', x.files,
  'confirmed_not_in_list', x.at_risk, 'confirmed_no_service', x.no_service, 'confirmed_in_list', x.safe,
  'deferred', x.deferred, 'proposed', x.proposed, 'undecided', x.undecided) order by l.name)
from clinic_prices.lists l join public.contracting_entity_contracts c on c.price_list_id = l.id
cross join lateral (
  select count(distinct b.id) files,
    count(*) filter (where coalesce((r->>'confirmed')::boolean, false) and coalesce(r->>'service_id', '') <> ''
                     and not exists (select 1 from clinic_prices.items i where i.list_id = l.id and i.service_id::text = r->>'service_id')) at_risk,
    count(*) filter (where coalesce((r->>'confirmed')::boolean, false) and coalesce(r->>'service_id', '') = '') no_service,
    count(*) filter (where coalesce((r->>'confirmed')::boolean, false)
                     and exists (select 1 from clinic_prices.items i where i.list_id = l.id and i.service_id::text = r->>'service_id')) safe,
    count(*) filter (where r->>'review_status' = 'deferred') deferred,
    count(*) filter (where r->>'review_status' = 'proposed') proposed,
    count(*) filter (where not coalesce((r->>'confirmed')::boolean, false) and coalesce(r->>'review_status', '') not in ('deferred', 'proposed')) undecided
  from clinic_prices.batches b cross join lateral jsonb_array_elements(b.rows) r
  where b.list_id = l.id and b.status = 'draft') x
where l.list_kind = 'reference' and l.deleted_at is null and l.status = 'draft' and c.status not in ('expired');
select 'total_at_risk' part, coalesce(sum(n), 0)::text from (
  select count(*) n from clinic_prices.lists l join clinic_prices.batches b on b.list_id = l.id and b.status = 'draft'
  cross join lateral jsonb_array_elements(b.rows) r
  where l.list_kind = 'reference' and l.deleted_at is null and coalesce((r->>'confirmed')::boolean, false)
    and not exists (select 1 from clinic_prices.items i where i.list_id = l.id and i.service_id::text = r->>'service_id')) z;
rollback;
