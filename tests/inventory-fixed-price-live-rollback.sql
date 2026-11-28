-- Live rollback dry-run for 20261127280000_inventory_fixed_sale_price.sql (rule 9). ONE transaction ending with ROLLBACK; nothing kept.
-- Applies the migration (the 3 owner items become fixed only at 50 / 1500 / 150), then as a REAL inventory manager (never
-- «Admin Test»): A) set the fixed price 50 → 55; B) «طبّق الهامش الموحّد على كل الأصناف» — every fixed item keeps its price;
-- C) a receipt-style recompute cost × (1 + markup) is put back; D) back to «نسبة ربح %» via «نوع التسعير»; E) reception refused.
-- Notices print SKUs / prices only; errors print the message and constraint only.
begin;
-- «سعر بيع ثابت» next to «نسبة الربح» (owner «طبّق سعر البيع الثابت، والتلاتة يبقوا ثابتين» 2026-11-27, mockup
-- docs/ui-references/mockups/fixed-sale-price.html @84289528). راجعت قرارات المالك.
--   * public.inventory_items.pricing_kind gains 'fixed' + column fixed_sale_price. A fixed item's sale price is the price the
--     manager typed — the same for every path that used to recompute it from cost: a new receipt (cost × (1 + markup)),
--     «هامش الربح الموحّد ← طبّق على كل الأصناف» (inventory_set_standard_markup p_apply_all), the item window
--     (inventory_save_catalog), and the inventory_standard_markup trigger. One BEFORE trigger, named to run LAST
--     (zz_inventory_fixed_price), puts current_sale_price back to fixed_sale_price, keeps the item off the standard markup and
--     keeps its old markup_percent. Price-history rows those paths try to write for a fixed item are skipped (no fake changes).
--   * public.inventory_set_fixed_price(item, price) — inventory manager / central-store manager: sets / changes the fixed price
--     (price history + audit). Leaving «ثابت»: public.inventory_set_pricing_kind (wrapped) to supply / medicine / shortage as
--     before. A price below cost is allowed (warning on screen).
--   * The three items the owner named become fixed at their current price, only if it is still that price:
--     ITM-0000595 «سكين بروتيكتور» 50, ITM-0000596 1500, ITM-0000597 150.
-- Rollback: supabase/rollbacks/20261127280000_inventory_fixed_sale_price.rollback.sql
do $$ begin
  if to_regprocedure('public.inventory_set_pricing_kind(uuid,text,numeric)') is null or to_regprocedure('public.inventory_pricing_list()') is null then
    raise exception 'طبّق تسعير الأدوية (20261122300000) الأول'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'inventory_items' and column_name = 'fixed_sale_price') then
    raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

alter table public.inventory_items drop constraint inventory_items_pricing_kind_check;
alter table public.inventory_items add constraint inventory_items_pricing_kind_check check (pricing_kind in ('supply', 'medicine', 'shortage', 'fixed'));
alter table public.inventory_items add column fixed_sale_price numeric(14,2)
  check (fixed_sale_price is null or (fixed_sale_price >= 0 and fixed_sale_price <= 1000000));
alter table public.inventory_items add constraint inventory_items_fixed_has_price check (pricing_kind <> 'fixed' or fixed_sale_price is not null);

-- runs after inventory_medicine_no_markup and inventory_standard_markup (BEFORE triggers fire in name order)
create function public.inventory_fixed_price_guard() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.pricing_kind = 'fixed' then
    new.current_sale_price := new.fixed_sale_price;
    new.use_standard_markup := false;
    if tg_op = 'UPDATE' then new.markup_percent := old.markup_percent; end if;
  elsif tg_op = 'UPDATE' and old.pricing_kind = 'fixed' then
    new.fixed_sale_price := null;
  end if;
  return new;
end $$;
revoke all on function public.inventory_fixed_price_guard() from public, anon, authenticated;
create trigger zz_inventory_fixed_price before insert or update on public.inventory_items
  for each row execute function public.inventory_fixed_price_guard();

