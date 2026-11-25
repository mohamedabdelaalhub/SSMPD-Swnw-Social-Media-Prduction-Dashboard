-- Ops (data): add «بكت شاش دريسينج 10*10» to the «فرعي مستلزمات تمريض» opening balance (left out of
-- 20261124_opening_nursing_supplies.sql until the owner confirmed the count and the price).
-- Owner 2026-11-25: 3 closed boxes + 1 open box with 70 pieces; box = 100 pieces; supplier price 216 EGP per box
-- → 370 pieces × 2.16 = 799.20 EGP. No expiry on the sheet.
-- Same pattern and timestamp as the nursing opening: item (مستلزمات, supply 35%), lot OPEN-NURSING-20261124,
-- opening_balance movement at 2026-11-24 08:00 Cairo, opening marker. No GL posting.
-- Idempotent: aborts with no change if the item already exists.
-- Expected: 1 item, 1 lot, 1 movement, 1 marker; nursing opening value +799.20.
begin;
do $$
declare me uuid; iid uuid; lid uuid; loc uuid; v_at timestamptz := timestamptz '2026-11-24 08:00+02';
begin
  select id into me from public.admins where role = 'super_admin' and active order by id limit 1;
  select id into loc from public.inventory_locations where name = 'فرعي مستلزمات تمريض' and active;
  if me is null or loc is null then raise exception 'super admin or store missing'; end if;
  if exists (select 1 from public.inventory_items where lower(trim(name)) = lower(trim('بكت شاش دريسينج 10*10'))) then
    raise exception 'الصنف موجود قبل كده؛ الملف اتطبق قبل كده؟';
  end if;
  insert into public.inventory_items(name, category, base_unit, units_per_pack, markup_percent, current_sale_price, track_lots, pricing_kind, created_by)
    values ('بكت شاش دريسينج 10*10', 'مستلزمات', 'قطعة', 100, 35, round(2.16 * 1.35, 2), false, 'supply', me) returning id into iid;
  insert into public.inventory_lots(item_id, lot_number, expiry_date, received_quantity, unit_cost, supplier_name, created_by)
    values (iid, 'OPEN-NURSING-20261124', null, 370, 2.16, 'رصيد أول المدة', me) returning id into lid;
  insert into public.inventory_movements(item_id, location_id, lot_id, movement_type, quantity_delta, unit_cost, reference_type, note, occurred_at, created_by)
    values (iid, loc, lid, 'opening_balance', 370, 2.16, 'opening', 'رصيد أول المدة 24 نوفمبر 2026', v_at, me);
  insert into public.inventory_opening_markers(location_id, item_id, batch_id) values (loc, iid, null);
end $$;
select l.name store, count(distinct m.item_id) items, round(sum(m.quantity_delta * m.unit_cost), 2) value
  from public.inventory_movements m join public.inventory_locations l on l.id = m.location_id
 where m.movement_type = 'opening_balance' and m.occurred_at = timestamptz '2026-11-24 08:00+02' group by l.name order by l.name;
commit;
