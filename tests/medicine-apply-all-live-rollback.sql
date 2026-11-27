-- Live rollback dry-run for 20261127320000_medicine_apply_all_no_markup.sql (rule 9). ONE transaction ending with ROLLBACK; nothing kept.
-- Applies the migration (repair NOTICEs: sku, old price → new), then as a REAL inventory manager (never «Admin Test»):
-- A) «هامش الربح الموحّد ← طبّق على كل الأصناف» at the current rate — every medicine keeps markup 0 and its price, no fake
--    history row for a medicine; supply items still repriced as before (count printed). B) a direct use_standard_markup = true
-- on a medicine is put back. Notices print SKUs / prices / counts only.
begin;
-- «طبّق الهامش الموحّد على كل الأصناف» must never mark up a medicine (owner decision with 20261122300000: a medicine is sold at
-- the price it was bought at). Found while testing #955: BEFORE triggers fire in name order, so inventory_medicine_no_markup
-- reset the markup to 0 and THEN inventory_standard_markup (use_standard_markup = true, set by inventory_set_standard_markup's
-- apply-all loop) put the standard markup and price back. Main chat asked for this fix 2026-11-27. راجعت قرارات المالك.
--   * inventory_medicine_no_markup also takes the medicine off the standard markup (use_standard_markup := false), so the
--     standard trigger that runs after it does nothing for a medicine.
--   * the price-history row apply-all writes for a medicine with the standard markup (a change that never happened) is skipped.
--   * repair: every medicine still on the standard markup or carrying a markup is brought back to 0 with the purchase price
--     (one real price-history row per item that changes; each printed as a NOTICE: sku, old → new).
-- Shortage («ناقص») and supply items are unchanged.
-- Rollback: supabase/rollbacks/20261127320000_medicine_apply_all_no_markup.rollback.sql (repaired prices stay).
do $$ begin
  if to_regprocedure('public.inventory_medicine_no_markup()') is null or to_regprocedure('public.inventory_set_standard_markup(numeric,boolean)') is null then
    raise exception 'طبّق تسعير الأدوية (20261122300000) الأول'; end if;
  if to_regprocedure('public.inventory_medicine_history_guard()') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create or replace function public.inventory_medicine_no_markup() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare base numeric;
begin
  if new.pricing_kind = 'medicine' then
    new.use_standard_markup := false;   -- the standard-markup trigger fires after this one (name order)
    if new.markup_percent <> 0 then
      base := clinic_finance.inventory_highest_purchase(new.id);
      if base is null then base := round(new.current_sale_price / (1 + new.markup_percent / 100), 2); end if;
      new.markup_percent := 0;
      new.current_sale_price := round(base, 2);
    end if;
  end if;
  return new;
end $$;
revoke all on function public.inventory_medicine_no_markup() from public, anon, authenticated;

create function public.inventory_medicine_history_guard() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if coalesce(new.new_markup, 0) <> 0 and exists (select 1 from public.inventory_items i where i.id = new.item_id and i.pricing_kind = 'medicine') then
    return null; end if;
  return new;
end $$;
revoke all on function public.inventory_medicine_history_guard() from public, anon, authenticated;
create trigger inventory_medicine_history before insert on public.inventory_price_history
  for each row execute function public.inventory_medicine_history_guard();

do $$
declare actor uuid; r record; n int := 0; p numeric;
begin
  select a.id into actor from public.admins a where a.active and coalesce(a.name, '') <> 'Admin Test' and a.role = 'super_admin'
   order by (a.name like '%عبدالعال%') desc, a.id limit 1;
  for r in select i.id, i.sku, i.current_sale_price, i.markup_percent from public.inventory_items i
           where i.pricing_kind = 'medicine' and (i.use_standard_markup or i.markup_percent <> 0) order by i.sku for update loop
    update public.inventory_items set use_standard_markup = false, updated_at = now() where id = r.id returning current_sale_price into p;
    if p is distinct from r.current_sale_price or r.markup_percent <> 0 then
      insert into public.inventory_price_history(item_id, previous_price, new_price, previous_markup, new_markup, changed_by)
        values (r.id, r.current_sale_price, p, r.markup_percent, 0, actor);
    end if;
    n := n + 1;
    raise notice 'medicine back to no markup: % — % (markup %) → %', r.sku, r.current_sale_price, r.markup_percent, p;
  end loop;
  raise notice 'medicines repaired: %', n;
