-- «الطبيب المحوِّل» on the booking and the invoice (owner 2026-11-23: «محتاجين في الفاتورة يتم ذكر الطبيب المحول في البيانات» →
-- «الاتنين، من جوة المركز او من بره»; build on the approved invoice form, no new form).
--   * appointments.referrer_*: kind internal (a reception provider) / external (name + optional specialty, clinic, phone).
--   * 'book' / 'walk_in' / 'reschedule' carrying referrer_kind set it (an empty kind clears it); new 'set_referrer' {id, referrer_*}
--     on a booked or arrived appointment until the visit has a collected service (then it's on the invoice for good).
--   * public.clinic_reception_invoice_print(ws, visit) also returns `referrer` {kind, name, specialty, clinic} for the invoice header.
-- The internal referral COMMISSION still comes from the service-order details («الطبيب المُحيل») as before — unchanged.
-- Outer wrappers (previous bodies kept as clinic_reception.command_before_referrer / invoice_print_before_referrer).
-- Rollback: supabase/rollbacks/20261123120000_referring_doctor.rollback.sql
begin;

do $$ begin
  if to_regprocedure('public.clinic_reception_invoice_print(uuid,uuid)') is null then raise exception 'دالة طباعة الفاتورة مش موجودة'; end if;
  if to_regprocedure('clinic_reception.command_before_referrer(uuid,text,jsonb,uuid)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

alter table clinic_reception.appointments
  add column referrer_kind text check (referrer_kind in ('internal', 'external')),
  add column referrer_provider_id uuid references clinic_reception.providers(id),
  add column referrer_name text check (referrer_name is null or length(referrer_name) <= 120),
  add column referrer_specialty text check (referrer_specialty is null or length(referrer_specialty) <= 120),
  add column referrer_clinic text check (referrer_clinic is null or length(referrer_clinic) <= 120),
  add column referrer_phone text check (referrer_phone is null or length(referrer_phone) <= 30),
  add column referrer_by uuid references public.admins(id),
  add column referrer_at timestamptz,
  add constraint appointments_referrer_shape check (
    (referrer_kind is null and referrer_provider_id is null and referrer_name is null)
    or (referrer_kind = 'internal' and referrer_provider_id is not null)
    or (referrer_kind = 'external' and length(btrim(coalesce(referrer_name, ''))) >= 3));

create function clinic_reception.set_referrer(p_workspace uuid, p_appointment uuid, p jsonb, p_me uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare ap record; kind text := nullif(btrim(coalesce(p->>'referrer_kind', '')), ''); prov record; nm text;
begin
  select * into ap from clinic_reception.appointments where id = p_appointment and workspace_id = p_workspace for update;
  if not found then raise exception 'الحجز مش موجود'; end if;
  if ap.status not in ('booked', 'arrived') then raise exception 'الطبيب المحوِّل بيتسجّل قبل ما الزيارة تخلص'; end if;
  if exists (select 1 from clinic_reception.visits v join clinic_reception.orders o on o.visit_id = v.id
              where v.appointment_id = ap.id and o.status = 'completed') then
    raise exception 'الزيارة دي اتحصّلت — الطبيب المحوِّل اتسجّل على الفاتورة'; end if;
  if kind is null then
    update clinic_reception.appointments set referrer_kind = null, referrer_provider_id = null, referrer_name = null, referrer_specialty = null,
      referrer_clinic = null, referrer_phone = null, referrer_by = p_me, referrer_at = now() where id = ap.id;
    return jsonb_build_object('id', ap.id, 'referrer_kind', null);
  end if;
  if kind = 'internal' then
    select pr.id, pr.name, pr.department into prov from clinic_reception.providers pr
     where pr.workspace_id = p_workspace and pr.id = nullif(p->>'referrer_provider_id', '')::uuid;
    if prov.id is null then raise exception 'اختار الطبيب المحوِّل من أطباء المركز'; end if;
    update clinic_reception.appointments set referrer_kind = 'internal', referrer_provider_id = prov.id, referrer_name = prov.name,
      referrer_specialty = prov.department, referrer_clinic = null, referrer_phone = null, referrer_by = p_me, referrer_at = now() where id = ap.id;
    nm := prov.name;
  elsif kind = 'external' then
    nm := btrim(coalesce(p->>'referrer_name', ''));
    if length(nm) < 3 then raise exception 'اكتب اسم الطبيب المحوِّل'; end if;
    update clinic_reception.appointments set referrer_kind = 'external', referrer_provider_id = null, referrer_name = left(nm, 120),
      referrer_specialty = nullif(left(btrim(coalesce(p->>'referrer_specialty', '')), 120), ''),
      referrer_clinic = nullif(left(btrim(coalesce(p->>'referrer_clinic', '')), 120), ''),
      referrer_phone = nullif(left(regexp_replace(coalesce(p->>'referrer_phone', ''), '[^0-9+]', '', 'g'), 30), ''),
      referrer_by = p_me, referrer_at = now() where id = ap.id;
  else raise exception 'اختار: من جوه المركز أو من بره المركز';
  end if;
  return jsonb_build_object('id', ap.id, 'referrer_kind', kind, 'referrer_name', nm);
end $$;
revoke all on function clinic_reception.set_referrer(uuid, uuid, jsonb, uuid) from public, anon, authenticated;

do $$ begin
  alter function public.clinic_reception_command(uuid, text, jsonb, uuid) rename to command_before_referrer;
  alter function public.command_before_referrer(uuid, text, jsonb, uuid) set schema clinic_reception;
  alter function public.clinic_reception_invoice_print(uuid, uuid) rename to invoice_print_before_referrer;
  alter function public.invoice_print_before_referrer(uuid, uuid) set schema clinic_reception;
end $$;
revoke all on function clinic_reception.command_before_referrer(uuid, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function clinic_reception.invoice_print_before_referrer(uuid, uuid) from public, anon, authenticated;

create function public.clinic_reception_command(p_workspace uuid, p_action text, p_payload jsonb, p_token uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid; out jsonb; prev jsonb; aid uuid;
begin
  if p_action = 'set_referrer' then
    me := clinic_reception.access(p_workspace, 'book');
    select c.response into prev from clinic_reception.commands c where c.workspace_id = p_workspace and c.actor_id = me and c.token = p_token;
    if found then return prev; end if;
    out := clinic_reception.set_referrer(p_workspace, nullif(p_payload->>'id', '')::uuid, p_payload, me);
    insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id, detail) values (p_workspace, me, 'set_referrer', (out->>'id')::uuid, p_payload);
    insert into clinic_reception.commands(workspace_id, actor_id, token, action, payload, response) values (p_workspace, me, p_token, p_action, p_payload, out);
    return out;
  end if;
  out := clinic_reception.command_before_referrer(p_workspace, p_action, p_payload, p_token);
  if p_action in ('book', 'walk_in', 'reschedule') and jsonb_typeof(p_payload) = 'object' and p_payload ? 'referrer_kind' then
    begin aid := coalesce(nullif(out->>'id', ''), nullif(p_payload->>'id', ''))::uuid; exception when others then aid := null; end;
    if aid is not null then
      me := clinic_reception.access(p_workspace, 'book');
      perform clinic_reception.set_referrer(p_workspace, aid, p_payload, me);
      insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id, detail)
        values (p_workspace, me, 'set_referrer', aid, p_payload - 'payer_proof_path' - 'payer_card_path' - 'discount_card_path' || jsonb_build_object('via', p_action));
    end if;
  end if;
  return out;
end $$;
revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid) to authenticated;

create function public.clinic_reception_invoice_print(p_workspace uuid, p_visit uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare r jsonb; a record;
begin
  r := clinic_reception.invoice_print_before_referrer(p_workspace, p_visit);
  select ap.referrer_kind, ap.referrer_name, ap.referrer_specialty, ap.referrer_clinic into a
    from clinic_reception.visits v join clinic_reception.appointments ap on ap.id = v.appointment_id
   where v.id = p_visit and v.workspace_id = p_workspace;
  if a.referrer_kind is null then return r; end if;
  return r || jsonb_build_object('referrer', jsonb_build_object('kind', a.referrer_kind, 'name', a.referrer_name,
    'specialty', a.referrer_specialty, 'clinic', a.referrer_clinic));
end $$;
revoke all on function public.clinic_reception_invoice_print(uuid, uuid) from public, anon;
grant execute on function public.clinic_reception_invoice_print(uuid, uuid) to authenticated;

commit;
