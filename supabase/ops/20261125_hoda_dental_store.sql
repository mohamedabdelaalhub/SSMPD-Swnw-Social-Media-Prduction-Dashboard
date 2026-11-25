-- Ops (access): owner 2026-11-25 «عايز مستلزمات اسنان تظهر لتمريض الأسنان، اللي هي دلوقتي مستخدم هدى تمريض أسنان».
-- Gives Hoda (dental nursing) the 'receiver' responsibility on «رئيسي أسنان» (552cff60-…). In inventory_location_can that grants:
--   view     → the store appears in her inventory tab with its items, balances and movements
--   receive  → «استهلاك داخلي» (inventory_consume_at issue) from this store, and confirming receipt of transfers addressed to her
-- It does NOT grant manage (items/prices/invoices/counts), storekeeper (approve or dispatch transfers), request (senior
-- nursing) or any other store. Earlier the owner named Hoda as the person responsible for the dental store; if storekeeper is
-- wanted later, it is one more row. Idempotent (on conflict do nothing). Aborts unless exactly one active admin matches.
begin;
do $$
declare h uuid; n int; names text;
begin
  select count(*), string_agg(name || ' (' || role || ')', '، ') into n, names
    from public.admins where active and name ~ 'هد[ىي]';
  if n <> 1 then raise exception 'expected exactly one active admin named هدى/هدي, found %: %', n, coalesce(names, '-'); end if;
  select id into h from public.admins where active and name ~ 'هد[ىي]';
  if not exists (select 1 from public.inventory_locations where id = '552cff60-fcad-4f4f-9e0e-5c7df1c3b6b7' and active and name = 'رئيسي أسنان')
    then raise exception 'dental store missing'; end if;
  insert into public.inventory_location_staff(location_id, admin_id, responsibility)
    values ('552cff60-fcad-4f4f-9e0e-5c7df1c3b6b7', h, 'receiver') on conflict do nothing;
end $$;
select a.name, a.role, l.name store, s.responsibility
  from public.inventory_location_staff s join public.admins a on a.id = s.admin_id join public.inventory_locations l on l.id = s.location_id
 where a.active and a.name ~ 'هد[ىي]' order by l.name, s.responsibility;
commit;
