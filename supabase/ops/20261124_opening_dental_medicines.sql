-- Ops (data): opening balances «رئيسي أسنان» + «رئيسي أدوية» as of 2026-11-24 (owner, inventory chat).
-- Source sheets: dental count 21-11 (owner-confirmed, open pieces may exceed a pack), medicines sheet with expiry
-- (month/day swap fixed per owner; ماء اوكسجين = Feb 2027; melatonin 40 EGP). Quantities in the item's dispensing unit.
-- APPLY ON/AFTER 2026-11-24 (owner: start tomorrow with the counts we have; a normal جرد on 2026-12-01 records any difference).
-- Per row: create the item (category, unit, units_per_pack, pricing_kind, markup, sale price), one opening lot
-- «OPEN-<store>-20261124» (every row gets a lot so reception «استهلاك أمس» can consume it), one opening_balance movement
-- at the store dated 2026-11-24 08:00 Cairo, and the opening marker. No GL posting (opening_balance has no posting
-- trigger); the opening stock value must be booked by finance's opening entry.
-- Idempotent: aborts if any of these item names already exists. Expected: 94 dental + 42 medicine items;
-- value dental 26,609.09 EGP, medicines 14,404.70 EGP.
begin;
do $$ begin
  if now() < timestamptz '2026-11-24 00:00+02' then raise exception 'لسه بدري: الرصيد ده بتاريخ 24 نوفمبر'; end if;
