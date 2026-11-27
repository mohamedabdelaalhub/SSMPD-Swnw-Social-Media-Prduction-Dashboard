-- Dry run of 20261127200000_catalog_duplicates_cleanup on the live server. Ends in ROLLBACK: nothing is kept.
-- Run: psql -v ON_ERROR_STOP=1 -v body="$(sed '/^begin;$/d;/^commit;$/d' supabase/migrations/20261127200000_catalog_duplicates_cleanup.sql)" \
--        -v rb="$(sed '/^begin;$/d;/^commit;$/d' supabase/rollbacks/20261127200000_catalog_duplicates_cleanup.rollback.sql)" -f tests/catalog-duplicates-cleanup-live-rollback.sql
-- Shows, per service touched: name, active, list items, aliases, live reception rows, future booked appointments — before and
-- after; the audit steps; a second run adds nothing; the rollback restores everything. Service names and counts only.
begin;
create temp view v as
  select s.canonical_code, s.name, s.active, s.booking_enabled,
    (select count(*) from clinic_prices.items i where i.service_id = s.id) items,
    (select count(*) from clinic_prices.aliases a where a.service_id = s.id) aliases,
    (select count(*) from clinic_reception.services r where r.pricing_service_id = s.id and r.active) reception_rows,
    (select count(*) from clinic_reception.appointments a join clinic_reception.services r on r.id = a.service_id
      where r.pricing_service_id = s.id and a.status = 'booked' and a.starts_at > now()) future_booked
  from public.pricing_services s
  where s.canonical_code in ('SVC-0000517','SVC-0000514','SVC-0000879','SVC-0000878','SVC-0000997','SVC-0000996','SVC-0000230','SVC-0000058',
                             'SVC-0000379','SVC-0000294','SVC-0001142','SVC-0001135','SVC-0001330','SVC-0000283','SVC-0001061','SVC-0000869');
create temp table before_v as select * from v;
select 'before' part, * from v order by 2;
:body
select 'after' part, * from v order by 2;
select 'audit' part, details->>'step' step, count(*) from clinic_prices.audit where details->>'migration' = '20261127200000' group by 2 order by 2;
create temp table n1 as select count(*) n from clinic_prices.audit where details->>'migration' = '20261127200000';
:body
select 'second_run_new_rows (must be 0)' part, (select count(*) from clinic_prices.audit where details->>'migration' = '20261127200000') - (select n from n1);
:rb
select 'restored_diff (must be 0)' part, count(*) from ((select * from v except select * from before_v) union all (select * from before_v except select * from v)) d;
rollback;
