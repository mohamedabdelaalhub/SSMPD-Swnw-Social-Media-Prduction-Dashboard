-- الاعتماد مسموح من «للتعديل» كمان (محمد، 2026-10-26): تعليق المدير على مهمة في المراجعة بيرجّعها revision،
-- فلو المدير داس «اعتماد وإكمال» بعدها كان بيطلع "Task is not waiting for review". طلب التعديل لسه من review بس.
create or replace function public.task_review(p_task_id uuid, p_approve boolean, p_note text)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_task public.tasks%rowtype; v_status text;
begin
  if not public.finance_module_allowed('tasks','update') then raise exception 'ليس لديك صلاحية هذا الإجراء في المهام';end if;
  select * into v_task from public.tasks where id=p_task_id for update;
  if not found or not public.task_can_manage_project(v_task.project_id) then raise exception 'Not allowed to review this task'; end if;
  if not (v_task.status='review' or (p_approve and v_task.status='revision')) then
    raise exception 'المهمة مش مستنية مراجعة (حالتها الحالية: %)', v_task.status;
  end if;
  if not p_approve and length(trim(coalesce(p_note,'')))=0 then raise exception 'A return note is required'; end if;
  v_status:=case when p_approve then 'done' else 'revision' end;
  update public.tasks set status=v_status,return_note=case when p_approve then null else trim(p_note) end,
    completed_at=case when p_approve then now() else null end,updated_at=now() where id=p_task_id;
  insert into public.task_updates(task_id,author_id,body,status_from,status_to)
    values(p_task_id,public.my_admin_id(),case when p_approve then coalesce(nullif(trim(p_note),''),'تم اعتماد المهمة') else 'إعادة للتعديل: '||trim(p_note) end,v_task.status,v_status);
  insert into public.task_notifications(recipient_id,task_id,kind,message)
    values(v_task.assignee_id,p_task_id,case when p_approve then 'status' else 'returned' end,
      case when p_approve then 'تم اعتماد المهمة: ' else 'أُعيدت المهمة للتعديل: ' end||v_task.title)
    on conflict do nothing;
end $function$;
