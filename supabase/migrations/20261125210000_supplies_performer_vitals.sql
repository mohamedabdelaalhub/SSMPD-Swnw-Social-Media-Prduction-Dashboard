-- 20261125210000 Supplies at service — PR2 (owner approved the mockups 2026-11-25 «طبق المستلزمات»,
-- docs/ui-references/mockups/supplies-at-service.html panels 1 «performer» and 7 «vitals»). Builds on PR1 (20261125200000).
--  A) «تنفيذ وتسجيل المستلزمات» — public.clinic_reception_performer(workspace, action, payload), actions 'today' / 'execute'.
--     The person who performs the service (nurse / doctor assistant / doctor) records the materials and executes the order WITHOUT
--     reception membership. Gate (all of it, inside the RPC):
--       * the workspace is the LIVE one (mode 'live' and settings.live_enabled);
--       * the caller is an active admin whose role or extra role (public.has_role) is nursing, head_nursing, doctor_assistant,
--         sono_doctor, super_admin or general_manager (reception / customer service alone are refused — they keep «مستلزمات الزيارة»);
--       * the order's department is in the caller's scope, reusing the existing scoping: head nursing / super admin / general
--         manager see every department; a nurse sees the sections of clinic_reception.my_nursing_sections(today) (same as
--         «تشغيل اليوم — التمريض», section from clinic_reception.section_of_text); a doctor assistant / doctor (or a nurse with a
--         provider record) also sees the departments of clinic_reception.admin_departments(me, workspace);
--       * the chosen store passes PR1's clinic_reception.consume_location_ok(workspace, order department, store).
--     Execute goes through public.clinic_reception_command('execute') — so PR1's billable / included split, overage consent and store
--     gate all apply, and clinic_reception.access(ws,'execute') still runs as the caller (on live it already grants execute to
--     nursing / head_nursing / sono_doctor, doctor_assistant through 20261120290000, super admin / general manager through
--     20261117180000 — no access change here).
--     Cash shift: the performer is not a cashier, so the performer path does NOT need an open cash shift. The RPC sets the
--     transaction-local flag clinic_reception.performer_exec = <workspace id> only after its own gate and only around its execute call;
--     clinic_reception.shift_guard_check (wrapped here) skips the check while that flag matches. Every other path is unchanged.
--  B) «طقم الفيتلة»: «الفحص قبل الكشف» stores a state per vital (bp / pulse / temp / spo2 / weight / sugar: measured / refused /
--     not_done) in clinic_reception.visit_triage.vital_states. When the triage is RECORDED («حفظ وإبلاغ الدكتور»), a fixed kit per
--     MEASURED vital is consumed at cost only ('included' → 5123, never billed) from an allowed store of the visit's department
--     (clinic_reception.vitals_consumptions = one row per visit + vital; partial unique index keeps it idempotent). A vital changed
--     from measured to refused / not done on a later recorded save is reversed: positive 'included' movements on the same lots +
--     journal 1131 / 5123 (source stock_cost_reversal), so stock and the journal net to zero. Drafts store the states only.
--     Refused / not done = nothing consumed. A missing kit, a store without stock or any stock error never blocks the clinical save:
--     the vital is skipped and a warning is returned (and logged in visit_triage_log). Kit contents: clinic_reception.vitals_kit,
--     edited with public.clinic_reception_vitals_kit (head nursing / super admin / general manager). Starts EMPTY — the head nurse
--     fills it (item names on live are not guessed here).
-- Rollback: supabase/rollbacks/20261125210000_supplies_performer_vitals.rollback.sql
do $$ begin
  if to_regclass('clinic_reception.vitals_kit') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
  if to_regprocedure('clinic_reception.consume_location_ok(uuid,text,uuid)') is null then raise exception 'طبّق 20261125200000 (المستلزمات وقت الخدمة) الأول'; end if;
  if to_regprocedure('public.clinic_reception_nursing(uuid,text,jsonb)') is null or to_regclass('clinic_reception.visit_triage') is null then
    raise exception 'طبّق تشغيل اليوم للتمريض الأول'; end if;
