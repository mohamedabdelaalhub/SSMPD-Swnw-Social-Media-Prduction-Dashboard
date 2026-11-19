-- Queue in the dashboard, phase 1: rooms, doctor ↔ room per day, ticket numbers, department queues, call log.
-- Owner approvals (2026-11-19): «موافق» on the queue scope; «ارقام بس» (doctor tickets are plain numbers per doctor per day);
-- rooms are real clinics plus lab, radiology, laser, physio…; when the doctor arrives reception picks the room and every call
-- for that doctor's patients names that room; «إنهاء العيادة» and «إعادة الربط بطبيب آخر»;
-- «الاستقبال ينادي التالي والفني كمان» (reception and the department staff both call the next ticket).
--
-- 1. rooms: one row per physical room. A room with ticket_prefix (L = lab, R = radiology) is a department queue.
-- 2. room_assignments: which doctor is in which clinic room today. One open row per room and per doctor; ending or
--    reassigning closes the row (history is kept). A doctor's calls name the room open for them at call time.
-- 3. room_staff: who may call the next ticket of a department room (e.g. the lab technician), besides reception.
-- 4. queue_entries.ticket_no: given on arrival (status → waiting), 1, 2, 3… per doctor per day. Never reused.
-- 5. dept_tickets: L1, L2… / R1, R2… per room per day; walk-ins or patients sent from a doctor.
-- 6. queue_calls: every call (doctor or department) with the ticket label and the room label at call time;
--    the waiting screen and the WhatsApp agent read the last minutes of it. Numbers and rooms only, no patient data.
-- Nothing here is public yet: the board and my_turn ops come in a later phase (service role only).

begin;

