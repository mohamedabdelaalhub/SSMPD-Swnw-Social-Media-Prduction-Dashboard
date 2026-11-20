-- «نقل أرشيف ماسا للداشبورد» (owner 2026-11-20/21: «موافق نكمل مراحل المرضى والحجوزات والتحصيل القديم لو دا مش هيأثر علي التسجيل علي
-- السيستم ماسا الحالي»). The old branch's data (database HospitalOLD, 2024-01 .. 2026-03-08, same Masa server) and the current
-- database's history are copied here by the WhatsApp agent's one-time, manual backfill through booking-fallback.
-- NOTHING LIVE IS TOUCHED: this adds two separate archive tables and two new ops. The 3-minute mirror (masa_import), the
-- fallback slots, the queue, the automatic booking and the live payments feed (masa_payments_import) are not changed.
--   * op masa_patients_import {source:'current'|'old', items:[{masa_patient_id, name, phone, phone2, phone3, birth_date|null,
--       birth_date_flag, national_id_hash|null, insurance_id, insurance_name, insurance_no, address, job, relative_name,
--       relative_phone, membership_no, membership_start, membership_end, price_list_id, discount_percent, is_blocked, is_deleted,
--       masa_created_at}]}  -> clinic_reception.masa_patients, key (source, masa_patient_id). A staging copy: it is NOT merged into
--       public.patients here (matching by phone + name needs review first; 353 phones are shared by families). The national id
--       arrives only as a salted hash and the raw number is never accepted. Gender is not accepted (unfilled in Masa).
--   * op masa_archive_import {source, items:[{official_booking_id, masa_doctor_id, masa_specialization_id, appointment_date,
--       appointment_time, status, booking_state_id, needed_service, patient_name, phone, patient_birth_date}]}
--       -> clinic_reception.masa_archive_bookings, key (source, official_booking_id): history only (no notification, no queue,
--       no fallback slot, no automatic booking).
--   * Old finance rows reuse masa_payments_import unchanged: the agent prefixes old ids with 'old:' (receipt, invoice and booking
--       ids) so they cannot collide with the current database's ids, and sends no payment_types for the old source.
-- Rollback: supabase/rollbacks/20261120310000_masa_archive_import.rollback.sql
begin;

do $$ begin
  if to_regprocedure('public.clinic_reception_fallback_api(text,jsonb)') is null or to_regclass('clinic_reception.masa_bookings') is null
     or to_regprocedure('clinic_finance.masa_int(jsonb)') is null or to_regprocedure('clinic_finance.masa_local_ts(text)') is null then
    raise exception 'مكونات الحجز أو تحصيل ماسا غير موجودة';
  end if;
  if to_regclass('clinic_reception.masa_patients') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create function clinic_reception.masa_phone_norm(v text) returns text language sql immutable as $$
  select case
    when d ~ '^20(1[0-9]{9})$' then '0' || substr(d, 3)
    when d ~ '^1[0-9]{9}$' then '0' || d
    when d = '' then null
    else d end
  from (select regexp_replace(coalesce(v, ''), '[^0-9]', '', 'g') as d) q
$$;

create table clinic_reception.masa_patients(
  source text not null check (source in ('current', 'old')),
  masa_patient_id text not null check (length(masa_patient_id) between 1 and 40),
  name text, phone text, phone2 text, phone3 text, phone_normalized text,
  birth_date date, birth_date_flag boolean not null default false, national_id_hash text check (national_id_hash is null or national_id_hash ~ '^[0-9a-f]{64}$'),
  insurance_id int, insurance_name text, insurance_no text, address text, job text, relative_name text, relative_phone text,
  membership_no text, membership_start date, membership_end date, price_list_id int, discount_percent numeric(7,2),
  is_blocked boolean not null default false, is_deleted boolean not null default false, masa_created_at timestamptz,
  patient_id uuid references public.patients(id),
  first_seen_at timestamptz not null default now(), synced_at timestamptz not null default now(),
  primary key (source, masa_patient_id));
create index on clinic_reception.masa_patients(phone_normalized);
create index on clinic_reception.masa_patients(national_id_hash) where national_id_hash is not null;

