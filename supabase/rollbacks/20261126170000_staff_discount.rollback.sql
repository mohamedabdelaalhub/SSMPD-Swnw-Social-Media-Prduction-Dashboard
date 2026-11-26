-- Rollback of 20261126170000_staff_discount.sql. Staff discounts already applied stay on their orders (approved requests keep
-- their percent); open bookings that carry a staff discount are turned into «خصم خاص» with the same reason so nothing breaks.
begin;
do $$ begin
  if to_regprocedure('clinic_reception.set_booking_discount_before_staff(uuid,uuid,jsonb,uuid)') is null then raise exception 'not applied'; end if;
end $$;
drop trigger staff_discount_request on clinic_reception.discount_requests;
drop function clinic_reception.staff_discount_request();
drop function clinic_reception.order_discount(uuid, uuid, jsonb, uuid);
alter function clinic_reception.order_discount_before_staff(uuid, uuid, jsonb, uuid) rename to order_discount;
drop function clinic_reception.set_booking_discount(uuid, uuid, jsonb, uuid);
alter function clinic_reception.set_booking_discount_before_staff(uuid, uuid, jsonb, uuid) rename to set_booking_discount;
drop function public.clinic_reception_staff_discount(uuid, uuid, date);
drop function clinic_reception.staff_check(uuid, uuid, date);
drop function clinic_reception.staff_for_patient(uuid, date);
update clinic_reception.appointments set discount_kind = 'special', discount_reason = coalesce(discount_reason, 'خصم العاملين بالمركز')
 where discount_kind = 'staff';
alter table clinic_reception.appointments drop constraint appointments_discount_staff_complete;
alter table clinic_reception.appointments drop constraint appointments_discount_kind_check;
alter table clinic_reception.appointments add constraint appointments_discount_kind_check
  check (discount_kind in ('syndicate', 'special', 'vezeeta', 'family'));
alter table clinic_reception.appointments drop constraint appointments_discount_complete;
alter table clinic_reception.appointments add constraint appointments_discount_complete check (
  discount_kind is null
  or (discount_kind = 'syndicate' and discount_percent is not null and discount_org_type is not null
      and length(btrim(coalesce(discount_org_name, ''))) >= 2 and length(btrim(coalesce(discount_card_no, ''))) >= 2
      and discount_card_expiry is not null and length(coalesce(discount_card_path, '')) > 3)
  or (discount_kind = 'special' and discount_percent is not null and length(btrim(coalesce(discount_reason, ''))) >= 3)
  or (discount_kind = 'vezeeta' and discount_percent = 40 and length(btrim(coalesce(discount_card_no, ''))) >= 2
      and discount_card_expiry is not null and length(coalesce(discount_card_path, '')) > 3)
  or (discount_kind = 'family' and discount_percent between 10 and 50));
alter table clinic_reception.appointments drop column discount_staff_id;
create or replace function clinic_reception.booking_discount_max_for(p_kind text) returns numeric language sql immutable as $$
  select case p_kind when 'vezeeta' then 40 when 'family' then 50 else clinic_reception.booking_discount_max() end::numeric $$;
revoke all on function clinic_reception.booking_discount_max_for(text) from public, anon, authenticated;
create or replace function clinic_reception.booking_discount_exclusive() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare oid uuid := new.order_id; ap record;
begin
  select a.discount_kind, a.discount_org_name into ap
    from clinic_reception.orders o join clinic_reception.visits v on v.id = o.visit_id join clinic_reception.appointments a on a.id = v.appointment_id
   where o.id = oid;
  if not found or ap.discount_kind is null then return new; end if;
  if tg_table_name = 'discount_requests' and new.reason like 'خصم الحجز: %' then return new; end if;
  raise exception 'الحجز ده عليه خصم % — مينفعش خصم تاني ولا سعر تعاقد عليه',
    case ap.discount_kind when 'syndicate' then 'نقابة / نادي (' || ap.discount_org_name || ')' when 'vezeeta' then 'فيزيتا شامل'
      when 'family' then 'كارت العيلة' else 'خاص' end;
end $$;
revoke all on function clinic_reception.booking_discount_exclusive() from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;
