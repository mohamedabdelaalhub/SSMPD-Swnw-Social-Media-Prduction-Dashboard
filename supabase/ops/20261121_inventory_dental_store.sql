-- Ops (not a migration): create the dental substore «مخزن الأسنان» in the current branch.
-- Owner approved 2026-11-21 (Inventory upload sub-chat). Idempotent: re-running changes nothing.
-- Same effect as the UI button «إضافة مخزن فرعي» (inventory_save_structure), done directly because
-- the ops runner has no my_admin_id(). No items, balances or staff are touched.
begin;
insert into public.inventory_locations(branch_id,name,kind)
select '00000000-0000-4000-8000-000000000002','مخزن الأسنان','substore'
where not exists (select 1 from public.inventory_locations
                  where branch_id='00000000-0000-4000-8000-000000000002' and name='مخزن الأسنان');
-- Expect exactly 1 dental store and 5 locations total (central + 4 substores).
do $$ begin
 if (select count(*) from public.inventory_locations where name='مخزن الأسنان') <> 1 then raise exception 'dental store count <> 1'; end if;
 if (select count(*) from public.inventory_locations) <> 5 then raise exception 'unexpected location count'; end if;
end $$;
select id,name,kind,branch_id,active from public.inventory_locations order by kind,name;
commit;
