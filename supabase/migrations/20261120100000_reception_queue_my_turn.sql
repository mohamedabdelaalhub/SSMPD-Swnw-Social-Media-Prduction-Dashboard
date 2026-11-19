-- Queue phase 4a: «اعرف دورك» for the patient, and the two read ops for the WhatsApp agent.
-- Owner approvals (2026-11-19): «موافق» on the scope: the patient link shows ticket number, how many are ahead, the number
-- inside now, room and doctor; the agent reads the queue board and the patient's turn. Numbers and status only: no patient names,
-- phones or medical data are returned by anything here.
--
-- 1. clinic_reception.queue_my_turn(token): the patient's turn from the check-in token (clinic_reception.checkin_tokens.token, the
--    same signed short-lived token reception/the agent already hands out; valid until it expires, also after check-in).
--    public.clinic_reception_my_turn(token) is the anon entry point for the patient page my-turn.html.
-- 2. public.clinic_reception_fallback_api now also answers two read-only ops (service role only, as before): 'queue_board' {date?}
--    and 'my_turn' {token}. Every other op is passed to clinic_reception.fallback_api unchanged.
-- Agent bookings that exist only in public.customer_bookings are NOT covered here (they have no check-in token, queue entry or
-- ticket yet); that is the next step and needs an owner decision.

begin;

create or replace function clinic_reception.queue_my_turn(p_token uuid)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare t clinic_reception.checkin_tokens%rowtype; a clinic_reception.appointments%rowtype; q clinic_reception.queue_entries%rowtype;
  r clinic_reception.rooms; ahead int; cur int; st text; dname text;
begin
  select * into t from clinic_reception.checkin_tokens where token = p_token;
  if not found or t.expires_at < now() then return jsonb_build_object('ok', false, 'error', 'invalid_or_expired'); end if;
  select * into a from clinic_reception.appointments where id = t.appointment_id and workspace_id = t.workspace_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'invalid_or_expired'); end if;
  select name into dname from clinic_reception.providers where id = a.provider_id;
  select * into q from clinic_reception.queue_entries where appointment_id = a.id;
  st := case
    when a.status = 'cancelled' or q.status = 'cancelled' then 'cancelled'
    when a.status = 'no_show' or q.status = 'no_show' then 'no_show'
    when q.status = 'completed' or a.status = 'completed' then 'done'
    when q.status = 'in_service' then 'in_service'
    when q.status = 'called' then 'called'
    when q.status in ('waiting', 'on_hold') and q.ticket_no is not null then 'waiting'
    else 'not_arrived' end;
  if st in ('waiting', 'called', 'in_service') then
    select count(*) into ahead from clinic_reception.queue_entries x
     where x.workspace_id = q.workspace_id and x.provider_id = q.provider_id and x.ticket_date = q.ticket_date and x.status = 'waiting'
       and (x.priority > q.priority or (x.priority = q.priority and x.ticket_no < q.ticket_no));
    select max(x.ticket_no) into cur from clinic_reception.queue_entries x
     where x.workspace_id = q.workspace_id and x.provider_id = q.provider_id and x.ticket_date = q.ticket_date and x.status in ('called', 'in_service');
    r := clinic_reception.provider_room(a.provider_id);
  end if;
  return jsonb_build_object('ok', true, 'state', st, 'order_no', q.ticket_no, 'ahead_count', ahead, 'current_no', cur,
    'room_label', r.label, 'doctor_name', dname, 'booked_time', to_char(a.starts_at at time zone 'Africa/Cairo', 'HH24:MI'),
    'stale', false, 'snapshot_at', now());
end $$;
revoke all on function clinic_reception.queue_my_turn(uuid) from public, anon, authenticated;

create or replace function public.clinic_reception_my_turn(p_token uuid)
returns jsonb language sql stable security definer set search_path = pg_catalog, public as $$ select clinic_reception.queue_my_turn(p_token) $$;
revoke all on function public.clinic_reception_my_turn(uuid) from public;
grant execute on function public.clinic_reception_my_turn(uuid) to anon, authenticated, service_role;

-- Board for the agent / lobby page. doctor_id is the Masa doctor id when linked (null otherwise).
create or replace function clinic_reception.queue_board_agent(p_date date default null)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare w uuid; b jsonb;
begin
  select id into w from clinic_reception.workspaces where mode = 'live' order by created_at limit 1;
  if w is null then return jsonb_build_object('ok', false, 'error', 'no_workspace'); end if;
  b := clinic_reception.queue_board(w, coalesce(p_date, clinic_reception.today()));
  return jsonb_build_object('ok', true, 'stale', false, 'snapshot_at', now(), 'date', b->'date',
    'doctors', coalesce((select jsonb_agg(jsonb_build_object('doctor_id', x->'masa_doctor_id', 'masa_doctor_id', x->'masa_doctor_id',
        'name', x->>'name', 'specialty', x->>'specialty', 'room_label', x->>'room_label', 'ticket_prefix', null,
        'current_no', x->'current_no', 'waiting_nos', x->'waiting_nos', 'waiting_count', x->'waiting_count', 'done_count', x->'done_count'))
        from jsonb_array_elements(b->'doctors') x), '[]'),
    'departments', coalesce((select jsonb_agg(jsonb_build_object('dept', x->>'dept', 'name', x->>'name', 'room_label', x->>'room_label',
        'ticket_prefix', x->>'ticket_prefix', 'current_no', x->'current_no', 'waiting_nos', x->'waiting_nos',
        'waiting_count', x->'waiting_count', 'done_count', x->'done_count'))
        from jsonb_array_elements(b->'departments') x), '[]'),
    'calls', coalesce((select jsonb_agg(jsonb_build_object('call_id', c->>'call_id', 'doctor_id',
        (select min(k.masa_doctor_id) from clinic_reception.masa_doctor_links k where k.provider_id = nullif(c->>'provider_id', '')::uuid and k.status = 'linked'),
        'dept', (select rm.kind from clinic_reception.rooms rm where rm.id = nullif(c->>'dept_room_id', '')::uuid),
        'ticket_no', c->>'ticket_no', 'room_label', c->>'room_label', 'called_at', c->>'called_at'))
        from jsonb_array_elements(b->'calls') c), '[]'));
end $$;
revoke all on function clinic_reception.queue_board_agent(date) from public, anon, authenticated;

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
