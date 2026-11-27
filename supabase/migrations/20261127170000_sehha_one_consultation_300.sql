-- صحة وان: consultation price is 300 EGP for both grades (owner 2026-11-27: «كشف عموما اخصائي او استشاري في صحة وان ٣٠٠ ج»).
-- Live state found by main chat 7: the entity's ACTIVE reference list has «كشف الأخصائي» (SVC-0001371) as a fixed item at
-- 1000.00 (wrong) and no item for «كشف الاستشاري» (SVC-0001372).
--   1. SVC-0001371 item: 1000 → 300.
--   2. SVC-0001372 item added at 300 (same section as the SVC-0001371 item).
-- «كشف استشاري الأمراض النفسية» (SVC-0001380, 175) is NOT touched — waiting for the owner.
-- Every step is written to clinic_prices.audit (action 'owner_price_fix'); list revision bumped. Refuses unless the state is
-- exactly as found (one active contract for صحة وان, its linked list active, SVC-0001371 at 1000, no SVC-0001372 item).
-- Idempotent. Rollback: supabase/rollbacks/20261127170000_sehha_one_consultation_300.rollback.sql
begin;
do $$
declare
  lid uuid; l clinic_prices.lists%rowtype; sp uuid; cs uuid; it clinic_prices.items%rowtype; n int; actor uuid;
begin
  select count(distinct k.price_list_id) into n from public.contracting_entity_contracts k join public.contracting_entities e on e.id = k.entity_id
   where e.name ~* 'صح[ةه]\s*وان' and k.status = 'active' and k.price_list_id is not null;
  if n <> 1 then raise exception 'expected exactly 1 active صحة وان contract list, found %', n; end if;
  select k.price_list_id into lid from public.contracting_entity_contracts k join public.contracting_entities e on e.id = k.entity_id
   where e.name ~* 'صح[ةه]\s*وان' and k.status = 'active' and k.price_list_id is not null limit 1;
  select * into l from clinic_prices.lists where id = lid and deleted_at is null for update;
  if l.status <> 'active' then raise exception 'صحة وان list is % — expected active; stop', l.status; end if;
  select id into sp from public.pricing_services where canonical_code = 'SVC-0001371';
  select id into cs from public.pricing_services where canonical_code = 'SVC-0001372';
  if sp is null or cs is null then raise exception 'consultation services SVC-0001371/SVC-0001372 not found'; end if;
  actor := coalesce(public.my_admin_id(), l.created_by);

  select * into it from clinic_prices.items where list_id = lid and service_id = sp;
  if it.fixed_price = 300 and exists (select 1 from clinic_prices.items where list_id = lid and service_id = cs and fixed_price = 300) then
    raise notice 'sehha_one_consultation_300: already applied, nothing to do'; return;
  end if;
  if it.id is null or it.fixed_price <> 1000 then raise exception 'SVC-0001371 item is % — expected 1000; stop', it.fixed_price; end if;
  if exists (select 1 from clinic_prices.items where list_id = lid and service_id = cs) then raise exception 'SVC-0001372 already has an item; stop'; end if;

  update clinic_prices.items set fixed_price = 300 where id = it.id;
  insert into clinic_prices.audit(actor_id, action, list_id, details) values (actor, 'owner_price_fix', lid,
    jsonb_build_object('migration', '20261127170000', 'step', 'specialist_price', 'item', to_jsonb(it), 'new_price', 300));
  insert into clinic_prices.items(list_id, service_id, fixed_price, section_id, notes)
  values (lid, cs, 300, it.section_id, 'أمر المالك 2026-11-27: كشف صحة وان 300 للأخصائي والاستشاري');
  insert into clinic_prices.audit(actor_id, action, list_id, details) values (actor, 'owner_price_fix', lid,
    jsonb_build_object('migration', '20261127170000', 'step', 'consultant_added', 'service_id', cs, 'price', 300));
  update clinic_prices.lists set revision = revision + 1 where id = lid;
  raise notice 'sehha_one_consultation_300: specialist 1000→300, consultant added at 300';
end $$;
commit;