end $$;
create temp table _open(store text,name text,category text,unit text,units_per_pack numeric,quantity numeric,unit_cost numeric,kind text,markup numeric,expiry date) on commit drop;
insert into _open values
  ('dental','long needles','أسنان','قطعة',100.0,30.0,3.0,'supply',35,null),
  ('dental','short needles','أسنان','قطعة',100.0,13.0,2.95,'supply',35,null),
  ('dental','meta paste','أسنان','سرينجة',1.0,0.5,600.0,'supply',35,null),
  ('dental','metapex','أسنان','سرينجة',1.0,0.25,580.0,'supply',35,null),
  ('dental','napkin','أسنان','قطعة',100.0,116.0,0.35,'supply',35,null),
  ('dental','nature silk suture 3/0','أسنان','قطعة',12.0,8.0,20.8333,'supply',35,null),
  ('dental','nature silk suture 4/0','أسنان','قطعة',12.0,10.0,20.8333,'supply',35,null),
  ('dental','nic spreaders','أسنان','قطعة',6.0,9.0,28.3333,'supply',35,null),
  ('dental','pink wax sheet','أسنان','قطعة',24.0,9.0,8.5417,'supply',35,null),
  ('dental','plastic cup','أسنان','قطعة',50.0,30.0,0.9,'supply',35,null),
  ('dental','pp25 4%','أسنان','قطعة',6.0,6.0,21.6667,'supply',35,null),
  ('dental','pp25 2%','أسنان','قطعة',6.0,6.0,21.6667,'supply',35,null),
  ('dental','pp30 4%','أسنان','قطعة',6.0,6.0,21.6667,'supply',35,null),
  ('dental','pp35 4%','أسنان','قطعة',6.0,3.0,21.6667,'supply',35,null),
  ('dental','retraction cord 00','أسنان','بكرة',1.0,1.0,140.0,'supply',35,null),
  ('dental','retraction cord 0','أسنان','بكرة',1.0,1.0,140.0,'supply',35,null),
  ('dental','retraction cord 1','أسنان','بكرة',1.0,1.0,140.0,'supply',35,null),
  ('dental','rotary files','أسنان','قطعة',5.0,26.0,66.0,'supply',35,null),
  ('dental','round stone','أسنان','قطعة',10.0,14.0,18.0,'supply',35,null),
  ('dental','rubber dam sheet','أسنان','قطعة',36.0,24.0,10.8333,'supply',35,null),
  ('dental','saddle matrix','أسنان','قطعة',36.0,33.0,16.1111,'supply',35,null),
  ('dental','saliva italy','أسنان','قطعة',100.0,26.0,3.4,'supply',35,null),
  ('dental','sectional matrix','أسنان','قطعة',36.0,90.0,10.5556,'supply',35,null),
  ('dental','surgical bur','أسنان','قطعة',10.0,3.0,30.0,'supply',35,null),
  ('dental','surgical high suction','أسنان','قطعة',18.0,20.0,5.5556,'supply',35,null),
  ('dental','temp crown','أسنان','سرينجة',1.0,0.75,1590.0,'supply',35,null),
  ('dental','temporary cement','أسنان','سرينجة',1.0,0.75,1690.0,'supply',35,null),
  ('dental','temporary filling','أسنان','علبة',1.0,1.25,175.0,'supply',35,null),
  ('dental','gloves','أسنان','قطعة',50.0,45.0,4.2,'supply',35,null),
  ('dental','mask','أسنان','قطعة',50.0,290.0,1.3,'supply',35,null),
  ('dental','three wheel stone','أسنان','قطعة',10.0,3.0,35.0,'supply',35,null),
  ('dental','finishing stones','أسنان','قطعة',10.0,22.0,35.0,'supply',35,null),
  ('dental','fissure bur','أسنان','قطعة',10.0,6.0,35.0,'supply',35,null),
  ('dental','flame blue stone','أسنان','قطعة',10.0,9.0,35.0,'supply',35,null),
  ('dental','zinconol','أسنان','علبة',1.0,0.5,500.0,'supply',35,null),
  ('dental','cement kromo drop & powder','أسنان','قطعة',1.0,0.5,550.0,'supply',35,null),
  ('dental','GP 20 6% meta gutta','أسنان','قطعة',6.0,6.0,23.3333,'supply',35,null),
  ('dental','GP 30 6% meta gutta','أسنان','قطعة',6.0,6.0,23.3333,'supply',35,null),
  ('dental','GP 25 6% meta gutta','أسنان','قطعة',6.0,5.0,23.3333,'supply',35,null),
  ('dental','GP 25 4% meta gutta','أسنان','قطعة',6.0,3.0,23.3333,'supply',35,null),
  ('dental','GP 30 4% meta gutta','أسنان','قطعة',6.0,6.0,23.3333,'supply',35,null),
  ('dental','GP 35 4% meta gutta','أسنان','قطعة',6.0,6.0,23.3333,'supply',35,null),
  ('dental','GP 25 2% meta gutta','أسنان','قطعة',6.0,9.0,23.3333,'supply',35,null),
  ('dental','GP 30 2% meta gutta','أسنان','قطعة',6.0,6.0,23.3333,'supply',35,null),
  ('dental','gauze','أسنان','قطعة',100.0,50.0,0.55,'supply',35,null),
  ('dental','H files 15-40','أسنان','قطعة',6.0,11.0,36.6667,'supply',35,null),
  ('dental','k files 15-40','أسنان','قطعة',6.0,13.0,36.6667,'supply',35,null),
  ('dental','k files 45-80','أسنان','قطعة',6.0,6.0,36.6667,'supply',35,null),
  ('dental','k file 8','أسنان','قطعة',6.0,7.0,36.6667,'supply',35,null),
  ('dental','k file 10','أسنان','قطعة',6.0,18.0,36.6667,'supply',35,null),
  ('dental','k file 15','أسنان','قطعة',6.0,4.0,36.6667,'supply',35,null),
  ('dental','k file 20','أسنان','قطعة',6.0,13.0,36.6667,'supply',35,null),
  ('dental','k file 25','أسنان','قطعة',6.0,10.0,36.6667,'supply',35,null),
  ('dental','c file 10','أسنان','قطعة',6.0,7.0,28.3333,'supply',35,null),
  ('dental','c file 15','أسنان','قطعة',6.0,11.0,28.3333,'supply',35,null),
  ('dental','zetalgin alginate','أسنان','كيس',1.0,1.25,295.0,'supply',35,null),
  ('dental','irrigation needle','أسنان','قطعة',100.0,41.0,3.25,'supply',35,null),
  ('dental','zetapluss putty','أسنان','علبة',1.0,0.25,665.0,'supply',35,null),
  ('dental','zetapluss putty light body','أسنان','أمبوبة',1.0,0.25,665.0,'supply',35,null),
  ('dental','zetapluss activator','أسنان','أمبوبة',1.0,0.25,665.0,'supply',35,null),
  ('dental','light bleaching','أسنان','قطعة',4.0,0.0,0.0,'supply',35,null),
  ('dental','TR blue stone13','أسنان','قطعة',10.0,11.0,30.0,'supply',35,null),
  ('dental','TR blue stone 12','أسنان','قطعة',10.0,7.0,30.0,'supply',35,null),
  ('dental','fissure stone','أسنان','قطعة',10.0,8.0,30.0,'supply',35,null),
  ('dental','carpul dental local anaesthesia','أسنان','قطعة',50.0,50.0,15.4,'supply',35,null),
  ('dental','wheel stone','أسنان','قطعة',10.0,3.0,30.0,'supply',35,null),
  ('dental','adsel pluss','أسنان','سرينجة',1.0,1.0,950.0,'supply',35,null),
  ('dental','articulating papers','أسنان','قطعة',10.0,9.0,40.0,'supply',35,null),
  ('dental','B- chem polishing','أسنان','علبة',1.0,0.75,90.0,'supply',35,null),
  ('dental','bisco bond','أسنان','علبة',1.0,0.5,2250.0,'supply',35,null),
  ('dental','bond brush','أسنان','قطعة',100.0,150.0,0.55,'supply',35,null),
  ('dental','resin cement','أسنان','سرينجة',1.0,0.5,650.0,'supply',35,null),
  ('dental','brulon green sticks','أسنان','قطعة',10.0,10.0,15.0,'supply',35,null),
  ('dental','acid etch','أسنان','سرينجة',1.0,2.0,180.0,'supply',35,null),
  ('dental','charm core','أسنان','سرينجة',1.0,0.5,1550.0,'supply',35,null),
  ('dental','chlorhexidine','أسنان','زجاجة',1.0,0.75,30.0,'supply',35,null),
  ('dental','edta plus solution','أسنان','زجاجة',1.0,0.5,50.0,'supply',35,null),
  ('dental','composite beautiful','أسنان','سرينجة',1.0,0.5,275.0,'supply',35,null),
  ('dental','cotton roll','أسنان','باكت',12.0,12.0,30.0,'supply',35,null),
  ('dental','crown fill composite','أسنان','سرينجة',1.0,0.5,250.0,'supply',35,null),
  ('dental','D finder 15','أسنان','قطعة',6.0,6.0,50.0,'supply',35,null),
  ('dental','dia root sealer','أسنان','سرينجة',1.0,0.75,650.0,'supply',35,null),
  ('dental','edta gel','أسنان','سرينجة',1.0,0.5,60.0,'supply',35,null),
  ('dental','EZ- shine polishing paste','أسنان','سرينجة',1.0,0.5,150.0,'supply',35,null),
  ('dental','fast polishing capsules','أسنان','كابسولة',1.0,7.0,15.0,'supply',35,null),
  ('dental','topical anasethia gel','أسنان','علبة',1.0,0.75,100.0,'supply',35,null),
  ('dental','wedges','أسنان','قطعة',100.0,76.0,2.0,'supply',35,null),
  ('dental','fiber post','أسنان','قطعة',30.0,18.0,5.0,'supply',35,null),
  ('dental','jk formocresol','أسنان','زجاجة',1.0,0.5,160.0,'supply',35,null),
  ('dental','jk gutta solvent','أسنان','زجاجة',1.0,0.75,140.0,'supply',35,null),
  ('dental','jk hemo stop liquid','أسنان','زجاجة',1.0,0.75,125.0,'supply',35,null),
  ('dental','gates drills2-3-4','أسنان','قطعة',6.0,15.0,58.3333,'supply',35,null),
  ('dental','flowable composite','أسنان','سرينجة',1.0,1.75,280.0,'supply',35,null),
  ('dental','dental floss','أسنان','بكرة',1.0,0.75,150.0,'supply',35,null),
  ('medicine','ceftriaxone 1gm amp','أدوية','أمبول',1.0,10.0,95.0,'medicine',0,'2029-01-31'),
  ('medicine','ceftriaxone 500 mg amp','أدوية','أمبول',1.0,12.0,62.0,'medicine',0,'2028-01-31'),
  ('medicine','gast-reg amp.','أدوية','أمبول',1.0,2.0,18.0,'medicine',0,'2027-03-31'),
  ('medicine','magnisol amp.','أدوية','أمبول',1.0,5.0,11.0,'medicine',0,'2027-07-31'),
  ('medicine','unicatam vial 1500','أدوية','أمبول',1.0,4.0,56.0,'medicine',0,'2028-04-30'),
  ('medicine','livabion amp','أدوية','أمبول',1.0,10.0,16.0,'medicine',0,'2027-04-30'),
  ('medicine','oframax 1 gm (cefotriaxone )','أدوية','أمبول',1.0,2.0,71.0,'medicine',0,'2027-12-31'),
  ('medicine','ماء اوكسجين','أدوية','زجاجة',1.0,2.0,30.0,'medicine',0,'2027-02-28'),
  ('medicine','corasor drops','أدوية','زجاجة',1.0,0.0,40.0,'medicine',0,null),
  ('medicine','ZOVIRAX 500 amp','أدوية','أمبول',1.0,0.0,182.0,'medicine',0,null),
  ('medicine','لبوس دولفن 12.5','أدوية','قمع',1.0,7.0,3.6,'medicine',0,'2028-01-31'),
  ('medicine','Insulin actirapid انسولين اكترابيد','أدوية','قطعة',1.0,3.0,338.0,'medicine',0,'2027-10-31'),
  ('medicine','kapron amp كابرون امبول','أدوية','أمبول',1.0,12.0,15.0,'medicine',0,'2028-04-30'),
  ('medicine','فاركولين استنشاق نقط farcolin drops','أدوية','قطعة',1.0,6.0,37.0,'medicine',0,'2027-03-31'),
  ('medicine','ديبوفيت امبول depovit amp','أدوية','أمبول',1.0,9.0,17.0,'medicine',0,'2028-01-31'),
  ('medicine','دانست اطفال ٤ مجم danset 4 mg','أدوية','أمبول',1.0,6.0,55.0,'medicine',0,'2027-10-31'),
  ('medicine','سبازموفري امبولspasmofree amp','أدوية','أمبول',1.0,3.0,18.0,'medicine',0,'2029-06-30'),
  ('medicine','كيتولاك امبول ketolak amp','أدوية','أمبول',1.0,27.0,12.0,'medicine',0,'2028-11-30'),
  ('medicine','فولتارين امبول volatren amp','أدوية','أمبول',1.0,6.0,17.0,'medicine',0,'2027-03-31'),
  ('medicine','ديكساميثازون امبول Dexamethasone amp','أدوية','أمبول',1.0,20.0,12.0,'medicine',0,'2028-07-31'),
  ('medicine','cerebrolysin 5MG AMP.','أدوية','أمبول',1.0,30.0,178.0,'medicine',0,'2028-08-31'),
  ('medicine','لازكس امبول٢٠ مجم lasix 20 mg amp','أدوية','أمبول',1.0,8.0,12.0,'medicine',0,'2027-11-30'),
  ('medicine','peel max','أدوية','قطعة',1.0,1.0,1350.0,'medicine',0,'2028-08-31'),
  ('medicine','ديكلوفين امبول declophen amp','أدوية','أمبول',1.0,26.0,12.0,'medicine',0,'2029-04-30'),
  ('medicine','بريمبران امبول primperan amp','أدوية','أمبول',1.0,10.0,10.0,'medicine',0,'2027-09-30'),
  ('medicine','antodine amp انتودين امبول','أدوية','أمبول',1.0,5.0,13.0,'shortage',35,'2029-06-30'),
  ('medicine','b comp amp بي كومب امبول','أدوية','أمبول',1.0,5.0,8.0,'medicine',0,'2029-04-30'),
  ('medicine','melatonin drops','أدوية','زجاجة',1.0,1.0,40.0,'medicine',0,'2027-12-31'),
  ('medicine','اتروفينت امبول استنشاق 250 atrovent','أدوية','أمبول',1.0,3.0,15.5,'medicine',0,'2027-11-30'),
  ('medicine','amrizole 500 mg vial اميرزول فايل ٥٠٠ مجم','أدوية','أمبول',1.0,3.0,47.0,'medicine',0,'2029-04-30'),
  ('medicine','mixtard 30 (insuline )','أدوية','أمبول',1.0,1.0,130.0,'medicine',0,'2027-09-30'),
  ('medicine','افيل امبول avil amp','أدوية','أمبول',1.0,6.0,11.5,'medicine',0,'2028-06-30'),
  ('medicine','دانسيت كبار 8ملل Danset 8 mg','أدوية','أمبول',1.0,20.0,53.0,'medicine',0,'2029-02-28'),
  ('medicine','paracetamol vial 1 gm','أدوية','أمبول',1.0,10.0,60.0,'medicine',0,'2028-05-31'),
  ('medicine','visceralgine amp','أدوية','قطعة',1.0,0.0,15.0,'medicine',0,null),
  ('medicine','pulmicort 0,25','أدوية','قطعة',1.0,0.0,564.0,'medicine',0,null),
  ('medicine','pulmicort 0,5','أدوية','قطعة',1.0,0.0,752.0,'medicine',0,null),
  ('medicine','pridocaine cream','أدوية','قطعة',1.0,0.0,55.0,'medicine',0,null),
  ('medicine','استنشاق 500 atrovent','أدوية','قطعة',1.0,0.0,311.0,'medicine',0,null),
  ('medicine','Fortamind 500 mg amp','أدوية','قطعة',1.0,0.0,240.0,'medicine',0,null),
  ('medicine','sulfax cream','أدوية','قطعة',1.0,0.0,120.0,'medicine',0,null),
  ('medicine','controloc 40 mg amp','أدوية','قطعة',1.0,0.0,146.0,'medicine',0,null);
