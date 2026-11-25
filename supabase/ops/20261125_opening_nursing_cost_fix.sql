-- Ops (data): correct the unit cost of 3 opening lots in «فرعي مستلزمات تمريض» (applied 2026-11-24 by
-- 20261124_opening_nursing_supplies.sql) to the supplier's prices confirmed by the owner on 2026-11-25:
--   تيوبة موف        2.00 → 1.85   (box of 100 = 185)
--   تيوبة احمر       2.00 → 2.45   (box of 100 = 245; the supplier's «أصفر» line is the red tube)
--   لزق استري ستريب  5.00 → 2.17   (box of 30 = 65; movement costs keep 2 decimals)
--   تيوبة رمادي / تيوبة لبني stay at 2.00 for now (owner).
-- Touches only: the OPEN-NURSING-20261124 lot, its opening_balance movement, the item sale price (cost × 1.35),
-- and the reception mirror (clinic_reception.lots.unit_cost, items.highest_cost/sale_price, the mirrored 'count' rows).
-- No GL posting (the finance opening batch is still on hold). Guard: aborts if any of these items has any movement
-- other than its opening balance (a consumption already posted 5123 at the old cost would need a different fix).
-- Idempotent: a re-run finds nothing to change (0 rows) and still passes the checks.
-- Expected: 3 lots, 3 movements, 3 items updated; nursing opening value 49,628.67 → 49,627.65 (−1.02).
begin;
create temp table _fix(name text, new_cost numeric) on commit drop;
insert into _fix values ('تيوبة موف', 1.85), ('تيوبة احمر', 2.45), ('لزق استري ستريب', 2.17);
do $$
declare n_items int; n_other int; n_rx int;
begin
  select count(*) into n_items from public.inventory_items i join _fix f on i.name = f.name;
  if n_items <> 3 then raise exception 'expected 3 items, found %', n_items; end if;
  select count(*) into n_other from public.inventory_movements m join public.inventory_items i on i.id = m.item_id join _fix f on i.name = f.name
   where m.movement_type <> 'opening_balance';
  if n_other > 0 then raise exception '% non-opening movement(s) exist on these items; stop and review', n_other; end if;
  select count(*) into n_rx from clinic_reception.movements rm join clinic_reception.items rx on rx.id = rm.item_id
    join public.inventory_items i on i.id = rx.inventory_item_id join _fix f on i.name = f.name
   where rm.kind <> 'count' or rm.source_id is not null;
  if n_rx > 0 then raise exception '% reception movement(s) exist on these items; stop and review', n_rx; end if;
end $$;
with x as (select i.id item_id, f.new_cost from public.inventory_items i join _fix f on i.name = f.name)
update public.inventory_lots l set unit_cost = x.new_cost
  from x where l.item_id = x.item_id and l.lot_number = 'OPEN-NURSING-20261124' and l.unit_cost <> x.new_cost;
with x as (select i.id item_id, f.new_cost from public.inventory_items i join _fix f on i.name = f.name)
update public.inventory_movements m set unit_cost = x.new_cost
  from x where m.item_id = x.item_id and m.movement_type = 'opening_balance' and m.reference_type = 'opening' and m.unit_cost <> x.new_cost;
update public.inventory_items i set markup_percent = 35, current_sale_price = round(f.new_cost * 1.35, 2), updated_at = now()
  from _fix f where i.name = f.name and (i.current_sale_price <> round(f.new_cost * 1.35, 2) or i.markup_percent <> 35);
-- reception mirror (sync_stock copied the lot cost once and only ever raises highest_cost, so set it directly)
update clinic_reception.lots rl set unit_cost = l.unit_cost
  from public.inventory_lots l join public.inventory_items i on i.id = l.item_id join _fix f on f.name = i.name
 where rl.inventory_lot_id = l.id and l.lot_number = 'OPEN-NURSING-20261124' and rl.unit_cost <> l.unit_cost;
update clinic_reception.movements rm set unit_cost = rl.unit_cost
  from clinic_reception.lots rl join public.inventory_lots l on l.id = rl.inventory_lot_id
  join public.inventory_items i on i.id = l.item_id join _fix f on f.name = i.name
 where rm.lot_id = rl.id and rm.kind = 'count' and rm.source_id is null and rm.unit_cost <> rl.unit_cost;
update clinic_reception.items rx set highest_cost = f.new_cost, markup = 35, sale_price = round(f.new_cost * 1.35, 2)
  from public.inventory_items i join _fix f on f.name = i.name
 where rx.inventory_item_id = i.id and (rx.highest_cost <> f.new_cost or rx.sale_price <> round(f.new_cost * 1.35, 2) or rx.markup <> 35);
do $$
begin
  if exists (select 1 from public.inventory_lots l join public.inventory_items i on i.id = l.item_id join _fix f on f.name = i.name
              where l.lot_number = 'OPEN-NURSING-20261124' and l.unit_cost <> f.new_cost) then raise exception 'lot cost not corrected'; end if;
  if exists (select 1 from public.inventory_items i join _fix f on f.name = i.name where i.current_sale_price <> round(f.new_cost * 1.35, 2))
    then raise exception 'sale price not corrected'; end if;
end $$;
select i.name, l.unit_cost, i.current_sale_price, public.inventory_location_balance(m.location_id, i.id) qty
  from public.inventory_items i join _fix f on f.name = i.name join public.inventory_lots l on l.item_id = i.id
  join public.inventory_movements m on m.lot_id = l.id and m.movement_type = 'opening_balance' order by i.name;
select l.name store, count(distinct m.item_id) items, round(sum(m.quantity_delta * m.unit_cost), 2) value
  from public.inventory_movements m join public.inventory_locations l on l.id = m.location_id
 where m.movement_type = 'opening_balance' and m.occurred_at = timestamptz '2026-11-24 08:00+02' group by l.name order by l.name;
commit;
