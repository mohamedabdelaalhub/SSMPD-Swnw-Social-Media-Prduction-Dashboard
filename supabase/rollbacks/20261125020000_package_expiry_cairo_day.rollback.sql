-- Rollback of 20261125020000_package_expiry_cairo_day.sql (packages sold meanwhile keep their Cairo-based expiry).
begin;
drop trigger if exists trg_package_expiry_cairo_day on clinic_reception.packages;
drop function if exists clinic_reception.package_expiry_cairo_day();
commit;
