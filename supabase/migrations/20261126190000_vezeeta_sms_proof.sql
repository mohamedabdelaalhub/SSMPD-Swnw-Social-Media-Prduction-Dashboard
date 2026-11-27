-- «لصق رسالة فيزيتا» (owner approved the mockup 2026-11-26 «موافق على شكل فيزيتا», docs/ui-references/mockups/vezeeta-paste-booking.html):
-- «فيزيتا شامل» has NO physical card — the booking SMS Vezeeta sends to the center's phone is the proof. A booking discount of kind
-- 'vezeeta' (40%) can now carry the pasted message (discount_proof_text) INSTEAD of card number / valid-until / photo.
-- The server re-validates the proof: it must say «Shamel», carry the patient's phone (last 10 digits of the archive phone, else the
-- reception file's phone) and the branch «Hadayek El-Ahram»; ≤ 1000 characters. Stored with who / when (discount_proof_by / _at).
-- The card path (number + valid until + photo) still works unchanged. Same exclusions as before (booked only, no package, no offer).
-- Wrapper on clinic_reception.set_booking_discount (book / walk-in / reschedule / «خصم على الحجز»); previous kept as
-- clinic_reception.set_booking_discount_before_vezeeta_sms. Rollback: supabase/rollbacks/20261126190000_vezeeta_sms_proof.rollback.sql
do $$ begin
  if to_regprocedure('clinic_reception.set_booking_discount(uuid,uuid,jsonb,uuid)') is null then raise exception 'خصومات الحجز مش موجودة'; end if;
  if to_regprocedure('clinic_reception.set_booking_discount_before_vezeeta_sms(uuid,uuid,jsonb,uuid)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;
begin;

alter table clinic_reception.appointments add column discount_proof_text text, add column discount_proof_by uuid references public.admins(id),
  add column discount_proof_at timestamptz;

-- vezeeta: card number + valid until + (photo OR the pasted Vezeeta message); other kinds unchanged (as of 20261126170000)
alter table clinic_reception.appointments drop constraint appointments_discount_complete;
alter table clinic_reception.appointments add constraint appointments_discount_complete check (
  discount_kind is null
  or (discount_kind = 'syndicate' and discount_percent is not null and discount_org_type is not null
      and length(btrim(coalesce(discount_org_name, ''))) >= 2 and length(btrim(coalesce(discount_card_no, ''))) >= 2
      and discount_card_expiry is not null and length(coalesce(discount_card_path, '')) > 3)
  or (discount_kind = 'special' and discount_percent is not null and length(btrim(coalesce(discount_reason, ''))) >= 3)
  or (discount_kind = 'vezeeta' and discount_percent = 40 and length(btrim(coalesce(discount_card_no, ''))) >= 2
      and discount_card_expiry is not null and (length(coalesce(discount_card_path, '')) > 3 or length(coalesce(discount_proof_text, '')) >= 20))
  or (discount_kind = 'family' and discount_percent between 10 and 50)
  or (discount_kind = 'staff' and discount_percent is not null and discount_staff_id is not null and length(btrim(coalesce(discount_reason, ''))) >= 3));

create function clinic_reception.vezeeta_sms_ok(p_text text, p_patient uuid) returns text
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare t text := btrim(coalesce(p_text, '')); ph text;
begin
  if length(t) < 20 or length(t) > 1000 then raise exception 'الصق رسالة فيزيتا كاملة'; end if;
  if t !~* 'shamel' then raise exception 'الرسالة دي مش «فيزيتا شامل» — خصم فيزيتا شامل محتاج رسالة شامل أو الكارت'; end if;
  if t !~* 'hadayek' then raise exception 'الرسالة دي لفرع تاني — مش بتتحجز هنا'; end if;
  select right(regexp_replace(coalesce(nullif(btrim(ar.phone), ''), rp.phone, ''), '\D', '', 'g'), 10) into ph
    from clinic_reception.patients rp left join public.patients ar on ar.id = rp.patient_id where rp.id = p_patient;
  if coalesce(length(ph), 0) < 10 or position(ph in regexp_replace(t, '\D', '', 'g')) = 0 then
    raise exception 'رقم تليفون المريض مش هو اللي في رسالة فيزيتا — اختار ملف المريض الصح';
  end if;
  return t;
end $$;
revoke all on function clinic_reception.vezeeta_sms_ok(text, uuid) from public, anon, authenticated;

alter function clinic_reception.set_booking_discount(uuid, uuid, jsonb, uuid) rename to set_booking_discount_before_vezeeta_sms;
revoke all on function clinic_reception.set_booking_discount_before_vezeeta_sms(uuid, uuid, jsonb, uuid) from public, anon, authenticated;
create function clinic_reception.set_booking_discount(p_workspace uuid, p_appointment uuid, p jsonb, p_me uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare ap record; t text;
begin
  if nullif(btrim(coalesce(p->>'discount_kind', '')), '') is distinct from 'vezeeta' or nullif(btrim(coalesce(p->>'discount_proof_text', '')), '') is null then
    perform clinic_reception.set_booking_discount_before_vezeeta_sms(p_workspace, p_appointment, p, p_me);
    -- any other save (another kind, clear, or a card) drops a stale message proof
    update clinic_reception.appointments set discount_proof_text = null, discount_proof_by = null, discount_proof_at = null
     where id = p_appointment and discount_proof_text is not null
       and (discount_kind is distinct from 'vezeeta' or length(coalesce(discount_card_path, '')) > 3);
    return;
  end if;
  select * into ap from clinic_reception.appointments where id = p_appointment and workspace_id = p_workspace for update;
  if not found then raise exception 'الحجز مش موجود'; end if;
  if ap.status <> 'booked' then raise exception 'الخصم بيتعدّل قبل وصول المريض بس'; end if;
  if ap.package_id is not null then raise exception 'حجز الباكج بسعره المتعاقد عليه — مينفعش عليه خصم'; end if;
  if to_regprocedure('clinic_reception.service_is_offer(uuid)') is not null and clinic_reception.service_is_offer(ap.service_id) then
    raise exception 'السعر ده عرض — مفيش خصم تاني عليه'; end if;
  t := clinic_reception.vezeeta_sms_ok(p->>'discount_proof_text', ap.patient_id);
  update clinic_reception.appointments set discount_kind = 'vezeeta', discount_percent = 40,
      discount_org_type = null, discount_org_name = null, discount_card_no = 'رسالة فيزيتا', discount_card_expiry = date '9999-12-31',
      discount_card_path = null, discount_reason = null, discount_proof_text = t, discount_proof_by = p_me, discount_proof_at = now(),
      discount_staff_id = null,
      discount_by = p_me, discount_at = now()
   where id = ap.id;
end $$;
revoke all on function clinic_reception.set_booking_discount(uuid, uuid, jsonb, uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
