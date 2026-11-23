-- «فيه حاجات كتير اوي اتكلمنا عليها في الحجز مش موجودة، يعني لا نقابات ولا خصومات» (owner 2026-11-23, via main chat 4).
-- The booking discount (20261121180000 + 20261122110000: نقابة / نادي / أخرى, فيزيتا شامل, كارت العيلة, خاص) now reaches every path:
--   * 'walk_in' and 'reschedule' carry the discount like 'book' (walk_in used to call the inner 'book' and silently dropped it;
--     reschedule never touched it). On reschedule a payload with the key discount_kind sets it, and an empty discount_kind clears it.
--   * new 'order_discount' {order_id, discount_*}: after arrival, while the service is still «ordered» (before «تحصيل» executes it),
--     the same kinds, the same evidence (card number / valid until ≥ today / card photo), the same caps (نقابة/نادي/خاص 30,
--     فيزيتا 40, كارت العيلة 10→50) and the same auto-approval. One discount per visit (refused if the visit or its booking already
--     has one); not on package / entitlement services. Stored on the appointment too (exclusivity + family-card count) and applied
--     through discount_requests with the «خصم الحجز: …» reason, like the arrival trigger. Audited 'order_discount'.
-- Front wrapper on public.clinic_reception_command (previous becomes clinic_reception.command_before_discount_everywhere).
-- Rollback: supabase/rollbacks/20261123060000_booking_discount_everywhere.rollback.sql
begin;

do $$ begin
  if to_regprocedure('clinic_reception.set_booking_discount(uuid,uuid,jsonb,uuid)') is null
     or to_regprocedure('clinic_reception.booking_discount_max_for(text)') is null then
    raise exception 'طبّق خصم الحجز (20261121180000 و 20261122110000) الأول'; end if;
  if to_regprocedure('clinic_reception.command_before_discount_everywhere(uuid,text,jsonb,uuid)') is not null then
    raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

