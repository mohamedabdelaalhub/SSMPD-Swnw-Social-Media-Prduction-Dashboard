-- Seasonal / competitor package offers (owner approval 2026-11-24, relayed by main chat 4):
--   1) Sell window: a package can be sold only between «يتباع من» and «لحد» (Cairo dates, both optional). Outside it the sale is
--      refused by itself; packages already sold keep their own validity (expires_on is set at sale, unchanged here).
--   2) First payment rule (per package, default 25 % for NEW packages): the patient pays at least that % of the contract price
--      before / at the first session, and every later payment towards the package is at least
--      max(that % of the contract price, what is still owed ÷ visits left). Paying everything still owed is always allowed.
--   3) Validity «4 شهور» = booking_validity_days 120 (existing column; the editor offers the preset).
-- Source of truth = public.pricing_packages (the price editor) → copied to clinic_reception.package_templates on insert and kept in
-- step on update (same pattern as 20261116130000 conditional_offer) → SNAPSHOTTED on each package at sale (later edits never
-- change a sold package). Existing pricing packages / templates / packages get NULL = no rule (today's behaviour).
-- Enforced by triggers, so every path (reception screen, today board, wrappers) is covered:
--   * packages BEFORE INSERT: refuse outside the template's window; snapshot min_first_percent.
--   * payments BEFORE INSERT with package_id: refuse a payment below the minimum (unless it pays everything owed).
--   * packages BEFORE UPDATE of recognized (first session executed): paid before it (old funded) must reach the %.
-- Rollback: supabase/rollbacks/20261123170000_package_offers.rollback.sql
begin;

do $$ begin
  if to_regclass('clinic_reception.package_templates') is null or to_regclass('clinic_reception.payments') is null then
    raise exception 'مكونات الباكجات غير موجودة'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'clinic_reception' and table_name = 'package_templates' and column_name = 'min_first_percent') then
    raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

alter table clinic_reception.package_templates
  add column sell_from date, add column sell_until date,
  add column min_first_percent numeric(5,2) check (min_first_percent is null or min_first_percent between 0 and 100),
  add constraint package_templates_sell_window_chk check (sell_from is null or sell_until is null or sell_from <= sell_until);
alter table clinic_reception.packages
  add column min_first_percent numeric(5,2) check (min_first_percent is null or min_first_percent between 0 and 100);

do $$ begin
  if to_regclass('public.pricing_packages') is not null then
    alter table public.pricing_packages
      add column if not exists booking_sell_from date, add column if not exists booking_sell_until date,
      add column if not exists booking_min_first_percent numeric(5,2);
    alter table public.pricing_packages add constraint pricing_packages_min_first_chk
      check (booking_min_first_percent is null or booking_min_first_percent between 0 and 100);
    alter table public.pricing_packages add constraint pricing_packages_sell_window_chk
      check (booking_sell_from is null or booking_sell_until is null or booking_sell_from <= booking_sell_until);
    -- NEW price-list packages default to 25 %; existing rows stay NULL (no rule)
    alter table public.pricing_packages alter column booking_min_first_percent set default 25;
  end if;
end $$;

-- template ← pricing package (on insert)
create function clinic_reception.package_template_offer_copy() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare pp uuid := nullif(to_jsonb(new)->>'pricing_package_id', '')::uuid;
begin
  if pp is not null and to_regclass('public.pricing_packages') is not null then
    execute 'select booking_sell_from, booking_sell_until, booking_min_first_percent from public.pricing_packages where id = $1'
      into new.sell_from, new.sell_until, new.min_first_percent using pp;
  end if;
  return new;
end $$;
revoke all on function clinic_reception.package_template_offer_copy() from public, anon, authenticated;
create trigger trg_package_template_offer_copy before insert on clinic_reception.package_templates
  for each row execute function clinic_reception.package_template_offer_copy();

-- active templates ← pricing package (on update of the three fields)
create function public.pricing_package_offer_sync() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if (new.booking_sell_from, new.booking_sell_until, new.booking_min_first_percent)
     is distinct from (old.booking_sell_from, old.booking_sell_until, old.booking_min_first_percent) then
    update clinic_reception.package_templates set sell_from = new.booking_sell_from, sell_until = new.booking_sell_until,
           min_first_percent = new.booking_min_first_percent
     where pricing_package_id = new.id and active;
  end if;
  return new;
end $$;
revoke all on function public.pricing_package_offer_sync() from public, anon, authenticated;
do $$ begin
  if to_regclass('public.pricing_packages') is not null then
    create trigger trg_pricing_package_offer_sync after update of booking_sell_from, booking_sell_until, booking_min_first_percent
      on public.pricing_packages for each row execute function public.pricing_package_offer_sync();
  end if;
