-- READ-ONLY: does anything on live hard-code the old clean-start day (2026-11-27)? Owner moved it to 2026-12-06.
-- No writes, no temp objects, ends with ROLLBACK. Counts and dates only; no patient names / phones.
begin read only;
-- 1) reception live switch (expected: live_enabled, cutover_at long before 27-11)
select s.live_enabled, s.cutover_at, s.pilot_only from clinic_reception.settings s;
-- 2) period locks (expected: nothing closed through 2026-11-26 or later)
select p.closed_through, p.created_at from clinic_finance.periods p order by 1 desc limit 5;
-- 3) opening batches (expected: none prepared for the clean start yet)
select b.kind, b.status, b.created_at::date created, b.reference from clinic_finance.manual_batches b where b.kind = 'opening' order by b.created_at;
-- 4) any ledger entry dated on/after 27-11 that looks like an opening/cutover (expected 0)
select e.source, count(*) n from clinic_finance.entries e
 where e.business_date >= date '2026-11-27' and e.source in ('opening','manual','cutover','adjustment') group by 1;
-- 5) scheduled jobs mentioning the date (expected 0 rows; skipped if pg_cron is absent)
do $$ begin
  if to_regclass('cron.job') is not null then
    raise notice 'cron jobs mentioning 2026-11-27 / 11-27: %', (select count(*) from cron.job where command ~ '2026-11-27|11-27');
  else raise notice 'pg_cron not installed'; end if;
end $$;
-- 6) function bodies in finance/reception schemas that hard-code the date (expected 0)
select n.nspname, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('clinic_finance', 'clinic_reception', 'public') and prosrc ~ '2026-11-27';
rollback;
