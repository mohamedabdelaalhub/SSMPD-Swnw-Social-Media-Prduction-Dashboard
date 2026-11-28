-- Live dry run of 20261127330000_contract_price_rules. Ends in ROLLBACK: nothing is kept.
-- Run: psql -v ON_ERROR_STOP=1 -v body="$(sed '/^begin;$/d;/^commit;$/d' supabase/migrations/20261127330000_contract_price_rules.sql)" \
--        -v rb="$(sed '/^begin;$/d;/^commit;$/d' supabase/rollbacks/20261127330000_contract_price_rules.rollback.sql)" -f tests/contract-price-rules-live-rollback.sql
-- Proves: (1) no existing price changes — every active contract × up to 40 of its list items, and 200 cash services, give the
-- same resolve() price before and after; (2) the resolve patch is in; (3) the catalog categories to map to groups;
-- (4) the rollback restores resolve and drops everything. Service names and prices only.
begin;
create temp table before_p as
  select k.id contract_id, i.service_id, (clinic_prices.resolve(i.service_id, s.base_price, current_date, k.id)->>'price') price
  from public.contracting_entity_contracts k join lateral (select service_id from clinic_prices.items where list_id = k.price_list_id order by service_id limit 40) i on true
  join public.pricing_services s on s.id = i.service_id
  where k.status = 'active' and k.price_list_link_status = 'active'
  union all
  select null, s.id, (clinic_prices.resolve(s.id, s.base_price, current_date, null)->>'price') from (select id, base_price from public.pricing_services where active order by id limit 200) s;
select 'sampled_prices' part, count(*) from before_p;
:body
select 'resolve_patched (must be t)' part, position('resolve_contract_rules' in prosrc) > 0 from pg_proc where oid = 'clinic_prices.resolve(uuid,numeric,date,uuid)'::regprocedure;
select 'changed_prices (must be 0)' part, count(*) from before_p b
  where b.price is distinct from (clinic_prices.resolve(b.service_id, (select base_price from public.pricing_services where id = b.service_id), current_date, b.contract_id)->>'price');
select 'groups' part, count(*) from clinic_prices.service_groups;
select 'category_to_map' part, category, count(*) services from public.pricing_services where active group by category order by 2;
:rb
select 'rollback_resolve_clean (must be f)' part, position('resolve_contract_rules' in prosrc) > 0 from pg_proc where oid = 'clinic_prices.resolve(uuid,numeric,date,uuid)'::regprocedure;
select 'rollback_tables_gone (must be null)' part, to_regclass('clinic_prices.contract_price_rules');
rollback;