end $$;
begin;

-- ---------------------------------------------------------------- tables
create table clinic_reception.vitals_kit(
  workspace_id uuid not null references clinic_reception.workspaces(id),
  vital text not null check (vital in ('bp', 'pulse', 'temp', 'spo2', 'weight', 'sugar')),
  item_id uuid not null references clinic_reception.items(id) on delete cascade,
  quantity numeric(14,3) not null check (quantity > 0 and quantity <= 100),
  updated_by uuid references public.admins(id),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, vital, item_id));
alter table clinic_reception.vitals_kit enable row level security;
revoke all on clinic_reception.vitals_kit from public, anon, authenticated;

create table clinic_reception.vitals_consumptions(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references clinic_reception.workspaces(id),
  appointment_id uuid not null references clinic_reception.appointments(id) on delete cascade,
  vital text not null check (vital in ('bp', 'pulse', 'temp', 'spo2', 'weight', 'sugar')),
  location_id uuid not null references clinic_reception.locations(id),
  lines jsonb not null default '[]',
  cost numeric(14,2) not null default 0,
  created_by uuid not null references public.admins(id),
  created_at timestamptz not null default now(),
  reversed_at timestamptz,
  reversed_by uuid references public.admins(id),
  reversal_cost numeric(14,2));
create unique index vitals_consumptions_active on clinic_reception.vitals_consumptions(appointment_id, vital) where reversed_at is null;
alter table clinic_reception.vitals_consumptions enable row level security;
revoke all on clinic_reception.vitals_consumptions from public, anon, authenticated;

alter table clinic_reception.visit_triage add column vital_states jsonb not null default '{}';

-- ---------------------------------------------------------------- performer scope helpers
create function clinic_reception.performer_role_ok() returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select public.my_admin_id() is not null and exists (select 1 from public.admins a where a.id = public.my_admin_id() and a.active)
     and (public.has_role('nursing') or public.has_role('head_nursing') or public.has_role('doctor_assistant') or public.has_role('sono_doctor')
          or public.has_role('super_admin') or public.has_role('general_manager'))
$$;

-- {all: bool, sections: text[] (physio/dental/general), departments: text[]} for the caller on that workspace
create function clinic_reception.performer_scope(p_workspace uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); secs text[] := '{}'; depts text[] := '{}';
begin
  if public.has_role('super_admin') or public.has_role('general_manager') or public.has_role('head_nursing') then
    return jsonb_build_object('all', true, 'sections', to_jsonb(array['physio', 'dental', 'general']), 'departments', '[]'::jsonb);
  end if;
  if clinic_reception.is_nurse(me) then secs := clinic_reception.my_nursing_sections(clinic_reception.today()); end if;
  if to_regprocedure('clinic_reception.admin_departments(uuid,uuid)') is not null then
    execute 'select clinic_reception.admin_departments($1, $2)' into depts using me, p_workspace;
  end if;
  return jsonb_build_object('all', false, 'sections', to_jsonb(coalesce(secs, '{}')), 'departments', to_jsonb(coalesce(depts, '{}')));
end $$;

create function clinic_reception.performer_dept_ok(p_scope jsonb, p_department text) returns boolean
language sql immutable set search_path = pg_catalog as $$
  select coalesce((p_scope->>'all')::boolean, false)
      or exists (select 1 from jsonb_array_elements_text(coalesce(p_scope->'sections', '[]')) s where s = clinic_reception.section_of_text(p_department))
      or exists (select 1 from jsonb_array_elements_text(coalesce(p_scope->'departments', '[]')) d where d = p_department)
$$;

