-- Live rollback check for 20261125030000_package_use_cairo_day.sql. ONE transaction ending in ROLLBACK, as postgres.
-- Lists the live functions that hold the server-date package check, applies the migration, and shows that no function
-- keeps «pkg.expires_on<current_date» and each patched one now uses the Cairo date. Nothing is kept.
begin;
create temp table pu_live(n serial, step text, expected text, actual text, ok boolean);
insert into pu_live(step, expected, actual, ok)
  select 'functions with the server-date package check (before)', '≥ 1', count(*)::text || ': ' || coalesce(string_agg(p.oid::regprocedure::text, ', '), ''), count(*) >= 1
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname in ('clinic_reception', 'public') and p.prokind = 'f' and position('pkg.expires_on<current_date' in pg_get_functiondef(p.oid)) > 0;
-- >>> paste supabase/migrations/20261125030000_package_use_cairo_day.sql here WITHOUT its own begin / commit <<<
insert into pu_live(step, expected, actual, ok)
  select 'after: functions still on the server date', '0', count(*)::text, count(*) = 0
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname in ('clinic_reception', 'public') and p.prokind = 'f' and position('pkg.expires_on<current_date' in pg_get_functiondef(p.oid)) > 0;
insert into pu_live(step, expected, actual, ok)
  select 'after: patched functions use the Cairo date', (select count(*) from clinic_reception.package_use_cairo_saved)::text, count(*)::text,
         count(*) = (select count(*) from clinic_reception.package_use_cairo_saved)
    from clinic_reception.package_use_cairo_saved x where position('pkg.expires_on<(now() at time zone ''Africa/Cairo'')::date' in pg_get_functiondef(x.fn)) > 0;
select step, expected, actual, ok from pu_live order by n;
rollback;
