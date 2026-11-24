-- A visit discount covers EVERY service of the visit (owner case 2026-11-23 via main chat 4: a union patient with a consult 500 + a
-- physio session 500 pays 700 = 30% off both; the 2nd service was refused «خصم واحد بس لكل زيارة»).
--   * New 'visit_same_discount' {visit_id}: every «ordered», non-package service of the visit WITHOUT a discount gets the visit's
--     approved discount percent (the latest approved discount_request on another service of the same visit), auto-approved —
--     same evidence, no new approval — reason «نفس خصم الزيارة: <original reason>». Refused when the visit has no approved discount.
--   * Automatic: a service ADDED to a visit whose booking carries a booking discount (نقابة / نادي, فيزيتا شامل, كارت العيلة, خاص)
--     that was already applied gets the same percent at once (reason «خصم الحجز: … (نفس خصم الزيارة)»).
--   * A DIFFERENT second discount is still refused (order_discount / booking discount unchanged).
--   * Generic 'discount': refused when the service already has a pending OR approved request (no duplicate requests).
-- Outer wrapper on public.clinic_reception_command (previous kept as clinic_reception.command_before_visit_discount) + one trigger.
-- Rollback: supabase/rollbacks/20261123130000_visit_discount_all_services.rollback.sql
begin;

