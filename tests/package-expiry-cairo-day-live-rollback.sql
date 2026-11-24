-- Live rollback check for #821: 20261125020000_package_expiry_cairo_day.sql (sale) + 20261125060000_package_use_cairo_day.sql
-- (use). ONE transaction ending in ROLLBACK, as postgres. Live clinic_reception.packages is empty, so the sale trigger is
-- exercised on a temp table with the SAME columns (CREATE TABLE AS … LIMIT 0) carrying the same trigger function.
-- The session time zone is set to a zone whose date differs from Cairo's right now, so the shift is visible. Nothing is kept.
begin;
-- >>> paste supabase/migrations/20261125020000_package_expiry_cairo_day.sql here WITHOUT its own begin / commit <<<
-- >>> paste supabase/migrations/20261125060000_package_use_cairo_day.sql here WITHOUT its own begin / commit <<<
create temp table pe_live(n serial, step text, expected text, actual text, ok boolean);
do $$ declare tz text; got date; want date; srv date; begin
  tz := case when extract(hour from now() at time zone 'Africa/Cairo') >= 12 then 'Pacific/Kiritimati' else 'Pacific/Honolulu' end;
  execute format('set local timezone = %L', tz);
  srv := current_date; want := (now() at time zone 'Africa/Cairo')::date + 120;
  insert into pe_live(step, expected, actual, ok) values ('session ' || tz || ': server date / Cairo date', 'different', srv || ' / ' || (now() at time zone 'Africa/Cairo')::date, srv <> (now() at time zone 'Africa/Cairo')::date);
  create temp table pe_pkg as select * from clinic_reception.packages limit 0;   -- same columns, no NOT NULL / FK
  create trigger pe_t before insert on pe_pkg for each row execute function clinic_reception.package_expiry_cairo_day();
  insert into pe_pkg(expires_on) values (current_date + 120) returning expires_on into got;
  insert into pe_live(step, expected, actual, ok) values ('sale: expiry of a package stamped current_date + 120', want::text, got::text, got = want);
  begin
    insert into pe_pkg(expires_on, legacy_paid_on) values (date '2027-01-01', date '2026-11-15') returning expires_on into got;
    insert into pe_live(step, expected, actual, ok) values ('sale: legacy package keeps the typed date', '2027-01-01', got::text, got = date '2027-01-01');
  exception when undefined_column then insert into pe_live(step, expected, actual, ok) values ('sale: legacy package', 'n/a', 'no legacy_paid_on column', true); end;
end $$;
-- use: no function keeps the server-date check; the patched ones use the Cairo date
insert into pe_live(step, expected, actual, ok)
  select 'use: functions patched (saved bodies)', '≥ 1', count(*)::text || ': ' || coalesce(string_agg(fn::text, ', '), ''), count(*) >= 1 from clinic_reception.package_use_cairo_saved;
insert into pe_live(step, expected, actual, ok)
  select 'use: functions still on the server date', '0', count(*)::text, count(*) = 0
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname in ('clinic_reception', 'public') and p.prokind = 'f' and position('pkg.expires_on<current_date' in pg_get_functiondef(p.oid)) > 0;
select step, expected, actual, ok from pe_live order by n;
rollback;
