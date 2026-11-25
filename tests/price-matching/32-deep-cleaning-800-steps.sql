-- Owner 2026-11-25 (typed in main chat 5): «والتنظيف 800» — «جلسة تنظيف بشرة عميق» 0001260 becomes 800 (was 600) in the
-- ACTIVE center list «سونو / دار النقاهة». Only that one item changes. Done in place on the active list (a new center version
-- would need ending the current one: 1,363 items, master review again) — the owner is the approver and decided it.
--   * clinic_prices.items.fixed_price 600 → 800 for 0001260 in the active center list; list revision +1 (screens holding the old
--     revision must reload); clinic_prices.audit 'owner_item_price_change' with old/new and the reason.
--   * Then the reception catalogue sync: cash price 800 from now. Orders already created keep their own price (snapshot).
--   * Contract lists that price 0001260 by discount / fallback on the center price follow the new base on the next sync;
--     fixed-price packages (booking_fixed_price) do NOT change. See the dry-run (33) for the full list.
-- Guards: exactly one active center list; 0001260 active and in it at 600 (or already 800 → nothing to do). Idempotent.
-- Run inside BEGIN … COMMIT.
do $$
declare l uuid; it clinic_prices.items%rowtype; sid uuid; n int;
begin
 select count(*) into n from clinic_prices.lists where list_kind='center' and contract_id is null and status='active' and deleted_at is null
   and current_date between valid_from and valid_to;
 if n<>1 then raise exception 'expected exactly one active center list today, found %',n;end if;
 select id into l from clinic_prices.lists where list_kind='center' and contract_id is null and status='active' and deleted_at is null
   and current_date between valid_from and valid_to;
 select id into sid from public.pricing_services where booking_code='0001260' and active;
 if sid is null then raise exception '0001260 not found/active';end if;
 select * into it from clinic_prices.items where list_id=l and service_id=sid for update;
 if not found then raise exception '0001260 is not in the active center list';end if;
 if it.fixed_price=800 then raise notice 'already 800 — nothing to do';return;end if;
 if it.fixed_price<>600 then raise exception '0001260 center price is %, expected 600 — stop and ask',it.fixed_price;end if;
 update clinic_prices.items set fixed_price=800 where id=it.id;
 update clinic_prices.lists set revision=revision+1 where id=l;
 insert into clinic_prices.audit(actor_id,action,list_id,details) values('bd5a528f-af8d-4ada-afe9-ce64e68b1d92','owner_item_price_change',l,
   jsonb_build_object('service_id',sid,'code','0001260','item_id',it.id,'old',it.fixed_price,'new',800,
                      'reason','قرار المالك 2026-11-25 — تنظيف بشرة عميق 800'));
end $$;
do $$declare ws uuid;begin
 select id into ws from clinic_reception.workspaces where mode='live' order by id limit 1;
 perform clinic_reception.sync_catalog(ws);
end $$;
