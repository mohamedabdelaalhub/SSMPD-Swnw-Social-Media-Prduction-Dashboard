-- 20261125200000 Supplies at service — PR1 (owner approved the mockups 2026-11-25 «طبق المستلزمات»,
-- docs/ui-references/mockups/supplies-at-service.html).
--  1) «يتحاسب عليه المريض»: public.inventory_items.patient_billable (default false), mirrored to clinic_reception.items by
--     trigger; per-service override clinic_reception.service_billing (null = follow the item). Edited by the inventory
--     manager / super admin / general manager (inventory_set_patient_billable, clinic_reception_service_billing).
--  2) execute split: a billable BOM item is billed at its sale price (4116, cost 5121) — no separate «consent» needed;
--     a non-billable item stays included at cost (5123); using more than the included quantity of a non-billable item is
--     still an extra that needs «وافق المريض» (flagged in the audit as overage).
--  3) store gate: clinic_reception.consume_locations — which stores a service section may consume from (owner 2026-11-22:
--     skin / physio / consultation → «فرعي مستلزمات تمريض», dental → «رئيسي أسنان», medicines → «رئيسي أدوية»; never
--     «رئيسي مستلزمات» or «فندقة»). Checked on execute and on «إضافة مستلزم». A workspace with no rows is not gated (trial).
--  4) «إنهاء الزيارة» with a billable supply missing does NOT block: the first call is refused with hint supplies_missing,
--     a second confirmed call (missing_ack) closes the visit and writes the note «تم التنبيه على … واختار الإنهاء رغم ذلك»
--     on visits.close_note + audit finish_missing_supplies. RPC clinic_reception_finish_check shows what is missing.
--  5) «مستني التحصيل»: clinic_reception_visit_reopen — a visit finished TODAY with nothing collected yet (no payment
--     allocation) goes back to open so reception can add/edit services and supplies; «تحصيل» ends the window.
--  6) «مستلزمات الزيارة»: clinic_reception_visit_supplies list / check / add — reception adds a supply to an executed
--     service: duplicate warning (who / when / qty) and included-item warning need an explicit confirm; billable adds go
--     on that service's invoice at sale price.
-- Rollback: supabase/rollbacks/20261125200000_supplies_billable_at_service.rollback.sql
do $$ begin
  if to_regprocedure('public.clinic_reception_command(uuid,text,jsonb,uuid)') is null then raise exception 'reception command missing'; end if;
  if exists (select 1 from pg_attribute where attrelid = 'clinic_reception.items'::regclass and attname = 'patient_billable' and not attisdropped) then
    raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;
begin;

-- ---------------------------------------------------------------- 1) billable flag + mirror + overrides
alter table clinic_reception.items add column patient_billable boolean not null default false;

create function clinic_reception.items_billable_from_inventory() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.inventory_item_id is not null then
    select i.patient_billable into new.patient_billable from public.inventory_items i where i.id = new.inventory_item_id;
    new.patient_billable := coalesce(new.patient_billable, false);
  end if;
  return new;
end $$;
revoke all on function clinic_reception.items_billable_from_inventory() from public, anon, authenticated;

create function public.inventory_items_billable_mirror() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  update clinic_reception.items set patient_billable = new.patient_billable
   where inventory_item_id = new.id and patient_billable is distinct from new.patient_billable;
  return null;
end $$;
revoke all on function public.inventory_items_billable_mirror() from public, anon, authenticated;

do $$ begin
  if to_regclass('public.inventory_items') is not null then
    alter table public.inventory_items add column if not exists patient_billable boolean not null default false;
    create trigger inventory_items_billable_mirror after insert or update of patient_billable on public.inventory_items
      for each row execute function public.inventory_items_billable_mirror();
    create trigger items_billable_from_inventory before insert or update of inventory_item_id on clinic_reception.items
      for each row execute function clinic_reception.items_billable_from_inventory();
    update clinic_reception.items r set patient_billable = i.patient_billable from public.inventory_items i where i.id = r.inventory_item_id;
  end if;
end $$;

create table clinic_reception.service_billing(
  workspace_id uuid not null references clinic_reception.workspaces(id),
  service_id uuid not null references clinic_reception.services(id) on delete cascade,
  item_id uuid not null references clinic_reception.items(id) on delete cascade,
  billable boolean not null,
  updated_by uuid not null references public.admins(id),
  updated_at timestamptz not null default now(),
  primary key (service_id, item_id));
alter table clinic_reception.service_billing enable row level security;

