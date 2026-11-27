-- صحة وان: «كشف استشاري الأمراض النفسية» (SVC-0001380) 175 → 300 (owner 2026-11-27: «… هيبقي ٣٠٠ ج», which replaces his earlier
-- «يفضل كده»). Same pattern as 20261127170000: guarded, audited ('owner_price_fix'), list revision bumped, idempotent.
-- Rollback: supabase/rollbacks/20261127190000_sehha_one_psychiatry_300.rollback.sql
begin;
do $$
declare lid uuid; l clinic_prices.lists%rowtype; ps uuid; it clinic_prices.items%rowtype; n int; actor uuid;
begin
  select count(distinct k.price_list_id) into n from public.contracting_entity_contracts k join public.contracting_entities e on e.id = k.entity_id
   where e.name ~* 'صح[ةه]\s*وان' and k.status = 'active' and k.price_list_id is not null;
  if n <> 1 then raise exception 'expected exactly 1 active صحة وان contract list, found %', n; end if;
  select k.price_list_id into lid from public.contracting_entity_contracts k join public.contracting_entities e on e.id = k.entity_id
   where e.name ~* 'صح[ةه]\s*وان' and k.status = 'active' and k.price_list_id is not null limit 1;
  select * into l from clinic_prices.lists where id = lid and deleted_at is null for update;
  if l.status <> 'active' then raise exception 'صحة وان list is % — expected active; stop', l.status; end if;
  select id into ps from public.pricing_services where canonical_code = 'SVC-0001380';
  if ps is null then raise exception 'SVC-0001380 not found'; end if;
  actor := coalesce(public.my_admin_id(), l.created_by);
  select * into it from clinic_prices.items where list_id = lid and service_id = ps;
  if it.fixed_price = 300 then raise notice 'sehha_one_psychiatry_300: already applied, nothing to do'; return; end if;
  if it.id is null or it.fixed_price <> 175 then raise exception 'SVC-0001380 item is % — expected 175; stop', it.fixed_price; end if;
  update clinic_prices.items set fixed_price = 300 where id = it.id;
  insert into clinic_prices.audit(actor_id, action, list_id, details) values (actor, 'owner_price_fix', lid,
    jsonb_build_object('migration', '20261127190000', 'step', 'psychiatry_price', 'item', to_jsonb(it), 'new_price', 300));
  update clinic_prices.lists set revision = revision + 1 where id = lid;
  raise notice 'sehha_one_psychiatry_300: 175 → 300';
end $$;
commit;
