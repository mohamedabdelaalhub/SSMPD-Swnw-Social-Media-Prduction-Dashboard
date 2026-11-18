-- Fallback booking: slots follow Masa's latest state (owner requirement 2026-11-18, relayed by the WhatsApp-agent chat:
-- fallback times at most ~3–5 minutes behind Masa).
-- * op 'masa_schedule' (every 5 min from the agent's /catalog sync) replaces the stored Masa doctor-days for a window.
--   A doctor/date missing from the window is CLOSED for the fallback.
-- * A fallback slot must now ALSO lie inside a Masa doctor-day (once any schedule has arrived); before the first
--   schedule, the earlier behaviour holds (dashboard availability only).
-- * 'slots' reports snapshot_at (last Masa schedule / last Masa bookings sync) and stale (older than 60 minutes);
--   while stale, one reception alert per hour.
-- * reconcile_flag 'cancelled_in_masa' for one of OUR bookings releases its block (fallback booking → cancelled;
--   agent booking → ignored for slot blocking). No write to public.customer_bookings, nothing sent to Masa.

create table if not exists clinic_reception.masa_schedule_days(
  masa_doctor_id int not null references clinic_reception.masa_doctor_links(masa_doctor_id),
  day date not null,
  starts time not null,
  ends time not null,           -- 00:00 = midnight at the end of the day
  primary key (masa_doctor_id, day, starts)
);
alter table clinic_reception.masa_schedule_days enable row level security;
revoke all on clinic_reception.masa_schedule_days from public, anon, authenticated;

create table if not exists clinic_reception.fallback_sync_state(
  key text primary key check (key in ('schedule','bookings')),
  synced_at timestamptz not null,
  source_generated_at timestamptz
);
alter table clinic_reception.fallback_sync_state enable row level security;
revoke all on clinic_reception.fallback_sync_state from public, anon, authenticated;

-- Agent bookings Masa cancelled (by official id): no longer block fallback times.
create table if not exists clinic_reception.masa_cancelled_bookings(
  official_booking_id text primary key,
  created_at timestamptz not null default now()
);
alter table clinic_reception.masa_cancelled_bookings enable row level security;
revoke all on clinic_reception.masa_cancelled_bookings from public, anon, authenticated;

alter table clinic_reception.fallback_alerts drop constraint if exists fallback_alerts_kind_check;
alter table clinic_reception.fallback_alerts add constraint fallback_alerts_kind_check
  check (kind in ('missing_in_masa','double_booked','cancelled_in_masa','stale_sync'));

create or replace function clinic_reception.masa_day_open(p_provider uuid, p_start timestamptz, p_end timestamptz)
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select not exists (select 1 from clinic_reception.fallback_sync_state where key = 'schedule')
      or exists (select 1 from clinic_reception.masa_schedule_days d
                   join clinic_reception.masa_doctor_links k on k.masa_doctor_id = d.masa_doctor_id and k.provider_id = p_provider
                  where d.day = (p_start at time zone 'Africa/Cairo')::date
                    and (d.day + d.starts) at time zone 'Africa/Cairo' <= p_start
                    and (d.day + case when d.ends = time '00:00' then interval '24 hours' else d.ends - time '00:00' end) at time zone 'Africa/Cairo' >= p_end)
$$;

create or replace function clinic_reception.fallback_slot_ok(p_provider uuid, p_start timestamptz, p_end timestamptz)
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select p_start > now() + interval '15 minutes'
     and (p_start at time zone 'Africa/Cairo')::time >= time '08:00'
     and p_end <= (((p_start at time zone 'Africa/Cairo')::date + 1)::timestamp at time zone 'Africa/Cairo')
     and not clinic_reception.center_closed((p_start at time zone 'Africa/Cairo')::date)
     and exists (select 1 from clinic_reception.availability v where v.provider_id = p_provider and v.starts_at <= p_start and v.ends_at >= p_end)
     and clinic_reception.masa_day_open(p_provider, p_start, p_end)
$$;

create or replace function clinic_reception.slot_busy(p_provider uuid, p_start timestamptz, p_end timestamptz, p_skip uuid default null)
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from clinic_reception.appointments a where a.provider_id = p_provider
                   and a.status not in ('cancelled','no_show') and a.starts_at < p_end and a.ends_at > p_start)
      or exists (select 1 from clinic_reception.fallback_bookings f where f.provider_id = p_provider
                   and clinic_reception.fallback_holds(f) and f.starts_at < p_end and f.ends_at > p_start and f.id is distinct from p_skip)
      or exists (select 1 from clinic_reception.masa_bookings m where m.provider_id = p_provider and m.status = 'active'
                   and m.starts_at < p_end and m.ends_at > p_start)
      or exists (select 1 from public.customer_bookings c join clinic_reception.masa_doctor_links k on k.masa_doctor_id = c.masa_doctor_id
                  where k.provider_id = p_provider and c.status in ('confirmed','rescheduled')
                    and not exists (select 1 from clinic_reception.masa_cancelled_bookings x where x.official_booking_id = c.official_booking_id)
                    and c.appointment_date between (p_start at time zone 'Africa/Cairo')::date - 1 and (p_end at time zone 'Africa/Cairo')::date
                    and clinic_reception.agent_booking_start(c.appointment_date, c.appointment_time) < p_end
                    and clinic_reception.agent_booking_start(c.appointment_date, c.appointment_time) + interval '20 minutes' > p_start)
