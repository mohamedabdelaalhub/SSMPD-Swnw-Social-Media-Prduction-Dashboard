-- Refuses while bookings carry a Vezeeta / family-card discount or family links exist (so documents are not lost).
begin;
do $$ begin
  if exists (select 1 from clinic_reception.appointments where discount_kind in ('vezeeta', 'family')) then
    raise exception 'فيه حجوزات عليها خصم فيزيتا أو كارت العيلة — مينفعش الرجوع'; end if;
  if exists (select 1 from clinic_reception.patient_relatives) then
    raise exception 'فيه أفراد عيلة متسجلين — مينفعش الرجوع من غير ما نحفظهم'; end if;
end $$;
do $$ declare r record; begin
  for r in select def from clinic_reception.discount_saved_defs loop execute r.def; end loop;
end $$;
drop function public.clinic_reception_family(uuid, text, jsonb);
drop function public.patient_family_verified(uuid, uuid);
drop function clinic_reception.family_visits(uuid, uuid);
drop function clinic_reception.family_percent(integer);
drop function clinic_reception.family_ids(uuid);
drop function clinic_reception.phone_key(text);
drop table clinic_reception.patient_relatives;
drop function clinic_reception.booking_discount_max_for(text);
alter table clinic_reception.appointments drop constraint appointments_discount_complete;
alter table clinic_reception.appointments add constraint appointments_discount_complete check (
  discount_kind is null
  or (discount_kind = 'syndicate' and discount_percent is not null and discount_org_type is not null
      and length(btrim(coalesce(discount_org_name, ''))) >= 2 and length(btrim(coalesce(discount_card_no, ''))) >= 2
      and discount_card_expiry is not null and length(coalesce(discount_card_path, '')) > 3)
  or (discount_kind = 'special' and discount_percent is not null and length(btrim(coalesce(discount_reason, ''))) >= 3));
alter table clinic_reception.appointments drop constraint appointments_discount_kind_check;
alter table clinic_reception.appointments add constraint appointments_discount_kind_check check (discount_kind in ('syndicate','special'));
drop table clinic_reception.discount_saved_defs;
commit;
