-- «قائمة أسعار نقابة التجاريين» (draft): fix the Vitamin D / Vitamin H mix-up, on the owner's order 2026-11-27
-- («ناخد سعر سونو 2026 ناقص 30%» rounded to the nearest 5 EGP). The file row «Vitamin D (25-hydroxy…)» (630 = 900 × 0.70)
-- was linked to Vitamin H, so the list item for Vitamin H carried Vitamin D's price and Vitamin D had no item at all.
--   1. Vitamin H item: 630 → 1470 (center 2100 × 0.70).
--   2. Vitamin D (25-OH) item added at 630 (center 900 × 0.70), same section as the Vitamin H item, external name/code/unit
--      taken from the file row.
--   3. That file row in the open draft batch is re-linked to Vitamin D (25-OH), confirmed, review_status 'approved'.
-- List and batch revisions are bumped so any open screen reloads; every step is written to clinic_prices.audit
-- (action 'owner_price_fix'). Refuses unless the list is still draft and the state is exactly what was found on the live
-- server (Vitamin H item at 630, no Vitamin D (25-OH) item, exactly one draft batch row «Vitamin D (25…» linked to
-- Vitamin H). Idempotent: once applied, a second run finds nothing to do.
-- Rollback: supabase/rollbacks/20261127160000_tugareen_vitamin_d_h_fix.rollback.sql
begin;
do $$
declare
  l clinic_prices.lists%rowtype; b clinic_prices.batches%rowtype; vh uuid; vd uuid; hi clinic_prices.items%rowtype;
  idx int; n int; r jsonb; actor uuid;
begin
  select * into l from clinic_prices.lists where name = 'قائمة أسعار نقابة التجاريين' and deleted_at is null for update;
  if not found then raise exception 'list not found'; end if;
  if l.status <> 'draft' then raise exception 'list is % — not draft; stop', l.status; end if;
  select count(*) into n from public.pricing_services where name ~* '^\s*vitamin\s*h\M' and active;
  if n <> 1 then raise exception 'expected exactly 1 active Vitamin H service, found %', n; end if;
  select id into vh from public.pricing_services where name ~* '^\s*vitamin\s*h\M' and active;
  select count(*) into n from public.pricing_services where name = 'Vitamin D (25-OH)' and active;
  if n <> 1 then raise exception 'expected exactly 1 active «Vitamin D (25-OH)» service, found %', n; end if;
  select id into vd from public.pricing_services where name = 'Vitamin D (25-OH)' and active;
  actor := coalesce(public.my_admin_id(), l.created_by);

  select * into hi from clinic_prices.items where list_id = l.id and service_id = vh;
  if exists (select 1 from clinic_prices.items where list_id = l.id and service_id = vd) and hi.fixed_price = 1470 then
    raise notice 'tugareen_vitamin_d_h_fix: already applied, nothing to do'; return;
  end if;
  if hi.id is null or hi.fixed_price <> 630 then raise exception 'Vitamin H item is % — expected 630; stop', hi.fixed_price; end if;
  if exists (select 1 from clinic_prices.items where list_id = l.id and service_id = vd) then raise exception 'Vitamin D (25-OH) already has an item; stop'; end if;

  select * into b from clinic_prices.batches where list_id = l.id and status = 'draft' for update;
  select count(*), min(o.n - 1) into n, idx from jsonb_array_elements(b.rows) with ordinality o(r, n)
   where o.r->>'name' ~* '^\s*vitamin\s*d\s*\(25' and o.r->>'service_id' = vh::text;
  if n <> 1 then raise exception 'expected exactly 1 draft row «Vitamin D (25…» linked to Vitamin H, found %', n; end if;
  r := b.rows -> idx;
  if (r->>'price')::numeric <> 630 then raise exception 'file row price is % — expected 630; stop', r->>'price'; end if;

  update clinic_prices.items set fixed_price = 1470 where id = hi.id;
  insert into clinic_prices.audit(actor_id, action, list_id, details) values (actor, 'owner_price_fix', l.id,
    jsonb_build_object('migration', '20261127160000', 'step', 'vitamin_h_price', 'item', to_jsonb(hi), 'new_price', 1470));

  insert into clinic_prices.items(list_id, service_id, fixed_price, section_id, external_code, external_name, unit, source_ref, notes)
  values (l.id, vd, 630, hi.section_id, coalesce(r->>'code', ''), coalesce(r->>'name', ''), coalesce(r->>'unit', ''),
          jsonb_build_object('batch_id', b.id, 'row', idx), 'أمر المالك 2026-11-27: سعر سونو 2026 − 30%');
  insert into clinic_prices.audit(actor_id, action, list_id, details) values (actor, 'owner_price_fix', l.id,
    jsonb_build_object('migration', '20261127160000', 'step', 'vitamin_d_added', 'service_id', vd, 'price', 630));

  update clinic_prices.batches set rows = jsonb_set(rows, array[idx::text], r || jsonb_build_object('service_id', vd, 'confirmed', true, 'review_status', 'approved')),
         revision = revision + 1 where id = b.id;
  insert into clinic_prices.audit(actor_id, action, list_id, details) values (actor, 'owner_price_fix', l.id,
    jsonb_build_object('migration', '20261127160000', 'step', 'row_relinked', 'batch_id', b.id, 'row', idx, 'old_row', r, 'to_service', vd));

  update clinic_prices.lists set revision = revision + 1 where id = l.id;
  raise notice 'tugareen_vitamin_d_h_fix: Vitamin H 630→1470, Vitamin D (25-OH) added at 630, row % re-linked', idx;
end $$;
commit;
