-- Dry run of 20261127190000_sehha_one_psychiatry_300. Ends in ROLLBACK: nothing is kept.
-- Run: psql -v ON_ERROR_STOP=1 -v body="$(sed '/^begin;$/d;/^commit;$/d' supabase/migrations/20261127190000_sehha_one_psychiatry_300.sql)" \
--        -v rb="$(sed '/^begin;$/d;/^commit;$/d' supabase/rollbacks/20261127190000_sehha_one_psychiatry_300.rollback.sql)" -f tests/sehha-one-psychiatry-live-rollback.sql
begin;
create temp view v as select s.canonical_code, s.name, i.fixed_price from public.contracting_entity_contracts k
  join public.contracting_entities e on e.id = k.entity_id join clinic_prices.items i on i.list_id = k.price_list_id
  join public.pricing_services s on s.id = i.service_id where e.name ~* 'صح[ةه]\s*وان' and k.status = 'active' and s.canonical_code in ('SVC-0001371','SVC-0001372','SVC-0001380');
create temp table before_v as select * from v;
select 'before' part, * from v order by 2;
:body
select 'after' part, * from v order by 2;
:body
select 'audit_rows (must be 1)' part, count(*) from clinic_prices.audit where details->>'migration' = '20261127190000';
:rb
select 'restored_diff (must be 0)' part, count(*) from ((select * from v except select * from before_v) union all (select * from before_v except select * from v)) d;
rollback;
