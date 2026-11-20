-- Reception booking: quantity, continuation session, «لم يرد» (owner 2026-11-20, reception request; mockup
-- docs/ui-references/mockups/booking-qty-continuation-noanswer.html approved «موافق علي الكل»).
-- 1. appointments.quantity (1–99): e.g. 3 crowns. The order created on arrival carries it (price × quantity on the bill).
-- 2. appointments.continuation_of → an earlier order of the same service (same code) for the same patient, not cancelled,
--    with a price and a fully paid bill (allocations ≥ invoice amount), within 180 days. The arrival order is created at no charge (price 0, snapshot.continuation_of).
--    Validated in clinic_reception_command; candidates via clinic_reception_continuation_candidates().
-- 3. clinic_reception_command('no_answer', {id}): counts a call attempt on a booked, unconfirmed appointment
--    (no_answer_count, last_no_answer_at/by) and writes the audit. The status stays 'booked'.
-- The order part is a BEFORE INSERT trigger so every arrival path (desk, queue, check-in link) gets it.
-- Rollback: supabase/rollbacks/20261120200000_reception_booking_qty_continuation_no_answer.rollback.sql
begin;

do $$ begin
  if to_regclass('clinic_reception.appointments') is null or to_regclass('clinic_reception.orders') is null
     or to_regprocedure('public.clinic_reception_command(uuid,text,jsonb,uuid)') is null then
    raise exception 'مكونات الحجز غير موجودة';
  end if;
  if to_regprocedure('clinic_reception.command_before_qty(uuid,text,jsonb,uuid)') is not null then
    raise exception 'تم تطبيق هذا الملف من قبل';
  end if;
end $$;

alter table clinic_reception.appointments
  add column if not exists quantity integer not null default 1,
  add column if not exists continuation_of uuid references clinic_reception.orders(id),
  add column if not exists no_answer_count integer not null default 0,
  add column if not exists last_no_answer_at timestamptz,
  add column if not exists last_no_answer_by uuid references public.admins(id);
alter table clinic_reception.appointments drop constraint if exists appointments_quantity_range;
alter table clinic_reception.appointments add constraint appointments_quantity_range check (quantity between 1 and 99);

-- Earlier orders a continuation can point to.
create function clinic_reception.continuation_orders(p_workspace uuid, p_patient uuid, p_service uuid) returns table(
  id uuid, service text, at timestamptz, doctor text, amount numeric)
language sql stable security definer set search_path = pg_catalog, public as $$
  select o.id, coalesce(o.snapshot->>'name', s.name), coalesce(o.completed_at, o.created_at), pr.name, pay.paid
  from clinic_reception.orders o
  join clinic_reception.visits v on v.id = o.visit_id
  join clinic_reception.invoices i on i.order_id = o.id
  cross join lateral (select coalesce(sum(al.amount), 0) as paid from clinic_reception.allocations al where al.invoice_id = i.id) pay
  left join clinic_reception.services s on s.id = o.service_id
  left join clinic_reception.providers pr on pr.id = o.provider_id
  where o.workspace_id = p_workspace and v.patient_id = p_patient and o.status <> 'cancelled' and o.price > 0
    and o.created_at > now() - interval '180 days'
    and i.amount > 0 and pay.paid >= i.amount   -- only a session whose bill is fully paid
    and (o.service_id = p_service or (o.snapshot->>'code') = (select s2.code from clinic_reception.services s2 where s2.id = p_service))
  order by coalesce(o.completed_at, o.created_at) desc
  limit 20
$$;
revoke all on function clinic_reception.continuation_orders(uuid, uuid, uuid) from public, anon, authenticated;

create function public.clinic_reception_continuation_candidates(p_workspace uuid, p_patient uuid, p_service uuid)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  perform clinic_reception.access(p_workspace, 'book');
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'service', c.service, 'at', c.at, 'doctor', c.doctor,
    'amount', c.amount) order by c.at desc) from clinic_reception.continuation_orders(p_workspace, p_patient, p_service) c), '[]');
end $$;
revoke all on function public.clinic_reception_continuation_candidates(uuid, uuid, uuid) from public, anon;
grant execute on function public.clinic_reception_continuation_candidates(uuid, uuid, uuid) to authenticated;

-- The arrival order takes the booking's quantity; a continuation is at no charge.
create function clinic_reception.booking_order_terms() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare a record;
begin
  if new.entitlement_id is not null then return new; end if;
  select ap.quantity, ap.continuation_of, ap.service_id into a
    from clinic_reception.visits v join clinic_reception.appointments ap on ap.id = v.appointment_id where v.id = new.visit_id;
  if not found or a.service_id is distinct from new.service_id or (a.quantity = 1 and a.continuation_of is null) then return new; end if;
  if exists (select 1 from clinic_reception.orders o where o.visit_id = new.visit_id and o.service_id = new.service_id) then
    return new;   -- only the order the arrival creates, not services added to the visit later
  end if;
  if a.quantity > 1 and new.quantity = 1 then new.quantity := a.quantity; end if;
  if a.continuation_of is not null then
    new.price := 0;
    new.snapshot := coalesce(new.snapshot, '{}'::jsonb) || jsonb_build_object('continuation_of', a.continuation_of);
  end if;
  return new;
