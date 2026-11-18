-- Rollback for 20261118190000_reception_fallback_masa_interval.sql (restores the 20261118180000 behaviour).
begin;
drop function if exists clinic_reception.fallback_api(text,jsonb);
alter function clinic_reception.fallback_api_before_interval(text,jsonb) rename to fallback_api;
revoke all on function clinic_reception.fallback_api(text,jsonb) from public, anon, authenticated;
create or replace function clinic_reception.masa_day_open(p_provider uuid, p_start timestamptz, p_end timestamptz)
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select not exists (select 1 from clinic_reception.fallback_sync_state where key = 'schedule')
      or exists (select 1 from clinic_reception.masa_schedule_days d
                   join clinic_reception.masa_doctor_links k on k.masa_doctor_id = d.masa_doctor_id and k.provider_id = p_provider
                  where d.day = (p_start at time zone 'Africa/Cairo')::date
                    and (d.day + d.starts) at time zone 'Africa/Cairo' <= p_start
                    and (d.day + case when d.ends = time '00:00' then interval '24 hours' else d.ends - time '00:00' end) at time zone 'Africa/Cairo' >= p_end)
$$;
revoke all on function clinic_reception.masa_day_open(uuid,timestamptz,timestamptz) from public, anon, authenticated;
create or replace function clinic_reception.slot_busy(p_provider uuid, p_start timestamptz, p_end timestamptz, p_skip uuid default null)
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from clinic_reception.appointments a where a.provider_id = p_provider
                   and a.status not in ('cancelled','no_show') and a.starts_at < p_end + clinic_reception.provider_gap(p_provider) and a.ends_at + clinic_reception.provider_gap(p_provider) > p_start)
      or exists (select 1 from clinic_reception.fallback_bookings f where f.provider_id = p_provider
                   and clinic_reception.fallback_holds(f) and f.starts_at < p_end + clinic_reception.provider_gap(p_provider) and f.ends_at + clinic_reception.provider_gap(p_provider) > p_start and f.id is distinct from p_skip)
      or exists (select 1 from clinic_reception.masa_bookings m where m.provider_id = p_provider and m.status = 'active'
                   and m.starts_at < p_end + clinic_reception.provider_gap(p_provider) and m.ends_at + clinic_reception.provider_gap(p_provider) > p_start)
      or exists (select 1 from public.customer_bookings c join clinic_reception.masa_doctor_links k on k.masa_doctor_id = c.masa_doctor_id
                  where k.provider_id = p_provider and c.status in ('confirmed','rescheduled')
                    and not exists (select 1 from clinic_reception.masa_cancelled_bookings x where x.official_booking_id = c.official_booking_id)
                    and c.appointment_date between (p_start at time zone 'Africa/Cairo')::date - 1 and (p_end at time zone 'Africa/Cairo')::date
                    and clinic_reception.agent_booking_start(c.appointment_date, c.appointment_time) < p_end + clinic_reception.provider_gap(p_provider)
                    and clinic_reception.agent_booking_start(c.appointment_date, c.appointment_time) + interval '20 minutes' + clinic_reception.provider_gap(p_provider) > p_start)
$$;

revoke all on function clinic_reception.slot_busy(uuid,timestamptz,timestamptz,uuid) from public, anon, authenticated;
alter table clinic_reception.masa_schedule_days drop column if exists interval_min;
commit;
