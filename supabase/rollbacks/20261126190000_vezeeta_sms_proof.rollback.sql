-- Rollback of 20261126190000_vezeeta_sms_proof.sql. Bookings whose «فيزيتا شامل» proof is a pasted message (no card photo) can't meet
-- the old constraint: they become «خصم خاص» (capped 30%, reason «فيزيتا شامل (رسالة فيزيتا)»); applied order discounts stay as they are.
begin;
do $$ begin
  if to_regprocedure('clinic_reception.set_booking_discount_before_vezeeta_sms(uuid,uuid,jsonb,uuid)') is null then raise exception 'not applied'; end if;
end $$;
drop function clinic_reception.set_booking_discount(uuid, uuid, jsonb, uuid);
alter function clinic_reception.set_booking_discount_before_vezeeta_sms(uuid, uuid, jsonb, uuid) rename to set_booking_discount;
revoke all on function clinic_reception.set_booking_discount(uuid, uuid, jsonb, uuid) from public, anon, authenticated;
drop function clinic_reception.vezeeta_sms_ok(text, uuid);
update clinic_reception.appointments set discount_kind = 'special', discount_reason = 'فيزيتا شامل (رسالة فيزيتا)', discount_card_no = null,
    discount_card_expiry = null, discount_card_path = null, discount_percent = least(discount_percent, 30)
 where discount_kind = 'vezeeta' and length(coalesce(discount_card_path, '')) <= 3 and discount_proof_text is not null;
alter table clinic_reception.appointments drop constraint appointments_discount_complete;
alter table clinic_reception.appointments add constraint appointments_discount_complete check (
  discount_kind is null
  or (discount_kind = 'syndicate' and discount_percent is not null and discount_org_type is not null
      and length(btrim(coalesce(discount_org_name, ''))) >= 2 and length(btrim(coalesce(discount_card_no, ''))) >= 2
      and discount_card_expiry is not null and length(coalesce(discount_card_path, '')) > 3)
  or (discount_kind = 'special' and discount_percent is not null and length(btrim(coalesce(discount_reason, ''))) >= 3)
  or (discount_kind = 'vezeeta' and discount_percent = 40 and length(btrim(coalesce(discount_card_no, ''))) >= 2
      and discount_card_expiry is not null and length(coalesce(discount_card_path, '')) > 3)
  or (discount_kind = 'family' and discount_percent between 10 and 50)
  or (discount_kind = 'staff' and discount_percent is not null and discount_staff_id is not null and length(btrim(coalesce(discount_reason, ''))) >= 3));
alter table clinic_reception.appointments drop column discount_proof_text, drop column discount_proof_by, drop column discount_proof_at;
notify pgrst, 'reload schema';
commit;
