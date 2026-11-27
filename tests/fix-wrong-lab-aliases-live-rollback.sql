-- Dry run of 20261127080000_fix_wrong_lab_aliases on the live server. Ends in ROLLBACK: nothing is kept.
-- Run: psql -v ON_ERROR_STOP=1 -v body="$(sed '/^begin;$/d;/^commit;$/d' supabase/migrations/20261127080000_fix_wrong_lab_aliases.sql)" \
--        -v rb="$(sed '/^begin;$/d;/^commit;$/d' supabase/migrations/20261127080000_fix_wrong_lab_aliases.rollback.sql)" -f tests/fix-wrong-lab-aliases-live-rollback.sql
-- Shows: (1) orders already priced from the wrong items (must be 0, else the fix stops), (2) items/aliases before,
-- (3) the fix, (4) items/aliases after plus the audit rows it wrote, (5) a second run changes nothing, (6) the rollback
-- file restores the before state. Staff/service names and prices only; no patient data.
begin;
create temp view tw as
  select l.name list, s.name service, i.id item_id, i.fixed_price, i.discount_percent, i.discount_amount
  from clinic_prices.items i join clinic_prices.lists l on l.id = i.list_id join public.pricing_services s on s.id = i.service_id
  where s.name in ('CMV PCR Qualitative In Urine', 'Troponin T') or s.name ~* '^\s*aminogram|^\s*troponin\s*i\M';
create temp view ta as
  select l.name list, a.external_name, s.name service from clinic_prices.aliases a join clinic_prices.lists l on l.id = a.list_id
  join public.pricing_services s on s.id = a.service_id where a.external_name ~* '^\s*aminogram|^\s*troponin\s*i\M';
select 'orders_on_wrong_items' part, count(*) from clinic_reception.orders o
  where exists (select 1 from clinic_prices.items i join public.pricing_services s on s.id = i.service_id
    where s.name in ('CMV PCR Qualitative In Urine', 'Troponin T') and o.snapshot::text like '%' || i.id::text || '%');
select 'right_services' part, name, active from public.pricing_services where name ~* '^\s*aminogram|^\s*troponin\s*i\M';
create temp table before_items as select * from tw; create temp table before_aliases as select * from ta;
select 'before_items' part, * from tw order by 2, 3;
select 'before_aliases' part, * from ta order by 2, 3;
:body
select 'after_items' part, * from tw order by 2, 3;
select 'after_aliases' part, * from ta order by 2, 3;
select 'audit' part, details->>'step' step, count(*) from clinic_prices.audit where details->>'migration' = '20261127080000' group by 2 order by 2;
create temp table audit_n as select count(*) n from clinic_prices.audit where details->>'migration' = '20261127080000';
:body
select 'second_run_new_audit_rows (must be 0)' part, (select count(*) from clinic_prices.audit where details->>'migration' = '20261127080000') - (select n from audit_n) n;
:rb
select 'restored_items_diff (must be 0)' part, (select count(*) from ((select * from tw except select * from before_items) union all (select * from before_items except select * from tw)) d) n;
select 'restored_aliases_diff (must be 0)' part, (select count(*) from ((select * from ta except select * from before_aliases) union all (select * from before_aliases except select * from ta)) d) n;
rollback;