create function clinic_reception.item_billable(p_service uuid, p_item uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce((select b.billable from clinic_reception.service_billing b where b.service_id = p_service and b.item_id = p_item),
                  (select i.patient_billable from clinic_reception.items i where i.id = p_item), false)
$$;
revoke all on function clinic_reception.item_billable(uuid, uuid) from public, anon, authenticated;

-- who may classify items: inventory manager, super admin, general manager
create function clinic_reception.billing_editor() returns boolean
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare ok boolean := false; r text;
begin
  if public.my_admin_id() is null then return false; end if;
  select a.role into r from public.admins a where a.id = public.my_admin_id() and a.active;
  if r in ('super_admin', 'general_manager') then return true; end if;
  if to_regprocedure('public.inventory_is_manager()') is not null then execute 'select public.inventory_is_manager()' into ok; end if;
  return coalesce(ok, false);
end $$;
revoke all on function clinic_reception.billing_editor() from public, anon, authenticated;

create function public.inventory_set_patient_billable(p_item uuid, p_billable boolean) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); prev boolean;
begin
  if me is null or not clinic_reception.billing_editor() then raise exception 'تحديد «يتحاسب على المريض» لمسؤول المخزن' using errcode = '42501'; end if;
  if p_billable is null then raise exception 'اختار أيوه أو لأ'; end if;
  select patient_billable into prev from public.inventory_items where id = p_item and active for update;
  if not found then raise exception 'الصنف غير موجود'; end if;
  if prev is distinct from p_billable then
    update public.inventory_items set patient_billable = p_billable, updated_at = now() where id = p_item;
    insert into public.inventory_audit_events(entity_id, kind, actor_id, detail)
      values (p_item, 'patient_billable', me, case when p_billable then 'يتحاسب على المريض' else 'في سعر الخدمة' end);
  end if;
  return jsonb_build_object('id', p_item, 'patient_billable', p_billable);
end $$;
revoke all on function public.inventory_set_patient_billable(uuid, boolean) from public, anon;
grant execute on function public.inventory_set_patient_billable(uuid, boolean) to authenticated;

-- the pricing sheet shows the flag
do $$ declare d text; begin
  if to_regprocedure('public.inventory_pricing_list()') is not null then
    d := pg_get_functiondef('public.inventory_pricing_list()'::regprocedure);
    if position('patient_billable' in d) = 0 then
      d := replace(d, '''pricing_kind'', i.pricing_kind,', '''pricing_kind'', i.pricing_kind, ''patient_billable'', i.patient_billable,');
      if position('patient_billable' in d) = 0 then raise exception 'inventory_pricing_list pattern not found'; end if;
      execute d;
    end if;
  end if;
end $$;

-- per-service override: list services with their BOM lines and effective billing; set / clear one line
create function public.clinic_reception_service_billing(p_workspace uuid, p_action text, p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare ws uuid := p_workspace; me uuid := public.my_admin_id(); svc uuid; itm uuid;
begin
  if ws is null then select id into ws from clinic_reception.workspaces where mode = 'live' limit 1; end if;
  if ws is null then raise exception 'مفيش مساحة تشغيل'; end if;
  if me is null or not clinic_reception.billing_editor() then raise exception 'استثناءات الخدمات لمسؤول المخزن' using errcode = '42501'; end if;
  if p_action = 'list' then
    return jsonb_build_object('workspace_id', ws, 'services', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name, 'department', s.department, 'lines', (
        select coalesce(jsonb_agg(jsonb_build_object('item_id', i.id, 'item', i.name, 'unit', i.unit, 'quantity', (x->>'quantity')::numeric,
                 'item_billable', i.patient_billable, 'override', b.billable,
                 'billable', clinic_reception.item_billable(s.id, i.id), 'sale_price', i.sale_price) order by i.name), '[]')
          from jsonb_array_elements(coalesce(s.bom, '[]')) x
          join clinic_reception.items i on i.id = (x->>'item_id')::uuid
          left join clinic_reception.service_billing b on b.service_id = s.id and b.item_id = i.id)) order by s.name)
      from clinic_reception.services s where s.workspace_id = ws and jsonb_array_length(coalesce(s.bom, '[]')) > 0), '[]'));
  elsif p_action = 'set' then
    svc := (p_payload->>'service_id')::uuid; itm := (p_payload->>'item_id')::uuid;
    if not exists (select 1 from clinic_reception.services s, jsonb_array_elements(coalesce(s.bom, '[]')) x
                    where s.id = svc and s.workspace_id = ws and x->>'item_id' = itm::text) then
      raise exception 'الصنف مش من مكونات الخدمة دي'; end if;
    if p_payload->>'billable' is null or p_payload->>'billable' = '' then
      delete from clinic_reception.service_billing where service_id = svc and item_id = itm;
    else
      insert into clinic_reception.service_billing(workspace_id, service_id, item_id, billable, updated_by)
        values (ws, svc, itm, (p_payload->>'billable')::boolean, me)
        on conflict (service_id, item_id) do update set billable = excluded.billable, updated_by = me, updated_at = now();
    end if;
    insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id, detail)
      values (ws, me, 'service_billing', svc, jsonb_build_object('item_id', itm, 'billable', p_payload->'billable'));
    return jsonb_build_object('service_id', svc, 'item_id', itm, 'billable', clinic_reception.item_billable(svc, itm));
  end if;
  raise exception 'إجراء غير معروف';
