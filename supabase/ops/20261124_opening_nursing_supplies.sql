-- Ops (data): opening balance «فرعي مستلزمات تمريض» as of 2026-11-24 08:00 Cairo (owner, inventory chat).
-- Source: nursing sheet + supplier prices sent by the owner (per piece; tubes 2 EGP each; dressing gauze EXCLUDED here (count pending; 400 EGP per pack of 100);
-- steri-strip 5 EGP each; مقص جراحي excluded = instrument). Expiry: Excel day/month swap fixed, end of month; Prolene 2.0 = Feb 2027.
-- Same pattern as 20261124_opening_dental_medicines.sql: item (category مستلزمات, supply 35%), lot OPEN-NURSING-20261124,
-- opening_balance movement, opening marker. No GL posting (finance books ONE opening for all stores afterwards).
-- Expected: 62 items (61 with stock), value 49,629.40 EGP. Aborts if any name already exists (idempotent).
begin;
create temp table _open(name text,unit text,units_per_pack numeric,quantity numeric,unit_cost numeric,expiry date) on commit drop;
insert into _open values
  ('لتر كحل','زجاجة',1.0,9.0,95.0,null),
  ('لزق جروح مدور','قطعة',500.0,300.0,0.35,null),
  ('لولب نحاسي','قطعة',1.0,3.0,650.0,'2027-03-31'),
  ('لولب فراشة','قطعة',1.0,10.0,200.0,'2027-03-31'),
  ('بكرة رسم قلب','بكرة',1.0,5.0,42.5,null),
  ('لزق استري ستريب','قطعة',1.0,9.0,5.0,null),
  ('مشرط مقاس 15','قطعة',100.0,48.0,2.75,'2028-07-31'),
  ('مشرط مقاس 20','قطعة',100.0,4.0,2.75,'2029-01-31'),
  ('مشرط مقاس 11','قطعة',100.0,29.0,2.75,'2029-02-28'),
  ('لزق قيصرية','قطعة',1.0,9.0,350.0,null),
  ('تيوبة رمادي','قطعة',1.0,69.0,2.0,'2027-02-28'),
  ('تيوبة موف','قطعة',1.0,80.0,2.0,'2028-05-31'),
  ('تيوبة لبني','قطعة',1.0,75.0,2.0,'2027-11-30'),
  ('تيوبة احمر','قطعة',1.0,81.0,2.0,'2027-03-31'),
  ('شاش فازلين 10 *10','قطعة',1.0,20.0,250.0,null),
  ('كيس قطن (100 جرام )','كيس',1.0,13.0,110.0,null),
  ('قسطرة بولية مقاس 16','قطعة',1.0,3.0,500.0,'2028-01-31'),
  ('قسطرة بولية مقاس 18','قطعة',1.0,3.0,500.0,'2028-01-31'),
  ('جهاز وريد','قطعة',1.0,168.0,9.75,'2031-01-31'),
  ('بكر لزق طبي','بكرة',1.0,11.0,62.0,null),
  ('اوفر شوز','قطعة',100.0,200.0,0.75,null),
  ('جاون طبي','قطعة',1.0,5.0,250.0,null),
  ('تيوبة حنجرية','قطعة',1.0,3.0,600.0,'2029-03-31'),
  ('خيط برولين 2.0','قطعة',12.0,7.0,35.4167,'2027-02-28'),
  ('خيط برولين 4.0','قطعة',12.0,3.0,35.4167,'2030-08-31'),
  ('خيط برولين 5.0','قطعة',12.0,12.0,35.4167,'2030-11-30'),
  ('خيط برولين 6.0','قطعة',12.0,17.0,51.6667,'2031-01-31'),
  ('خيط فكريل 3.0','قطعة',12.0,3.0,51.6667,'2029-05-31'),
  ('خيط فكريل 4.0','قطعة',12.0,2.0,52.0833,'2029-05-31'),
  ('خيط سكرل 3.0','قطعة',12.0,9.0,35.4167,'2027-06-30'),
  ('لزق كانولا','قطعة',100.0,9.0,3.75,'2031-04-30'),
  ('جاركن جل سونار (4 ليتر )','جاركن',1.0,5.0,75.0,'2031-05-31'),
  ('رباط ضغط مقاس 15','قطعة',1.0,16.0,22.5,null),
  ('رباط ضغط مقاس 10','قطعة',1.0,10.0,16.5,null),
  ('جيبسونة مقاس 15','قطعة',1.0,7.0,42.0,'2027-05-31'),
  ('جيبسونة مقاس 10','قطعة',1.0,11.0,34.0,'2027-10-31'),
  ('ماسك كبار نيولايزر','قطعة',1.0,20.0,13.5,null),
  ('ماسك اطفال نيولايزر','قطعة',1.0,20.0,13.5,null),
  ('محلول رينجر','قطعة',1.0,42.0,25.0,'2028-08-31'),
  ('محلول ملح','قطعة',1.0,14.0,24.5,'2029-09-30'),
  ('محلول جلوكوز','قطعة',1.0,19.0,21.5,'2028-01-31'),
  ('كيس كب حجامة (10 قطع )','قطعة',10.0,160.0,8.5,null),
  ('خافض لسان','قطعة',100.0,1120.0,0.45,'2030-05-31'),
  ('شريحة سكر','قطعة',50.0,415.0,4.7,'2027-11-30'),
  ('شكاكة سكر','قطعة',100.0,1425.0,0.45,'2030-04-30'),
  ('تيوبة بلازما','قطعة',1.0,14.0,42.5,'2028-11-30'),
  ('سرنجة 10 سم','قطعة',125.0,99.0,2.8,'2030-12-31'),
  ('سرنجة 50 سم','قطعة',1.0,5.0,10.0,'2028-12-31'),
  ('سرنجة 3 سم كبار','قطعة',250.0,291.0,1.58,'2030-12-31'),
  ('سرنجة 3 سم اطفال','قطعة',250.0,376.0,1.58,'2031-09-30'),
  ('سرنجة انسولين','قطعة',300.0,254.0,1.9333,'2030-06-30'),
  ('رول ازرق','رول',1.0,25.0,85.0,null),
  ('كانولا زرقاء','قطعة',100.0,200.0,8.5,'2030-05-31'),
  ('سرنجة 5 سم','قطعة',200.0,250.0,2.05,'2031-06-30'),
  ('كانيولا صفراء','قطعة',100.0,206.0,9.75,'2030-01-31'),
  ('سيفتي بوكس','قطعة',1.0,22.0,18.5,null),
  ('جلافز M','قطعة',100.0,815.0,2.1,'2029-06-30'),
  ('جلافز L','قطعة',100.0,517.0,2.1,'2031-04-30'),
  ('جلافز XL','قطعة',100.0,1020.0,2.1,'2031-05-31'),
  ('كب عينية بول','قطعة',1.0,150.0,3.25,null),
  ('كحول اسبراي 75 مللي','قطعة',12.0,17.0,14.5833,null),
  ('سحابة بول','قطعة',1.0,0.0,250.0,null);
