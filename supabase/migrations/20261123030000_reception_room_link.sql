-- «موظفي الريسبشن هم اللي هيسجلوا رقم العيادة لكل دكتور يوميا» (owner 2026-11-23, via main chat 4).
-- Today's doctor ↔ clinic-room link ('assign' / 'end_assignment' in public.clinic_reception_queue) is allowed for:
--   * reception / super_admin / general_manager roles,
--   * any member of the live workspace with 'book', 'arrive' or 'execute',
--   * anyone the previous rule already allowed (reception 'execute' access).
-- Creating / renaming / stopping rooms and room staff stay manager-only (unchanged: they go to the previous function).
-- Every link / unlink is audited in clinic_reception.audit ('room_link' / 'room_unlink': room, doctor, the doctor it replaced).
-- Outer wrapper; the previous body is kept as clinic_reception.queue_rpc_before_room_link.
-- Rollback: supabase/rollbacks/20261123030000_reception_room_link.rollback.sql
begin;

do $$ begin
  if to_regprocedure('public.clinic_reception_queue(uuid,text,jsonb)') is null then raise exception 'طبّق الغرف والطابور أولًا'; end if;
  if to_regprocedure('clinic_reception.queue_rpc_before_room_link(uuid,text,jsonb)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create function clinic_reception.room_link_allowed(p_workspace uuid) returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id();
begin
  if me is null or not exists (select 1 from public.admins where id = me and active) then raise exception 'سجل الدخول' using errcode = '42501'; end if;
  if not exists (select 1 from clinic_reception.workspaces w where w.id = p_workspace) then raise exception 'مساحة غير معروفة'; end if;
  if public.has_role('reception') or public.has_role('super_admin') or public.has_role('general_manager') then return me; end if;
  if exists (select 1 from clinic_reception.members m where m.workspace_id = p_workspace and m.admin_id = me
              and m.capabilities && array['book', 'arrive', 'execute']::text[]) then return me; end if;
  return clinic_reception.access(p_workspace, 'execute');
end $$;
revoke all on function clinic_reception.room_link_allowed(uuid) from public, anon, authenticated;

do $$ begin
  alter function public.clinic_reception_queue(uuid, text, jsonb) rename to queue_rpc_before_room_link;
  alter function public.queue_rpc_before_room_link(uuid, text, jsonb) set schema clinic_reception;
end $$;
revoke all on function clinic_reception.queue_rpc_before_room_link(uuid, text, jsonb) from public, anon, authenticated;

create function public.clinic_reception_queue(p_workspace uuid, p_action text, p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid; p jsonb := coalesce(p_payload, '{}'); rm clinic_reception.rooms; pv uuid; prev uuid; today date;
begin
  if p_action not in ('assign', 'end_assignment') then
    return clinic_reception.queue_rpc_before_room_link(p_workspace, p_action, p_payload);
  end if;
  me := clinic_reception.room_link_allowed(p_workspace);
  today := clinic_reception.today();
  select * into rm from clinic_reception.rooms where id = nullif(p->>'room_id', '')::uuid and workspace_id = p_workspace for update;
  if not found then raise exception 'الغرفة غير موجودة'; end if;
  select a.provider_id into prev from clinic_reception.room_assignments a where a.room_id = rm.id and a.ended_at is null order by a.started_at desc limit 1;
  if p_action = 'assign' then
    if not rm.active then raise exception 'الغرفة دي متوقفة'; end if;
    if rm.ticket_prefix is not null then raise exception 'دي غرفة قسم بأرقامها، مش عيادة دكتور'; end if;
    pv := nullif(p->>'provider_id', '')::uuid;
    if pv is null or not exists (select 1 from clinic_reception.providers where id = pv and workspace_id = p_workspace and active) then raise exception 'اختر طبيب'; end if;
    update clinic_reception.room_assignments set ended_at = now(), ended_by = me
     where ended_at is null and (room_id = rm.id or provider_id = pv);
    insert into clinic_reception.room_assignments(workspace_id, room_id, provider_id, service_date, assigned_by)
    values (p_workspace, rm.id, pv, today, me);
    insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id, detail)
    values (p_workspace, me, 'room_link', rm.id, jsonb_build_object('room', rm.label, 'provider_id', pv, 'replaced_provider_id', prev, 'day', today));
  else
    update clinic_reception.room_assignments a set ended_at = now(), ended_by = me where a.room_id = rm.id and a.ended_at is null;
    insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id, detail)
    values (p_workspace, me, 'room_unlink', rm.id, jsonb_build_object('room', rm.label, 'provider_id', prev, 'day', today));
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.clinic_reception_queue(uuid, text, jsonb) from public, anon;
grant execute on function public.clinic_reception_queue(uuid, text, jsonb) to authenticated;

commit;
