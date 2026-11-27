-- Dry run of 20261127160000_tugareen_vitamin_d_h_fix on the live server. Ends in ROLLBACK: nothing is kept.
-- Run: psql -v ON_ERROR_STOP=1 -v body="$(sed '/^begin;$/d;/^commit;$/d' supabase/migrations/20261127160000_tugareen_vitamin_d_h_fix.sql)" \
--        -v rb="$(sed '/^begin;$/d;/^commit;$/d' supabase/rollbacks/20261127160000_tugareen_vitamin_d_h_fix.rollback.sql)" -f tests/tugareen-vitamin-fix-live-rollback.sql
-- Service names and prices only; no patient data.
begin;
create temp view v as select s.name, i.fixed_price from clinic_prices.items i join clinic_prices.lists l on l.id = i.list_id
  join public.pricing_services s on s.id = i.service_id where l.name = 'قائمة أسعار نقابة التجاريين' and s.name ~* '^\s*vitamin\s*(h\M|d\s*\(25)';
create temp table before_v as select * from v;
select 'before' part, * from v order by 2;
:body
select 'after' part, * from v order by 2;
select 'row' part, o.n - 1 idx, o.r->>'name' name, (select name from public.pricing_services where id::text = o.r->>'service_id') linked_to, o.r->>'confirmed' confirmed, o.r->>'review_status' review
  from clinic_prices.batches b join clinic_prices.lists l on l.id = b.list_id cross join lateral jsonb_array_elements(b.rows) with ordinality o(r, n)
 where l.name = 'قائمة أسعار نقابة التجاريين' and b.status = 'draft' and o.r->>'name' ~* '^\s*vitamin\s*(h\M|d)';
:body
select 'second_run_audit_rows (must be 3)' part, count(*) from clinic_prices.audit where details->>'migration' = '20261127160000';
:rb
select 'restored_diff (must be 0)' part, count(*) from ((select * from v except select * from before_v) union all (select * from before_v except select * from v)) d;
rollback;