$$;

create or replace function clinic_reception.fallback_mark_sync(p_key text, p_generated timestamptz default null) returns void
language sql security definer set search_path = pg_catalog, public as $$
  insert into clinic_reception.fallback_sync_state(key, synced_at, source_generated_at) values (p_key, now(), p_generated)
  on conflict (key) do update set synced_at = excluded.synced_at, source_generated_at = coalesce(excluded.source_generated_at, clinic_reception.fallback_sync_state.source_generated_at)
$$;

do $$ begin
  if to_regprocedure('clinic_reception.fallback_api_before_schedule(text,jsonb)') is null then
    alter function clinic_reception.fallback_api(text, jsonb) rename to fallback_api_before_schedule;
  end if;
end $$;
revoke all on function clinic_reception.fallback_api_before_schedule(text, jsonb) from public, anon, authenticated;

create or replace function clinic_reception.fallback_api(p_op text, p jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare d0 date; d1 date; r jsonb; it jsonb; ins int := 0; del int := 0; sch timestamptz; bks timestamptz; snap timestamptz;
  stale boolean; ws uuid; f clinic_reception.fallback_bookings; oid text; s time; e time;
begin
  p := coalesce(p, '{}');

  if p_op = 'masa_schedule' then
    d0 := nullif(p->>'date_from', '')::date; d1 := nullif(p->>'date_to', '')::date;
    if d0 is null or d1 is null or d1 < d0 or d1 - d0 > 31 then return jsonb_build_object('ok', false, 'error', 'invalid_range'); end if;
    if jsonb_typeof(p->'days') <> 'array' then return jsonb_build_object('ok', false, 'error', 'days_required'); end if;
    if jsonb_array_length(p->'days') > 5000 then return jsonb_build_object('ok', false, 'error', 'too_many_items'); end if;
    -- validate everything before replacing (atomic: one bad row → nothing changes)
    for it in select value from jsonb_array_elements(p->'days') loop
      if coalesce(it->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(it->>'start', '') !~ '^\d{1,2}:\d{2}$' or coalesce(it->>'end', '') !~ '^\d{1,2}:\d{2}$'
         or (it->>'date')::date not between d0 and d1 then
        return jsonb_build_object('ok', false, 'error', 'invalid_day', 'item', it);
      end if;
      s := (it->>'start')::time; e := (it->>'end')::time;
      if e <> time '00:00' and e <= s then return jsonb_build_object('ok', false, 'error', 'invalid_day', 'item', it); end if;
    end loop;
    delete from clinic_reception.masa_schedule_days where day between d0 and d1;
    get diagnostics del = row_count;
    insert into clinic_reception.masa_schedule_days(masa_doctor_id, day, starts, ends)
      select (x->>'masa_doctor_id')::int, (x->>'date')::date, (x->>'start')::time, (x->>'end')::time
        from jsonb_array_elements(p->'days') x
       where exists (select 1 from clinic_reception.masa_doctor_links k where k.masa_doctor_id = (x->>'masa_doctor_id')::int)
      on conflict (masa_doctor_id, day, starts) do update set ends = greatest(clinic_reception.masa_schedule_days.ends, excluded.ends);
    get diagnostics ins = row_count;
    perform clinic_reception.fallback_mark_sync('schedule', nullif(p->>'generated_at', '')::timestamptz);
    return jsonb_build_object('ok', true, 'upserted', ins, 'deleted', del,
      'skipped', jsonb_array_length(p->'days') - ins);
  end if;

  if p_op in ('reconcile_list','masa_import') then
    r := clinic_reception.fallback_api_before_schedule(p_op, p);
    if coalesce((r->>'ok')::boolean, false) then perform clinic_reception.fallback_mark_sync('bookings'); end if;
    return r;
  end if;

  if p_op = 'reconcile_flag' then
    r := clinic_reception.fallback_api_before_schedule(p_op, p);
    if coalesce((r->>'ok')::boolean, false) and p->>'kind' = 'cancelled_in_masa' then
      -- Masa cancelled one of OUR bookings: release its block for the fallback.
      select * into f from clinic_reception.fallback_bookings where booking_request_id = nullif(trim(p->>'booking_request_id'), '') for update;
      if found and f.status in ('pending','replayed','conflict') then
        update clinic_reception.fallback_bookings set status = 'cancelled', lease_until = null, updated_at = now(),
          cancel_reason = coalesce(cancel_reason, 'اتلغى من ماسا') where id = f.id;
      end if;
      oid := nullif(trim(p->>'official_booking_id'), '');
      if oid is not null then
        update clinic_reception.fallback_bookings set status = 'cancelled', lease_until = null, updated_at = now(),
          cancel_reason = coalesce(cancel_reason, 'اتلغى من ماسا')
         where official_booking_id = oid and status in ('replayed','conflict');
        if exists (select 1 from public.customer_bookings c where c.official_booking_id = oid) then
          insert into clinic_reception.masa_cancelled_bookings(official_booking_id) values (left(oid, 80)) on conflict do nothing;
        end if;
        update clinic_reception.masa_bookings set status = 'cancelled', updated_at = now() where official_booking_id = oid and status = 'active';
      end if;
    end if;
    return r;
  end if;

  if p_op = 'slots' then
    r := clinic_reception.fallback_api_before_schedule(p_op, p);
    select synced_at into sch from clinic_reception.fallback_sync_state where key = 'schedule';
    select synced_at into bks from clinic_reception.fallback_sync_state where key = 'bookings';
    snap := least(sch, bks);
    stale := sch is null or bks is null or snap < now() - interval '60 minutes';
    if stale and (sch is not null or bks is not null) then
      select workspace_id into ws from clinic_reception.masa_doctor_links group by workspace_id order by count(*) desc limit 1;
      if ws is not null then
        insert into clinic_reception.fallback_alerts(workspace_id, kind, ref, detail)
          values (ws, 'stale_sync', 'stale:' || to_char(now() at time zone 'Africa/Cairo', 'YYYY-MM-DD HH24'),
                  'آخر مزامنة مع ماسا: ' || coalesce(to_char(snap at time zone 'Africa/Cairo', 'YYYY-MM-DD HH24:MI'), 'مفيش'))
          on conflict (kind, ref) do nothing;
      end if;
    end if;
    return r || jsonb_build_object('snapshot_at', snap, 'schedule_synced_at', sch, 'bookings_synced_at', bks, 'stale', stale);
  end if;

  return clinic_reception.fallback_api_before_schedule(p_op, p);
end $$;
revoke all on function clinic_reception.fallback_api(text, jsonb) from public, anon, authenticated;

revoke all on function clinic_reception.masa_day_open(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function clinic_reception.fallback_slot_ok(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function clinic_reception.slot_busy(uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated;
revoke all on function clinic_reception.fallback_mark_sync(text, timestamptz) from public, anon, authenticated;