do $$
declare me uuid; r record; iid uuid; lid uuid; loc uuid; v_at timestamptz := timestamptz '2026-11-24 08:00+02';
begin
  select id into me from public.admins where role = 'super_admin' and active order by id limit 1;
  select id into loc from public.inventory_locations where name = 'فرعي مستلزمات تمريض' and active;
  if me is null or loc is null then raise exception 'super admin or store missing'; end if;
  if exists (select 1 from public.inventory_items i join _open o on lower(trim(i.name)) = lower(trim(o.name))) then
    raise exception 'بعض الأصناف موجودة قبل كده؛ الملف اتطبق قبل كده؟';
  end if;
  for r in select * from _open order by name loop
    insert into public.inventory_items(name, category, base_unit, units_per_pack, markup_percent, current_sale_price, track_lots, pricing_kind, created_by)
      values (r.name, 'مستلزمات', r.unit, r.units_per_pack, 35, round(r.unit_cost * 1.35, 2), false, 'supply', me) returning id into iid;
    if r.quantity > 0 then
      insert into public.inventory_lots(item_id, lot_number, expiry_date, received_quantity, unit_cost, supplier_name, created_by)
        values (iid, 'OPEN-NURSING-20261124', r.expiry, r.quantity, r.unit_cost, 'رصيد أول المدة', me) returning id into lid;
      insert into public.inventory_movements(item_id, location_id, lot_id, movement_type, quantity_delta, unit_cost, reference_type, note, occurred_at, created_by)
        values (iid, loc, lid, 'opening_balance', r.quantity, r.unit_cost, 'opening', 'رصيد أول المدة 24 نوفمبر 2026', v_at, me);
      insert into public.inventory_opening_markers(location_id, item_id, batch_id) values (loc, iid, null);
    end if;
  end loop;
end $$;
select l.name store, count(distinct m.item_id) items, round(sum(m.quantity_delta * m.unit_cost), 2) value
  from public.inventory_movements m join public.inventory_locations l on l.id = m.location_id
 where m.movement_type = 'opening_balance' and m.occurred_at = timestamptz '2026-11-24 08:00+02' group by l.name;
commit;