end $$;
revoke all on function public.clinic_reception_service_billing(uuid, text, jsonb) from public, anon;
grant execute on function public.clinic_reception_service_billing(uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------- 3) store gate
create table clinic_reception.consume_locations(
  workspace_id uuid not null references clinic_reception.workspaces(id),
  section text not null check (section in ('general', 'physio', 'dental')),
  location_id uuid not null references clinic_reception.locations(id) on delete cascade,
  primary key (workspace_id, section, location_id));
alter table clinic_reception.consume_locations enable row level security;

create function clinic_reception.supply_section(p_department text) returns text
language sql immutable set search_path = pg_catalog as $$
  select case when coalesce(p_department, '') ~* '(اسنان|أسنان|dental)' then 'dental'
              when coalesce(p_department, '') ~* '(علاج طبيعي|فيزيو|physio)' then 'physio'
              else 'general' end
$$;
revoke all on function clinic_reception.supply_section(text) from public, anon, authenticated;

create function clinic_reception.consume_location_ok(p_workspace uuid, p_department text, p_location uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select not exists (select 1 from clinic_reception.consume_locations where workspace_id = p_workspace)
      or exists (select 1 from clinic_reception.consume_locations
                  where workspace_id = p_workspace and section = clinic_reception.supply_section(p_department) and location_id = p_location)
$$;
revoke all on function clinic_reception.consume_location_ok(uuid, text, uuid) from public, anon, authenticated;

-- seed the live workspace from the owner rule (stores matched by public.inventory_locations id / is_main + name)
do $$
declare ws uuid; nurse uuid; meds uuid; dental uuid; n int; r record;
begin
  select id into ws from clinic_reception.workspaces where mode = 'live';
  if ws is null or to_regclass('public.inventory_locations') is null then return; end if;
  select count(*) into n from public.inventory_locations where name = 'فرعي مستلزمات تمريض' and not is_main and active;
  if n <> 1 then raise exception 'store «فرعي مستلزمات تمريض» not found exactly once (%)', n; end if;
  select count(*) into n from public.inventory_locations where name = 'رئيسي أدوية' and is_main and active;
  if n <> 1 then raise exception 'store «رئيسي أدوية» not found exactly once (%)', n; end if;
  if not exists (select 1 from public.inventory_locations where id = '552cff60-fcad-4f4f-9e0e-5c7df1c3b6b7' and active) then
    raise exception 'store «رئيسي أسنان» (552cff60…) not found / inactive'; end if;
  for r in select l.id, l.name from public.inventory_locations l
            where (l.name = 'فرعي مستلزمات تمريض' and not l.is_main) or (l.name = 'رئيسي أدوية' and l.is_main)
               or l.id = '552cff60-fcad-4f4f-9e0e-5c7df1c3b6b7' loop
    if not exists (select 1 from clinic_reception.locations where workspace_id = ws and inventory_location_id = r.id) then
      insert into clinic_reception.locations(workspace_id, name, inventory_location_id) values (ws, r.name, r.id);
    end if;
  end loop;
  select id into nurse from clinic_reception.locations where workspace_id = ws and inventory_location_id =
    (select id from public.inventory_locations where name = 'فرعي مستلزمات تمريض' and not is_main and active);
  select id into meds from clinic_reception.locations where workspace_id = ws and inventory_location_id =
    (select id from public.inventory_locations where name = 'رئيسي أدوية' and is_main and active);
  select id into dental from clinic_reception.locations where workspace_id = ws and inventory_location_id = '552cff60-fcad-4f4f-9e0e-5c7df1c3b6b7';
  insert into clinic_reception.consume_locations(workspace_id, section, location_id) values
    (ws, 'general', nurse), (ws, 'general', meds), (ws, 'physio', nurse), (ws, 'physio', meds), (ws, 'dental', dental), (ws, 'dental', meds)
  on conflict do nothing;
end $$;

-- ---------------------------------------------------------------- 4) missing billable supplies on a visit
create table clinic_reception.visit_supply_adds(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references clinic_reception.workspaces(id),
  visit_id uuid not null references clinic_reception.visits(id),
  order_id uuid not null references clinic_reception.orders(id),
  item_id uuid not null references clinic_reception.items(id),
  location_id uuid not null references clinic_reception.locations(id),
  quantity numeric(14,3) not null check (quantity > 0),
  billable boolean not null,
  unit_price numeric(14,2) not null default 0,
  amount numeric(14,2) not null default 0,
  cost numeric(14,4) not null default 0,
  confirmed jsonb not null default '{}',
  created_by uuid not null references public.admins(id),
  created_at timestamptz not null default now());
