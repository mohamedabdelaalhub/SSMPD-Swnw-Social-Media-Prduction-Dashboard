-- Catalog clean-up from the owner's review of «duplicate-services-2026-11-27.xlsx» (decisions in his «ملاحظات» column, plus
-- his chat replies the same day: keep Vitamin D (25-OH), cancel «Vitamin D (25 Hydroxycolecalciferol)»; LDH stays as «S.LDH»).
--   Cancel (active=false, booking_enabled=false) and move to the kept service:
--     SVC-0000517 CK-MB → SVC-0000514 CK-MB (Creatine Kinase Isoenzyme)
--     SVC-0000879 LH (Centaur) → SVC-0000878 LH
--     SVC-0000997 Prolactin PRL (Centaur) → SVC-0000996 Prolactin PRL
--     SVC-0000230 مشد حرف U (الطوارئ) → SVC-0000058 مشد حرف U (العظام)
--     SVC-0000379 Antitrypsin In Stool → SVC-0000294 Alpha-1-Antitrypsin In Stool (A1a)
--     SVC-0001142 Vitamin D (25 Hydroxycolecalciferol) → SVC-0001135 Vitamin D (25-OH)
--   Cancel with no replacement: SVC-0001330 فيلر Stylage L/XL (its list items are removed).
--   Rename: SVC-0000283 Albumin → «S.Albumin», SVC-0001061 Total Protein → «S.Total Protein», SVC-0000869 → «S.LDH».
-- What moves: price-list items (if the kept service already has an item in the same list, the kept price stays and the
-- cancelled item is removed), name aliases, and live reception catalog rows: a row is switched off (kept for history) when
-- the kept service already has an active row in that workspace and nothing is booked ahead on it, otherwise re-pointed;
-- a row with no replacement is switched off. History is NOT touched: orders, invoices, appointments, proposals, pay adjustments keep
-- pointing where they did. A future booked appointment on a service with no replacement stops the migration.
-- Every step is written to clinic_prices.audit (action 'catalog_cleanup', full copy of the old row). Idempotent.
-- Rollback: supabase/rollbacks/20261127200000_catalog_duplicates_cleanup.rollback.sql
begin;
do $$
declare
  m record; c record; it record; al record; rs record; center uuid; actor uuid; cid uuid; kid uuid; n int; fut int;