do $$ begin
  if to_regprocedure('clinic_reception.order_discount(uuid,uuid,jsonb,uuid)') is null then raise exception 'طبّق خصومات الحجز (20261123060000) الأول'; end if;
  if to_regprocedure('clinic_reception.command_before_visit_discount(uuid,text,jsonb,uuid)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

-- the visit's approved discount: {percent, reason} from the latest approved request on a service of that visit (null if none)
create function clinic_reception.visit_discount(p_visit uuid) returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  select jsonb_build_object('percent', dr.percent, 'reason', dr.reason, 'request_id', dr.id)
    from clinic_reception.discount_requests dr join clinic_reception.orders o on o.id = dr.order_id
   where o.visit_id = p_visit and dr.status = 'approved' and dr.percent > 0 and o.status <> 'cancelled'
   order by dr.percent desc, dr.id limit 1
$$;
revoke all on function clinic_reception.visit_discount(uuid) from public, anon, authenticated;

-- apply it to one order (no-op when the order is not eligible); returns the percent applied or null
create function clinic_reception.apply_visit_discount(p_order uuid, p_me uuid, p_prefix text default 'نفس خصم الزيارة: ') returns numeric
language plpgsql security definer set search_path = pg_catalog, public as $$
declare o clinic_reception.orders%rowtype; vd jsonb; why text; quoted boolean;
begin
  select * into o from clinic_reception.orders where id = p_order for update;
  if not found or o.status <> 'ordered' or o.entitlement_id is not null or o.discount > 0 or o.price <= 0 then return null; end if;
  if exists (select 1 from clinic_reception.discount_requests dr where dr.order_id = o.id and dr.status in ('pending', 'approved')) then return null; end if;
  if to_regclass('clinic_reception.order_quotes') is not null then
    execute 'select exists (select 1 from clinic_reception.order_quotes q where q.order_id = $1)' into quoted using o.id;
    if quoted then return null; end if;
  end if;
  vd := clinic_reception.visit_discount(o.visit_id);
  if vd is null then return null; end if;
  why := vd->>'reason';
  -- keep the «خصم الحجز: » prefix so the booking-discount exclusivity guard accepts it
  why := case when why like 'خصم الحجز: %' then why || ' (نفس خصم الزيارة)' else p_prefix || why end;
  insert into clinic_reception.discount_requests(workspace_id, order_id, percent, reason, created_by, reviewed_by, status)
    values (o.workspace_id, o.id, (vd->>'percent')::numeric, left(why, 500), p_me, p_me, 'approved');
  update clinic_reception.orders set discount = (vd->>'percent')::numeric where id = o.id;
  return (vd->>'percent')::numeric;
end $$;
revoke all on function clinic_reception.apply_visit_discount(uuid, uuid, text) from public, anon, authenticated;

-- automatic for services added to a visit whose BOOKING discount (union / vezeeta / family / special) is already applied
create function clinic_reception.visit_discount_on_add() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare k text;
begin
  if new.entitlement_id is not null then return new; end if;
  select a.discount_kind into k from clinic_reception.visits v join clinic_reception.appointments a on a.id = v.appointment_id where v.id = new.visit_id;
  if k is null then return new; end if;
  if not exists (select 1 from clinic_reception.discount_requests dr join clinic_reception.orders o on o.id = dr.order_id
                  where o.visit_id = new.visit_id and o.id <> new.id and dr.status = 'approved' and dr.reason like 'خصم الحجز: %') then return new; end if;
  perform clinic_reception.apply_visit_discount(new.id, new.created_by);
  return new;
end $$;
revoke all on function clinic_reception.visit_discount_on_add() from public, anon, authenticated;
create trigger visit_discount_on_add after insert on clinic_reception.orders for each row execute function clinic_reception.visit_discount_on_add();

do $$ begin
  alter function public.clinic_reception_command(uuid, text, jsonb, uuid) rename to command_before_visit_discount;
  alter function public.command_before_visit_discount(uuid, text, jsonb, uuid) set schema clinic_reception;
end $$;
revoke all on function clinic_reception.command_before_visit_discount(uuid, text, jsonb, uuid) from public, anon, authenticated;

create function public.clinic_reception_command(p_workspace uuid, p_action text, p_payload jsonb, p_token uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid; out jsonb; prev jsonb; v record; o record; pct numeric; n int := 0; vd jsonb; oid uuid;
begin
  if p_action = 'visit_same_discount' then
    me := clinic_reception.access(p_workspace, 'book');
    select c.response into prev from clinic_reception.commands c where c.workspace_id = p_workspace and c.actor_id = me and c.token = p_token;
    if found then return prev; end if;
    select * into v from clinic_reception.visits where id = nullif(p_payload->>'visit_id', '')::uuid and workspace_id = p_workspace;
    if not found then raise exception 'الزيارة مش موجودة'; end if;
    vd := clinic_reception.visit_discount(v.id);
    if vd is null then raise exception 'الزيارة دي مفيش عليها خصم معتمد'; end if;
    for o in select id from clinic_reception.orders where visit_id = v.id and status = 'ordered' order by created_at loop
      pct := clinic_reception.apply_visit_discount(o.id, me);
      if pct is not null then n := n + 1; end if;
    end loop;
    if n = 0 then raise exception 'كل خدمات الزيارة عليها الخصم بالفعل (أو اتنفذت)'; end if;
    out := jsonb_build_object('visit_id', v.id, 'percent', vd->'percent', 'services', n);
    insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id, detail) values (p_workspace, me, 'visit_same_discount', v.id, out);
    insert into clinic_reception.commands(workspace_id, actor_id, token, action, payload, response) values (p_workspace, me, p_token, p_action, p_payload, out);
    return out;
  end if;
  if p_action = 'discount' then
    begin oid := coalesce(nullif(p_payload->>'id', ''), nullif(p_payload->>'order_id', ''))::uuid; exception when others then oid := null; end;
    if oid is not null and exists (select 1 from clinic_reception.discount_requests dr where dr.order_id = oid and dr.status in ('pending', 'approved'))
       and not exists (select 1 from clinic_reception.commands c where c.workspace_id = p_workspace and c.token = p_token) then
      raise exception 'الخدمة دي عليها طلب خصم بالفعل (مستني المراجعة أو اتعتمد)'; end if;
  end if;
  return clinic_reception.command_before_visit_discount(p_workspace, p_action, p_payload, p_token);
end $$;
revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid) to authenticated;

commit;