end $$;
revoke all on function clinic_reception.booking_order_terms() from public, anon, authenticated;
create trigger booking_order_terms before insert on clinic_reception.orders
  for each row execute function clinic_reception.booking_order_terms();

do $$ begin
  alter function public.clinic_reception_command(uuid, text, jsonb, uuid) rename to command_before_qty;
  alter function public.command_before_qty(uuid, text, jsonb, uuid) set schema clinic_reception;
end $$;
revoke all on function clinic_reception.command_before_qty(uuid, text, jsonb, uuid) from public, anon, authenticated;

create function public.clinic_reception_command(p_workspace uuid, p_action text, p_payload jsonb, p_token uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid; prev jsonb; out jsonb; ap record; qty integer; cont uuid; pid uuid; svc uuid; has_q boolean; has_c boolean;
begin
  if p_action = 'no_answer' then
    me := clinic_reception.access(p_workspace, 'book');
    select c.response into prev from clinic_reception.commands c where c.workspace_id = p_workspace and c.actor_id = me and c.token = p_token;
    if found then return prev; end if;
    update clinic_reception.appointments a set no_answer_count = a.no_answer_count + 1, last_no_answer_at = now(), last_no_answer_by = me
      where a.workspace_id = p_workspace and a.id = nullif(p_payload->>'id', '')::uuid and a.status = 'booked'
      returning a.id, a.no_answer_count, a.last_no_answer_at into ap;
    if not found then raise exception 'الحجز ده مش متاح لتسجيل «لم يرد»'; end if;
    out := jsonb_build_object('id', ap.id, 'no_answer_count', ap.no_answer_count, 'last_no_answer_at', ap.last_no_answer_at);
    insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id, detail) values (p_workspace, me, 'no_answer', ap.id, out);
    insert into clinic_reception.commands(workspace_id, actor_id, token, action, payload, response) values (p_workspace, me, p_token, p_action, p_payload, out);
    return out;
  end if;

  if p_action not in ('book', 'walk_in', 'reschedule') or jsonb_typeof(p_payload) <> 'object' then
    return clinic_reception.command_before_qty(p_workspace, p_action, p_payload, p_token);
  end if;
  has_q := p_payload ? 'quantity'; has_c := p_payload ? 'continuation_of';
  if not has_q and not has_c then
    return clinic_reception.command_before_qty(p_workspace, p_action, p_payload, p_token);
  end if;

  if has_q and coalesce(p_payload->>'quantity', '') <> '' then
    if (p_payload->>'quantity') !~ '^\s*\d{1,2}\s*$' or (p_payload->>'quantity')::integer not between 1 and 99 then
      raise exception 'العدد لازم يكون رقم صحيح من 1 لـ 99';
    end if;
    qty := (p_payload->>'quantity')::integer;
  else qty := 1; end if;
  cont := nullif(p_payload->>'continuation_of', '')::uuid;
  if nullif(p_payload->>'package_id', '') is not null then
    if cont is not null then raise exception 'جلسات الباكج محسوبة في الباكج — مش محتاجة «جلسة استكمال»'; end if;
    qty := 1;
  end if;
  if cont is not null then
    perform clinic_reception.access(p_workspace, 'book');
    if p_action = 'reschedule' then
      select a.patient_id, a.service_id into ap from clinic_reception.appointments a
        where a.workspace_id = p_workspace and a.id = nullif(p_payload->>'id', '')::uuid;
      pid := coalesce(nullif(p_payload->>'patient_id', '')::uuid, ap.patient_id);
      svc := coalesce(nullif(p_payload->>'service_id', '')::uuid, ap.service_id);
    else
      pid := nullif(p_payload->>'patient_id', '')::uuid; svc := nullif(p_payload->>'service_id', '')::uuid;
    end if;
    if not exists (select 1 from clinic_reception.continuation_orders(p_workspace, pid, svc) c where c.id = cont) then
      raise exception 'المريض مالوش جلسة سابقة للخدمة دي في آخر ٦ شهور — احجزها كخدمة عادية';
    end if;
    qty := 1;
  end if;

  out := clinic_reception.command_before_qty(p_workspace, p_action, p_payload - 'quantity' - 'continuation_of', p_token);
  if nullif(out->>'id', '') is not null then
    update clinic_reception.appointments a
      set quantity = case when has_q or has_c then qty else a.quantity end,
          continuation_of = case when has_c then cont else a.continuation_of end
      where a.workspace_id = p_workspace and a.id = (out->>'id')::uuid;
  end if;
  return out;
end $$;
revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid) to authenticated;

commit;