create table clinic_reception.masa_archive_bookings(
  source text not null check (source in ('current', 'old')),
  official_booking_id text not null check (length(official_booking_id) between 1 and 80),
  masa_doctor_id int, masa_specialization_id int, appointment_date date not null, appointment_time text,
  status text not null default 'active' check (status in ('active', 'cancelled')), needed_service text,
  booking_state_id int, patient_name text, phone text, phone_normalized text, patient_birth_date date,
  first_seen_at timestamptz not null default now(), synced_at timestamptz not null default now(),
  primary key (source, official_booking_id));
create index on clinic_reception.masa_archive_bookings(appointment_date);
create index on clinic_reception.masa_archive_bookings(phone_normalized);

alter table clinic_reception.masa_patients enable row level security;
alter table clinic_reception.masa_archive_bookings enable row level security;
revoke all on clinic_reception.masa_patients, clinic_reception.masa_archive_bookings from public, anon, authenticated;

create function clinic_reception.masa_d(v text) returns date language plpgsql immutable as $$
begin
  if coalesce(v, '') ~ '^\d{4}-\d{2}-\d{2}' then return left(v, 10)::date; end if;
  return null;
exception when others then return null;
end $$;

create function clinic_reception.masa_patients_import(p jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare it jsonb; src text; pid text; n int := 0; sk int := 0; bd date;
begin
  if jsonb_typeof(p) <> 'object' then return jsonb_build_object('ok', false, 'error', 'payload_required'); end if;
  src := p->>'source';
  if src is null or src not in ('current', 'old') then return jsonb_build_object('ok', false, 'error', 'source_required'); end if;
  if coalesce(jsonb_typeof(p->'items'), '') <> 'array' then return jsonb_build_object('ok', false, 'error', 'items_required'); end if;
  if jsonb_array_length(p->'items') > 1000 then return jsonb_build_object('ok', false, 'error', 'too_many_items'); end if;
  for it in select value from jsonb_array_elements(p->'items') loop
    pid := left(nullif(trim(it->>'masa_patient_id'), ''), 40);
    if pid is null then sk := sk + 1; continue; end if;
    bd := clinic_reception.masa_d(it->>'birth_date');
    if bd is not null and (bd > (now() at time zone 'Africa/Cairo')::date or bd < date '1900-01-01') then bd := null; end if;
    insert into clinic_reception.masa_patients as x(source, masa_patient_id, name, phone, phone2, phone3, phone_normalized, birth_date, birth_date_flag,
        national_id_hash, insurance_id, insurance_name, insurance_no, address, job, relative_name, relative_phone, membership_no, membership_start,
        membership_end, price_list_id, discount_percent, is_blocked, is_deleted, masa_created_at)
      values (src, pid, left(nullif(trim(it->>'name'), ''), 180), left(nullif(trim(it->>'phone'), ''), 40), left(nullif(trim(it->>'phone2'), ''), 40),
        left(nullif(trim(it->>'phone3'), ''), 40), clinic_reception.masa_phone_norm(it->>'phone'), bd,
        coalesce((it->>'birth_date_flag')::boolean, false) or (bd is null and coalesce(it->>'birth_date', '') <> ''),
        case when coalesce(it->>'national_id_hash', '') ~ '^[0-9a-f]{64}$' then it->>'national_id_hash' end,
        clinic_finance.masa_int(it->'insurance_id'), left(nullif(trim(it->>'insurance_name'), ''), 120), left(nullif(trim(it->>'insurance_no'), ''), 60),
        left(nullif(trim(it->>'address'), ''), 300), left(nullif(trim(it->>'job'), ''), 120), left(nullif(trim(it->>'relative_name'), ''), 180),
        left(nullif(trim(it->>'relative_phone'), ''), 40), left(nullif(trim(it->>'membership_no'), ''), 60), clinic_reception.masa_d(it->>'membership_start'),
        clinic_reception.masa_d(it->>'membership_end'), clinic_finance.masa_int(it->'price_list_id'),
        case when jsonb_typeof(it->'discount_percent') = 'number' then (it->>'discount_percent')::numeric(7,2) end,
        coalesce((it->>'is_blocked')::boolean, false), coalesce((it->>'is_deleted')::boolean, false), clinic_finance.masa_local_ts(it->>'masa_created_at'))
      on conflict (source, masa_patient_id) do update set name = excluded.name, phone = excluded.phone, phone2 = excluded.phone2, phone3 = excluded.phone3,
        phone_normalized = excluded.phone_normalized, birth_date = excluded.birth_date, birth_date_flag = excluded.birth_date_flag,
        national_id_hash = coalesce(excluded.national_id_hash, x.national_id_hash), insurance_id = excluded.insurance_id, insurance_name = excluded.insurance_name,
        insurance_no = excluded.insurance_no, address = excluded.address, job = excluded.job, relative_name = excluded.relative_name,
        relative_phone = excluded.relative_phone, membership_no = excluded.membership_no, membership_start = excluded.membership_start,
        membership_end = excluded.membership_end, price_list_id = excluded.price_list_id, discount_percent = excluded.discount_percent,
        is_blocked = excluded.is_blocked, is_deleted = excluded.is_deleted, masa_created_at = excluded.masa_created_at, synced_at = now();
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'upserted', n, 'skipped', sk);
end $$;
revoke all on function clinic_reception.masa_patients_import(jsonb) from public, anon, authenticated;