begin
  select count(*) into n from clinic_prices.lists where list_kind = 'center' and status = 'active' and deleted_at is null and name ilike '%سونو%';
  if n <> 1 then raise exception 'expected exactly 1 active center list «سونو…», found %', n; end if;
  select id, created_by into center, actor from clinic_prices.lists where list_kind = 'center' and status = 'active' and deleted_at is null and name ilike '%سونو%';
  actor := coalesce(public.my_admin_id(), actor);

  for m in select * from (values
      ('SVC-0000517', 'SVC-0000514', '^\s*ck-?mb'), ('SVC-0000879', 'SVC-0000878', '^\s*lh\M'), ('SVC-0000997', 'SVC-0000996', 'prolactin'),
      ('SVC-0000230', 'SVC-0000058', 'مشد'), ('SVC-0000379', 'SVC-0000294', 'antitrypsin'), ('SVC-0001142', 'SVC-0001135', 'vitamin\s*d'),
      ('SVC-0001330', null, 'فيلر')) x(cancel_code, keep_code, name_re)
  loop
    select id into cid from public.pricing_services where canonical_code = m.cancel_code and name ~* m.name_re;
    if cid is null then raise exception '% not found or name does not match %', m.cancel_code, m.name_re; end if;
    kid := null;
    if m.keep_code is not null then
      select id into kid from public.pricing_services where canonical_code = m.keep_code and name ~* m.name_re and active;
      if kid is null then raise exception 'kept service % not found / inactive / name mismatch', m.keep_code; end if;
    end if;

    -- reception rows: future booked appointments with no replacement stop everything
    select count(*) into fut from clinic_reception.appointments a join clinic_reception.services r on r.id = a.service_id
     where r.pricing_service_id = cid and a.status = 'booked' and a.starts_at > now();
    if kid is null and fut > 0 then raise exception '% has % future booked appointment(s) and no replacement; stop', m.cancel_code, fut; end if;
    if fut > 0 then raise notice '% has % future booked appointment(s): its reception rows are re-pointed, not switched off', m.cancel_code, fut; end if;

    for it in select * from clinic_prices.items where service_id = cid loop
      if kid is not null and not exists (select 1 from clinic_prices.items where list_id = it.list_id and service_id = kid) then
        update clinic_prices.items set service_id = kid where id = it.id;
        insert into clinic_prices.audit(actor_id, action, list_id, details) values (actor, 'catalog_cleanup', it.list_id,
          jsonb_build_object('migration', '20261127200000', 'step', 'item_moved', 'item', to_jsonb(it), 'to_service', kid));
      else
        delete from clinic_prices.items where id = it.id;
        insert into clinic_prices.audit(actor_id, action, list_id, details) values (actor, 'catalog_cleanup', it.list_id,
          jsonb_build_object('migration', '20261127200000', 'step', 'item_removed', 'item', to_jsonb(it), 'reason', case when kid is null then 'no_replacement' else 'kept_service_already_priced' end));
      end if;
      update clinic_prices.lists set revision = revision + 1 where id = it.list_id;
    end loop;

    for al in select * from clinic_prices.aliases where service_id = cid loop
      if kid is not null then update clinic_prices.aliases set service_id = kid where id = al.id;
      else delete from clinic_prices.aliases where id = al.id; end if;
      insert into clinic_prices.audit(actor_id, action, list_id, details) values (actor, 'catalog_cleanup', al.list_id,
        jsonb_build_object('migration', '20261127200000', 'step', case when kid is null then 'alias_removed' else 'alias_moved' end, 'alias', to_jsonb(al), 'to_service', kid));
    end loop;

    for rs in select * from clinic_reception.services where pricing_service_id = cid and active loop
      -- the kept service already has its own active row in this workspace and nothing is booked ahead on this row:
      -- switch this row off (kept for history) instead of having two rows for one service in the booking list
      if kid is null or (exists (select 1 from clinic_reception.services k where k.workspace_id = rs.workspace_id and k.pricing_service_id = kid and k.active and k.id <> rs.id)
                         and not exists (select 1 from clinic_reception.appointments ap where ap.service_id = rs.id and ap.status = 'booked' and ap.starts_at > now())) then
        if rs.active then
          update clinic_reception.services set active = false where id = rs.id;
          insert into clinic_prices.audit(actor_id, action, list_id, details) values (actor, 'catalog_cleanup', center,
            jsonb_build_object('migration', '20261127200000', 'step', 'reception_off', 'reception_service', to_jsonb(rs), 'kept', kid));
        end if;
      else
        update clinic_reception.services set pricing_service_id = kid where id = rs.id;
        insert into clinic_prices.audit(actor_id, action, list_id, details) values (actor, 'catalog_cleanup', center,
          jsonb_build_object('migration', '20261127200000', 'step', 'reception_moved', 'reception_service', to_jsonb(rs), 'to_service', kid));
      end if;
    end loop;

    select * into c from public.pricing_services where id = cid;
    if c.active or c.booking_enabled then
      update public.pricing_services set active = false, booking_enabled = false where id = cid;
      insert into clinic_prices.audit(actor_id, action, list_id, details) values (actor, 'catalog_cleanup', center,
        jsonb_build_object('migration', '20261127200000', 'step', 'service_cancelled', 'service', jsonb_build_object('id', c.id, 'canonical_code', c.canonical_code, 'name', c.name, 'active', c.active, 'booking_enabled', c.booking_enabled), 'kept', m.keep_code));
    end if;
  end loop;

  for m in select * from (values ('SVC-0000283', 'S.Albumin', '^\s*albumin\s*$'), ('SVC-0001061', 'S.Total Protein', '^\s*total\s*protein\s*$'),
                                  ('SVC-0000869', 'S.LDH', '^\s*ldh\s*\(lactate')) x(code, new_name, name_re)
  loop
    select * into c from public.pricing_services where canonical_code = m.code;
    if c.id is null then raise exception '% not found', m.code; end if;
    continue when c.name = m.new_name;
    if c.name !~* m.name_re then raise exception '% is named «%» — expected %; stop', m.code, c.name, m.name_re; end if;
    update public.pricing_services set name = m.new_name where id = c.id;
    insert into clinic_prices.audit(actor_id, action, list_id, details) values (actor, 'catalog_cleanup', center,
      jsonb_build_object('migration', '20261127200000', 'step', 'service_renamed', 'service_id', c.id, 'old_name', c.name, 'new_name', m.new_name));
  end loop;
  raise notice 'catalog_duplicates_cleanup: done';
end $$;
commit;
