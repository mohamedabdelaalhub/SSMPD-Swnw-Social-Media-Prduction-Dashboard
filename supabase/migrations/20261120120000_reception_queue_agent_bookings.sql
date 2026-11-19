-- Queue phase 4b: agent (WhatsApp) bookings that exist only in public.customer_bookings get a turn.
-- Owner decision 2026-11-19 («الاستقبال يسجّله عند الوصول»): reception registers the arrival. Live patient files are never created from
-- agent data: reception picks the archive patient (phone search) and a service; the system then, in one transaction,
-- attaches the patient (existing patient_attach), books a walk-in for the doctor linked to the booking's Masa id, arrives it
-- (ticket number from phase 1) and issues the check-in token the patient's «اعرف دورك» link uses.
-- 1. clinic_reception.agent_booking_links: customer booking ↔ appointment (one each way), who linked it and when.
-- 2. public.clinic_reception_queue: two new actions, 'agent_bookings' {date?} (today's agent bookings for reception) and
--    'agent_booking_register' {booking_id, patient_id (archive), service_id}. Every other action is passed on unchanged.
-- 3. public.clinic_reception_fallback_api: new read-only op 'checkin_link' {official_booking_id | booking_request_id} → the token and
--    the my-turn path, or error not_registered / unknown_booking. Other ops unchanged. Service role only, as before.

begin;

create table if not exists clinic_reception.agent_booking_links(
  customer_booking_id uuid primary key references public.customer_bookings(id) on delete cascade,
  workspace_id uuid not null references clinic_reception.workspaces(id) on delete cascade,
  appointment_id uuid not null unique references clinic_reception.appointments(id) on delete cascade,
  linked_by uuid references public.admins(id),
  linked_at timestamptz not null default now()
);
alter table clinic_reception.agent_booking_links enable row level security;
revoke all on clinic_reception.agent_booking_links from public, anon, authenticated;

-- Keep the earlier queue RPC as the inner one and put the new actions in front of it.
do $$ begin
  if to_regprocedure('clinic_reception.queue_rpc_before_agent(uuid,text,jsonb)') is null then
    alter function public.clinic_reception_queue(uuid, text, jsonb) rename to queue_rpc_before_agent;
    alter function public.queue_rpc_before_agent(uuid, text, jsonb) set schema clinic_reception;
  end if;
end $$;
revoke all on function clinic_reception.queue_rpc_before_agent(uuid, text, jsonb) from public, anon, authenticated;

create or replace function public.clinic_reception_queue(p_workspace uuid, p_action text, p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid; p jsonb := coalesce(p_payload, '{}'); b public.customer_bookings; l clinic_reception.agent_booking_links;
  prov uuid; svc clinic_reception.services; cp uuid; ap uuid; tok text; today date := clinic_reception.today(); out jsonb;
begin
  if p_action = 'agent_bookings' then
    perform clinic_reception.access(p_workspace, 'book');
    return jsonb_build_object('bookings', coalesce((select jsonb_agg(jsonb_build_object(
        'id', cb.id, 'booking_reference', cb.booking_reference, 'customer_name', cb.customer_name, 'phone', cb.phone,
        'doctor_name', coalesce(pr.name, cb.doctor_name), 'provider_id', pr.id, 'appointment_time', cb.appointment_time, 'status', cb.status,
        'registered', al.customer_booking_id is not null, 'appointment_id', al.appointment_id) order by cb.appointment_time, cb.created_at)
      from public.customer_bookings cb
      left join clinic_reception.masa_doctor_links k on k.masa_doctor_id = cb.masa_doctor_id and k.status = 'linked' and k.workspace_id = p_workspace
      left join clinic_reception.providers pr on pr.id = k.provider_id
      left join clinic_reception.agent_booking_links al on al.customer_booking_id = cb.id
      where cb.appointment_date = coalesce(nullif(p->>'date', '')::date, today) and cb.status in ('confirmed', 'rescheduled', 'arrived')), '[]'));

  elsif p_action = 'agent_booking_register' then
    me := clinic_reception.access(p_workspace, 'book');
    select * into b from public.customer_bookings where id = (p->>'booking_id')::uuid for update;
    if not found then raise exception 'الحجز غير موجود'; end if;
    if b.appointment_date is distinct from today then raise exception 'تسجيل الوصول لحجوزات النهارده بس'; end if;
    if b.status not in ('confirmed', 'rescheduled', 'arrived') then raise exception 'الحجز ده مش ساري'; end if;
    select * into l from clinic_reception.agent_booking_links where customer_booking_id = b.id;
    if found then
      select token::text into tok from clinic_reception.checkin_tokens where appointment_id = l.appointment_id and expires_at > now() order by created_at desc limit 1;
      return jsonb_build_object('ok', true, 'already', true, 'appointment_id', l.appointment_id, 'token', tok);
    end if;
    select k.provider_id into prov from clinic_reception.masa_doctor_links k where k.masa_doctor_id = b.masa_doctor_id and k.status = 'linked' and k.workspace_id = p_workspace;
    if prov is null then raise exception 'الدكتور مش مربوط بدكتور في الداشبورد؛ اربطه الأول من ربط أطباء ماسا'; end if;
    select * into svc from clinic_reception.services where id = (p->>'service_id')::uuid and workspace_id = p_workspace;
    if not found then raise exception 'اختر الخدمة'; end if;
    -- 1. attach the archive patient (the existing live path; needs archive access) → clinic_reception.patients id
    out := public.clinic_reception_command(p_workspace, 'patient_attach', jsonb_build_object('patient_id', p->>'patient_id'), gen_random_uuid());
    cp := (out->>'id')::uuid;
    -- 2. walk-in appointment now, for the doctor linked to the booking
    out := public.clinic_reception_command(p_workspace, 'walk_in', jsonb_build_object('patient_id', cp, 'provider_id', prov, 'service_id', svc.id,
             'source', 'whatsapp'), gen_random_uuid());
    ap := (out->>'id')::uuid;
    -- 3. arrive → queue entry waiting with a ticket number; 4. token for the patient's «اعرف دورك» link
    perform public.clinic_reception_journey_command(p_workspace, 'arrive', jsonb_build_object('appointment_id', ap, 'method', 'reception'), gen_random_uuid());
    out := public.clinic_reception_journey_command(p_workspace, 'checkin_token', jsonb_build_object('appointment_id', ap), gen_random_uuid());
    tok := out->>'token';
    insert into clinic_reception.agent_booking_links(customer_booking_id, workspace_id, appointment_id, linked_by) values (b.id, p_workspace, ap, me);
    return jsonb_build_object('ok', true, 'appointment_id', ap, 'token', tok,
      'ticket_no', (select ticket_no from clinic_reception.queue_entries where appointment_id = ap));
  end if;
  return clinic_reception.queue_rpc_before_agent(p_workspace, p_action, p_payload);
end $$;
revoke all on function public.clinic_reception_queue(uuid, text, jsonb) from public, anon;
grant execute on function public.clinic_reception_queue(uuid, text, jsonb) to authenticated;

-- Agent: the link for a registered agent booking.
create or replace function clinic_reception.agent_checkin_link(p_official text, p_request text)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare b public.customer_bookings; l clinic_reception.agent_booking_links; t clinic_reception.checkin_tokens;
begin
  if nullif(p_official, '') is null and nullif(p_request, '') is null then return jsonb_build_object('ok', false, 'error', 'booking_required'); end if;
  select * into b from public.customer_bookings
   where (nullif(p_official, '') is not null and official_booking_id = p_official) or (nullif(p_request, '') is not null and booking_request_id = p_request)
   order by created_at desc limit 1;
  if not found then return jsonb_build_object('ok', false, 'error', 'unknown_booking'); end if;
  select * into l from clinic_reception.agent_booking_links where customer_booking_id = b.id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_registered'); end if;
  select * into t from clinic_reception.checkin_tokens where appointment_id = l.appointment_id and expires_at > now() order by created_at desc limit 1;
  if not found then return jsonb_build_object('ok', false, 'error', 'link_expired'); end if;
  return jsonb_build_object('ok', true, 'token', t.token, 'path', 'my-turn.html?t=' || t.token, 'expires_at', t.expires_at);
end $$;
revoke all on function clinic_reception.agent_checkin_link(text, text) from public, anon, authenticated;

create or replace function public.clinic_reception_fallback_api(p_op text, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if p_op = 'queue_board' then
    return clinic_reception.queue_board_agent(nullif(coalesce(p_payload, '{}')->>'date', '')::date);
  elsif p_op = 'my_turn' then
    if nullif(coalesce(p_payload, '{}')->>'token', '') is null then return jsonb_build_object('ok', false, 'error', 'token_required'); end if;
    begin
      return clinic_reception.queue_my_turn((p_payload->>'token')::uuid);
    exception when invalid_text_representation then
      return jsonb_build_object('ok', false, 'error', 'invalid_or_expired');
    end;
  elsif p_op = 'checkin_link' then
    return clinic_reception.agent_checkin_link(coalesce(p_payload, '{}')->>'official_booking_id', coalesce(p_payload, '{}')->>'booking_request_id');
  end if;
  return clinic_reception.fallback_api(p_op, p_payload);
end $$;
revoke all on function public.clinic_reception_fallback_api(text, jsonb) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema clinic_reception to service_role;
    grant execute on function public.clinic_reception_fallback_api(text, jsonb) to service_role;
  end if;
end $$;

commit;
