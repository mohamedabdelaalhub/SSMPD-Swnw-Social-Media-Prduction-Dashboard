-- Package USE counts the Cairo date too (owner 2026-11-25 «اظبط استخدام الباكج كمان بتاريخ القاهرة»; sale side: 20261125020000).
-- Executing a package session checks «pkg.expires_on<current_date» (20261017041727, clinic_reception.service_operation and any
-- function that inherited that body through the wrapper chain). current_date is the server date (UTC), so between 00:00 and
-- 02:00 Cairo a package that expired «yesterday» in Cairo was still usable. Every live function in clinic_reception / public
-- whose body holds that exact check is patched in place to the Cairo date; old bodies are saved for the rollback.
-- (The booking check already uses the booking's Cairo date; the legacy-package use already uses the Cairo date.)
-- Rollback: supabase/rollbacks/20261125030000_package_use_cairo_day.rollback.sql
begin;

create table if not exists clinic_reception.package_use_cairo_saved(fn regprocedure primary key, def text not null);
revoke all on clinic_reception.package_use_cairo_saved from public, anon, authenticated;

do $$
declare r record; d text; n int := 0;
  a constant text := 'pkg.expires_on<current_date';
  b constant text := 'pkg.expires_on<(now() at time zone ''Africa/Cairo'')::date';
begin
  if exists (select 1 from clinic_reception.package_use_cairo_saved) then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
  for r in select p.oid::regprocedure fn from pg_proc p join pg_namespace s on s.oid = p.pronamespace
            where s.nspname in ('clinic_reception', 'public') and p.prokind = 'f' and position(a in pg_get_functiondef(p.oid)) > 0 loop
    d := pg_get_functiondef(r.fn);
    insert into clinic_reception.package_use_cairo_saved values (r.fn, d);
    execute replace(d, a, b);
    n := n + 1;
    raise notice 'patched %', r.fn;
  end loop;
  if n = 0 then raise exception 'no function holds «%» — nothing to patch', a; end if;
end $$;

commit;