alter table clinic_reception.visit_supply_adds enable row level security;

create function clinic_reception.visit_missing_billable(p_visit uuid) returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(jsonb_agg(jsonb_build_object('order_id', z.order_id, 'service', z.service, 'item_id', z.item_id, 'item', z.item,
           'quantity', z.expected - z.used, 'unit_price', z.sale_price, 'value', round((z.expected - z.used) * z.sale_price, 2))
           order by z.service, z.item), '[]')
  from (
    select o.id order_id, o.snapshot->>'name' service, i.id item_id, i.name item, i.sale_price, b.qty expected,
           coalesce((select sum(-m.quantity) from clinic_reception.movements m where m.source_id = o.id and m.item_id = i.id and m.kind = 'sale'), 0)
         + coalesce((select sum(a.quantity) from clinic_reception.visit_supply_adds a where a.order_id = o.id and a.item_id = i.id and a.billable), 0) used
    from clinic_reception.orders o
    cross join lateral (select (x->>'item_id')::uuid item_id, sum((x->>'quantity')::numeric) * o.quantity qty
                          from jsonb_array_elements(coalesce(o.snapshot->'bom', '[]')) x group by 1) b
    join clinic_reception.items i on i.id = b.item_id
    where o.visit_id = p_visit and o.status = 'completed' and clinic_reception.item_billable(o.service_id, b.item_id)) z
  where z.expected > z.used
$$;
revoke all on function clinic_reception.visit_missing_billable(uuid) from public, anon, authenticated;

create function clinic_reception.admin_name(p_admin uuid) returns text
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(nullif(to_jsonb(a)->>'name', ''), nullif(to_jsonb(a)->>'full_name', ''), nullif(to_jsonb(a)->>'email', ''), 'موظف')
    from public.admins a where a.id = p_admin
$$;
revoke all on function clinic_reception.admin_name(uuid) from public, anon, authenticated;

create function public.clinic_reception_finish_check(p_workspace uuid, p_payload jsonb) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v clinic_reception.visits%rowtype; miss jsonb;
begin
  perform clinic_reception.access(p_workspace, 'view');
  if nullif(p_payload->>'visit_id', '') is not null then
    select * into v from clinic_reception.visits where workspace_id = p_workspace and id = (p_payload->>'visit_id')::uuid;
  else
    select * into v from clinic_reception.visits where workspace_id = p_workspace and appointment_id = (p_payload->>'appointment_id')::uuid;
  end if;
  if not found then return jsonb_build_object('missing', '[]'::jsonb, 'total', 0); end if;
  miss := clinic_reception.visit_missing_billable(v.id);
  return jsonb_build_object('visit_id', v.id, 'missing', miss, 'employee', clinic_reception.admin_name(public.my_admin_id()),
    'total', coalesce((select sum((x->>'value')::numeric) from jsonb_array_elements(miss) x), 0));
end $$;
revoke all on function public.clinic_reception_finish_check(uuid, jsonb) from public, anon;
grant execute on function public.clinic_reception_finish_check(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------- 2+4) command wrapper: execute split + store gate, visit_close note
do $$ begin
  alter function public.clinic_reception_command(uuid, text, jsonb, uuid) rename to command_before_supplies;
  alter function public.command_before_supplies(uuid, text, jsonb, uuid) set schema clinic_reception;
end $$;
revoke all on function clinic_reception.command_before_supplies(uuid, text, jsonb, uuid) from public, anon, authenticated;

