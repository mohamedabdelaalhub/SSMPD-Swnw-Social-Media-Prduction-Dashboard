-- Rollback of 20261123170000_package_offers.sql: removes the triggers, functions and the new columns. Packages already sold keep
-- their own expires_on (unchanged by the migration); the snapshotted min_first_percent column is dropped with the rule.
begin;
drop trigger if exists trg_package_offer_on_first_session on clinic_reception.packages;
drop trigger if exists trg_package_offer_on_payment on clinic_reception.payments;
drop trigger if exists trg_package_offer_on_sale on clinic_reception.packages;
drop trigger if exists trg_package_template_offer_copy on clinic_reception.package_templates;
do $$ begin
  if to_regclass('public.pricing_packages') is not null then
    drop trigger if exists trg_pricing_package_offer_sync on public.pricing_packages;
    alter table public.pricing_packages drop constraint if exists pricing_packages_min_first_chk,
      drop constraint if exists pricing_packages_sell_window_chk,
      drop column if exists booking_sell_from, drop column if exists booking_sell_until, drop column if exists booking_min_first_percent;
  end if;
end $$;
drop function if exists clinic_reception.package_offer_on_first_session();
drop function if exists clinic_reception.package_offer_on_payment();
drop function if exists clinic_reception.package_offer_on_sale();
drop function if exists clinic_reception.package_min_payment(uuid);
drop function if exists public.pricing_package_offer_sync();
drop function if exists clinic_reception.package_template_offer_copy();
alter table clinic_reception.packages drop column if exists min_first_percent;
alter table clinic_reception.package_templates drop constraint if exists package_templates_sell_window_chk,
  drop column if exists sell_from, drop column if exists sell_until, drop column if exists min_first_percent;
commit;