end $$;

-- the minimum the NEXT payment towards a package must reach (null = no rule); owed = what is still owed on it
create function clinic_reception.package_min_payment(p_package uuid) returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  with k as (select * from clinic_reception.packages where id = p_package),
  owed as (select greatest(0, k.contract_price - k.funded)
                  + coalesce((select sum(clinic_reception.due(i.id)) from clinic_reception.invoices i where i.package_id = k.id), 0) as v from k),
  left_visits as (select greatest(1, count(distinct e.visit_no)) as n from clinic_reception.entitlements e join k on k.id = e.package_id where e.used < e.quantity),
  paid_before as (select exists (select 1 from clinic_reception.payments p join k on k.id = p.package_id) as any)
  select case when k.min_first_percent is null then null else jsonb_build_object(
    'percent', k.min_first_percent, 'first', not paid_before.any, 'owed', round(owed.v, 2),
    'minimum', least(round(owed.v, 2), case when not paid_before.any then round(k.contract_price * k.min_first_percent / 100, 2)
                    else greatest(round(k.contract_price * k.min_first_percent / 100, 2), round(owed.v / left_visits.n, 2)) end),
    'first_session_needs', round(k.contract_price * k.min_first_percent / 100, 2)) end
  from k, owed, left_visits, paid_before
$$;
revoke all on function clinic_reception.package_min_payment(uuid) from public, anon;
grant execute on function clinic_reception.package_min_payment(uuid) to authenticated;

-- sale: window + snapshot
create function clinic_reception.package_offer_on_sale() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare t clinic_reception.package_templates%rowtype; today date := (now() at time zone 'Africa/Cairo')::date;
begin
  select * into t from clinic_reception.package_templates where id = new.template_id;
  if t.sell_from is not null and today < t.sell_from then
    raise exception 'العرض ده لسه ما بداش — بيتباع من %', to_char(t.sell_from, 'DD/MM/YYYY'); end if;
  if t.sell_until is not null and today > t.sell_until then
    raise exception 'العرض ده خلص يوم % — اختار باكج تاني', to_char(t.sell_until, 'DD/MM/YYYY'); end if;
  new.min_first_percent := t.min_first_percent;
  return new;
end $$;
revoke all on function clinic_reception.package_offer_on_sale() from public, anon, authenticated;
create trigger trg_package_offer_on_sale before insert on clinic_reception.packages
  for each row execute function clinic_reception.package_offer_on_sale();

-- payments towards a package: at least the minimum (or everything still owed)
create function clinic_reception.package_offer_on_payment() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare m jsonb;
begin
  if new.package_id is null then return new; end if;
  m := clinic_reception.package_min_payment(new.package_id);
  if m is null then return new; end if;
  if new.amount + 0.005 < (m->>'minimum')::numeric then
    raise exception 'أقل دفعة للباكج دلوقتي % ج.م (% ٪ من قيمة الباكج%) — أو ادفع الباقي كله % ج.م',
      to_char((m->>'minimum')::numeric, 'FM999,999,990.00'), rtrim(rtrim(m->>'percent', '0'), '.'),
      case when (m->>'first')::boolean then ' كأول دفعة' else ' أو الباقي على عدد الزيارات اللي فاضلة' end,
      to_char((m->>'owed')::numeric, 'FM999,999,990.00');
  end if;
  return new;
end $$;
revoke all on function clinic_reception.package_offer_on_payment() from public, anon, authenticated;
create trigger trg_package_offer_on_payment before insert on clinic_reception.payments
  for each row execute function clinic_reception.package_offer_on_payment();

-- the first session of a package with a rule: what was PAID before it (old.funded) must reach the %. Checked when the package is
-- first recognized (execution adds the session's unpaid part to funded and its value to recognized in one update)
create function clinic_reception.package_offer_on_first_session() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare need numeric;
begin
  if new.min_first_percent is null or old.recognized > 0 or new.recognized <= 0 then return new; end if;
  need := round(new.contract_price * new.min_first_percent / 100, 2);
  if old.funded + 0.005 < need then
    raise exception 'لازم المريض يدفع % ٪ من الباكج (% ج.م) قبل أول جلسة — المدفوع لحد دلوقتي % ج.م',
      rtrim(rtrim(new.min_first_percent::text, '0'), '.'), to_char(need, 'FM999,999,990.00'), to_char(old.funded, 'FM999,999,990.00');
  end if;
  return new;
end $$;
revoke all on function clinic_reception.package_offer_on_first_session() from public, anon, authenticated;
create trigger trg_package_offer_on_first_session before update of recognized on clinic_reception.packages
  for each row execute function clinic_reception.package_offer_on_first_session();

commit;
