-- Queue phase 3: the waiting-screen board. Owner approved the scope 2026-11-19 («موافق»): a board per doctor and per
-- department with room, current number and waiting numbers; every new call shows the number and room with an alert sound;
-- no patient names on the screen.
-- Public entry point guarded by the existing display-session token (the same one the check-in QR screen uses):
-- anon can only read numbers, rooms and doctor/department names. No patient data, no ids of patients or appointments.

begin;

create or replace function public.clinic_reception_queue_display(p_display_token uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare ds clinic_reception.display_sessions%rowtype; b jsonb;
begin
  select * into ds from clinic_reception.display_sessions
   where token = p_display_token and revoked_at is null and expires_at > now();
  if not found then raise exception 'رابط شاشة الانتظار غير صالح أو انتهت صلاحيته'; end if;
  update clinic_reception.display_sessions set last_seen_at = now() where id = ds.id and (last_seen_at is null or last_seen_at < now() - interval '30 seconds');
  b := clinic_reception.queue_board(ds.workspace_id, clinic_reception.today());
  return jsonb_build_object(
    'server_now', now(),
    'date', b->'date',
    'doctors', coalesce((select jsonb_agg(jsonb_build_object('name', x->>'name', 'specialty', x->>'specialty', 'room_label', x->>'room_label',
        'current_no', x->'current_no', 'waiting_nos', x->'waiting_nos', 'waiting_count', x->'waiting_count', 'done_count', x->'done_count'))
        from jsonb_array_elements(b->'doctors') x), '[]'),
    'departments', coalesce((select jsonb_agg(jsonb_build_object('name', x->>'name', 'room_label', x->>'room_label', 'ticket_prefix', x->>'ticket_prefix',
        'current_no', x->'current_no', 'waiting_nos', x->'waiting_nos', 'waiting_count', x->'waiting_count', 'done_count', x->'done_count'))
        from jsonb_array_elements(b->'departments') x), '[]'),
    'calls', coalesce((select jsonb_agg(jsonb_build_object('call_id', x->>'call_id', 'ticket_no', x->>'ticket_no', 'room_label', x->>'room_label', 'called_at', x->>'called_at'))
        from jsonb_array_elements(b->'calls') x), '[]'));
end $$;

revoke all on function public.clinic_reception_queue_display(uuid) from public;
grant execute on function public.clinic_reception_queue_display(uuid) to anon, authenticated, service_role;

commit;