-- no fake «price changed» rows for a fixed item (a receipt or «طبّق على الكل» tried and was put back)
create function public.inventory_fixed_price_history_guard() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if coalesce(current_setting('inventory.fixed_price_change', true), '') = '1' then return new; end if;
  if exists (select 1 from public.inventory_items i where i.id = new.item_id and i.pricing_kind = 'fixed' and new.new_price is distinct from i.fixed_sale_price) then
    return null; end if;
  return new;
end $$;
revoke all on function public.inventory_fixed_price_history_guard() from public, anon, authenticated;
create trigger inventory_fixed_price_history before insert on public.inventory_price_history
  for each row execute function public.inventory_fixed_price_history_guard();

create function public.inventory_set_fixed_price(p_item uuid, p_price numeric) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); i public.inventory_items%rowtype; cost numeric;
begin
  if me is null or not (public.inventory_is_manager() or public.inventory_location_can('00000000-0000-4000-8000-000000000001', 'manage')) then
    raise exception 'تسعير الأصناف لمسؤول المخزن' using errcode = '42501';
  end if;
  if p_price is null or p_price < 0 or p_price > 1000000 or p_price::text in ('NaN', 'Infinity', '-Infinity') or p_price <> round(p_price, 2) then
    raise exception 'اكتب سعر البيع (رقم من 0 لـ 1000000)'; end if;
  select * into i from public.inventory_items where id = p_item and active for update;
  if not found then raise exception 'الصنف غير موجود'; end if;
  perform set_config('inventory.fixed_price_change', '1', true);
  if i.current_sale_price is distinct from p_price or i.pricing_kind <> 'fixed' then
    insert into public.inventory_price_history(item_id, previous_price, new_price, previous_markup, new_markup, changed_by)
      values (i.id, i.current_sale_price, p_price, i.markup_percent, i.markup_percent, me);
  end if;
  update public.inventory_items set pricing_kind = 'fixed', fixed_sale_price = p_price, updated_at = now() where id = i.id returning * into i;
  perform set_config('inventory.fixed_price_change', '', true);
  insert into public.inventory_audit_events(entity_id, kind, actor_id, detail) values (i.id, 'fixed_price', me, 'سعر بيع ثابت ' || p_price);
  cost := clinic_finance.inventory_highest_purchase(i.id);
  return jsonb_build_object('id', i.id, 'pricing_kind', i.pricing_kind, 'sale_price', i.current_sale_price, 'markup_percent', i.markup_percent,
    'purchase_price', cost, 'effective_margin', case when coalesce(cost, 0) > 0 then round((p_price - cost) / cost * 100, 2) end, 'below_cost', cost is not null and p_price < cost);
end $$;
revoke all on function public.inventory_set_fixed_price(uuid, numeric) from public, anon;
grant execute on function public.inventory_set_fixed_price(uuid, numeric) to authenticated;