-- stores the caller may pick (PR1 map; a workspace with no map → every store)
create function clinic_reception.performer_locations(p_workspace uuid, p_scope jsonb) returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name,
           'sections', (select coalesce(jsonb_agg(distinct c.section), '[]') from clinic_reception.consume_locations c where c.location_id = l.id))
           order by (l.name ~ 'أدوية'), l.name), '[]')
    from clinic_reception.locations l
   where l.workspace_id = p_workspace
     and (not exists (select 1 from clinic_reception.consume_locations where workspace_id = p_workspace)
          or exists (select 1 from clinic_reception.consume_locations c where c.workspace_id = p_workspace and c.location_id = l.id
                      and (coalesce((p_scope->>'all')::boolean, false)
                           or c.section in (select s from jsonb_array_elements_text(coalesce(p_scope->'sections', '[]')) s)
                           or c.section in (select clinic_reception.supply_section(d) from jsonb_array_elements_text(coalesce(p_scope->'departments', '[]')) d))))
$$;
revoke all on function clinic_reception.performer_role_ok(), clinic_reception.performer_scope(uuid), clinic_reception.performer_dept_ok(jsonb, text),
  clinic_reception.performer_locations(uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------- shift guard: the performer path is not a cash desk
do $$ begin
  if to_regprocedure('clinic_reception.shift_guard_check(uuid)') is not null then
    alter function clinic_reception.shift_guard_check(uuid) rename to shift_guard_check_before_performer;
    revoke all on function clinic_reception.shift_guard_check_before_performer(uuid) from public, anon, authenticated;
    create function clinic_reception.shift_guard_check(p_workspace uuid) returns void
    language plpgsql stable security definer set search_path = pg_catalog, public as $f$
    begin
      -- set only by public.clinic_reception_performer, after its own gate, around its execute call (transaction-local)
      if coalesce(current_setting('clinic_reception.performer_exec', true), '') = p_workspace::text then return; end if;
      perform clinic_reception.shift_guard_check_before_performer(p_workspace);
    end $f$;
    revoke all on function clinic_reception.shift_guard_check(uuid) from public, anon, authenticated;
  end if;
end $$;

-- ---------------------------------------------------------------- A) the performer RPC
create function public.clinic_reception_performer(p_workspace uuid, p_action text, p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); p jsonb := coalesce(p_payload, '{}'); ws clinic_reception.workspaces%rowtype; sc jsonb;
        o clinic_reception.orders%rowtype; v clinic_reception.visits%rowtype; loc uuid; mats jsonb; note text; res jsonb; tok uuid; inv numeric;
        nomat boolean;
