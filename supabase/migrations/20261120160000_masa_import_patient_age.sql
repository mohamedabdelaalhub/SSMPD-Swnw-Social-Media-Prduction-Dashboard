-- Masa patient age (owner 2026-11-19 «١ ب» / «موافق على تعديل الجسر»). The first automatic-booking run left 39 of 93 Masa
-- bookings waiting for staff to type the age of a new patient: Masa did not send it. The bridge now returns the patient's
-- BirthDate and the WhatsApp agent sends patient_age (whole years on the booking date; null when unknown) in every
-- masa_import item. For patients the agent created in Masa it is the age they gave when booking.
-- * clinic_reception.masa_bookings.patient_age (null allowed).
-- * clinic_reception_fallback_api('masa_import'): after the unchanged import, stores patient_age on the Masa booking and on its
--   automatic-booking row; a booking waiting only for the age goes back to the queue (next 5-minute run opens the file).
--   No other op changes; booking-fallback (edge) is unchanged.
-- Rollback: supabase/rollbacks/20261120160000_masa_import_patient_age.rollback.sql
begin;

do $$ begin
  if to_regclass('clinic_reception.masa_bookings') is null or to_regclass('clinic_reception.external_bookings') is null
     or to_regprocedure('public.clinic_reception_fallback_api(text,jsonb)') is null then
    raise exception 'مكونات الحجز غير موجودة';
  end if;
  if to_regprocedure('clinic_reception.fallback_api_before_age(text,jsonb)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

alter table clinic_reception.masa_bookings add column if not exists patient_age int check (patient_age between 0 and 130);

do $$ begin
  alter function public.clinic_reception_fallback_api(text, jsonb) rename to fallback_api_before_age;
  alter function public.fallback_api_before_age(text, jsonb) set schema clinic_reception;
end $$;
revoke all on function clinic_reception.fallback_api_before_age(text, jsonb) from public, anon, authenticated;

create function public.clinic_reception_fallback_api(p_op text, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare r jsonb; it jsonb; oid text; v_age int;
begin
  r := clinic_reception.fallback_api_before_age(p_op, p_payload);
  if p_op = 'masa_import' and coalesce((r->>'ok')::boolean, true) and jsonb_typeof(p_payload->'items') = 'array' then
    for it in select value from jsonb_array_elements(p_payload->'items') loop
      oid := left(nullif(trim(it->>'official_booking_id'), ''), 80);
      v_age := case when coalesce(it->>'patient_age', '') ~ '^[0-9]{1,3}$' and (it->>'patient_age')::int <= 130 then (it->>'patient_age')::int end;
      if oid is null or v_age is null then continue; end if;
      update clinic_reception.masa_bookings set patient_age = v_age where official_booking_id = oid and patient_age is distinct from v_age;
      update clinic_reception.external_bookings e set age = v_age,
          state = case when e.state = 'review' and e.review_kind = 'age' then 'pending' else e.state end,
          reason = case when e.state = 'review' and e.review_kind = 'age' then null else e.reason end,
          review_kind = case when e.state = 'review' and e.review_kind = 'age' then null else e.review_kind end,
          updated_at = now()
        where e.source = 'masa' and e.external_id = oid and e.age is distinct from v_age and e.public_patient_id is null;
    end loop;
  end if;
  return r;
end $$;
revoke all on function public.clinic_reception_fallback_api(text, jsonb) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.clinic_reception_fallback_api(text, jsonb) to service_role;
  end if;
end $$;

commit;
