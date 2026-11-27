-- Rollback of 20261125120000_package_fixed_price.sql. Templates keep the price they have now until the next sync_catalog run
-- rebuilds them at the margin price (fingerprints cleared for packages that had a fixed price). Sold packages are untouched.
begin;
update clinic_reception.package_templates t set source_fingerprint = null
 where t.active and exists (select 1 from public.pricing_packages p where p.id = t.pricing_package_id and p.booking_fixed_price is not null);
drop trigger if exists trg_pricing_package_fixed_price_sync on public.pricing_packages;
drop trigger if exists trg_package_template_fixed_price on clinic_reception.package_templates;
drop function if exists public.pricing_package_fixed_price_sync();
drop function if exists clinic_reception.package_template_fixed_price();
alter table public.pricing_packages drop constraint if exists pricing_packages_fixed_price_chk, drop column if exists booking_fixed_price;
commit;