begin
  select * into ws from clinic_reception.workspaces where id = p_workspace;
  if not found or ws.mode <> 'live' or not coalesce((select live_enabled from clinic_reception.settings where id), false) then
    raise exception 'الشاشة دي على مساحة التشغيل الفعلية بس' using errcode = '42501'; end if;
  if not clinic_reception.performer_role_ok() then
    raise exception 'الشاشة دي للي بينفّذ الخدمة (تمريض / مساعد طبيب / دكتور)' using errcode = '42501'; end if;
  sc := clinic_reception.performer_scope(p_workspace);

  if p_action = 'today' then
    res := jsonb_build_object('date', clinic_reception.today(), 'me', clinic_reception.admin_name(me), 'scope', sc,
      'locations', clinic_reception.performer_locations(p_workspace, sc),
      'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'unit', i.unit, 'sale_price', i.sale_price,
                 'billable', i.patient_billable) order by i.name) from clinic_reception.items i where i.workspace_id = p_workspace), '[]'),
      'orders', coalesce((select jsonb_agg(x.r order by x.st, x.created_at) from (
        select a.starts_at st, o2.created_at, jsonb_build_object('id', o2.id, 'visit_id', v2.id, 'status', o2.status, 'visit_status', v2.status,
                 'name', o2.snapshot->>'name', 'department', o2.snapshot->>'department', 'section', clinic_reception.section_of_text(o2.snapshot->>'department'),
                 'quantity', o2.quantity, 'patient_name', rp.name, 'file_no', rp.file_no, 'starts_at', a.starts_at, 'doctor', pr.name,
                 'completed_at', o2.completed_at, 'can_execute', o2.status = 'ordered' and v2.status = 'open',
                 'bom', (select coalesce(jsonb_agg(jsonb_build_object('item_id', i.id, 'item', i.name, 'unit', i.unit,
                            'quantity', (b->>'quantity')::numeric * o2.quantity, 'billable', clinic_reception.item_billable(o2.service_id, i.id),
                            'sale_price', i.sale_price) order by i.name), '[]')
                           from jsonb_array_elements(coalesce(o2.snapshot->'bom', '[]')) b join clinic_reception.items i on i.id = (b->>'item_id')::uuid)) r
          from clinic_reception.orders o2
          join clinic_reception.visits v2 on v2.id = o2.visit_id
          join clinic_reception.appointments a on a.id = v2.appointment_id
          join clinic_reception.patients rp on rp.id = v2.patient_id
          join clinic_reception.providers pr on pr.id = o2.provider_id
         where o2.workspace_id = p_workspace and o2.status in ('ordered', 'completed')
           and (v2.opened_at at time zone 'Africa/Cairo')::date = clinic_reception.today()
           and clinic_reception.performer_dept_ok(sc, o2.snapshot->>'department')) x), '[]'));
    -- «بصرف من» lists only the stores the gate accepts for at least one of the services shown (a nurse covering two sections
    -- with only dental orders today sees the dental stores only); every order also carries its own allowed stores
    if jsonb_array_length(res->'orders') > 0 then
      res := jsonb_set(res, '{orders}', (select jsonb_agg(xo.j || jsonb_build_object('location_ids',
               (select coalesce(jsonb_agg(xl.j->>'id'), '[]') from jsonb_array_elements(res->'locations') xl(j)
                 where clinic_reception.consume_location_ok(p_workspace, xo.j->>'department', (xl.j->>'id')::uuid))))
             from jsonb_array_elements(res->'orders') xo(j)));
      res := jsonb_set(res, '{locations}', coalesce((select jsonb_agg(xl.j) from jsonb_array_elements(res->'locations') xl(j)
               where exists (select 1 from jsonb_array_elements(res->'orders') xo(j) where xo.j->'location_ids' ? (xl.j->>'id'))), '[]'));
    end if;
    return res;
  elsif p_action = 'execute' then
    begin select * into o from clinic_reception.orders where workspace_id = p_workspace and id = nullif(p->>'order_id', '')::uuid for update;
    exception when invalid_text_representation then o := null; end;
    if o.id is null then raise exception 'الخدمة مش موجودة'; end if;
    if not clinic_reception.performer_dept_ok(sc, o.snapshot->>'department') then
      raise exception 'الخدمة دي مش من قسمك' using errcode = '42501'; end if;
    if o.status <> 'ordered' then raise exception 'الخدمة دي اتنفذت قبل كده'; end if;
    select * into v from clinic_reception.visits where id = o.visit_id;
    if v.status <> 'open' then raise exception 'الزيارة اتقفلت'; end if;
    nomat := coalesce(nullif(p->>'no_materials', '')::boolean, false);
    note := nullif(trim(coalesce(p->>'material_note', '')), '');
    if nomat then
      if note is null or length(note) < 3 then raise exception 'اكتب سبب «بدون مستلزمات»'; end if;
      mats := '[]'::jsonb;
    else
      mats := p->'materials';
      if mats is null or jsonb_typeof(mats) <> 'array' then raise exception 'راجع المستلزمات'; end if;
    end if;
    begin loc := nullif(p->>'location_id', '')::uuid; exception when invalid_text_representation then loc := null; end;
    if exists (select 1 from jsonb_array_elements(mats) x where coalesce(nullif(x->>'quantity', '')::numeric, 0) > 0) then
      if loc is null then raise exception 'اختار المخزن اللي بتصرف منه'; end if;
      if not exists (select 1 from clinic_reception.locations where id = loc and workspace_id = p_workspace) then raise exception 'المخزن مش موجود'; end if;
      if not clinic_reception.consume_location_ok(p_workspace, o.snapshot->>'department', loc) then
        raise exception 'المخزن ده مش مسموح يتصرف منه لخدمات القسم ده — اختار مخزن القسم'; end if;
    end if;
    begin tok := coalesce(nullif(p->>'token', '')::uuid, gen_random_uuid()); exception when invalid_text_representation then tok := gen_random_uuid(); end;
    perform set_config('clinic_reception.performer_exec', p_workspace::text, true);
    res := public.clinic_reception_command(p_workspace, 'execute', jsonb_strip_nulls(jsonb_build_object('id', o.id, 'location_id', loc,
             'materials', mats, 'material_note', note, 'additional_confirmed', coalesce(nullif(p->>'patient_agreed', '')::boolean, false))), tok);
    perform set_config('clinic_reception.performer_exec', '', true);
    select amount into inv from clinic_reception.invoices where order_id = o.id;
    insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id, detail)
      values (p_workspace, me, 'performer_execute', o.id, jsonb_build_object('service', o.snapshot->>'name', 'location_id', loc,
              'materials', mats, 'no_materials', nomat, 'note', note));
    return coalesce(res, '{}'::jsonb) || jsonb_build_object('order_id', o.id, 'invoice_amount', inv);
  end if;
  raise exception 'إجراء غير معروف';
