-- Fallback booking, step 1b: reconciliation with Masa (owner 2026-11-18 «كلهم بترتيب», relayed by the WhatsApp-agent chat).
-- The WhatsApp agent reads Masa bookings through the read-only bridge every 15 minutes and calls three new ops on
-- booking-fallback (service role only):
--   reconcile_list  — dashboard bookings tied to Masa in a date range (no names/phones): fallback bookings, agent bookings
--                     mirrored by booking-sync-ingest (public.customer_bookings), and Masa imports.
--   masa_import     — bookings reception made by hand in Masa; stored in clinic_reception.masa_bookings (idempotent on the
--                     Masa booking id). They block those times for the fallback (slots/book) and show to reception.
--   reconcile_flag  — a reception alert (missing in Masa / booked twice / cancelled in Masa), once per (kind, booking).
-- Agent bookings already in Masa (customer_bookings) now also block fallback times.
-- Nothing here calls Masa, writes to Masa or sends messages. Masa imports do NOT block reception's own booking screen
-- (reception often enters the same patient in both systems); they only keep the fallback off those times.

create table if not exists public.customer_bookings (
  id uuid primary key default gen_random_uuid(), booking_request_id text not null unique, booking_flow_id text, official_booking_id text,
  booking_reference text, tenant_id text not null default 'swnw',
  channel text not null default 'whatsapp' check (channel in ('whatsapp','messenger','instagram','facebook','other')),
  wa_id text, customer_name text, phone text, specialty_id text, specialty_name text, doctor_id text, doctor_name text,
  appointment_date date, appointment_time text, price numeric(12,2), currency text not null default 'EGP',
  status text not null default 'confirmed' check (status in ('confirmed','rescheduled','cancelled','arrived','completed','no_show')),
  confirmed_at timestamptz, last_synced_at timestamptz not null default now(), created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- No-ops on live (setup.sql has them); keeps older/partial copies of the table compatible.
alter table public.customer_bookings add column if not exists official_booking_id text, add column if not exists doctor_id text,
  add column if not exists appointment_date date, add column if not exists appointment_time text, add column if not exists status text;
create index if not exists customer_bookings_official_idx on public.customer_bookings (official_booking_id);

create table if not exists clinic_reception.masa_bookings(
  official_booking_id text primary key check (length(official_booking_id) between 1 and 80),
  workspace_id uuid not null references clinic_reception.workspaces(id),
  masa_doctor_id int not null references clinic_reception.masa_doctor_links(masa_doctor_id),
  masa_specialization_id int,
  provider_id uuid references clinic_reception.providers(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'active' check (status in ('active','cancelled')),
  needed_service text,
  patient_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists masa_bookings_provider_idx on clinic_reception.masa_bookings(provider_id, starts_at);
alter table clinic_reception.masa_bookings enable row level security;
revoke all on clinic_reception.masa_bookings from public, anon, authenticated;

create table if not exists clinic_reception.fallback_alerts(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references clinic_reception.workspaces(id),
  kind text not null check (kind in ('missing_in_masa','double_booked','cancelled_in_masa')),
  ref text not null check (length(ref) between 1 and 200),
  detail text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.admins(id),
  unique (kind, ref)
);
alter table clinic_reception.fallback_alerts enable row level security;
revoke all on clinic_reception.fallback_alerts from public, anon, authenticated;

-- Agent bookings in Masa (mirrored), as busy intervals per provider. doctor_id is the Masa doctor id.
create or replace function clinic_reception.agent_booking_start(d date, t text) returns timestamptz language sql immutable as $$
  select case when d is not null and t ~ '^\s*[0-9]{1,2}:[0-9]{2}' then (d + substring(t from '[0-9]{1,2}:[0-9]{2}')::time) at time zone 'Africa/Cairo' end
$$;

create or replace function clinic_reception.slot_busy(p_provider uuid, p_start timestamptz, p_end timestamptz, p_skip uuid default null)
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from clinic_reception.appointments a where a.provider_id = p_provider
                   and a.status not in ('cancelled','no_show') and a.starts_at < p_end and a.ends_at > p_start)
      or exists (select 1 from clinic_reception.fallback_bookings f where f.provider_id = p_provider
                   and clinic_reception.fallback_holds(f) and f.starts_at < p_end and f.ends_at > p_start and f.id is distinct from p_skip)
      or exists (select 1 from clinic_reception.masa_bookings m where m.provider_id = p_provider and m.status = 'active'
                   and m.starts_at < p_end and m.ends_at > p_start)
      or exists (select 1 from public.customer_bookings c join clinic_reception.masa_doctor_links k on k.masa_doctor_id::text = trim(c.doctor_id)
                  where k.provider_id = p_provider and c.status in ('confirmed','rescheduled')
                    and c.appointment_date between (p_start at time zone 'Africa/Cairo')::date - 1 and (p_end at time zone 'Africa/Cairo')::date
                    and clinic_reception.agent_booking_start(c.appointment_date, c.appointment_time) < p_end
                    and clinic_reception.agent_booking_start(c.appointment_date, c.appointment_time) + interval '20 minutes' > p_start)
$$;

do $$ begin
  if to_regprocedure('clinic_reception.fallback_api_before_reconcile(text,jsonb)') is null then
    alter function clinic_reception.fallback_api(text, jsonb) rename to fallback_api_before_reconcile;
  end if;
end $$;
revoke all on function clinic_reception.fallback_api_before_reconcile(text, jsonb) from public, anon, authenticated;

create or replace function clinic_reception.fallback_api(p_op text, p jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare d0 date; d1 date; out jsonb; it jsonb; l clinic_reception.masa_doctor_links; m clinic_reception.masa_bookings;
  oid text; t timestamptz; st text; ph text; ins int := 0; upd int := 0; skp int := 0; ws uuid; v_ref text; k text; n int;
begin
  p := coalesce(p, '{}');
  if p_op = 'reconcile_list' then
    d0 := coalesce(nullif(p->>'date_from', '')::date, (now() at time zone 'Africa/Cairo')::date - 1);
    d1 := coalesce(nullif(p->>'date_to', '')::date, d0 + 15);
    if d1 < d0 or d1 - d0 > 31 then return jsonb_build_object('ok', false, 'error', 'invalid_range'); end if;
    select coalesce(jsonb_agg(x order by x->>'appointment_date', x->>'appointment_time'), '[]') into out from (
      select jsonb_build_object('booking_request_id', f.booking_request_id, 'source', f.source, 'status', f.status,
               'official_booking_id', f.official_booking_id, 'masa_doctor_id', f.masa_doctor_id,
               'appointment_date', to_char(f.starts_at at time zone 'Africa/Cairo', 'YYYY-MM-DD'),
               'appointment_time', to_char(f.starts_at at time zone 'Africa/Cairo', 'HH24:MI')) x
        from clinic_reception.fallback_bookings f where (f.starts_at at time zone 'Africa/Cairo')::date between d0 and d1
      union all
      select jsonb_build_object('booking_request_id', c.booking_request_id, 'source', 'whatsapp',
               'status', case when c.status = 'cancelled' then 'cancelled' else 'confirmed' end,
               'official_booking_id', c.official_booking_id,
               'masa_doctor_id', case when trim(c.doctor_id) ~ '^[0-9]{1,9}$' then trim(c.doctor_id)::int end,
               'appointment_date', to_char(c.appointment_date, 'YYYY-MM-DD'),
               'appointment_time', substring(c.appointment_time from '[0-9]{1,2}:[0-9]{2}'))
        from public.customer_bookings c
       where c.official_booking_id is not null and c.appointment_date between d0 and d1
         and not exists (select 1 from clinic_reception.fallback_bookings f where f.booking_request_id = c.booking_request_id)
      union all
      select jsonb_build_object('booking_request_id', 'masa:' || mb.official_booking_id, 'source', 'masa_import',
               'status', case when mb.status = 'active' then 'confirmed' else 'cancelled' end,
               'official_booking_id', mb.official_booking_id, 'masa_doctor_id', mb.masa_doctor_id,
               'appointment_date', to_char(mb.starts_at at time zone 'Africa/Cairo', 'YYYY-MM-DD'),
               'appointment_time', to_char(mb.starts_at at time zone 'Africa/Cairo', 'HH24:MI'))
        from clinic_reception.masa_bookings mb where (mb.starts_at at time zone 'Africa/Cairo')::date between d0 and d1
    ) q;
    return jsonb_build_object('ok', true, 'date_from', d0, 'date_to', d1, 'bookings', out);
  end if;

  if p_op = 'masa_import' then
    if jsonb_typeof(p->'items') <> 'array' then return jsonb_build_object('ok', false, 'error', 'items_required'); end if;
    if jsonb_array_length(p->'items') > 500 then return jsonb_build_object('ok', false, 'error', 'too_many_items'); end if;
    for it in select value from jsonb_array_elements(p->'items') loop
      oid := left(nullif(trim(it->>'official_booking_id'), ''), 80);
      st := case when coalesce(it->>'status', 'active') = 'cancelled' then 'cancelled' else 'active' end;
      -- already known as a dashboard/agent booking → not an import
      if oid is null or exists (select 1 from clinic_reception.fallback_bookings f where f.official_booking_id = oid)
         or exists (select 1 from public.customer_bookings c where c.official_booking_id = oid) then skp := skp + 1; continue; end if;
      select * into m from clinic_reception.masa_bookings where official_booking_id = oid for update;
      if st = 'cancelled' then
        if found and m.status = 'active' then
          update clinic_reception.masa_bookings set status = 'cancelled', updated_at = now() where official_booking_id = oid; upd := upd + 1;
        else skp := skp + 1; end if;
        continue;
      end if;
      select * into l from clinic_reception.masa_doctor_links where masa_doctor_id = nullif(it->>'masa_doctor_id', '')::int;
      if not found or nullif(it->>'appointment_date', '') is null or coalesce(it->>'appointment_time', '') !~ '^\s*[0-9]{1,2}:[0-9]{2}' then
        skp := skp + 1; continue;
      end if;
      t := clinic_reception.agent_booking_start((it->>'appointment_date')::date, it->>'appointment_time');
      ph := nullif(regexp_replace(coalesce(it->>'phone', ''), '[^0-9+]', '', 'g'), '');
      if m.official_booking_id is null then
        insert into clinic_reception.masa_bookings(official_booking_id, workspace_id, masa_doctor_id, masa_specialization_id, provider_id,
            starts_at, ends_at, status, needed_service, patient_name, phone)
          values (oid, l.workspace_id, l.masa_doctor_id, coalesce(nullif(it->>'masa_specialization_id', '')::int, l.masa_specialization_id),
            l.provider_id, t, t + interval '20 minutes', 'active', left(nullif(trim(it->>'needed_service'), ''), 80),
            left(nullif(trim(it->>'patient_name'), ''), 120), left(ph, 20));
        ins := ins + 1;
      elsif m.status <> 'active' or m.starts_at <> t or m.masa_doctor_id <> l.masa_doctor_id
            or m.patient_name is distinct from left(nullif(trim(it->>'patient_name'), ''), 120) or m.phone is distinct from left(ph, 20) then
        update clinic_reception.masa_bookings set status = 'active', starts_at = t, ends_at = t + interval '20 minutes', masa_doctor_id = l.masa_doctor_id,
            provider_id = l.provider_id, patient_name = left(nullif(trim(it->>'patient_name'), ''), 120), phone = left(ph, 20),
            needed_service = left(nullif(trim(it->>'needed_service'), ''), 80), updated_at = now()
          where official_booking_id = oid;
        upd := upd + 1;
      else
        skp := skp + 1;
      end if;
    end loop;
    return jsonb_build_object('ok', true, 'inserted', ins, 'updated', upd, 'skipped', skp);
  end if;

  if p_op = 'reconcile_flag' then
    k := p->>'kind';
    if k is null or k not in ('missing_in_masa','double_booked','cancelled_in_masa') then return jsonb_build_object('ok', false, 'error', 'invalid_kind'); end if;
    v_ref := coalesce(nullif(trim(p->>'booking_request_id'), ''), 'masa:' || nullif(trim(p->>'official_booking_id'), ''));
    if v_ref is null then return jsonb_build_object('ok', false, 'error', 'booking_required'); end if;
    select workspace_id into ws from clinic_reception.fallback_bookings where booking_request_id = v_ref;
    if ws is null then select workspace_id into ws from clinic_reception.masa_bookings where 'masa:' || official_booking_id = v_ref; end if;
    if ws is null then select workspace_id into ws from clinic_reception.masa_doctor_links group by workspace_id order by count(*) desc limit 1; end if;
    if ws is null then return jsonb_build_object('ok', false, 'error', 'no_workspace'); end if;
    insert into clinic_reception.fallback_alerts(workspace_id, kind, ref, detail) values (ws, k, left(v_ref, 200), left(nullif(trim(p->>'detail'), ''), 500))
      on conflict (kind, ref) do nothing;
    get diagnostics n = row_count;
    return jsonb_build_object('ok', true, 'created', n > 0);
  end if;

  return clinic_reception.fallback_api_before_reconcile(p_op, p);
end $$;
revoke all on function clinic_reception.fallback_api(text, jsonb) from public, anon, authenticated;

-- Reception: alerts and Masa imports in the same panel; resolve an alert.
do $$ begin
  if to_regprocedure('clinic_reception.fallback_before_reconcile(uuid,text,jsonb)') is null then
    alter function public.clinic_reception_fallback(uuid, text, jsonb) rename to fallback_before_reconcile;
    alter function public.fallback_before_reconcile(uuid, text, jsonb) set schema clinic_reception;
  end if;
end $$;
revoke all on function clinic_reception.fallback_before_reconcile(uuid, text, jsonb) from public, anon, authenticated;

create or replace function public.clinic_reception_fallback(p_workspace uuid, p_action text, p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid; r jsonb; ws uuid := p_workspace;
begin
  if p_action = 'list' then
    r := clinic_reception.fallback_before_reconcile(p_workspace, p_action, p_payload);
    return r || jsonb_build_object(
      'alerts', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'detail', a.detail, 'created_at', a.created_at,
          'customer_name', coalesce(f.customer_name, m.patient_name), 'doctor_name', pr.name,
          'appointment_date', to_char(coalesce(f.starts_at, m.starts_at) at time zone 'Africa/Cairo', 'YYYY-MM-DD'),
          'appointment_time', to_char(coalesce(f.starts_at, m.starts_at) at time zone 'Africa/Cairo', 'HH24:MI')) order by a.created_at), '[]')
        from clinic_reception.fallback_alerts a
        left join clinic_reception.fallback_bookings f on f.booking_request_id = a.ref
        left join clinic_reception.masa_bookings m on 'masa:' || m.official_booking_id = a.ref
        left join clinic_reception.providers pr on pr.id = coalesce(f.provider_id, m.provider_id)
        where a.workspace_id = ws and a.resolved_at is null),
      'masa_imports', (select coalesce(jsonb_agg(jsonb_build_object('official_booking_id', m.official_booking_id, 'patient_name', m.patient_name,
          'phone', m.phone, 'doctor_name', pr.name, 'department', pr.department, 'needed_service', m.needed_service,
          'appointment_date', to_char(m.starts_at at time zone 'Africa/Cairo', 'YYYY-MM-DD'),
          'appointment_time', to_char(m.starts_at at time zone 'Africa/Cairo', 'HH24:MI')) order by m.starts_at), '[]')
        from clinic_reception.masa_bookings m left join clinic_reception.providers pr on pr.id = m.provider_id
        where m.workspace_id = ws and m.status = 'active' and m.starts_at > now() - interval '2 hours' and m.starts_at < now() + interval '3 days'));
  elsif p_action = 'alert_resolve' then
    me := clinic_reception.access(p_workspace, 'book');
    update clinic_reception.fallback_alerts set resolved_at = now(), resolved_by = me
     where id = nullif(p_payload->>'id', '')::uuid and workspace_id = p_workspace and resolved_at is null;
    if not found then raise exception 'التنبيه غير موجود أو اتراجع قبل كده'; end if;
    return jsonb_build_object('ok', true);
  end if;
  return clinic_reception.fallback_before_reconcile(p_workspace, p_action, p_payload);
end $$;
revoke all on function public.clinic_reception_fallback(uuid, text, jsonb) from public, anon;
grant execute on function public.clinic_reception_fallback(uuid, text, jsonb) to authenticated;

revoke all on function clinic_reception.agent_booking_start(date, text) from public, anon, authenticated;
revoke all on function clinic_reception.slot_busy(uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated;