-- discount on a visit's service that is still «ordered» (after arrival, before execution / collection)
create function clinic_reception.order_discount(p_workspace uuid, p_order uuid, p jsonb, p_me uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare o record; ap record; kind text := nullif(btrim(coalesce(p->>'discount_kind', '')), ''); pct numeric; exp date; path text;
  d date := (now() at time zone 'Africa/Cairo')::date; has_file boolean; used int; why text; ok boolean;
begin
  select ord.*, v.appointment_id, v.patient_id as visit_patient into o
    from clinic_reception.orders ord join clinic_reception.visits v on v.id = ord.visit_id
   where ord.id = p_order and ord.workspace_id = p_workspace for update of ord;
  if not found then raise exception 'الخدمة مش موجودة'; end if;
  if o.status <> 'ordered' then raise exception 'الخصم بيتسجّل قبل تنفيذ الخدمة وتحصيلها بس'; end if;
  if o.entitlement_id is not null then raise exception 'خدمة الباكج بسعرها المتعاقد عليه — مينفعش عليها خصم'; end if;
  if exists (select 1 from clinic_reception.discount_requests dr join clinic_reception.orders o2 on o2.id = dr.order_id
              where o2.visit_id = o.visit_id and dr.status in ('pending', 'approved')) or o.discount > 0 then
    raise exception 'الزيارة دي عليها خصم بالفعل — خصم واحد بس لكل زيارة'; end if;
  select * into ap from clinic_reception.appointments where id = o.appointment_id for update;
  if found and ap.discount_kind is not null then raise exception 'الحجز ده عليه خصم بالفعل'; end if;
  if kind is null or kind not in ('syndicate', 'special', 'vezeeta', 'family') then raise exception 'اختار نوع الخصم'; end if;
  if kind = 'vezeeta' then pct := 40;
  elsif kind = 'family' then
    used := clinic_reception.family_visits(o.visit_patient, o.appointment_id);
    pct := clinic_reception.family_percent(used);
  else
    begin pct := nullif(btrim(coalesce(p->>'discount_percent', '')), '')::numeric; exception when others then pct := null; end;
    if pct is null or pct <= 0 then raise exception 'اكتب نسبة الخصم'; end if;
    if pct > clinic_reception.booking_discount_max() then raise exception 'أقصى خصم % ٪', clinic_reception.booking_discount_max(); end if;
  end if;
  if kind in ('syndicate', 'vezeeta') then
    if kind = 'syndicate' then
      if coalesce(p->>'discount_org_type', '') not in ('syndicate', 'club', 'other') then raise exception 'اختار الجهة: نقابة أو نادي أو أخرى'; end if;
      if length(btrim(coalesce(p->>'discount_org_name', ''))) < 2 then raise exception 'اكتب اسم الجهة'; end if;
    end if;
    if length(btrim(coalesce(p->>'discount_card_no', ''))) < 2 then
      raise exception '%', case when kind = 'vezeeta' then 'رقم كارت فيزيتا شامل إجباري' else 'رقم الكارنيه إجباري' end; end if;
    begin exp := nullif(p->>'discount_card_expiry', '')::date; exception when others then exp := null; end;
    if exp is null then raise exception 'اكتب الكارت ساري لحد إمتى'; end if;
    if exp < d then raise exception 'الكارت منتهي — الخصم مش متاح'; end if;
    path := btrim(coalesce(p->>'discount_card_path', ''));
    if length(path) < 4 then raise exception 'ارفع صورة الكارت'; end if;
    if to_regclass('storage.objects') is not null then
      execute 'select exists (select 1 from storage.objects x where x.bucket_id = ''booking-discount-cards'' and x.name = $1)' into has_file using path;
      if not has_file then raise exception 'ارفع صورة الكارت'; end if;
    end if;
  elsif kind = 'special' and length(btrim(coalesce(p->>'discount_reason', ''))) < 3 then
    raise exception 'اكتب سبب الخصم';
  end if;
  if ap.id is not null then
    update clinic_reception.appointments set discount_kind = kind, discount_percent = pct,
        discount_org_type = case when kind = 'syndicate' then p->>'discount_org_type' end,
        discount_org_name = case when kind = 'syndicate' then left(btrim(p->>'discount_org_name'), 120) end,
        discount_card_no = case when kind in ('syndicate', 'vezeeta') then left(btrim(p->>'discount_card_no'), 60) end,
        discount_card_expiry = case when kind in ('syndicate', 'vezeeta') then exp end,
        discount_card_path = case when kind in ('syndicate', 'vezeeta') then path end,
        discount_reason = case when kind = 'special' then left(btrim(p->>'discount_reason'), 300) end,
        discount_by = p_me, discount_at = now()
     where id = ap.id;
  end if;
  why := 'خصم الحجز: ' || case kind
           when 'syndicate' then case p->>'discount_org_type' when 'syndicate' then 'نقابة' when 'club' then 'نادي' else 'جهة' end
                || ' — ' || btrim(p->>'discount_org_name') || ' — كارنيه ' || btrim(p->>'discount_card_no')
           when 'vezeeta' then 'فيزيتا شامل — كارت ' || btrim(p->>'discount_card_no')
           when 'family' then 'كارت العيلة — زيارة العيلة رقم ' || (used + 1)
           else 'خصم خاص — ' || btrim(p->>'discount_reason') end || ' (بعد الوصول)';
  ok := pct <= clinic_reception.booking_discount_max_for(kind);
  insert into clinic_reception.discount_requests(workspace_id, order_id, percent, reason, created_by, status)
    values (p_workspace, o.id, pct, why, p_me, case when ok then 'approved' else 'pending' end);
  if ok then update clinic_reception.orders set discount = pct where id = o.id; end if;
  return jsonb_build_object('order_id', o.id, 'percent', pct, 'status', case when ok then 'approved' else 'pending' end,
    'net', round(o.price * o.quantity * (1 - pct / 100), 2));
end $$;
revoke all on function clinic_reception.order_discount(uuid, uuid, jsonb, uuid) from public, anon, authenticated;

do $$ begin
  alter function public.clinic_reception_command(uuid, text, jsonb, uuid) rename to command_before_discount_everywhere;
  alter function public.command_before_discount_everywhere(uuid, text, jsonb, uuid) set schema clinic_reception;
end $$;
revoke all on function clinic_reception.command_before_discount_everywhere(uuid, text, jsonb, uuid) from public, anon, authenticated;

create function public.clinic_reception_command(p_workspace uuid, p_action text, p_payload jsonb, p_token uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid; out jsonb; prev jsonb; kind text := nullif(btrim(coalesce(p_payload->>'discount_kind', '')), ''); aid uuid;
begin
  if p_action = 'order_discount' then
    me := clinic_reception.access(p_workspace, 'book');
    select c.response into prev from clinic_reception.commands c where c.workspace_id = p_workspace and c.actor_id = me and c.token = p_token;
    if found then return prev; end if;
    out := clinic_reception.order_discount(p_workspace, nullif(p_payload->>'order_id', '')::uuid, p_payload, me);
    insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id, detail)
      values (p_workspace, me, 'order_discount', nullif(p_payload->>'order_id', '')::uuid, (p_payload - 'discount_card_path') || out);
    insert into clinic_reception.commands(workspace_id, actor_id, token, action, payload, response) values (p_workspace, me, p_token, p_action, p_payload, out);
    return out;
  end if;
  out := clinic_reception.command_before_discount_everywhere(p_workspace, p_action, p_payload, p_token);
  -- walk-in books through the inner 'book' (the discount wrapper never saw it); reschedule edits the discount when it carries the key
  if (p_action = 'walk_in' and kind is not null) or (p_action = 'reschedule' and jsonb_typeof(p_payload) = 'object' and p_payload ? 'discount_kind') then
    begin aid := coalesce(nullif(out->>'id', ''), nullif(p_payload->>'id', ''))::uuid; exception when others then aid := null; end;
    if aid is not null and exists (select 1 from clinic_reception.appointments where id = aid and workspace_id = p_workspace and status = 'booked') then
      me := clinic_reception.access(p_workspace, 'book');
      perform clinic_reception.set_booking_discount(p_workspace, aid, p_payload, me);
      insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id, detail)
        values (p_workspace, me, 'booking_discount', aid, (p_payload - 'discount_card_path') || jsonb_build_object('via', p_action));
    end if;
  end if;
  return out;
end $$;
revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid) to authenticated;

commit;
