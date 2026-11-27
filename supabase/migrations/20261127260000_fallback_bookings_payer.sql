-- Website payment step, outage path (owner 2026-11-27 «اعمله»): when Masa / the bridge is down the booking is parked in clinic_reception.fallback_bookings.
-- That row now carries the payment step too (payment_mode, contracting entity, the insurer's approval number + when it arrived), so nothing the patient
-- chose is lost, reception sees it on the fallback row (and copies the approval number into «رقم مرجع الموافقة» when registering the normal appointment),
-- and «إرسال رقم الموافقة» after booking also works for a parked booking (reference WEB-XXXXXXXX).
--   * 4 nullable columns on fallback_bookings (FK to contracting_entities).
--   * clinic_reception.fallback_api: outer wrapper (previous body kept as fallback_api_before_payer). op 'book' validates the optional payer fields BEFORE
--     booking (invalid -> {ok:false,error:'invalid_payer'}), then stores them on the new row. Every other op is passed through untouched.
--   * clinic_reception.fallback_row: outer wrapper (previous body kept as fallback_row_before_payer) adds the payer fields to the row the reception list reads.
--   * public.website_booking_attach_approval: now also matches a parked booking (WEB-<first 8 hex of booking_request_id>) + phone (last 10 digits).
-- Rollback: supabase/rollbacks/20261127260000_fallback_bookings_payer.rollback.sql
begin;
do $$ begin
  if to_regclass('clinic_reception.fallback_bookings') is null then raise exception 'clinic_reception.fallback_bookings غير موجود'; end if;
  if to_regprocedure('public.website_booking_attach_approval(text,text,text)') is null then raise exception 'طبّق 20261127250000 الأول'; end if;
  if to_regprocedure('clinic_reception.fallback_api_before_payer(text,jsonb)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

alter table clinic_reception.fallback_bookings
  add column payment_mode text check (payment_mode is null or payment_mode in ('direct', 'insurance', 'membership', 'entity')),
  add column payer_entity_id uuid references public.contracting_entities(id) on delete set null,
  add column approval_no text check (approval_no is null or length(approval_no) between 3 and 40),
  add column approval_at timestamptz;

alter function clinic_reception.fallback_row(clinic_reception.fallback_bookings) rename to fallback_row_before_payer;
revoke all on function clinic_reception.fallback_row_before_payer(clinic_reception.fallback_bookings) from public, anon, authenticated;
create function clinic_reception.fallback_row(f clinic_reception.fallback_bookings) returns jsonb language sql stable
security definer set search_path = pg_catalog, public as $$
  select clinic_reception.fallback_row_before_payer(f) || jsonb_build_object('payment_mode', f.payment_mode, 'payer_entity_id', f.payer_entity_id,
    'payer_entity_name', (select e.name from public.contracting_entities e where e.id = f.payer_entity_id), 'approval_no', f.approval_no, 'approval_at', f.approval_at)
$$;
revoke all on function clinic_reception.fallback_row(clinic_reception.fallback_bookings) from public, anon, authenticated;

alter function clinic_reception.fallback_api(text, jsonb) rename to fallback_api_before_payer;
revoke all on function clinic_reception.fallback_api_before_payer(text, jsonb) from public, anon, authenticated;
create function clinic_reception.fallback_api(p_op text, p jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare r jsonb; mode text; ent uuid; ap text; rid text;
begin
  p := coalesce(p, '{}');
  if p_op <> 'book' or nullif(p->>'payment_mode', '') is null then return clinic_reception.fallback_api_before_payer(p_op, p); end if;
  mode := p->>'payment_mode'; ap := nullif(btrim(coalesce(p->>'approval_no', '')), ''); rid := nullif(trim(p->>'booking_request_id'), '');
  begin ent := nullif(p->>'payer_entity_id', '')::uuid; exception when others then ent := null; end;
  if mode not in ('direct', 'insurance', 'membership', 'entity') or (mode <> 'direct' and (ent is null or not exists (select 1 from public.contracting_entities where id = ent)))
     or (mode = 'direct' and (ent is not null or ap is not null)) or (ap is not null and (mode <> 'insurance' or ap !~ '^[0-9A-Za-z\-/]{3,40}$')) then
    return jsonb_build_object('ok', false, 'error', 'invalid_payer');
  end if;
  r := clinic_reception.fallback_api_before_payer(p_op, p);
  if coalesce((r->>'ok')::boolean, false) and rid is not null then
    update clinic_reception.fallback_bookings set payment_mode = mode, payer_entity_id = ent, approval_no = ap, approval_at = case when ap is null then null else now() end
     where booking_request_id = rid;
  end if;
  return r;
end $$;
revoke all on function clinic_reception.fallback_api(text, jsonb) from public, anon, authenticated;

create or replace function public.website_booking_attach_approval(p_reference text, p_phone text, p_approval text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_ref text := nullif(btrim(coalesce(p_reference, '')), ''); v_ph text := right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 10);
        v_ap text := nullif(btrim(coalesce(p_approval, '')), ''); v_id uuid; v_n int; v_fid uuid; v_fn int;
begin
  if v_ref is null or length(v_ref) > 60 or length(v_ph) < 10 or v_ap is null or length(v_ap) not between 3 and 40 or v_ap !~ '^[0-9A-Za-z\-/]+$' then return false; end if;
  select count(*), min(id::text)::uuid into v_n, v_id from public.customer_bookings
   where booking_reference = v_ref and right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) = v_ph
     and status in ('confirmed', 'rescheduled') and payment_mode in ('insurance', 'membership', 'entity');
  select count(*), min(id::text)::uuid into v_fn, v_fid from clinic_reception.fallback_bookings
   where 'WEB-' || upper(left(replace(booking_request_id, '-', ''), 8)) = v_ref and right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) = v_ph
     and status in ('pending', 'replayed') and payment_mode in ('insurance', 'membership', 'entity');
  if v_n + v_fn <> 1 then return false; end if;
  if v_n = 1 then update public.customer_bookings set approval_no = v_ap, approval_at = now(), updated_at = now() where id = v_id;
  else update clinic_reception.fallback_bookings set approval_no = v_ap, approval_at = now() where id = v_fid; end if;
  return true;
end $$;
revoke all on function public.website_booking_attach_approval(text, text, text) from public, anon, authenticated;
grant execute on function public.website_booking_attach_approval(text, text, text) to service_role;
commit;
