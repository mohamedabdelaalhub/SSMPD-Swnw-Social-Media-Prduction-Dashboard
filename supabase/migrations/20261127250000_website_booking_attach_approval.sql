-- Website: «إرسال رقم موافقة التأمين» after booking (permanent page, WhatsApp agent). Service role only (called by the booking agent through an
-- edge function that checks the shared secret; the agent rate-limits per IP). ONE neutral answer for every failure so nobody can probe bookings.
--   matches booking_reference AND the phone (last 10 digits) AND a live booking (confirmed / rescheduled) not yet arrived, with a payer chosen
--   (insurance / membership / entity); stores approval_no + approval_at; returns true only when exactly one booking was updated.
-- Rollback: supabase/rollbacks/20261127250000_website_booking_attach_approval.rollback.sql
begin;
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customer_bookings' and column_name = 'approval_no') then
    raise exception 'طبّق 20261127230000 الأول'; end if;
  if to_regprocedure('public.website_booking_attach_approval(text,text,text)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create function public.website_booking_attach_approval(p_reference text, p_phone text, p_approval text) returns boolean
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
