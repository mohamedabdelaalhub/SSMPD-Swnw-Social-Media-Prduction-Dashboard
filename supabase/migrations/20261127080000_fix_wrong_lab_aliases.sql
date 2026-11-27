-- Fix two wrong name links made on 2026-11-25 in four activated entity price lists (Med Net, Misr Health Care,
-- Med Sure, Doctors Syndicate 2026):
--   «Aminogram in Urine»       was linked to «CMV PCR Qualitative In Urine»  (the CMV item carries the Aminogram price)
--   «Troponin I (Qualitative)» was linked to «Troponin T»                     (the Troponin T item carries the Troponin I price)
-- For each wrong item: move it to the right service when that service exists and is not already priced in the list;
-- otherwise remove the wrong item (the wrong service then has no contract price in that list, which is safer than a wrong
-- one). The eight aliases are re-pointed to the right service, or removed when it does not exist, so later imports do not
-- repeat the mistake. Every change is written to clinic_prices.audit. Refuses to run if anything looks different from what
-- was found on the live server (no alias, an order already priced from the item, more than one candidate service).
-- List names are compared with hamza forms folded (أ/إ/آ → ا), since live names are spelled both ways.
-- Idempotent: once fixed, a second run finds nothing to do and changes nothing.
begin;
do $$
declare
  lists text[] := array['ميد نت','مصر هيلث كير','ميد شور','نقابة الأطباء'];
  pair record; l record; it record; al record; v_right uuid; v_wrong uuid; n int; done int := 0; v_actor uuid;
begin
  for pair in select * from (values
      ('aminogram', '^\s*aminogram\M.*\murine\M', 'CMV PCR Qualitative In Urine', '^\s*aminogram'),
      ('troponin_i', '^\s*troponine?\s*i\M.*\mqual', 'Troponin T', '^\s*troponine?\s*i\M')) p(k, right_re, wrong_name, alias_re)
  loop
    select count(*) into n from public.pricing_services where name = pair.wrong_name;
    if n = 0 then raise notice 'skip %: wrong service «%» not found', pair.k, pair.wrong_name; continue; end if;
    if n > 1 then raise exception 'more than one service named «%»; stop and check', pair.wrong_name; end if;
    select id into v_wrong from public.pricing_services where name = pair.wrong_name;
    select count(*) into n from public.pricing_services where name ~* pair.right_re and coalesce(active, true);
    if n > 1 then raise exception 'more than one candidate right service for % (%); pick it by hand', pair.k, pair.right_re; end if;
    select id into v_right from public.pricing_services where name ~* pair.right_re and coalesce(active, true);

    for l in select x.id, x.name, x.created_by from clinic_prices.lists x where x.deleted_at is null
        and exists (select 1 from unnest(lists) s where translate(x.name, 'أإآ', 'ااا') ilike '%' || translate(s, 'أإآ', 'ااا') || '%')
        and exists (select 1 from clinic_prices.aliases a where a.list_id = x.id and a.service_id = v_wrong and a.external_name ~* pair.alias_re)
    loop
      v_actor := coalesce(public.my_admin_id(), l.created_by);
      select * into it from clinic_prices.items i where i.list_id = l.id and i.service_id = v_wrong;
      if found then
        if exists (select 1 from clinic_reception.orders o where o.snapshot::text like '%' || it.id::text || '%') then
          raise exception 'an order was already priced from item % in «%»; fix it by hand with finance', it.id, l.name;
        end if;
        if v_right is not null and not exists (select 1 from clinic_prices.items i where i.list_id = l.id and i.service_id = v_right) then
          update clinic_prices.items set service_id = v_right where id = it.id;
          insert into clinic_prices.audit(actor_id, action, list_id, details) values (v_actor, 'fix_wrong_link', l.id,
            jsonb_build_object('migration', '20261127080000', 'step', 'item_moved', 'item_id', it.id, 'from_service', v_wrong, 'to_service', v_right, 'item', to_jsonb(it)));
        else
          delete from clinic_prices.items where id = it.id;
          insert into clinic_prices.audit(actor_id, action, list_id, details) values (v_actor, 'fix_wrong_link', l.id,
            jsonb_build_object('migration', '20261127080000', 'step', 'item_removed', 'reason', case when v_right is null then 'right_service_missing' else 'right_service_already_priced' end, 'item', to_jsonb(it)));
        end if;
        done := done + 1;
      end if;
      for al in select * from clinic_prices.aliases a where a.list_id = l.id and a.service_id = v_wrong and a.external_name ~* pair.alias_re loop
        if v_right is not null then
          update clinic_prices.aliases set service_id = v_right where id = al.id;
        else
          delete from clinic_prices.aliases where id = al.id;
        end if;
        insert into clinic_prices.audit(actor_id, action, list_id, details) values (v_actor, 'fix_wrong_link', l.id,
          jsonb_build_object('migration', '20261127080000', 'step', case when v_right is null then 'alias_removed' else 'alias_moved' end, 'alias', to_jsonb(al), 'to_service', v_right));
      end loop;
    end loop;
  end loop;
  raise notice 'fix_wrong_lab_aliases: % item(s) fixed', done;
end $$;
commit;