end $$;


do $$
declare a record; mgr uuid; mgr_name text; rate numeric; tot int; x record; cn text; meds int; h0 int; h1 int; sup int;
begin
  for a in select ad.id, ad.user_id, ad.role from public.admins ad where ad.active and ad.user_id is not null and coalesce(ad.name, '') <> 'Admin Test'
            order by (ad.role = 'super_admin'), ad.id loop
    perform set_config('request.jwt.claim.sub', a.user_id::text, true);
    if public.inventory_is_manager() then mgr := a.user_id; mgr_name := a.role; exit; end if;
  end loop;
  if mgr is null then raise exception 'no real inventory manager login'; end if;
  raise notice 'manager role: %', mgr_name;
  select count(*) into meds from public.inventory_items where pricing_kind = 'medicine' and (markup_percent <> 0 or use_standard_markup);
  if meds <> 0 then raise exception 'repair left % medicines with a markup', meds; end if;

  -- A) apply-all at the current rate
  begin
    select markup_percent into rate from clinic_finance.inventory_pricing_settings where id;
    create temp table med_before on commit drop as select id, sku, current_sale_price from public.inventory_items where pricing_kind = 'medicine';
    select count(*) into h0 from public.inventory_price_history h join public.inventory_items i on i.id = h.item_id where i.pricing_kind = 'medicine';
    select count(*) into sup from public.inventory_items where pricing_kind = 'supply' and active;
    perform set_config('request.jwt.claim.sub', mgr::text, true); execute 'set local role authenticated';
    tot := public.inventory_set_standard_markup(coalesce(rate, 35), true);
    execute 'reset role';
    select count(*) into meds from public.inventory_items i join med_before b on b.id = i.id
      where i.markup_percent <> 0 or i.use_standard_markup or i.current_sale_price <> b.current_sale_price;
    select count(*) into h1 from public.inventory_price_history h join public.inventory_items i on i.id = h.item_id where i.pricing_kind = 'medicine';
    raise notice 'A apply-all at %: % items looped, % supply items, medicines changed: %, medicine history rows added: %', rate, tot, sup, meds, h1 - h0;
    if meds <> 0 then raise exception 'A: % medicines were marked up', meds; end if;
    if h1 <> h0 then raise exception 'A: fake medicine history rows'; end if;
    raise exception 'SCENARIO_DONE';
  exception when others then if sqlerrm <> 'SCENARIO_DONE' then get stacked diagnostics cn = constraint_name; execute 'reset role'; raise exception 'A: % [%]', sqlerrm, cn; end if; end;

  -- B) a direct write that puts a medicine on the standard markup is put back
  begin
    select id, sku, current_sale_price into x from public.inventory_items where pricing_kind = 'medicine' and active order by sku limit 1;
    if x.id is null then raise notice 'B skipped: no medicine items'; raise exception 'SCENARIO_DONE'; end if;
    update public.inventory_items set use_standard_markup = true where id = x.id;
    if exists (select 1 from public.inventory_items where id = x.id and (use_standard_markup or markup_percent <> 0 or current_sale_price <> x.current_sale_price)) then
      raise exception 'B: % marked up', x.sku; end if;
    raise notice 'B: % stays % with no markup', x.sku, x.current_sale_price;
    raise exception 'SCENARIO_DONE';
  exception when others then if sqlerrm <> 'SCENARIO_DONE' then get stacked diagnostics cn = constraint_name; raise exception 'B: % [%]', sqlerrm, cn; end if; end;
  raise notice 'ALL SCENARIOS PASSED';
end $$;
rollback;
