-- Ops (data only, run AFTER migration 20261122270000): the owner's store structure (2026-11-22, approved mockup
-- docs/ui-references/mockups/inventory-supplies-flow.html). Renames + is_main flags on the live rows.
--   central «المخزن الرئيسي المركزي»   → «رئيسي مستلزمات»        (main)
--   «مخزن الأسنان» 552cff60-…        → «رئيسي أسنان»           (main)
--   «الادوية - تمريض»                  → «رئيسي أدوية»           (main)
--   «مستلزمات طبية - تمريض»            → «فرعي مستلزمات تمريض»   (sub, fed by transfers from «رئيسي مستلزمات»)
--   «فندقة»                             unchanged (owner: «زي ما هو»)
-- Idempotent: each update only touches a row that still differs, so a re-run changes 0 rows. The reception mirror keeps
-- its own copy of the name (clinic_reception.locations.name); it is refreshed here so reception screens show the new names.
begin;
update public.inventory_locations set name = 'رئيسي مستلزمات', is_main = true
 where id = '00000000-0000-4000-8000-000000000001' and (name <> 'رئيسي مستلزمات' or not is_main);
update public.inventory_locations set name = 'رئيسي أسنان', is_main = true
 where id = '552cff60-fcad-4f4f-9e0e-5c7df1c3b6b7' and (name <> 'رئيسي أسنان' or not is_main);
update public.inventory_locations set name = 'رئيسي أدوية', is_main = true
 where kind = 'substore' and name in ('الادوية - تمريض', 'رئيسي أدوية') and (name <> 'رئيسي أدوية' or not is_main);
update public.inventory_locations set name = 'فرعي مستلزمات تمريض'
 where kind = 'substore' and name = 'مستلزمات طبية - تمريض';
update clinic_reception.locations r set name = l.name
  from public.inventory_locations l where r.inventory_location_id = l.id and r.name <> l.name;
do $$ begin
  if (select count(*) from public.inventory_locations where is_main and active) <> 3 then raise exception 'expected 3 main stores'; end if;
  if not exists (select 1 from public.inventory_locations where name = 'فرعي مستلزمات تمريض') then raise exception 'nursing sub store missing'; end if;
  if not exists (select 1 from public.inventory_locations where name = 'فندقة') then raise exception 'فندقة must stay'; end if;
end $$;
select id, name, kind, is_main, active from public.inventory_locations order by is_main desc, name;
commit;
