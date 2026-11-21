-- Several sessions / areas in one visit (owner 2026-11-21 «في ناس بتعمل منطقتين او أكتر في نفس الزيارة»; mockup
-- docs/ui-references/mockups/arrival-sessions-* approved «موافق»).
-- «تسجيل حضور المريض» can set the number of sessions / areas (1–99) and, optionally, which areas. They are saved on the
-- appointment BEFORE the arrival runs, so the arrival order takes the quantity through the existing booking_order_terms
-- trigger (20261120200000: price × quantity on the bill) — no money code changes.
-- * appointments.session_areas text (≤ 120), copied into the arrival order snapshot ('areas') by trigger booking_order_areas.
-- * public.clinic_reception_command: new front wrapper for 'arrive' with quantity / session_areas (the previous command
--   becomes clinic_reception.command_before_arrival_qty; every other action passes through unchanged). A package
--   appointment keeps quantity 1 (sessions are counted in the package). Same transaction: a refused arrival changes nothing.
-- Rollback: supabase/rollbacks/20261121140000_reception_arrival_sessions.rollback.sql
begin;

do $$ begin
  if to_regprocedure('public.clinic_reception_command(uuid,text,jsonb,uuid)') is null
     or to_regprocedure('clinic_reception.booking_order_terms()') is null then raise exception 'مكونات الحجز غير موجودة'; end if;
  if to_regprocedure('clinic_reception.command_before_arrival_qty(uuid,text,jsonb,uuid)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

alter table clinic_reception.appointments add column if not exists session_areas text
  check (session_areas is null or length(session_areas) <= 120);

create function clinic_reception.booking_order_areas() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare a record;
begin
  if new.entitlement_id is not null then return new; end if;
  select ap.session_areas, ap.service_id into a
    from clinic_reception.visits v join clinic_reception.appointments ap on ap.id = v.appointment_id where v.id = new.visit_id;
  if not found or a.session_areas is null or a.service_id is distinct from new.service_id then return new; end if;
  if exists (select 1 from clinic_reception.orders o where o.visit_id = new.visit_id and o.service_id = new.service_id) then return new; end if;
  new.snapshot := coalesce(new.snapshot, '{}'::jsonb) || jsonb_build_object('areas', a.session_areas);
  return new;
end $$;
revoke all on function clinic_reception.booking_order_areas() from public, anon, authenticated;
create trigger booking_order_areas before insert on clinic_reception.orders
  for each row execute function clinic_reception.booking_order_areas();

do $$ begin
  alter function public.clinic_reception_command(uuid, text, jsonb, uuid) rename to command_before_arrival_qty;
  alter function public.command_before_arrival_qty(uuid, text, jsonb, uuid) set schema clinic_reception;
end $$;
revoke all on function clinic_reception.command_before_arrival_qty(uuid, text, jsonb, uuid) from public, anon, authenticated;

create function public.clinic_reception_command(p_workspace uuid, p_action text, p_payload jsonb, p_token uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare ap record; qty integer; areas text; has_q boolean; has_a boolean;
begin
  if p_action <> 'arrive' or jsonb_typeof(p_payload) <> 'object' or not (p_payload ? 'quantity' or p_payload ? 'session_areas') then
    return clinic_reception.command_before_arrival_qty(p_workspace, p_action, p_payload, p_token);
  end if;
  has_q := coalesce(p_payload->>'quantity', '') <> ''; has_a := p_payload ? 'session_areas';
  if has_q and ((p_payload->>'quantity') !~ '^\s*\d{1,2}\s*$' or (p_payload->>'quantity')::integer not between 1 and 99) then
    raise exception 'عدد الجلسات / المناطق لازم يكون رقم صحيح من 1 لـ 99';
  end if;
  qty := case when has_q then (p_payload->>'quantity')::integer end;
  areas := left(nullif(btrim(coalesce(p_payload->>'session_areas', '')), ''), 120);
  select a.id, a.status, to_jsonb(a)->>'package_id' pkg, a.quantity into ap from clinic_reception.appointments a
   where a.workspace_id = p_workspace and a.id = nullif(p_payload->>'id', '')::uuid for update;
  if found and ap.status = 'booked' then
    if ap.pkg is not null and coalesce(qty, 1) > 1 then raise exception 'جلسات الباكج محسوبة في الباكج — سيب العدد 1'; end if;
    update clinic_reception.appointments a set quantity = coalesce(qty, a.quantity),
        session_areas = case when has_a then areas else a.session_areas end
     where a.id = ap.id;
  end if;
  return clinic_reception.command_before_arrival_qty(p_workspace, p_action, p_payload - 'quantity' - 'session_areas', p_token);
end $$;
revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid) to authenticated;

commit;
