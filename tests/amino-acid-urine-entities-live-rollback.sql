-- Dry run of 20261127210000_amino_acid_urine_entity_prices. Ends in ROLLBACK: nothing is kept.
-- Run: psql -v ON_ERROR_STOP=1 -v body="$(sed '/^begin;$/d;/^commit;$/d' supabase/migrations/20261127210000_amino_acid_urine_entity_prices.sql)" \
--        -v rb="$(sed '/^begin;$/d;/^commit;$/d' supabase/rollbacks/20261127210000_amino_acid_urine_entity_prices.rollback.sql)" -f tests/amino-acid-urine-entities-live-rollback.sql
begin;
create temp view v as select l.name list, i.fixed_price, (select count(*) from clinic_prices.aliases a where a.service_id = s.id and a.list_id = l.id) aliases
  from clinic_prices.items i join clinic_prices.lists l on l.id = i.list_id join public.pricing_services s on s.id = i.service_id where s.canonical_code = 'SVC-0000304';
create temp table before_v as select * from v;
select 'before' part, * from v order by 2;
:body
select 'after' part, * from v order by 2;
select 'resolve_check' part, l.name, (clinic_prices.resolve(s.id, 2700, current_date, k.id)->>'price') contract_price
  from public.contracting_entity_contracts k join clinic_prices.lists l on l.id = k.price_list_id, public.pricing_services s
 where s.canonical_code = 'SVC-0000304' and k.status = 'active' and translate(l.name,'أإآ','ااا') ~ '(ميد نت|مصر هيلث كير|ميد شور|نقابة الاطباء.*2026)';
create temp table n1 as select count(*) n from clinic_prices.audit where details->>'migration' = '20261127210000';
:body
select 'second_run_new_rows (must be 0)' part, (select count(*) from clinic_prices.audit where details->>'migration' = '20261127210000') - (select n from n1);
:rb
select 'restored_diff (must be 0)' part, count(*) from ((select * from v except select * from before_v) union all (select * from before_v except select * from v)) d;
rollback;