create function public.clinic_reception_command(p_workspace uuid, p_action text, p_payload jsonb, p_token uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare p jsonb := coalesce(p_payload, '{}'); o clinic_reception.orders%rowtype; bom jsonb; mats jsonb; bill text[] := '{}';
        over jsonb := '[]'; billed jsonb := '[]'; m jsonb; inc numeric; res jsonb; vid uuid; miss jsonb; ack boolean; note text;
        me uuid := public.my_admin_id(); touched boolean := false;
begin
  if p_action = 'execute' then
    begin select * into o from clinic_reception.orders where workspace_id = p_workspace and id = nullif(p->>'id', '')::uuid;
    exception when others then o := null; end;
    if o.id is not null and o.status = 'ordered' then
      touched := true;
      bom := coalesce(o.snapshot->'bom', '[]');
      select coalesce(array_agg(distinct x->>'item_id'), '{}') into bill from jsonb_array_elements(bom) x
       where clinic_reception.item_billable(o.service_id, (x->>'item_id')::uuid);
      mats := p->'materials';
      if mats is null then
        select coalesce(jsonb_agg(x || jsonb_build_object('quantity', (x->>'quantity')::numeric * o.quantity)), '[]') into mats from jsonb_array_elements(bom) x;
      end if;
      if jsonb_typeof(mats) = 'array' and nullif(p->>'location_id', '') is not null
         and exists (select 1 from jsonb_array_elements(mats) x where coalesce(nullif(x->>'quantity', '')::numeric, 0) > 0)
         and not clinic_reception.consume_location_ok(p_workspace, o.snapshot->>'department', (p->>'location_id')::uuid) then
        raise exception 'المخزن ده مش مسموح يتصرف منه لخدمات القسم ده — اختار مخزن القسم';
      end if;
      if jsonb_typeof(mats) = 'array' then
        for m in select * from jsonb_array_elements(mats) loop
          continue when coalesce(nullif(m->>'quantity', '')::numeric, 0) <= 0;
          if (m->>'item_id') = any(bill) or clinic_reception.item_billable(o.service_id, nullif(m->>'item_id', '')::uuid) then
            billed := billed || jsonb_build_array(jsonb_build_object('item_id', m->>'item_id', 'quantity', (m->>'quantity')::numeric));
          else
            select coalesce(sum((x->>'quantity')::numeric * o.quantity), 0) into inc from jsonb_array_elements(bom) x
             where x->>'item_id' = m->>'item_id' and coalesce((x->>'included')::boolean, true);
            if (m->>'quantity')::numeric > inc then
              over := over || jsonb_build_array(jsonb_build_object('item_id', m->>'item_id', 'quantity', (m->>'quantity')::numeric - inc));
            end if;
          end if;
        end loop;
      end if;
      if cardinality(bill) > 0 then
        update clinic_reception.orders set snapshot = jsonb_set(snapshot, '{bom}', (
          select jsonb_agg(case when x->>'item_id' = any(bill) then x || '{"included":false,"billable":true}'::jsonb else x end)
            from jsonb_array_elements(bom) x)) where id = o.id;
      end if;
      -- billable items are normal billing (no separate consent); a non-billable overage still needs «وافق المريض»
      if jsonb_array_length(billed) > 0 and jsonb_array_length(over) = 0 then p := p || '{"additional_confirmed":true}'::jsonb; end if;
    end if;
    res := clinic_reception.command_before_supplies(p_workspace, p_action, p, p_token);
    if touched and (jsonb_array_length(billed) > 0 or jsonb_array_length(over) > 0) then
      insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id, detail)
        values (p_workspace, me, 'execute_supplies', o.id, jsonb_build_object('billed', billed, 'overage', over, 'service', o.snapshot->>'name'));
    end if;
    return res;
  elsif p_action = 'visit_close' then
    begin vid := nullif(p->>'id', '')::uuid; exception when others then vid := null; end;
    if vid is not null and exists (select 1 from clinic_reception.visits where id = vid and workspace_id = p_workspace and status = 'open') then
      miss := clinic_reception.visit_missing_billable(vid);
      ack := coalesce(nullif(p->>'missing_ack', '')::boolean, false) or coalesce(current_setting('clinic_reception.finish_ack', true), '') = '1';
      if jsonb_array_length(miss) > 0 and not ack then
        raise exception 'فيه مستلزم بيتحاسب ناقص على الزيارة — راجع التنبيه وأكد الإنهاء' using hint = 'supplies_missing';
      end if;
      res := clinic_reception.command_before_supplies(p_workspace, p_action, p, p_token);
      if jsonb_array_length(miss) > 0 then
        select 'تم التنبيه على ' || clinic_reception.admin_name(me) || ' إن فيه مستلزم ناقص ' ||
               string_agg((x->>'item') || ' قيمته ' || to_char((x->>'value')::numeric, 'FM999999990.00') || ' ج', ' و') ||
               ' واختار الإنهاء رغم ذلك' into note from jsonb_array_elements(miss) x;
        update clinic_reception.visits set close_note = concat_ws(' — ', nullif(close_note, ''), note) where id = vid;
        insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id, detail)
          values (p_workspace, me, 'finish_missing_supplies', vid, jsonb_build_object('missing', miss, 'note', note));
      end if;
      return res;
    end if;
  end if;
  return clinic_reception.command_before_supplies(p_workspace, p_action, p, p_token);
end $$;
revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid) to authenticated;

-- the board's «إنهاء الزيارة» (journey) passes the second confirmation through to visit_close
do $$ begin
  if to_regprocedure('public.clinic_reception_journey_command(uuid,text,jsonb,uuid)') is not null then
    alter function public.clinic_reception_journey_command(uuid, text, jsonb, uuid) rename to journey_command_before_supplies;
    alter function public.journey_command_before_supplies(uuid, text, jsonb, uuid) set schema clinic_reception;
    revoke all on function clinic_reception.journey_command_before_supplies(uuid, text, jsonb, uuid) from public, anon, authenticated;
    execute $f$
      create function public.clinic_reception_journey_command(p_workspace uuid, p_action text, p_payload jsonb, p_token uuid)
      returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $b$
      begin
        if p_action = 'visit_complete' and coalesce(nullif(p_payload->>'missing_ack', '')::boolean, false) then
          perform set_config('clinic_reception.finish_ack', '1', true);
        end if;
        return clinic_reception.journey_command_before_supplies(p_workspace, p_action, p_payload, p_token);
      end $b$ $f$;
    revoke all on function public.clinic_reception_journey_command(uuid, text, jsonb, uuid) from public, anon;
    grant execute on function public.clinic_reception_journey_command(uuid, text, jsonb, uuid) to authenticated;
  end if;