do $$
declare me uuid; r record; iid uuid; lid uuid; loc uuid; v_at timestamptz := timestamptz '2026-11-24 08:00+02';
begin
  select id into me from public.admins where role = 'super_admin' and active order by id limit 1;
  if me is null then raise exception 'no super admin'; end if;
  if exists (select 1 from public.inventory_items i join _open o on lower(trim(i.name)) = lower(trim(o.name))) then
    raise exception 'بعض الأصناف موجودة قبل كده؛ الملف اتطبق قبل كده؟';
  end if;
  for r in select * from _open order by store, name loop
    loc := case r.store when 'dental' then '552cff60-fcad-4f4f-9e0e-5c7df1c3b6b7'::uuid
             else (select id from public.inventory_locations where name = 'رئيسي أدوية' and active) end;
    if loc is null then raise exception 'store missing %', r.store; end if;
    insert into public.inventory_items(name, category, base_unit, units_per_pack, markup_percent, current_sale_price, track_lots, pricing_kind, created_by)
      values (r.name, r.category, r.unit, r.units_per_pack, r.markup, round(r.unit_cost * (1 + r.markup / 100), 2), r.store = 'medicine', r.kind, me)
      returning id into iid;
    if r.quantity > 0 then
      insert into public.inventory_lots(item_id, lot_number, expiry_date, received_quantity, unit_cost, supplier_name, created_by)
        values (iid, 'OPEN-' || upper(r.store) || '-20261124', r.expiry, r.quantity, r.unit_cost, 'رصيد أول المدة', me) returning id into lid;
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
