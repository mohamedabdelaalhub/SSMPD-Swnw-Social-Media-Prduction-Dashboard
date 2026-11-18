-- Rollback for 20261118170000_reception_fallback_reconcile.sql (restores the 20261117140000 behaviour).
-- Masa imports and alerts are dropped; they are copies/notes only (the bookings themselves live in Masa).
drop function if exists public.clinic_reception_fallback(uuid,text,jsonb);
alter function clinic_reception.fallback_before_reconcile(uuid,text,jsonb) set schema public;
alter function public.fallback_before_reconcile(uuid,text,jsonb) rename to clinic_reception_fallback;
revoke all on function public.clinic_reception_fallback(uuid,text,jsonb) from public, anon;
grant execute on function public.clinic_reception_fallback(uuid,text,jsonb) to authenticated;
drop function if exists clinic_reception.fallback_api(text,jsonb);
alter function clinic_reception.fallback_api_before_reconcile(text,jsonb) rename to fallback_api;
revoke all on function clinic_reception.fallback_api(text,jsonb) from public, anon, authenticated;
create or replace function clinic_reception.slot_busy(p_provider uuid, p_start timestamptz, p_end timestamptz, p_skip uuid default null)
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from clinic_reception.appointments a where a.provider_id = p_provider
                   and a.status not in ('cancelled','no_show') and a.starts_at < p_end + clinic_reception.provider_gap(p_provider) and a.ends_at + clinic_reception.provider_gap(p_provider) > p_start)
      or exists (select 1 from clinic_reception.fallback_bookings f where f.provider_id = p_provider
                   and clinic_reception.fallback_holds(f) and f.starts_at < p_end + clinic_reception.provider_gap(p_provider) and f.ends_at + clinic_reception.provider_gap(p_provider) > p_start and f.id is distinct from p_skip)
$$;
revoke all on function clinic_reception.slot_busy(uuid,timestamptz,timestamptz,uuid) from public, anon, authenticated;
drop function if exists clinic_reception.agent_booking_start(date,text);
drop table if exists clinic_reception.fallback_alerts;
drop table if exists clinic_reception.masa_bookings;
drop index if exists public.customer_bookings_official_idx;
drop index if exists public.customer_bookings_masa_doctor_idx;
-- Redeploy the previous booking-sync-ingest BEFORE dropping the column, or new agent bookings fail to sync:
alter table public.customer_bookings drop column if exists masa_doctor_id;
-- public.customer_bookings is kept (it existed before; the migration only guarded its creation).