end $$;

-- ---------------------------------------------------------------- 5) «مستني التحصيل»: reopen a finished, uncollected visit (same day)
create function public.clinic_reception_visit_reopen(p_workspace uuid, p_visit uuid, p_reason text, p_token uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); v clinic_reception.visits%rowtype; prev jsonb; out jsonb; reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  perform clinic_reception.access(p_workspace, 'execute');
  select response into prev from clinic_reception.commands where workspace_id = p_workspace and actor_id = me and token = p_token;
  if found then return prev; end if;
  select * into v from clinic_reception.visits where workspace_id = p_workspace and id = p_visit for update;
  if not found then raise exception 'الزيارة مش موجودة'; end if;
  if v.status <> 'completed' then raise exception 'الزيارة لسه مفتوحة — عدّل عليها عادي'; end if;
  if v.closed_at is null or (v.closed_at at time zone 'Africa/Cairo')::date <> (now() at time zone 'Africa/Cairo')::date then
    raise exception 'التعديل بعد الإنهاء متاح في نفس يوم الزيارة بس'; end if;
  if exists (select 1 from clinic_reception.allocations al join clinic_reception.invoices i on i.id = al.invoice_id
              where i.visit_id = v.id and al.source = 'payment') then
    raise exception 'اتحصّل على الزيارة دي — التعديل بعد التحصيل مش متاح'; end if;
  update clinic_reception.visits set status = 'open', closed_at = null where id = v.id;
  update clinic_reception.appointments set status = 'arrived' where id = v.appointment_id and status = 'completed';
  if to_regclass('clinic_reception.queue_entries') is not null then
    execute 'update clinic_reception.queue_entries set status = ''in_service'', service_ended_at = null, updated_by = $1, updated_at = now() where appointment_id = $2 and status = ''completed'''
      using me, v.appointment_id;
  end if;
  insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id, detail)
    values (p_workspace, me, 'visit_reopen', v.id, jsonb_build_object('reason', coalesce(reason, 'تعديل قبل التحصيل'), 'close_note', v.close_note, 'closed_at', v.closed_at));
  out := jsonb_build_object('id', v.id, 'status', 'open');
  insert into clinic_reception.commands(workspace_id, actor_id, token, action, payload, response)
    values (p_workspace, me, p_token, 'visit_reopen', jsonb_build_object('visit_id', v.id, 'reason', reason), out);
  return out;