-- leaving «ثابت» through the existing «نوع التسعير» setter: its price-history row is a real change
alter function public.inventory_set_pricing_kind(uuid, text, numeric) rename to inventory_set_pricing_kind_before_fixed;
alter function public.inventory_set_pricing_kind_before_fixed(uuid, text, numeric) set schema clinic_finance;
revoke all on function clinic_finance.inventory_set_pricing_kind_before_fixed(uuid, text, numeric) from public, anon, authenticated;
create function public.inventory_set_pricing_kind(p_item uuid, p_kind text, p_markup numeric default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare r jsonb;
begin
  if p_kind = 'fixed' then raise exception 'السعر الثابت بيتحدد من «سعر بيع ثابت» (اكتب السعر)'; end if;
  if exists (select 1 from public.inventory_items where id = p_item and pricing_kind = 'fixed') then
    perform set_config('inventory.fixed_price_change', '1', true);
    update public.inventory_items set pricing_kind = 'supply' where id = p_item;   -- the guard clears fixed_sale_price
  end if;
  r := clinic_finance.inventory_set_pricing_kind_before_fixed(p_item, p_kind, p_markup);
  perform set_config('inventory.fixed_price_change', '', true);
  return r;
end $$;
revoke all on function public.inventory_set_pricing_kind(uuid, text, numeric) from public, anon;
grant execute on function public.inventory_set_pricing_kind(uuid, text, numeric) to authenticated;

-- the three items the owner named: fixed at their current price, only if it is still that price
do $$
declare actor uuid; r record; n int := 0;
begin
  select a.id into actor from public.admins a where a.active and coalesce(a.name, '') <> 'Admin Test' and a.role = 'super_admin'
   order by (a.name like '%عبدالعال%') desc, a.id limit 1;
  for r in select i.id, i.sku, i.name, i.current_sale_price, v.p from public.inventory_items i
             join (values ('ITM-0000595', 50::numeric), ('ITM-0000596', 1500::numeric), ('ITM-0000597', 150::numeric)) v(sku, p) on v.sku = i.sku loop
    if r.current_sale_price = r.p then
      update public.inventory_items set pricing_kind = 'fixed', fixed_sale_price = r.p, updated_at = now() where id = r.id;
      if actor is not null then
        insert into public.inventory_audit_events(entity_id, kind, actor_id, detail) values (r.id, 'fixed_price', actor, 'سعر بيع ثابت ' || r.p || ' — بأمر المالك');
      end if;
      n := n + 1;
      raise notice 'fixed: % — price %', r.sku, r.p;
    else
      raise notice 'NOT fixed (price changed): % — now % (expected %)', r.sku, r.current_sale_price, r.p;
    end if;
  end loop;
  raise notice 'fixed-price items set: %', n;
end $$;


-- ===================== dry-run scenarios (real people, live data, nothing kept) =====================
do $$
declare sp uuid; mgr uuid; mgr_name text; rec uuid; a record; r jsonb; cn text; x record; rate numeric; changed int; tot int;
begin
  select id into sp from public.inventory_items where sku = 'ITM-0000595';
  -- the 3 owner items after the migration
  for x in select sku, pricing_kind, fixed_sale_price, current_sale_price, markup_percent, use_standard_markup from public.inventory_items where sku in ('ITM-0000595', 'ITM-0000596', 'ITM-0000597') order by sku loop
    raise notice 'item %: kind %, fixed %, sale %, markup %, standard %', x.sku, x.pricing_kind, x.fixed_sale_price, x.current_sale_price, x.markup_percent, x.use_standard_markup;
  end loop;
  -- a REAL inventory manager (not «Admin Test»), preferring one who is not the super admin
  for a in select ad.id, ad.user_id, ad.name, ad.role from public.admins ad where ad.active and ad.user_id is not null and coalesce(ad.name, '') <> 'Admin Test'
            order by (ad.role = 'super_admin'), ad.id loop
    perform set_config('request.jwt.claim.sub', a.user_id::text, true);
    if public.inventory_is_manager() then mgr := a.user_id; mgr_name := a.role; exit; end if;
  end loop;
  if mgr is null then raise exception 'no real inventory manager login'; end if;
  raise notice 'manager role: %', mgr_name;

  -- A) the manager changes the fixed price 50 → 55 (history + audit), item window path
  begin
    perform set_config('request.jwt.claim.sub', mgr::text, true); execute 'set local role authenticated';
    r := public.inventory_set_fixed_price(sp, 55);
    execute 'reset role';
    raise notice 'A set fixed 55: kind %, sale %, effective margin % %%, below cost %', r->>'pricing_kind', r->>'sale_price', r->>'effective_margin', r->>'below_cost';
    if (r->>'sale_price')::numeric <> 55 then raise exception 'A: price not 55'; end if;
    raise exception 'SCENARIO_DONE';
  exception when others then if sqlerrm <> 'SCENARIO_DONE' then get stacked diagnostics cn = constraint_name; execute 'reset role'; raise exception 'A: % [%]', sqlerrm, cn; end if; end;

  -- B) «هامش الربح الموحّد ← طبّق على كل الأصناف» by the manager at the current rate: fixed items keep their price
  begin
    select markup_percent into rate from clinic_finance.inventory_pricing_settings where id;
    perform set_config('request.jwt.claim.sub', mgr::text, true); execute 'set local role authenticated';
    tot := public.inventory_set_standard_markup(coalesce(rate, 35), true);
    execute 'reset role';
    for x in select sku, pricing_kind, current_sale_price, fixed_sale_price from public.inventory_items where pricing_kind = 'fixed' order by sku loop
      raise notice 'B after apply-all (% items): % sale % (fixed %)', tot, x.sku, x.current_sale_price, x.fixed_sale_price;
      if x.current_sale_price <> x.fixed_sale_price then raise exception 'B: % lost its fixed price', x.sku; end if;
    end loop;
    raise exception 'SCENARIO_DONE';
  exception when others then if sqlerrm <> 'SCENARIO_DONE' then get stacked diagnostics cn = constraint_name; execute 'reset role'; raise exception 'B: % [%]', sqlerrm, cn; end if; end;

  -- C) a receipt-style recompute (cost × (1 + markup)) on the fixed items: put back
  begin
    update public.inventory_items set current_sale_price = round(coalesce(clinic_finance.inventory_highest_purchase(id), 1) * (1 + markup_percent / 100), 2), updated_at = now()
     where pricing_kind = 'fixed';
    select count(*) into changed from public.inventory_items where pricing_kind = 'fixed' and current_sale_price <> fixed_sale_price;
    raise notice 'C receipt-style recompute: fixed items off their price: % (must be 0)', changed;
    if changed <> 0 then raise exception 'C: fixed price overwritten'; end if;
    raise exception 'SCENARIO_DONE';
  exception when others then if sqlerrm <> 'SCENARIO_DONE' then get stacked diagnostics cn = constraint_name; raise exception 'C: % [%]', sqlerrm, cn; end if; end;

  -- D) back to «نسبة ربح %» through «نوع التسعير» (supply 35)
  begin
    perform set_config('request.jwt.claim.sub', mgr::text, true); execute 'set local role authenticated';
    r := public.inventory_set_pricing_kind(sp, 'supply', 35);
    execute 'reset role';
    select * into x from public.inventory_items where sku = 'ITM-0000595';
    raise notice 'D back to supply 35%%: kind %, sale %, fixed %', x.pricing_kind, x.current_sale_price, x.fixed_sale_price;
    raise exception 'SCENARIO_DONE';
  exception when others then if sqlerrm <> 'SCENARIO_DONE' then get stacked diagnostics cn = constraint_name; execute 'reset role'; raise exception 'D: % [%]', sqlerrm, cn; end if; end;

  -- E) reception refused
  select ad.user_id into rec from public.admins ad where ad.active and ad.user_id is not null and coalesce(ad.name, '') <> 'Admin Test' and ad.role = 'reception' order by ad.id limit 1;
  if rec is not null then
    begin
      perform set_config('request.jwt.claim.sub', rec::text, true); execute 'set local role authenticated';
      perform public.inventory_set_fixed_price(sp, 1);
      raise exception 'reception set a price!';
    exception when others then execute 'reset role'; if sqlerrm = 'reception set a price!' then raise; end if; raise notice 'E reception refused: %', sqlerrm; end;
  end if;
  raise notice 'fixed sale price dry-run OK — nothing kept (ROLLBACK)';
exception when others then
  get stacked diagnostics cn = constraint_name;
  raise exception '%', sqlerrm || coalesce(' [' || nullif(cn, '') || ']', '');
end $$;
rollback;
