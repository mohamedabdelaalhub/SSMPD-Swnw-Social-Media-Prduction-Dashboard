-- Patient-portal bookings become REQUESTS that reception confirms (owner: «موافق علي الكل»).
-- The portal no longer books in the official system directly: it stores a pending request here;
-- only reception's «تأكيد» (patient-portal-booking staff_confirm) creates the official booking via
-- the bridge. At most 2 open requests/bookings per patient (pending, or confirmed for today/future),
-- enforced here under a per-patient lock so two quick taps cannot exceed it.
-- Access: service_role only (edge function). No client policies.

begin;

create table if not exists public.patient_portal_booking_requests (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references public.patient_accounts(id) on delete restrict,
  patient_id          uuid not null references public.patients(id) on delete cascade,
  doctor_id           text not null,           -- portal catalog id (doc_…)
  doctor_name         text,
  specialty_id        text,
  specialty_name      text,
  requested_date      date not null,
  requested_time      text not null check (requested_time ~ '^\d{2}:\d{2}$'),
  status              text not null default 'pending' check (status in
                        ('pending','confirming','confirmed','cancelled_by_patient','cancelled_by_staff','slot_unavailable')),
  official_booking_id text,
  booking_request_id  text,
  last_error          text,
  staff_note          text,
  reviewed_by         uuid references public.admins(id),
  reviewed_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists ppbr_status_idx on public.patient_portal_booking_requests (status, created_at desc);
create index if not exists ppbr_patient_idx on public.patient_portal_booking_requests (patient_id, created_at desc);
create unique index if not exists ppbr_one_open_per_slot
  on public.patient_portal_booking_requests (patient_id, doctor_id, requested_date, requested_time)
  where status in ('pending','confirming','confirmed');

alter table public.patient_portal_booking_requests enable row level security;
revoke all on table public.patient_portal_booking_requests from public, anon, authenticated;

create or replace function public.ppbr_enforce_limit()
returns trigger language plpgsql set search_path = public as $$
declare v_open integer;
begin
  if tg_op = 'UPDATE' and new.status = old.status then
    new.updated_at := now();
    return new;
  end if;
  if new.status in ('pending','confirming','confirmed') and (tg_op = 'INSERT' or old.status not in ('pending','confirming','confirmed')) then
    perform pg_advisory_xact_lock(hashtextextended('ppbr:' || new.patient_id::text, 0));
    select count(*) into v_open from public.patient_portal_booking_requests r
     where r.patient_id = new.patient_id and r.id <> new.id
       and (r.status in ('pending','confirming')
            or (r.status = 'confirmed' and r.requested_date >= (now() at time zone 'Africa/Cairo')::date));
    if v_open >= 2 then
      raise exception 'PORTAL_BOOKING_LIMIT' using errcode = 'P0001';
    end if;
  end if;
  new.updated_at := now();
  return new;
end
$$;
drop trigger if exists ppbr_enforce_limit on public.patient_portal_booking_requests;
create trigger ppbr_enforce_limit before insert or update on public.patient_portal_booking_requests
  for each row execute function public.ppbr_enforce_limit();
revoke all on function public.ppbr_enforce_limit() from public, anon, authenticated;

commit;
