-- Fixed package price (owner's packages/offers sheet 2026-11-25, relayed by main chat 5).
-- Today a reception template's price = Σ current reception prices of its services × (1 + margin) — so a package moves every time a
-- service price moves (e.g. on 2026-12-01 the White Friday offer prices end and the 15 «3 جلسات» packages would rise).
-- New: public.pricing_packages.booking_fixed_price. NULL = today's behaviour (margin). When set, every reception template of that
-- package carries exactly that price, whatever the service prices are. Sold packages keep their own contract price (snapshot).
--   * BEFORE INSERT on clinic_reception.package_templates (sync_catalog inserts a new version) → price := fixed price.
--   * AFTER UPDATE of booking_fixed_price on public.pricing_packages → active templates take the new price (same pattern as
--     trg_pricing_package_offer_sync in 20261123170000).
-- sync_catalog is NOT replaced; its lines (standalone prices) and fingerprints stay as they are.
-- Rollback: supabase/rollbacks/20261125120000_package_fixed_price.rollback.sql
begin;

do $$ begin
  if to_regclass('public.pricing_packages') is null or to_regclass('clinic_reception.package_templates') is null then
    raise exception 'مكونات الباكجات غير موجودة'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pricing_packages'
             and column_name = 'booking_fixed_price') then
    raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

alter table public.pricing_packages add column booking_fixed_price numeric(14,2)
  constraint pricing_packages_fixed_price_chk check (booking_fixed_price is null or (booking_fixed_price > 0 and booking_fixed_price::text not in ('NaN','Infinity')));

create function clinic_reception.package_template_fixed_price() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare fp numeric;
begin
  if new.pricing_package_id is not null then
    select booking_fixed_price into fp from public.pricing_packages where id = new.pricing_package_id;
    if fp is not null then new.price := fp; end if;
  end if;
  return new;
end $$;
revoke all on function clinic_reception.package_template_fixed_price() from public, anon, authenticated;
create trigger trg_package_template_fixed_price before insert on clinic_reception.package_templates
  for each row execute function clinic_reception.package_template_fixed_price();

create function public.pricing_package_fixed_price_sync() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.booking_fixed_price is not null and new.booking_fixed_price is distinct from old.booking_fixed_price then
    update clinic_reception.package_templates set price = new.booking_fixed_price where pricing_package_id = new.id and active;
  end if;
  -- clearing the fixed price: the next sync_catalog run cannot see the change (same fingerprint), so retire the active templates
  -- and let sync rebuild them at the margin price.
  if new.booking_fixed_price is null and old.booking_fixed_price is not null then
    update clinic_reception.package_templates set source_fingerprint = null where pricing_package_id = new.id and active;
  end if;
  return new;
end $$;
revoke all on function public.pricing_package_fixed_price_sync() from public, anon, authenticated;
create trigger trg_pricing_package_fixed_price_sync after update of booking_fixed_price on public.pricing_packages
  for each row execute function public.pricing_package_fixed_price_sync();

commit;