end $$;
revoke all on function public.clinic_reception_performer(uuid, text, jsonb) from public, anon;
grant execute on function public.clinic_reception_performer(uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------- B) vitals kit
create function clinic_reception.vital_keys() returns text[] language sql immutable set search_path = pg_catalog as $$
  select array['bp', 'pulse', 'temp', 'spo2', 'weight', 'sugar'] $$;

-- the value fields of each vital in the triage payload
create function clinic_reception.vital_fields(p_vital text) returns text[] language sql immutable set search_path = pg_catalog as $$
  select case p_vital when 'bp' then array['bp_sys', 'bp_dia'] when 'pulse' then array['pulse'] when 'temp' then array['temp_c']
    when 'spo2' then array['spo2'] when 'weight' then array['weight_kg'] when 'sugar' then array['sugar_mgdl'] else '{}'::text[] end $$;

-- the effective state per vital: explicit state, else measured when a value was typed, else not_done
create function clinic_reception.vital_states_of(p jsonb) returns jsonb language sql immutable set search_path = pg_catalog as $$
  select coalesce(jsonb_object_agg(k, case when p->'vital_states'->>k in ('measured', 'refused', 'not_done') then p->'vital_states'->>k
      when exists (select 1 from unnest(clinic_reception.vital_fields(k)) f where nullif(p->>f, '') is not null) then 'measured'
      else 'not_done' end), '{}')
  from unnest(clinic_reception.vital_keys()) k $$;

create function clinic_reception.vitals_kit_json(p_workspace uuid) returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(jsonb_agg(jsonb_build_object('vital', k.vital, 'item_id', i.id, 'item', i.name, 'unit', i.unit, 'quantity', k.quantity)
           order by array_position(clinic_reception.vital_keys(), k.vital), i.name), '[]')
    from clinic_reception.vitals_kit k join clinic_reception.items i on i.id = k.item_id where k.workspace_id = p_workspace $$;

