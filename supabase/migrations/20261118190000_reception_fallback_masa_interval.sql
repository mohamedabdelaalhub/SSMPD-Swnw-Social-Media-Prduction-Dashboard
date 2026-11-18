-- Fallback slots match Masa exactly (WhatsApp-agent chat's live comparison, 2026-11-18, for the owner):
-- 1. Per Masa doctor id: «داليا سعيد» is Masa 1130 (dermatology) and 1132 (orthodontics) on ONE dashboard provider.
--    Slots and book for a Masa id now use only THAT id's Masa days (before: any id of the provider opened the day).
-- 2. Step = Masa interval. Masa's DDoctor.Interval is the FULL step (owner rule: 20 = 15 visit + 5 gap). masa_schedule
--    days may carry interval_minutes; then fallback slots start at the Masa day start and step by that interval, and
--    a fallback booking lasts interval − provider gap, so the next Masa time stays free (no 25-minute steps, no
--    times Masa does not have). book refuses a time off that grid. Days without interval_minutes keep the old way.
-- 3. Masa-sourced bookings block 15 + gap = one Masa step (see slot_busy below).
begin;

alter table clinic_reception.masa_schedule_days add column if not exists interval_min int check (interval_min between 5 and 240);

-- Restrict the Masa-day check to one Masa id while a request for that id runs (transaction-local setting).
create or replace function clinic_reception.masa_day_open(p_provider uuid, p_start timestamptz, p_end timestamptz)
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select not exists (select 1 from clinic_reception.fallback_sync_state where key = 'schedule')
      or exists (select 1 from clinic_reception.masa_schedule_days d
                   join clinic_reception.masa_doctor_links k on k.masa_doctor_id = d.masa_doctor_id and k.provider_id = p_provider
                  where d.day = (p_start at time zone 'Africa/Cairo')::date
                    and (coalesce(current_setting('swnw.fallback_masa_id', true), '') = '' or d.masa_doctor_id::text = current_setting('swnw.fallback_masa_id', true))
                    and (d.day + d.starts) at time zone 'Africa/Cairo' <= p_start
                    and (d.day + case when d.ends = time '00:00' then interval '24 hours' else d.ends - time '00:00' end) at time zone 'Africa/Cairo' >= p_end)
$$;
revoke all on function clinic_reception.masa_day_open(uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- Masa-sourced bookings (Masa imports, agent bookings) occupy one Masa step: 15-minute visit + the provider gap
-- = 20, so the next Masa time stays free (was 20 + gap = 25). Same text as 20261118180000 otherwise; provider_gap ×8.
create or replace function clinic_reception.slot_busy(p_provider uuid, p_start timestamptz, p_end timestamptz, p_skip uuid default null)
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from clinic_reception.appointments a where a.provider_id = p_provider
                   and a.status not in ('cancelled','no_show') and a.starts_at < p_end + clinic_reception.provider_gap(p_provider) and a.ends_at + clinic_reception.provider_gap(p_provider) > p_start)
      or exists (select 1 from clinic_reception.fallback_bookings f where f.provider_id = p_provider
                   and clinic_reception.fallback_holds(f) and f.starts_at < p_end + clinic_reception.provider_gap(p_provider) and f.ends_at + clinic_reception.provider_gap(p_provider) > p_start and f.id is distinct from p_skip)
      or exists (select 1 from clinic_reception.masa_bookings m where m.provider_id = p_provider and m.status = 'active'
                   and m.starts_at < p_end + clinic_reception.provider_gap(p_provider) and least(m.ends_at, m.starts_at + interval '15 minutes') + clinic_reception.provider_gap(p_provider) > p_start)
      or exists (select 1 from public.customer_bookings c join clinic_reception.masa_doctor_links k on k.masa_doctor_id = c.masa_doctor_id
                  where k.provider_id = p_provider and c.status in ('confirmed','rescheduled')
                    and not exists (select 1 from clinic_reception.masa_cancelled_bookings x where x.official_booking_id = c.official_booking_id)
                    and c.appointment_date between (p_start at time zone 'Africa/Cairo')::date - 1 and (p_end at time zone 'Africa/Cairo')::date
                    and clinic_reception.agent_booking_start(c.appointment_date, c.appointment_time) < p_end + clinic_reception.provider_gap(p_provider)
                    and clinic_reception.agent_booking_start(c.appointment_date, c.appointment_time) + interval '15 minutes' + clinic_reception.provider_gap(p_provider) > p_start)
$$;

revoke all on function clinic_reception.slot_busy(uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated;

do $$ begin
  if to_regprocedure('clinic_reception.fallback_api_before_interval(text,jsonb)') is null then
    alter function clinic_reception.fallback_api(text, jsonb) rename to fallback_api_before_interval;
  end if;
end $$;
revoke all on function clinic_reception.fallback_api_before_interval(text, jsonb) from public, anon, authenticated;

create or replace function clinic_reception.fallback_api(p_op text, p jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare r jsonb; mid int; l clinic_reception.masa_doctor_links; pr clinic_reception.providers; d0 date; nd int; gap interval;
  row_ record; t timestamptz; dend timestamptz; visit interval; out jsonb := '[]'; cnt int := 0; it jsonb; n int;
begin
  p := coalesce(p, '{}');

  if p_op = 'masa_schedule' then
    if jsonb_typeof(p->'days') = 'array' then
      for it in select value from jsonb_array_elements(p->'days') loop
        if it ? 'interval_minutes' and coalesce(it->>'interval_minutes', '') !~ '^\d{1,3}$' then
          return jsonb_build_object('ok', false, 'error', 'invalid_day', 'item', it);
        end if;
        if nullif(it->>'interval_minutes', '')::int not between 5 and 240 then
          return jsonb_build_object('ok', false, 'error', 'invalid_day', 'item', it);
        end if;
      end loop;
    end if;
    r := clinic_reception.fallback_api_before_interval(p_op, p);
    if coalesce((r->>'ok')::boolean, false) then
      update clinic_reception.masa_schedule_days d set interval_min = x.iv
        from (select (e->>'masa_doctor_id')::int mid, (e->>'date')::date dy, (e->>'start')::time st, max(nullif(e->>'interval_minutes', '')::int) iv
                from jsonb_array_elements(p->'days') e group by 1, 2, 3) x
       where d.masa_doctor_id = x.mid and d.day = x.dy and d.starts = x.st;
    end if;
    return r;
  end if;

  if p_op not in ('slots','book') or nullif(p->>'masa_doctor_id', '') is null or (p->>'masa_doctor_id') !~ '^\d{1,9}$' then
    return clinic_reception.fallback_api_before_interval(p_op, p);
  end if;

  mid := (p->>'masa_doctor_id')::int;
  perform set_config('swnw.fallback_masa_id', mid::text, true);
  select * into l from clinic_reception.masa_doctor_links where masa_doctor_id = mid;
  if found and l.provider_id is not null then select * into pr from clinic_reception.providers where id = l.provider_id; end if;
  gap := case when pr.id is not null then clinic_reception.provider_gap(pr.id) else interval '0' end;

  if p_op = 'book' and pr.id is not null then
    t := case when nullif(p->>'starts_at', '') is not null then (p->>'starts_at')::timestamptz
              when nullif(p->>'appointment_date', '') is not null and coalesce(p->>'appointment_time', '') ~ '^\d{1,2}:\d{2}' then
                ((p->>'appointment_date')::date + (p->>'appointment_time')::time) at time zone 'Africa/Cairo' end;
    if t is not null then
      select d.* into row_ from clinic_reception.masa_schedule_days d
       where d.masa_doctor_id = mid and d.day = (t at time zone 'Africa/Cairo')::date and d.interval_min is not null
         and (d.day + d.starts) at time zone 'Africa/Cairo' <= t
         and (d.day + case when d.ends = time '00:00' then interval '24 hours' else d.ends - time '00:00' end) at time zone 'Africa/Cairo' > t
       order by d.starts limit 1;
      if found then
        if (extract(epoch from t - (row_.day + row_.starts) at time zone 'Africa/Cairo')::bigint / 60) % row_.interval_min <> 0 then
          perform set_config('swnw.fallback_masa_id', '', true);
          return jsonb_build_object('ok', false, 'error', 'slot_unavailable', 'detail', 'off_masa_grid');
        end if;
        if nullif(p->>'minutes', '') is null then
          p := p || jsonb_build_object('minutes', greatest(row_.interval_min - (extract(epoch from gap) / 60)::int, 5));
        end if;
      end if;
    end if;
  end if;

  r := clinic_reception.fallback_api_before_interval(p_op, p);

  if p_op = 'slots' and coalesce((r->>'ok')::boolean, false) and pr.id is not null then
    d0 := coalesce(nullif(p->>'date_from', '')::date, (now() at time zone 'Africa/Cairo')::date);
    nd := least(greatest(coalesce(nullif(p->>'days', '')::int, 7), 1), 14);
    select count(*) into n from clinic_reception.masa_schedule_days where masa_doctor_id = mid and day between d0 and d0 + nd - 1 and interval_min is null;
    if n = 0 and exists (select 1 from clinic_reception.masa_schedule_days where masa_doctor_id = mid and day between d0 and d0 + nd - 1) then
      for row_ in select * from clinic_reception.masa_schedule_days where masa_doctor_id = mid and day between d0 and d0 + nd - 1 order by day, starts loop
        visit := make_interval(mins => greatest(row_.interval_min - (extract(epoch from gap) / 60)::int, 5));
        t := (row_.day + row_.starts) at time zone 'Africa/Cairo';
        dend := (row_.day + case when row_.ends = time '00:00' then interval '24 hours' else row_.ends - time '00:00' end) at time zone 'Africa/Cairo';
        while t + visit <= dend and cnt < 300 loop
          if clinic_reception.fallback_slot_ok(pr.id, t, t + visit) and not clinic_reception.slot_busy(pr.id, t, t + visit) then
            out := out || jsonb_build_object('starts_at', t, 'appointment_date', to_char(t at time zone 'Africa/Cairo', 'YYYY-MM-DD'),
                                             'appointment_time', to_char(t at time zone 'Africa/Cairo', 'HH24:MI'), 'interval_minutes', row_.interval_min);
            cnt := cnt + 1;
          end if;
          t := t + make_interval(mins => row_.interval_min);
        end loop;
      end loop;
      r := r || jsonb_build_object('slots', out, 'slot_minutes', null, 'step', 'masa_interval');
    end if;
  end if;

  perform set_config('swnw.fallback_masa_id', '', true);
  return r;
end $$;
revoke all on function clinic_reception.fallback_api(text, jsonb) from public, anon, authenticated;

commit;
