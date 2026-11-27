-- Rollback of 20261127260000_fallback_bookings_payer.sql (payer values on parked bookings are dropped with the columns).
begin;
drop function if exists clinic_reception.fallback_api(text, jsonb);
alter function clinic_reception.fallback_api_before_payer(text, jsonb) rename to fallback_api;
drop function if exists clinic_reception.fallback_row(clinic_reception.fallback_bookings);
alter function clinic_reception.fallback_row_before_payer(clinic_reception.fallback_bookings) rename to fallback_row;
alter table clinic_reception.fallback_bookings drop column if exists approval_at, drop column if exists approval_no, drop column if exists payer_entity_id, drop column if exists payment_mode;
create or replace function public.website_booking_attach_approval(p_reference text, p_phone text, p_approval text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_ref text := nullif(btrim(coalesce(p_reference, '')), ''); v_ph text := right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 10);
        v_ap text := nullif(btrim(coalesce(p_approval, '')), ''); v_id uuid; v_n int;
begin
  if v_ref is null or length(v_ref) > 60 or length(v_ph) < 10 or v_ap is null or length(v_ap) not between 3 and 40 or v_ap !~ '^[0-9A-Za-z\-/]+$' then return false; end if;
  select count(*), min(id::text)::uuid into v_n, v_id from public.customer_bookings
   where booking_reference = v_ref and right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) = v_ph
     and status in ('confirmed', 'rescheduled') and payment_mode in ('insurance', 'membership', 'entity');
  if v_n <> 1 then return false; end if;
  update public.customer_bookings set approval_no = v_ap, approval_at = now(), updated_at = now() where id = v_id;
  return true;
end $$;
revoke all on function public.website_booking_attach_approval(text, text, text) from public, anon, authenticated;
grant execute on function public.website_booking_attach_approval(text, text, text) to service_role;
commit;
