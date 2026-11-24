-- Package validity counts from the CAIRO date (owner 2026-11-25 «اه خلي السيستم يستخدم تاريخ القاهرة»).
-- The sale (package_sell and its wrappers) stamps expires_on = current_date + validity_days. current_date is the SERVER
-- date (UTC), so a package sold between 00:00 and 02:00 Cairo got an expiry one day early. A BEFORE INSERT trigger moves
-- expires_on by the difference between the Cairo date and the server date (0 most of the day, +1 in that window), so
-- every sale path is covered without touching the sale functions. A legacy package registered by hand
-- (legacy_paid_on set, 20261123110000) keeps the date reception typed. Packages already sold are not changed.
-- Rollback: supabase/rollbacks/20261125020000_package_expiry_cairo_day.rollback.sql
begin;

do $$ begin
  if to_regclass('clinic_reception.packages') is null then raise exception 'مكونات الباكجات غير موجودة'; end if;
  if to_regprocedure('clinic_reception.package_expiry_cairo_day()') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create function clinic_reception.package_expiry_cairo_day() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.expires_on is not null and (to_jsonb(new)->>'legacy_paid_on') is null then
    new.expires_on := new.expires_on + ((now() at time zone 'Africa/Cairo')::date - current_date);
  end if;
  return new;
end $$;
revoke all on function clinic_reception.package_expiry_cairo_day() from public, anon, authenticated;
create trigger trg_package_expiry_cairo_day before insert on clinic_reception.packages
  for each row execute function clinic_reception.package_expiry_cairo_day();

commit;
