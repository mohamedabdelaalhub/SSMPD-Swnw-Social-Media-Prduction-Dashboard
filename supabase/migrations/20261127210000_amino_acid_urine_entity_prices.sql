-- «Aminogram in Urine» in four entity files = «Amino Acid Urine» (SVC-0000304, Sono 2700). Owner 2026-11-27: price 1890
-- (= 2700 × 0.70) for all, and «أيوه هو نفسه» (same service — no new service).
--   1. Adds an item SVC-0000304 at 1890 to the ACTIVE lists of ميد نت, مصر هيلث كير, ميد شور and نقابة الاطباء 2026
--      (hamza folded), same section as the list's SVC-0000305 «Aminogram» item when there is one.
--   2. Restores the four «Aminogram in Urine» aliases that 20261127080000 removed (from its audit copies), pointing them to
--      SVC-0000304 so later imports link the name correctly.
-- A list that already has an SVC-0000304 item is left as is (reported). Audited ('owner_price_fix'), list revisions bumped,
-- idempotent. Rollback: supabase/rollbacks/20261127210000_amino_acid_urine_entity_prices.rollback.sql
begin;
do $$
declare
  svc uuid; l record; sec uuid; al clinic_prices.aliases; a record; actor uuid; n int; added int := 0;
begin
  select id into svc from public.pricing_services where canonical_code = 'SVC-0000304' and name ~* 'amino\s*acid.*urine' and active;
  if svc is null then raise exception 'SVC-0000304 «Amino Acid Urine» not found or inactive'; end if;
  select count(*) into n from clinic_prices.lists x where x.deleted_at is null and x.status = 'active' and x.list_kind = 'reference'
     and translate(x.name, 'أإآ', 'ااا') ~ '(ميد نت|مصر هيلث كير|ميد شور|نقابة الاطباء.*2026)';
  if n <> 4 then raise exception 'expected 4 active entity lists, found %', n; end if;

  for l in select x.id, x.name, x.created_by from clinic_prices.lists x where x.deleted_at is null and x.status = 'active' and x.list_kind = 'reference'
     and translate(x.name, 'أإآ', 'ااا') ~ '(ميد نت|مصر هيلث كير|ميد شور|نقابة الاطباء.*2026)' order by x.name
  loop
    actor := coalesce(public.my_admin_id(), l.created_by);
    if exists (select 1 from clinic_prices.items where list_id = l.id and service_id = svc) then
      raise notice '«%» already has Amino Acid Urine — left as is', l.name; continue;
    end if;
    select i.section_id into sec from clinic_prices.items i join public.pricing_services s on s.id = i.service_id
     where i.list_id = l.id and s.canonical_code = 'SVC-0000305' limit 1;
    insert into clinic_prices.items(list_id, service_id, fixed_price, section_id, external_name, notes)
    values (l.id, svc, 1890, sec, 'Aminogram in Urine', 'أمر المالك 2026-11-27: Aminogram في البول = Amino Acid Urine بـ1890');
    insert into clinic_prices.audit(actor_id, action, list_id, details) values (actor, 'owner_price_fix', l.id,
      jsonb_build_object('migration', '20261127210000', 'step', 'item_added', 'service_id', svc, 'price', 1890));
    update clinic_prices.lists set revision = revision + 1 where id = l.id;
    added := added + 1;
  end loop;

  for a in select x.* from clinic_prices.audit x where x.details->>'migration' = '20261127080000' and x.details->>'step' = 'alias_removed'
      and x.details->'alias'->>'external_name' ~* 'aminogram' loop
    al := jsonb_populate_record(null::clinic_prices.aliases, a.details->'alias');
    continue when exists (select 1 from clinic_prices.aliases z where z.scope_key = al.scope_key and z.external_code = al.external_code and z.external_name = al.external_name and z.unit = al.unit);
    al.service_id := svc; al.reviewed_at := now();
    insert into clinic_prices.aliases select al.*;
    insert into clinic_prices.audit(actor_id, action, list_id, details) values (a.actor_id, 'owner_price_fix', al.list_id,
      jsonb_build_object('migration', '20261127210000', 'step', 'alias_restored', 'alias_id', al.id, 'service_id', svc));
  end loop;
  raise notice 'amino_acid_urine_entity_prices: % item(s) added', added;
end $$;
commit;