end $$;
revoke all on function public.clinic_reception_visit_reopen(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.clinic_reception_visit_reopen(uuid, uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------- 6) «مستلزمات الزيارة»: list / check / add
create function clinic_reception.supply_warnings(p_order uuid, p_item uuid) returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  select jsonb_build_object(
    'duplicate', (select jsonb_build_object('by', clinic_reception.admin_name(d.actor), 'at', d.last_at, 'quantity', d.qty) from (
        select m.actor_id actor, max(m.created_at) last_at, sum(-m.quantity) qty from clinic_reception.movements m
         where m.source_id = p_order and m.item_id = p_item and m.kind in ('included', 'sale') group by m.actor_id
        union all
        select a.created_by, max(a.created_at), sum(a.quantity) from clinic_reception.visit_supply_adds a
         where a.order_id = p_order and a.item_id = p_item group by a.created_by
        order by 2 desc limit 1) d),
    'included', exists (select 1 from clinic_reception.orders o, jsonb_array_elements(coalesce(o.snapshot->'bom', '[]')) x
                         where o.id = p_order and x->>'item_id' = p_item::text and not clinic_reception.item_billable(o.service_id, p_item)),
    'billable', (select clinic_reception.item_billable(o.service_id, p_item) from clinic_reception.orders o where o.id = p_order),
    'unit_price', (select sale_price from clinic_reception.items where id = p_item))
$$;
revoke all on function clinic_reception.supply_warnings(uuid, uuid) from public, anon, authenticated;

create function public.clinic_reception_visit_supplies(p_workspace uuid, p_action text, p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); v clinic_reception.visits%rowtype; o clinic_reception.orders%rowtype; it clinic_reception.items%rowtype;
        w jsonb; q numeric; loc uuid; bill boolean; v_cost numeric; amt numeric := 0; aid uuid := gen_random_uuid(); prev jsonb; out jsonb; dims jsonb; v_mode text;
begin
  if p_action = 'list' then
    perform clinic_reception.access(p_workspace, 'view');
    select * into v from clinic_reception.visits where workspace_id = p_workspace and id = (p_payload->>'visit_id')::uuid;
    if not found then raise exception 'الزيارة مش موجودة'; end if;
    return jsonb_build_object('visit', jsonb_build_object('id', v.id, 'status', v.status, 'close_note', v.close_note),
      'missing', clinic_reception.visit_missing_billable(v.id),
      'orders', coalesce((select jsonb_agg(jsonb_build_object('id', o2.id, 'name', o2.snapshot->>'name', 'status', o2.status,
          'department', o2.snapshot->>'department',
          'bom', (select coalesce(jsonb_agg(jsonb_build_object('item_id', i.id, 'item', i.name, 'quantity', (x->>'quantity')::numeric * o2.quantity,
                     'billable', clinic_reception.item_billable(o2.service_id, i.id), 'sale_price', i.sale_price)), '[]')
                    from jsonb_array_elements(coalesce(o2.snapshot->'bom', '[]')) x join clinic_reception.items i on i.id = (x->>'item_id')::uuid),
          'lines', (select coalesce(jsonb_agg(l order by l->>'at'), '[]') from (
              select jsonb_build_object('item_id', m.item_id, 'item', i.name, 'quantity', sum(-m.quantity), 'billed', m.kind = 'sale',
                       'at', max(m.created_at), 'by', clinic_reception.admin_name(m.actor_id), 'source', 'execute') l
                from clinic_reception.movements m join clinic_reception.items i on i.id = m.item_id
               where m.source_id = o2.id and m.kind in ('included', 'sale') group by m.item_id, i.name, m.kind, m.actor_id
              union all
              select jsonb_build_object('item_id', a.item_id, 'item', i.name, 'quantity', a.quantity, 'billed', a.billable, 'amount', a.amount,
                       'at', a.created_at, 'by', clinic_reception.admin_name(a.created_by), 'source', 'reception')
                from clinic_reception.visit_supply_adds a join clinic_reception.items i on i.id = a.item_id where a.order_id = o2.id) s))
          order by o2.created_at) from clinic_reception.orders o2 where o2.visit_id = v.id and o2.status <> 'cancelled'), '[]'),
      'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'unit', i.unit, 'sale_price', i.sale_price,
          'billable', i.patient_billable) order by i.name) from clinic_reception.items i where i.workspace_id = p_workspace), '[]'),
      'locations', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name,
          'sections', (select coalesce(jsonb_agg(c.section), '[]') from clinic_reception.consume_locations c where c.location_id = l.id))
          order by l.name) from clinic_reception.locations l where l.workspace_id = p_workspace
          and (not exists (select 1 from clinic_reception.consume_locations where workspace_id = p_workspace)
               or exists (select 1 from clinic_reception.consume_locations c where c.location_id = l.id))), '[]'));
  elsif p_action = 'check' then
    perform clinic_reception.access(p_workspace, 'view');
    select * into o from clinic_reception.orders where workspace_id = p_workspace and id = (p_payload->>'order_id')::uuid;
    if not found then raise exception 'الخدمة مش موجودة'; end if;
    return clinic_reception.supply_warnings(o.id, (p_payload->>'item_id')::uuid);
  elsif p_action = 'add' then
    perform clinic_reception.access(p_workspace, 'execute');
    select response into prev from clinic_reception.commands where workspace_id = p_workspace and actor_id = me and token = (p_payload->>'token')::uuid;
    if found then return prev; end if;
    select w2.mode into v_mode from clinic_reception.workspaces w2 where w2.id = p_workspace;
    if to_regprocedure('clinic_reception.shift_guard_check(uuid)') is not null then
      execute 'select clinic_reception.shift_guard_check($1)' using p_workspace; end if;
    if v_mode = 'live' and to_regprocedure('clinic_finance.lock_day()') is not null then execute 'select clinic_finance.lock_day()'; end if;
    select * into o from clinic_reception.orders where workspace_id = p_workspace and id = (p_payload->>'order_id')::uuid for update;
    if not found or o.status <> 'completed' then raise exception 'المستلزم بيتضاف على خدمة اتنفذت — نفّذ الخدمة الأول'; end if;
    select * into v from clinic_reception.visits where id = o.visit_id;
    if v.status <> 'open' then raise exception 'الزيارة اتقفلت — اضغط «تعديل قبل التحصيل» الأول'; end if;
    select * into it from clinic_reception.items where workspace_id = p_workspace and id = (p_payload->>'item_id')::uuid;
    if not found then raise exception 'المستلزم غير متاح'; end if;
    q := clinic_reception.number(p_payload->>'quantity', 3);
    loc := nullif(p_payload->>'location_id', '')::uuid;
    if loc is null then raise exception 'اختار المخزن اللي هيتصرف منه'; end if;
    if not clinic_reception.consume_location_ok(p_workspace, o.snapshot->>'department', loc) then
      raise exception 'المخزن ده مش مسموح يتصرف منه لخدمات القسم ده — اختار مخزن القسم'; end if;
    w := clinic_reception.supply_warnings(o.id, it.id);
    if w->'duplicate' is not null and jsonb_typeof(w->'duplicate') = 'object' and not coalesce((p_payload->>'confirm_duplicate')::boolean, false) then
      raise exception 'المستلزم ده متسجّل قبل كده على الخدمة — أكد إنك عايز تضيفه تاني' using hint = 'supplies_duplicate'; end if;
    if (w->>'included')::boolean and not coalesce((p_payload->>'confirm_included')::boolean, false) then
      raise exception 'المستلزم ده في سعر الخدمة — أكد إنك عايز تضيفه' using hint = 'supplies_included'; end if;
    bill := coalesce((w->>'billable')::boolean, false);
    if v_mode = 'live' and to_regprocedure('clinic_reception.sync_stock(uuid)') is not null then perform clinic_reception.sync_stock(p_workspace); end if;
    insert into clinic_reception.visit_supply_adds(id, workspace_id, visit_id, order_id, item_id, location_id, quantity, billable, created_by, confirmed)
      values (aid, p_workspace, v.id, o.id, it.id, loc, q, bill, me,
              jsonb_build_object('duplicate', coalesce((p_payload->>'confirm_duplicate')::boolean, false), 'included', coalesce((p_payload->>'confirm_included')::boolean, false)));
    dims := jsonb_build_object('patient_id', v.patient_id, 'visit_id', v.id, 'order_id', o.id, 'provider_id', o.provider_id,
                               'department', o.snapshot->>'department', 'invoice_id', (select id from clinic_reception.invoices where order_id = o.id));
    if bill then
      if it.sale_price <= 0 then raise exception 'المستلزم ده ملوش سعر بيع — كلّم مسؤول المخزن'; end if;
      v_cost := clinic_reception.consume(p_workspace, it.id, loc, q, 'sale', aid);
      amt := round(q * it.sale_price, 2);
      update clinic_reception.invoices set amount = amount + amt where order_id = o.id;
      perform clinic_reception.post(p_workspace, 'extra_material', aid, 'مستلزمات إضافية بسعر البيع', '1122', '4116', amt, dims);
    else
      v_cost := clinic_reception.consume(p_workspace, it.id, loc, q, 'included', aid);
    end if;
    update clinic_reception.visit_supply_adds set unit_price = case when bill then it.sale_price else 0 end, amount = amt, cost = v_cost where id = aid;
    update clinic_reception.orders set cost = coalesce(cost, 0) + v_cost, net_revenue = coalesce(net_revenue, 0) + amt where id = o.id;
    insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id, detail)
      values (p_workspace, me, 'visit_supply_add', o.id, jsonb_build_object('item', it.name, 'quantity', q, 'billable', bill, 'amount', amt,
              'confirmed_duplicate', coalesce((p_payload->>'confirm_duplicate')::boolean, false), 'confirmed_included', coalesce((p_payload->>'confirm_included')::boolean, false)));
    out := jsonb_build_object('id', aid, 'billable', bill, 'amount', amt);
    if nullif(p_payload->>'token', '') is not null then
      insert into clinic_reception.commands(workspace_id, actor_id, token, action, payload, response)
        values (p_workspace, me, (p_payload->>'token')::uuid, 'visit_supply_add', p_payload, out);
    end if;
    return out;
  end if;
  raise exception 'إجراء غير معروف';
end $$;
revoke all on function public.clinic_reception_visit_supplies(uuid, text, jsonb) from public, anon;
grant execute on function public.clinic_reception_visit_supplies(uuid, text, jsonb) to authenticated;

-- reception activity log: the new actions show under «خدمات» / «زيارة»
do $$ begin
  if to_regprocedure('clinic_reception.activity_kind(text)') is not null then
    create or replace function clinic_reception.activity_kind(p_action text) returns text language sql immutable set search_path = pg_catalog as $f$
      select case
        when p_action in ('book', 'overbook') then 'book'
        when p_action in ('reschedule', 'manual_time', 'auto_booking_set_time') then 'reschedule'
        when p_action in ('cancel', 'no_show') then 'cancel'
        when p_action in ('arrive', 'visit_reopen', 'finish_missing_supplies') then 'visit'
        when p_action in ('order_add', 'journey_request_service', 'visit_supply_add', 'execute_supplies') then 'service'
        when p_action in ('collect', 'collect_multi') then 'pay'
        when p_action in ('request', 'visit_void_requested', 'visit_void_completed', 'request_review') then 'void'
      end
    $f$;
  end if;
end $$;

commit;
