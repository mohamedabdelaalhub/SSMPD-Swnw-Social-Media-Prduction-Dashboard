-- Owner rule 2026-11-24 (relayed by main chat 4): «العروض ملهاش اي خصومات تانية — يعني المريض يسري عليه خصم واحد اما العروض او النقابات
-- واحد منهم فقط». A service priced by an ACTIVE offer list (clinic_prices.resolve → source 'offer', 20261123160000; copied to
-- clinic_reception.services.pricing_evidence by sync_catalog and to each order's snapshot) takes NO desk discount:
-- نقابة / نادي / فيزيتا / كارت العيلة / خصم خاص / payer-kind union / «نفس خصم الزيارة» / a generic discount request.
--   * Manual paths REFUSE with «السعر ده عرض — مفيش خصم تاني عليه»:
--       set_booking_discount (booking_discount / book / walk_in / reschedule / union payer) when the booked service is an offer now,
--       order_discount (discount on an arrived visit's service), the generic 'discount' request, and 'visit_same_discount' when every
--       service still open on the visit is an offer.
--   * Automatic paths SKIP the offer service quietly (the other services of the visit still get their discount):
--       a discount_requests row for an offer order is not inserted, and orders.discount stays 0 on an offer order
--       (arrival auto-apply, «نفس خصم الزيارة» on mixed visits, a service added later).
-- Contract prices (payer «تعاقد») are the price chat's (mig 190000) and are not touched here.
-- Rollback: supabase/rollbacks/20261123200000_offer_no_other_discount.rollback.sql
begin;

do $$ begin
  if to_regprocedure('clinic_reception.set_booking_discount(uuid,uuid,jsonb,uuid)') is null
     or to_regprocedure('clinic_reception.order_discount(uuid,uuid,jsonb,uuid)') is null then
    raise exception 'طبّق ملفات خصومات الحجز (20261121180000 / 20261123060000) الأول'; end if;
  if to_regprocedure('clinic_reception.set_booking_discount_before_offer(uuid,uuid,jsonb,uuid)') is not null then
    raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

-- is this order / service priced by an offer?
create function clinic_reception.order_is_offer(p_order uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce((select coalesce(o.snapshot->'pricing_evidence'->>'source', s.pricing_evidence->>'source') = 'offer'
                     from clinic_reception.orders o left join clinic_reception.services s on s.id = o.service_id where o.id = p_order), false)
$$;
create function clinic_reception.service_is_offer(p_service uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce((select s.pricing_evidence->>'source' = 'offer' from clinic_reception.services s where s.id = p_service), false)
$$;
revoke all on function clinic_reception.order_is_offer(uuid), clinic_reception.service_is_offer(uuid) from public, anon, authenticated;

-- manual: booking discount on an offer-priced booked service
alter function clinic_reception.set_booking_discount(uuid, uuid, jsonb, uuid) rename to set_booking_discount_before_offer;
revoke all on function clinic_reception.set_booking_discount_before_offer(uuid, uuid, jsonb, uuid) from public, anon, authenticated;
create function clinic_reception.set_booking_discount(p_workspace uuid, p_appointment uuid, p jsonb, p_me uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if nullif(btrim(coalesce(p->>'discount_kind', '')), '') is not null
     and clinic_reception.service_is_offer((select service_id from clinic_reception.appointments where id = p_appointment)) then
    raise exception 'السعر ده عرض — مفيش خصم تاني عليه'; end if;
  perform clinic_reception.set_booking_discount_before_offer(p_workspace, p_appointment, p, p_me);
end $$;
revoke all on function clinic_reception.set_booking_discount(uuid, uuid, jsonb, uuid) from public, anon, authenticated;

-- manual: discount on an arrived visit's service
alter function clinic_reception.order_discount(uuid, uuid, jsonb, uuid) rename to order_discount_before_offer;
revoke all on function clinic_reception.order_discount_before_offer(uuid, uuid, jsonb, uuid) from public, anon, authenticated;
create function clinic_reception.order_discount(p_workspace uuid, p_order uuid, p jsonb, p_me uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if nullif(btrim(coalesce(p->>'discount_kind', '')), '') is not null and clinic_reception.order_is_offer(p_order) then
    raise exception 'السعر ده عرض — مفيش خصم تاني عليه'; end if;
  return clinic_reception.order_discount_before_offer(p_workspace, p_order, p, p_me);
end $$;
revoke all on function clinic_reception.order_discount(uuid, uuid, jsonb, uuid) from public, anon, authenticated;

-- automatic: never a discount row / percent on an offer order (other services of the visit unaffected)
create function clinic_reception.offer_discount_request_skip() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.percent > 0 and clinic_reception.order_is_offer(new.order_id) then return null; end if;
  return new;
end $$;
revoke all on function clinic_reception.offer_discount_request_skip() from public, anon, authenticated;
create trigger offer_discount_request_skip before insert on clinic_reception.discount_requests
  for each row execute function clinic_reception.offer_discount_request_skip();

create function clinic_reception.offer_order_discount_zero() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.discount > 0 and new.entitlement_id is null
     and coalesce(new.snapshot->'pricing_evidence'->>'source', (select s.pricing_evidence->>'source' from clinic_reception.services s where s.id = new.service_id)) = 'offer' then
    new.discount := 0;
  end if;
  return new;
end $$;
revoke all on function clinic_reception.offer_order_discount_zero() from public, anon, authenticated;
create trigger offer_order_discount_zero before insert or update of discount on clinic_reception.orders
  for each row execute function clinic_reception.offer_order_discount_zero();

-- manual commands: the generic request and «نفس خصم الزيارة» get the clear reason
do $$ begin
  alter function public.clinic_reception_command(uuid, text, jsonb, uuid) rename to command_before_offer_discount;
  alter function public.command_before_offer_discount(uuid, text, jsonb, uuid) set schema clinic_reception;
end $$;
revoke all on function clinic_reception.command_before_offer_discount(uuid, text, jsonb, uuid) from public, anon, authenticated;

create function public.clinic_reception_command(p_workspace uuid, p_action text, p_payload jsonb, p_token uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare oid uuid; vid uuid;
begin
  if p_action = 'discount' and coalesce((p_payload->>'percent')::numeric, 0) > 0 then
    begin oid := coalesce(nullif(p_payload->>'id', ''), nullif(p_payload->>'order_id', ''))::uuid; exception when others then oid := null; end;
    if oid is not null and clinic_reception.order_is_offer(oid) then raise exception 'السعر ده عرض — مفيش خصم تاني عليه'; end if;
  end if;
  if p_action = 'visit_same_discount' then
    begin vid := nullif(p_payload->>'visit_id', '')::uuid; exception when others then vid := null; end;
    if vid is not null
       and exists (select 1 from clinic_reception.orders o where o.visit_id = vid and o.status = 'ordered' and o.entitlement_id is null and o.discount = 0)
       and not exists (select 1 from clinic_reception.orders o where o.visit_id = vid and o.status = 'ordered' and o.entitlement_id is null and o.discount = 0
                         and not clinic_reception.order_is_offer(o.id)) then
      raise exception 'السعر ده عرض — مفيش خصم تاني عليه'; end if;
  end if;
  return clinic_reception.command_before_offer_discount(p_workspace, p_action, p_payload, p_token);
end $$;
revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid) to authenticated;

commit;