create table if not exists clinic_reception.rooms(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references clinic_reception.workspaces(id) on delete cascade,
  label text not null check (length(trim(label)) between 1 and 60),
  kind text not null default 'clinic' check (kind in ('clinic','lab','radiology','laser','physio','other')),
  ticket_prefix text check (ticket_prefix ~ '^[A-Z]$'),
  active boolean not null default true,
  sort_order int not null default 0,
  updated_by uuid references public.admins(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists rooms_label_uq on clinic_reception.rooms(workspace_id, lower(trim(label)));
create unique index if not exists rooms_prefix_uq on clinic_reception.rooms(workspace_id, ticket_prefix) where ticket_prefix is not null;
alter table clinic_reception.rooms enable row level security;
revoke all on clinic_reception.rooms from public, anon, authenticated;

create table if not exists clinic_reception.room_assignments(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references clinic_reception.workspaces(id) on delete cascade,
  room_id uuid not null references clinic_reception.rooms(id) on delete cascade,
  provider_id uuid not null references clinic_reception.providers(id) on delete cascade,
  service_date date not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  assigned_by uuid references public.admins(id),
  ended_by uuid references public.admins(id),
  check (ended_at is null or ended_at >= started_at)
);
create unique index if not exists room_assignments_open_room_uq on clinic_reception.room_assignments(room_id) where ended_at is null;
create unique index if not exists room_assignments_open_provider_uq on clinic_reception.room_assignments(provider_id) where ended_at is null;
create index if not exists room_assignments_day_idx on clinic_reception.room_assignments(workspace_id, service_date);
alter table clinic_reception.room_assignments enable row level security;
revoke all on clinic_reception.room_assignments from public, anon, authenticated;

create table if not exists clinic_reception.room_staff(
  room_id uuid not null references clinic_reception.rooms(id) on delete cascade,
  admin_id uuid not null references public.admins(id) on delete cascade,
  added_by uuid references public.admins(id),
  added_at timestamptz not null default now(),
  primary key (room_id, admin_id)
);
alter table clinic_reception.room_staff enable row level security;
revoke all on clinic_reception.room_staff from public, anon, authenticated;

alter table clinic_reception.queue_entries add column if not exists ticket_no int check (ticket_no > 0);
alter table clinic_reception.queue_entries add column if not exists ticket_date date;
create unique index if not exists queue_entries_ticket_uq on clinic_reception.queue_entries(workspace_id, provider_id, ticket_date, ticket_no) where ticket_no is not null;

create table if not exists clinic_reception.dept_tickets(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references clinic_reception.workspaces(id) on delete cascade,
  room_id uuid not null references clinic_reception.rooms(id),
  ticket_date date not null,
  ticket_no int not null check (ticket_no > 0),
  status text not null default 'waiting' check (status in ('waiting','called','in_service','done','no_show','cancelled')),
  appointment_id uuid references clinic_reception.appointments(id) on delete set null,
  source text not null default 'reception' check (source in ('reception','doctor','whatsapp','manual')),
  created_by uuid references public.admins(id),
  created_at timestamptz not null default now(),
  called_at timestamptz,
  called_by uuid references public.admins(id),
  service_started_at timestamptz,
  service_ended_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (room_id, ticket_date, ticket_no)
);
create index if not exists dept_tickets_day_idx on clinic_reception.dept_tickets(workspace_id, ticket_date, room_id, status);
alter table clinic_reception.dept_tickets enable row level security;
revoke all on clinic_reception.dept_tickets from public, anon, authenticated;

create table if not exists clinic_reception.queue_calls(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references clinic_reception.workspaces(id) on delete cascade,
  called_at timestamptz not null default now(),
  ticket_label text not null,
  provider_id uuid references clinic_reception.providers(id) on delete cascade,
  dept_room_id uuid references clinic_reception.rooms(id) on delete cascade,
  room_id uuid references clinic_reception.rooms(id) on delete set null,
  room_label text,
  queue_entry_id uuid references clinic_reception.queue_entries(id) on delete cascade,
  dept_ticket_id uuid references clinic_reception.dept_tickets(id) on delete cascade,
  called_by uuid references public.admins(id),
  check ((provider_id is null) <> (dept_room_id is null))
);
create index if not exists queue_calls_recent_idx on clinic_reception.queue_calls(workspace_id, called_at desc);
alter table clinic_reception.queue_calls enable row level security;
revoke all on clinic_reception.queue_calls from public, anon, authenticated;

-- Seed the two department rooms for each live workspace (labels editable later; prefixes fixed by the owner).
insert into clinic_reception.rooms(workspace_id, label, kind, ticket_prefix, sort_order)
select w.id, x.label, x.kind, x.prefix, x.ord
  from clinic_reception.workspaces w
  cross join (values ('غرفة سحب العينات','lab','L',100), ('غرفة الأشعة','radiology','R',110)) x(label, kind, prefix, ord)
 where w.mode = 'live'
on conflict do nothing;

-- The room a doctor is in right now (open assignment for today), or null.
create or replace function clinic_reception.provider_room(p_provider uuid)
returns clinic_reception.rooms language sql stable security definer set search_path = pg_catalog, public as $$
  select r.* from clinic_reception.room_assignments a join clinic_reception.rooms r on r.id = a.room_id
   where a.provider_id = p_provider and a.ended_at is null and a.service_date = clinic_reception.today()
   limit 1
$$;

-- Ticket number on arrival, and a call record on every call, whatever path changed the queue entry.
create or replace function clinic_reception.queue_ticket_and_call()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare d date; r clinic_reception.rooms;
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status or new.called_at is distinct from old.called_at then
    if new.ticket_no is null and new.status in ('waiting','called','in_service','on_hold') then
      d := (coalesce(new.queued_at, now()) at time zone 'Africa/Cairo')::date;
      perform pg_advisory_xact_lock(hashtext('queue_ticket:' || new.provider_id::text || ':' || d::text));
      new.ticket_date := d;
      new.ticket_no := coalesce((select max(ticket_no) from clinic_reception.queue_entries
                                  where workspace_id = new.workspace_id and provider_id = new.provider_id and ticket_date = d), 0) + 1;
    end if;
    if tg_op = 'UPDATE' and new.status = 'called' and new.called_at is not null
       and (old.status is distinct from 'called' or new.called_at is distinct from old.called_at) then
      r := clinic_reception.provider_room(new.provider_id);
      insert into clinic_reception.queue_calls(workspace_id, called_at, ticket_label, provider_id, room_id, room_label, queue_entry_id, called_by)
      values (new.workspace_id, new.called_at, new.ticket_no::text, new.provider_id, r.id, r.label, new.id, new.updated_by);
    end if;
  end if;
  return new;
end $$;
-- BEFORE trigger so it can write the ticket fields; the call row is only written on UPDATE, when new.id already exists.
drop trigger if exists trg_queue_ticket_and_call on clinic_reception.queue_entries;
create trigger trg_queue_ticket_and_call before insert or update of status, called_at on clinic_reception.queue_entries
  for each row execute function clinic_reception.queue_ticket_and_call();

-- Department ticket label, e.g. L7.
create or replace function clinic_reception.dept_label(t clinic_reception.dept_tickets)
returns text language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(r.ticket_prefix, '') || t.ticket_no from clinic_reception.rooms r where r.id = t.room_id
$$;

-- Who may run a department room: reception/nursing (execute) or a member of that room's staff.
create or replace function clinic_reception.room_actor(p_workspace uuid, p_room uuid)
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id();
begin
  if me is not null and exists (select 1 from public.admins where id = me and active)
     and exists (select 1 from clinic_reception.room_staff s join clinic_reception.rooms r on r.id = s.room_id
                  where s.room_id = p_room and s.admin_id = me and r.workspace_id = p_workspace) then
    return me;
  end if;
  return clinic_reception.access(p_workspace, 'execute');
end $$;

-- Board snapshot for one day: per doctor and per department, numbers and rooms only. Used by the dashboard now and
-- by the waiting screen and the agent later (each through its own guarded entry point).
create or replace function clinic_reception.queue_board(p_workspace uuid, p_date date default null)
returns jsonb language sql stable security definer set search_path = pg_catalog, public as $$
  with d as (select coalesce(p_date, clinic_reception.today()) as dd),
  doc as (
    select q.provider_id,
      max(q.ticket_no) filter (where q.status in ('called','in_service')) cur,
      coalesce(jsonb_agg(q.ticket_no order by q.priority desc, q.ticket_no) filter (where q.status = 'waiting'), '[]') waiting,
      count(*) filter (where q.status = 'waiting') waiting_count,
      count(*) filter (where q.status = 'completed') done_count
    from clinic_reception.queue_entries q, d
    where q.workspace_id = p_workspace and q.ticket_date = d.dd and q.ticket_no is not null
    group by q.provider_id),
  dep as (
    select t.room_id,
      max(t.ticket_no) filter (where t.status in ('called','in_service')) cur,
      coalesce(jsonb_agg(t.ticket_no order by t.ticket_no) filter (where t.status = 'waiting'), '[]') waiting,
      count(*) filter (where t.status = 'waiting') waiting_count,
      count(*) filter (where t.status = 'done') done_count
    from clinic_reception.dept_tickets t, d
    where t.workspace_id = p_workspace and t.ticket_date = d.dd
    group by t.room_id)
  select jsonb_build_object(
    'date', (select dd from d),
    'doctors', coalesce((select jsonb_agg(jsonb_build_object(
        'provider_id', pr.id, 'name', pr.name, 'specialty', pr.department,
        'masa_doctor_id', (select min(k.masa_doctor_id) from clinic_reception.masa_doctor_links k where k.provider_id = pr.id and k.status = 'linked'),
        'room_label', r.label, 'ticket_prefix', null,
        'current_no', doc.cur, 'waiting_nos', coalesce(doc.waiting, '[]'), 'waiting_count', coalesce(doc.waiting_count, 0),
        'done_count', coalesce(doc.done_count, 0)) order by r.sort_order nulls last, pr.name)
      from clinic_reception.providers pr
      left join doc on doc.provider_id = pr.id
      left join lateral (select rr.* from clinic_reception.room_assignments a join clinic_reception.rooms rr on rr.id = a.room_id, d
                          where a.provider_id = pr.id and a.ended_at is null and a.service_date = d.dd limit 1) r on true
      where pr.workspace_id = p_workspace and (doc.provider_id is not null or r.id is not null)), '[]'),
    'departments', coalesce((select jsonb_agg(jsonb_build_object(
        'room_id', rm.id, 'dept', rm.kind, 'name', rm.label, 'room_label', rm.label, 'ticket_prefix', rm.ticket_prefix,
        'current_no', case when dep.cur is not null then rm.ticket_prefix || dep.cur end,
        'waiting_nos', coalesce((select jsonb_agg(rm.ticket_prefix || (x #>> '{}')) from jsonb_array_elements(dep.waiting) x), '[]'),
        'waiting_count', coalesce(dep.waiting_count, 0), 'done_count', coalesce(dep.done_count, 0)) order by rm.sort_order, rm.label)
      from clinic_reception.rooms rm left join dep on dep.room_id = rm.id
      where rm.workspace_id = p_workspace and rm.active and rm.ticket_prefix is not null), '[]'),
    'calls', coalesce((select jsonb_agg(jsonb_build_object('call_id', c.id, 'provider_id', c.provider_id, 'dept_room_id', c.dept_room_id,
        'ticket_no', c.ticket_label, 'room_label', c.room_label, 'called_at', c.called_at) order by c.called_at desc)
      from clinic_reception.queue_calls c
      where c.workspace_id = p_workspace and c.called_at > now() - interval '10 minutes'), '[]'))
$$;

-- Dashboard entry point (reception, nursing, department staff, managers).
create or replace function public.clinic_reception_queue(p_workspace uuid, p_action text, p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid; p jsonb := coalesce(p_payload, '{}'); rm clinic_reception.rooms; t clinic_reception.dept_tickets;
  pv uuid; q clinic_reception.queue_entries; n int; today date := clinic_reception.today(); v jsonb;
begin
  if p_action = 'state' then
    me := public.my_admin_id();
    if not exists (select 1 from clinic_reception.room_staff s join clinic_reception.rooms r on r.id = s.room_id
                    where s.admin_id = me and r.workspace_id = p_workspace) then
      perform clinic_reception.access(p_workspace, 'view');
    end if;
    return clinic_reception.queue_board(p_workspace, today) || jsonb_build_object(
      'rooms', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'label', r.label, 'kind', r.kind, 'ticket_prefix', r.ticket_prefix,
          'active', r.active, 'sort_order', r.sort_order,
          'staff', (select coalesce(jsonb_agg(jsonb_build_object('admin_id', a.id, 'name', coalesce(nullif(a.name, ''), a.email)) order by a.name), '[]')
                      from clinic_reception.room_staff s join public.admins a on a.id = s.admin_id where s.room_id = r.id),
          'mine', exists (select 1 from clinic_reception.room_staff s where s.room_id = r.id and s.admin_id = me),
          'assignment', (select jsonb_build_object('id', a.id, 'provider_id', a.provider_id, 'doctor_name', pr.name, 'started_at', a.started_at)
                           from clinic_reception.room_assignments a join clinic_reception.providers pr on pr.id = a.provider_id
                          where a.room_id = r.id and a.ended_at is null and a.service_date = today))
          order by r.sort_order, r.label), '[]') from clinic_reception.rooms r where r.workspace_id = p_workspace),
      'tickets', (select coalesce(jsonb_agg(jsonb_build_object('queue_entry_id', q2.id, 'appointment_id', q2.appointment_id,
          'provider_id', q2.provider_id, 'ticket_no', q2.ticket_no, 'status', q2.status) order by q2.provider_id, q2.ticket_no), '[]')
          from clinic_reception.queue_entries q2 where q2.workspace_id = p_workspace and q2.ticket_date = today),
      'dept_tickets', (select coalesce(jsonb_agg(jsonb_build_object('id', t2.id, 'room_id', t2.room_id, 'label', clinic_reception.dept_label(t2),
          'status', t2.status, 'appointment_id', t2.appointment_id, 'created_at', t2.created_at) order by t2.room_id, t2.ticket_no), '[]')
          from clinic_reception.dept_tickets t2 where t2.workspace_id = p_workspace and t2.ticket_date = today));

  elsif p_action = 'room_save' then
    me := clinic_reception.access(p_workspace, 'manage');
    if nullif(trim(p->>'label'), '') is null then raise exception 'اكتب اسم الغرفة'; end if;
    if nullif(p->>'id', '') is null then
      insert into clinic_reception.rooms(workspace_id, label, kind, ticket_prefix, active, sort_order, updated_by)
      values (p_workspace, trim(p->>'label'), coalesce(nullif(p->>'kind', ''), 'clinic'), upper(nullif(trim(p->>'ticket_prefix'), '')),
              coalesce((p->>'active')::boolean, true), coalesce(nullif(p->>'sort_order', '')::int, 0), me)
      returning * into rm;
    else
      update clinic_reception.rooms set label = trim(p->>'label'), kind = coalesce(nullif(p->>'kind', ''), kind),
             ticket_prefix = upper(nullif(trim(p->>'ticket_prefix'), '')), active = coalesce((p->>'active')::boolean, active),
             sort_order = coalesce(nullif(p->>'sort_order', '')::int, sort_order), updated_by = me, updated_at = now()
       where id = (p->>'id')::uuid and workspace_id = p_workspace returning * into rm;
      if not found then raise exception 'الغرفة غير موجودة'; end if;
    end if;
    if not rm.active or rm.ticket_prefix is not null then
      update clinic_reception.room_assignments set ended_at = now(), ended_by = me where room_id = rm.id and ended_at is null;
    end if;
    return jsonb_build_object('ok', true, 'id', rm.id);

  elsif p_action = 'room_staff_set' then
    me := clinic_reception.access(p_workspace, 'manage');
    select * into rm from clinic_reception.rooms where id = (p->>'room_id')::uuid and workspace_id = p_workspace;
    if not found then raise exception 'الغرفة غير موجودة'; end if;
    delete from clinic_reception.room_staff where room_id = rm.id;
    insert into clinic_reception.room_staff(room_id, admin_id, added_by)
    select rm.id, a.id, me from public.admins a
     where a.id in (select (x #>> '{}')::uuid from jsonb_array_elements(coalesce(p->'admin_ids', '[]')) x) and a.active
    on conflict do nothing;
    return jsonb_build_object('ok', true);

  elsif p_action = 'assign' then
    me := clinic_reception.access(p_workspace, 'execute');
    select * into rm from clinic_reception.rooms where id = (p->>'room_id')::uuid and workspace_id = p_workspace for update;
    if not found then raise exception 'الغرفة غير موجودة'; end if;
    if not rm.active then raise exception 'الغرفة دي متوقفة'; end if;
    if rm.ticket_prefix is not null then raise exception 'دي غرفة قسم بأرقامها، مش عيادة دكتور'; end if;
    pv := (p->>'provider_id')::uuid;
    if not exists (select 1 from clinic_reception.providers where id = pv and workspace_id = p_workspace and active) then raise exception 'اختر طبيب'; end if;
    update clinic_reception.room_assignments set ended_at = now(), ended_by = me
     where ended_at is null and (room_id = rm.id or provider_id = pv);
    insert into clinic_reception.room_assignments(workspace_id, room_id, provider_id, service_date, assigned_by)
    values (p_workspace, rm.id, pv, today, me);
    return jsonb_build_object('ok', true);

  elsif p_action = 'end_assignment' then
    me := clinic_reception.access(p_workspace, 'execute');
    update clinic_reception.room_assignments a set ended_at = now(), ended_by = me
      from clinic_reception.rooms r
     where r.id = a.room_id and r.workspace_id = p_workspace and a.room_id = (p->>'room_id')::uuid and a.ended_at is null;
    return jsonb_build_object('ok', true);

  elsif p_action = 'dept_ticket' then
    select * into rm from clinic_reception.rooms where id = (p->>'room_id')::uuid and workspace_id = p_workspace;
    if not found or rm.ticket_prefix is null then raise exception 'اختر غرفة قسم'; end if;
    if not rm.active then raise exception 'الغرفة دي متوقفة'; end if;
    me := clinic_reception.room_actor(p_workspace, rm.id);
    if nullif(p->>'appointment_id', '') is not null
       and not exists (select 1 from clinic_reception.appointments where id = (p->>'appointment_id')::uuid and workspace_id = p_workspace) then
      raise exception 'الحجز غير موجود';
    end if;
    perform pg_advisory_xact_lock(hashtext('dept_ticket:' || rm.id::text || ':' || today::text));
    n := coalesce((select max(ticket_no) from clinic_reception.dept_tickets where room_id = rm.id and ticket_date = today), 0) + 1;
    insert into clinic_reception.dept_tickets(workspace_id, room_id, ticket_date, ticket_no, appointment_id, source, created_by)
    values (p_workspace, rm.id, today, n, nullif(p->>'appointment_id', '')::uuid,
            case when p->>'source' in ('doctor','manual') then p->>'source' else 'reception' end, me)
    returning * into t;
    return jsonb_build_object('ok', true, 'id', t.id, 'label', rm.ticket_prefix || n, 'room_label', rm.label);

  elsif p_action = 'call_next' then
    if nullif(p->>'room_id', '') is not null then
      select * into rm from clinic_reception.rooms where id = (p->>'room_id')::uuid and workspace_id = p_workspace;
      if not found or rm.ticket_prefix is null then raise exception 'اختر غرفة قسم'; end if;
      me := clinic_reception.room_actor(p_workspace, rm.id);
      perform pg_advisory_xact_lock(hashtext('dept_ticket:' || rm.id::text || ':' || today::text));
      -- whoever is still "called" and was not started is left as is (they can be recalled or marked absent)
      update clinic_reception.dept_tickets set status = 'done', service_ended_at = now(), updated_at = now()
       where room_id = rm.id and ticket_date = today and status = 'in_service';
      select * into t from clinic_reception.dept_tickets where room_id = rm.id and ticket_date = today and status = 'waiting'
       order by ticket_no limit 1 for update;
      if not found then return jsonb_build_object('ok', true, 'empty', true); end if;
      update clinic_reception.dept_tickets set status = 'called', called_at = now(), called_by = me, updated_at = now() where id = t.id;
      insert into clinic_reception.queue_calls(workspace_id, ticket_label, dept_room_id, room_id, room_label, dept_ticket_id, called_by)
      values (p_workspace, rm.ticket_prefix || t.ticket_no, rm.id, rm.id, rm.label, t.id, me);
      return jsonb_build_object('ok', true, 'label', rm.ticket_prefix || t.ticket_no, 'room_label', rm.label);
    end if;
    pv := (p->>'provider_id')::uuid;
    perform clinic_reception.access(p_workspace, 'execute');
    perform pg_advisory_xact_lock(hashtext('queue_call_next:' || pv::text));
    select * into q from clinic_reception.queue_entries where workspace_id = p_workspace and provider_id = pv
       and ticket_date = today and status = 'waiting' order by priority desc, ticket_no limit 1;
    if not found then return jsonb_build_object('ok', true, 'empty', true); end if;
    -- the existing journey action does the call (permissions, journey event, messages); the trigger logs the call
    v := public.clinic_reception_journey_command(p_workspace, 'call', jsonb_build_object('appointment_id', q.appointment_id), gen_random_uuid());
    rm := clinic_reception.provider_room(pv);
    return jsonb_build_object('ok', true, 'label', q.ticket_no::text, 'room_label', rm.label);

  elsif p_action in ('dept_recall','dept_start','dept_done','dept_no_show','dept_cancel') then
    select * into t from clinic_reception.dept_tickets where id = (p->>'id')::uuid and workspace_id = p_workspace for update;
    if not found then raise exception 'الرقم غير موجود'; end if;
    select * into rm from clinic_reception.rooms where id = t.room_id;
    me := clinic_reception.room_actor(p_workspace, rm.id);
    if p_action = 'dept_recall' then
      if t.status not in ('called','in_service') then raise exception 'الرقم ده مش متنادي'; end if;
      update clinic_reception.dept_tickets set status = 'called', called_at = now(), called_by = me, updated_at = now() where id = t.id;
      insert into clinic_reception.queue_calls(workspace_id, ticket_label, dept_room_id, room_id, room_label, dept_ticket_id, called_by)
      values (p_workspace, rm.ticket_prefix || t.ticket_no, rm.id, rm.id, rm.label, t.id, me);
    elsif p_action = 'dept_start' then
      if t.status not in ('waiting','called') then raise exception 'الرقم ده مش في الانتظار'; end if;
      update clinic_reception.dept_tickets set status = 'in_service', service_started_at = now(), updated_at = now() where id = t.id;
    elsif p_action = 'dept_done' then
      if t.status not in ('called','in_service') then raise exception 'الرقم ده لسه ماتناداش'; end if;
      update clinic_reception.dept_tickets set status = 'done', service_ended_at = now(), updated_at = now() where id = t.id;
    elsif p_action = 'dept_no_show' then
      if t.status not in ('waiting','called') then raise exception 'مينفعش'; end if;
      update clinic_reception.dept_tickets set status = 'no_show', updated_at = now() where id = t.id;
    else
      if t.status in ('done','cancelled') then raise exception 'مينفعش'; end if;
      update clinic_reception.dept_tickets set status = 'cancelled', updated_at = now() where id = t.id;
    end if;
    return jsonb_build_object('ok', true);
  end if;
  raise exception 'إجراء غير معروف';
end $$;

revoke all on function clinic_reception.provider_room(uuid) from public, anon, authenticated;
revoke all on function clinic_reception.queue_ticket_and_call() from public, anon, authenticated;
revoke all on function clinic_reception.dept_label(clinic_reception.dept_tickets) from public, anon, authenticated;
revoke all on function clinic_reception.room_actor(uuid, uuid) from public, anon, authenticated;
revoke all on function clinic_reception.queue_board(uuid, date) from public, anon, authenticated;
revoke all on function public.clinic_reception_queue(uuid, text, jsonb) from public, anon;
grant execute on function public.clinic_reception_queue(uuid, text, jsonb) to authenticated;

commit;