-- stores allowed for a department (PR1 map; no map → every store), name order with medicines last
create function clinic_reception.dept_locations(p_workspace uuid, p_department text) returns uuid[]
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(array_agg(l.id order by (l.name ~ 'أدوية'), l.name), '{}') from clinic_reception.locations l
   where l.workspace_id = p_workspace and clinic_reception.consume_location_ok(p_workspace, p_department, l.id)
     and (not exists (select 1 from clinic_reception.consume_locations where workspace_id = p_workspace)
          or exists (select 1 from clinic_reception.consume_locations c where c.location_id = l.id)) $$;

create function clinic_reception.stock_at(p_workspace uuid, p_item uuid, p_location uuid) returns numeric
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(sum(m.quantity), 0) from clinic_reception.movements m join clinic_reception.lots lot on lot.id = m.lot_id
   where m.workspace_id = p_workspace and m.item_id = p_item and m.location_id = p_location
     and (lot.expiry_date is null or lot.expiry_date >= current_date) $$;

-- consume / reverse the kit of every vital of one recorded triage; never raises
create function clinic_reception.vitals_reconcile(p_workspace uuid, p_appointment uuid, p_states jsonb, p_location uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); dept text; k text; st text; c clinic_reception.vitals_consumptions%rowtype; lines jsonb; ln jsonb;
        loc uuid; cid uuid; total numeric; m record; nid uuid; amt numeric; consumed text[] := '{}'; reversed text[] := '{}'; warns jsonb := '[]';
        cands uuid[]; cand uuid;
begin
  select pr.department into dept from clinic_reception.appointments a join clinic_reception.providers pr on pr.id = a.provider_id where a.id = p_appointment;
  cands := clinic_reception.dept_locations(p_workspace, dept);
  -- live: bring the reception stock in line with the real inventory first (as execute / «مستلزمات الزيارة» do)
  if exists (select 1 from clinic_reception.workspaces where id = p_workspace and mode = 'live')
     and exists (select 1 from jsonb_each_text(p_states) s where s.value = 'measured') then
    begin perform clinic_reception.sync_stock(p_workspace);
    exception when others then warns := warns || jsonb_build_array(jsonb_build_object('vital', null, 'message', sqlerrm)); end;
  end if;
  foreach k in array clinic_reception.vital_keys() loop
    st := coalesce(p_states->>k, 'not_done');
    select * into c from clinic_reception.vitals_consumptions where appointment_id = p_appointment and vital = k and reversed_at is null;
    if st = 'measured' then
      continue when c.id is not null;   -- already consumed for this visit: re-saving never consumes twice
      select coalesce(jsonb_agg(jsonb_build_object('item_id', item_id, 'quantity', quantity)), '[]') into lines
        from clinic_reception.vitals_kit where workspace_id = p_workspace and vital = k;
      continue when jsonb_array_length(lines) = 0;
      begin
        loc := null;
        if p_location is not null then
          if not (p_location = any(cands)) then raise exception 'المخزن ده مش مسموح يتصرف منه لخدمات القسم ده'; end if;
          loc := p_location;
        else
          foreach cand in array cands loop
            if not exists (select 1 from jsonb_array_elements(lines) x
                            where clinic_reception.stock_at(p_workspace, (x->>'item_id')::uuid, cand) < (x->>'quantity')::numeric) then
              loc := cand; exit; end if;
          end loop;
          if loc is null then raise exception 'مفيش رصيد كفاية من مستلزمات الطقم في مخزن القسم'; end if;
        end if;
        cid := gen_random_uuid(); total := 0;
        insert into clinic_reception.vitals_consumptions(id, workspace_id, appointment_id, vital, location_id, lines, created_by)
          values (cid, p_workspace, p_appointment, k, loc, lines, me);
        for ln in select * from jsonb_array_elements(lines) loop
          total := total + clinic_reception.consume(p_workspace, (ln->>'item_id')::uuid, loc, (ln->>'quantity')::numeric, 'included', cid);
        end loop;
        update clinic_reception.vitals_consumptions set cost = total where id = cid;
        consumed := consumed || k;
      exception when others then
        warns := warns || jsonb_build_array(jsonb_build_object('vital', k, 'message', sqlerrm));
      end;
    elsif c.id is not null then
      begin
        total := 0;
        for m in select * from clinic_reception.movements where source_id = c.id and kind = 'included' and quantity < 0 loop
          insert into clinic_reception.movements(workspace_id, item_id, location_id, lot_id, kind, quantity, unit_cost, sale_price, source_id, actor_id)
            values (p_workspace, m.item_id, m.location_id, m.lot_id, 'included', -m.quantity, m.unit_cost, 0, c.id, me) returning id into nid;
          amt := round(-m.quantity * m.unit_cost, 2);
          perform clinic_reception.post(p_workspace, 'stock_cost_reversal', nid, 'رجوع مستلزمات الفيتلة — القياس اتلغى', '1131', '5123', amt,
            jsonb_build_object('appointment_id', p_appointment, 'item_id', m.item_id, 'location_id', m.location_id, 'vital', k));
          total := total + amt;
        end loop;
        update clinic_reception.vitals_consumptions set reversed_at = now(), reversed_by = me, reversal_cost = total where id = c.id;
        reversed := reversed || k;
      exception when others then
        warns := warns || jsonb_build_array(jsonb_build_object('vital', k, 'message', sqlerrm));
      end;
    end if;
  end loop;
  return jsonb_build_object('consumed', to_jsonb(consumed), 'reversed', to_jsonb(reversed), 'warnings', warns);
