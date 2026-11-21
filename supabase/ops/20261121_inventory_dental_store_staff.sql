-- Ops (not a migration): give هدى the storekeeper role in «مخزن الأسنان».
-- Owner said 2026-11-21: «المسؤول عن مخزن الأسنان هدى». Run AFTER 20261121_inventory_dental_store.sql.
-- storekeeper = view + manage items + receive + count, per inventory_location_can. Approving count/opening
-- imports stays with the inventory managers (owner/finance), not هدى.
-- Idempotent (ON CONFLICT DO NOTHING). Aborts unless exactly ONE active admin name contains «هدى».
begin;
do $$
declare v_loc uuid; v_admin uuid; n int;
begin
 select id into strict v_loc from public.inventory_locations where name='مخزن الأسنان' and active;
 select count(*) into n from public.admins where active and name like '%هدى%';
 if n<>1 then raise exception 'expected exactly 1 active admin named هدى, found %', n; end if;
 select id into v_admin from public.admins where active and name like '%هدى%';
 insert into public.inventory_location_staff(location_id,admin_id,responsibility)
 values(v_loc,v_admin,'storekeeper') on conflict do nothing;
end $$;
select l.name location, a.name admin, s.responsibility
from public.inventory_location_staff s join public.inventory_locations l on l.id=s.location_id join public.admins a on a.id=s.admin_id
where l.name='مخزن الأسنان';
commit;