create function clinic_reception.masa_archive_import(p jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare it jsonb; src text; oid text; d date; n int := 0; sk int := 0;
begin
  if jsonb_typeof(p) <> 'object' then return jsonb_build_object('ok', false, 'error', 'payload_required'); end if;
  src := p->>'source';
  if src is null or src not in ('current', 'old') then return jsonb_build_object('ok', false, 'error', 'source_required'); end if;
  if coalesce(jsonb_typeof(p->'items'), '') <> 'array' then return jsonb_build_object('ok', false, 'error', 'items_required'); end if;
  if jsonb_array_length(p->'items') > 1000 then return jsonb_build_object('ok', false, 'error', 'too_many_items'); end if;
  for it in select value from jsonb_array_elements(p->'items') loop
    oid := left(nullif(trim(it->>'official_booking_id'), ''), 80);
    d := clinic_reception.masa_d(it->>'appointment_date');
    if oid is null or d is null then sk := sk + 1; continue; end if;
    insert into clinic_reception.masa_archive_bookings as x(source, official_booking_id, masa_doctor_id, masa_specialization_id, appointment_date, appointment_time,
        status, booking_state_id, needed_service, patient_name, phone, phone_normalized, patient_birth_date)
      values (src, oid, clinic_finance.masa_int(it->'masa_doctor_id'), clinic_finance.masa_int(it->'masa_specialization_id'), d,
        left(nullif(trim(it->>'appointment_time'), ''), 8), case when lower(coalesce(it->>'status', '')) = 'cancelled' then 'cancelled' else 'active' end, clinic_finance.masa_int(it->'booking_state_id'),
        left(nullif(trim(it->>'needed_service'), ''), 200), left(nullif(trim(it->>'patient_name'), ''), 180), left(nullif(trim(it->>'phone'), ''), 40),
        clinic_reception.masa_phone_norm(it->>'phone'), clinic_reception.masa_d(it->>'patient_birth_date'))
      on conflict (source, official_booking_id) do update set masa_doctor_id = excluded.masa_doctor_id, masa_specialization_id = excluded.masa_specialization_id,
        appointment_date = excluded.appointment_date, appointment_time = excluded.appointment_time, status = excluded.status, booking_state_id = excluded.booking_state_id,
        needed_service = excluded.needed_service, patient_name = excluded.patient_name, phone = excluded.phone, phone_normalized = excluded.phone_normalized,
        patient_birth_date = excluded.patient_birth_date, synced_at = now();
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'upserted', n, 'skipped', sk);
end $$;
revoke all on function clinic_reception.masa_archive_import(jsonb) from public, anon, authenticated;

do $$ begin
  alter function public.clinic_reception_fallback_api(text, jsonb) rename to fallback_api_before_archive;
  alter function public.fallback_api_before_archive(text, jsonb) set schema clinic_reception;
end $$;
revoke all on function clinic_reception.fallback_api_before_archive(text, jsonb) from public, anon, authenticated;
create function public.clinic_reception_fallback_api(p_op text, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if p_op = 'masa_patients_import' then return clinic_reception.masa_patients_import(coalesce(p_payload, '{}')); end if;
  if p_op = 'masa_archive_import' then return clinic_reception.masa_archive_import(coalesce(p_payload, '{}')); end if;
  return clinic_reception.fallback_api_before_archive(p_op, p_payload);
end $$;
revoke all on function public.clinic_reception_fallback_api(text, jsonb) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.clinic_reception_fallback_api(text, jsonb) to service_role;
  end if;
end $$;

commit;