end $$;
revoke all on function clinic_reception.vital_keys(), clinic_reception.vital_fields(text), clinic_reception.vital_states_of(jsonb),
  clinic_reception.vitals_kit_json(uuid), clinic_reception.dept_locations(uuid, text), clinic_reception.stock_at(uuid, uuid, uuid),
  clinic_reception.vitals_reconcile(uuid, uuid, jsonb, uuid) from public, anon, authenticated;

-- nursing RPC wrapper: triage_save stores the states (+ consumes on a recorded save), triage_get returns the kit / stores / consumption
do $$ begin
  alter function public.clinic_reception_nursing(uuid, text, jsonb) rename to nursing_before_vitals;
  alter function public.nursing_before_vitals(uuid, text, jsonb) set schema clinic_reception;
end $$;
revoke all on function clinic_reception.nursing_before_vitals(uuid, text, jsonb) from public, anon, authenticated;

create function public.clinic_reception_nursing(p_workspace uuid, p_action text, p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare p jsonb := coalesce(p_payload, '{}'); states jsonb; k text; f text; res jsonb; rec jsonb; ap uuid; dept text; loc uuid; t clinic_reception.visit_triage%rowtype;
begin
  if p_action = 'triage_save' then
    states := clinic_reception.vital_states_of(p);
    foreach k in array clinic_reception.vital_keys() loop
      if states->>k <> 'measured' then
        foreach f in array clinic_reception.vital_fields(k) loop p := p || jsonb_build_object(f, null); end loop;
      end if;
    end loop;
    res := clinic_reception.nursing_before_vitals(p_workspace, p_action, p);
    ap := (p->>'appointment_id')::uuid;
    update clinic_reception.visit_triage set vital_states = states where appointment_id = ap and workspace_id = p_workspace;
    if res->>'status' = 'recorded' then
      begin loc := nullif(p->>'kit_location_id', '')::uuid; exception when invalid_text_representation then loc := null; end;
      rec := clinic_reception.vitals_reconcile(p_workspace, ap, states, loc);
    else
      rec := jsonb_build_object('consumed', '[]'::jsonb, 'reversed', '[]'::jsonb, 'warnings', '[]'::jsonb, 'draft', true);
    end if;
    insert into clinic_reception.visit_triage_log(appointment_id, actor_id, action, revision, snapshot)
      values (ap, public.my_admin_id(), 'vitals_kit', (res->>'revision')::int, jsonb_build_object('states', states) || rec);
    return res || jsonb_build_object('vitals', jsonb_build_object('states', states) || rec);
  elsif p_action = 'triage_get' then
    res := clinic_reception.nursing_before_vitals(p_workspace, p_action, p);
    begin ap := (p->>'appointment_id')::uuid; exception when invalid_text_representation then return res; end;
    select pr.department into dept from clinic_reception.appointments a join clinic_reception.providers pr on pr.id = a.provider_id
     where a.id = ap and a.workspace_id = p_workspace;
    return res || jsonb_build_object('vitals_kit', jsonb_build_object(
      'kit', clinic_reception.vitals_kit_json(p_workspace),
      'locations', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name) order by array_position(clinic_reception.dept_locations(p_workspace, dept), l.id))
                              from clinic_reception.locations l where l.id = any(clinic_reception.dept_locations(p_workspace, dept))), '[]'),
      'consumed', coalesce((select jsonb_agg(jsonb_build_object('vital', c.vital, 'location', l.name, 'at', c.created_at, 'cost', c.cost) order by c.created_at)
                              from clinic_reception.vitals_consumptions c join clinic_reception.locations l on l.id = c.location_id
                             where c.appointment_id = ap and c.reversed_at is null), '[]')));
  end if;
  return clinic_reception.nursing_before_vitals(p_workspace, p_action, p);
end $$;
revoke all on function public.clinic_reception_nursing(uuid, text, jsonb) from public, anon;
grant execute on function public.clinic_reception_nursing(uuid, text, jsonb) to authenticated;

-- kit editor: head nursing / super admin / general manager
create function public.clinic_reception_vitals_kit(p_workspace uuid, p_action text, p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); ws uuid := p_workspace; x jsonb; n int := 0;
begin
  if me is null or not exists (select 1 from public.admins where id = me and active)
     or not (public.has_role('head_nursing') or public.has_role('super_admin') or public.has_role('general_manager')) then
    raise exception 'طقم الفيتلة بتظبطه رئيسة التمريض' using errcode = '42501'; end if;
  if ws is null then select id into ws from clinic_reception.workspaces where mode = 'live' limit 1; end if;
  if not exists (select 1 from clinic_reception.workspaces where id = ws) then raise exception 'مفيش مساحة تشغيل'; end if;
  if p_action = 'save' then
    if jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines') > 60 then raise exception 'راجع الطقم'; end if;
    delete from clinic_reception.vitals_kit where workspace_id = ws;
    for x in select * from jsonb_array_elements(p_payload->'lines') loop
      if not (x->>'vital' = any(clinic_reception.vital_keys())) then raise exception 'قياس غير معروف'; end if;
      if not exists (select 1 from clinic_reception.items where id = nullif(x->>'item_id', '')::uuid and workspace_id = ws) then raise exception 'المستلزم غير متاح'; end if;
      insert into clinic_reception.vitals_kit(workspace_id, vital, item_id, quantity, updated_by)
        values (ws, x->>'vital', (x->>'item_id')::uuid, clinic_reception.number(x->>'quantity', 3), me)
        on conflict (workspace_id, vital, item_id) do update set quantity = excluded.quantity, updated_by = me, updated_at = now();
      n := n + 1;
    end loop;
    insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id, detail)
      values (ws, me, 'vitals_kit_save', ws, jsonb_build_object('lines', p_payload->'lines'));
  elsif p_action <> 'list' then
    raise exception 'إجراء غير معروف';
  end if;
  return jsonb_build_object('workspace_id', ws, 'kit', clinic_reception.vitals_kit_json(ws),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'unit', i.unit) order by i.name)
                         from clinic_reception.items i where i.workspace_id = ws), '[]'));
end $$;
revoke all on function public.clinic_reception_vitals_kit(uuid, text, jsonb) from public, anon;
grant execute on function public.clinic_reception_vitals_kit(uuid, text, jsonb) to authenticated;

commit;
