create or replace function public.task_add_comment_to(p_task_id uuid, p_body text, p_attachments jsonb, p_addressed_to uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_claude uuid;
  v_actor uuid := public.my_admin_id();
  v_task public.tasks%rowtype;
  v_update uuid;
  v_item jsonb;
  v_url text;
  v_to uuid := p_addressed_to;
  v_body text := trim(coalesce(p_body,''));
  v_atts jsonb := case when jsonb_typeof(coalesce(p_attachments,'[]'::jsonb))='array' then coalesce(p_attachments,'[]'::jsonb) else '[]'::jsonb end;
begin
  select admin_id into v_claude
  from public.digital_team_members
  where code='claude_creative' and active;

  if not public.finance_module_allowed('tasks','update') then raise exception 'ليس لديك صلاحية هذا الإجراء في المهام'; end if;
  if v_actor is null then raise exception 'Authentication required'; end if;
  if not public.task_can_access(p_task_id) then raise exception 'Task not found'; end if;
  select * into v_task from public.tasks where id = p_task_id for update;
  if jsonb_array_length(v_atts) > 10 then raise exception 'الحد الأقصى 10 ملفات في التعليق الواحد'; end if;
  if v_body = '' and jsonb_array_length(v_atts) = 0 then raise exception 'اكتب تعليقاً أو أرفق ملفاً'; end if;
  if length(v_body) > 5000 then raise exception 'التعليق أطول من المسموح'; end if;
  if v_to = v_actor then v_to := null; end if;
  if v_to is not null and not exists(select 1 from public.admins where id = v_to and (active or is_system_identity)) then
    raise exception 'الشخص اللي التعليق موجّه له مش موجود أو موقوف';
  end if;
  if v_to = v_claude and v_body = '' then raise exception 'اكتب لـ Claude المطلوب منه'; end if;

  insert into public.task_updates(task_id, author_id, body, addressed_to)
    values (p_task_id, v_actor, case when v_body = '' then 'مرفقات' else v_body end, v_to)
    returning id into v_update;

  for v_item in select * from jsonb_array_elements(v_atts) loop
    v_url := v_item->>'url';
    if v_url is null or v_url !~ '^https://(drive|docs)\\.google\\.com/' then raise exception 'رابط المرفق غير صالح'; end if;
    insert into public.task_attachments(task_id, update_id, uploaded_by, file_name, mime_type, size_bytes, file_url, drive_file_id)
      values (p_task_id, v_update, v_actor,
              left(coalesce(nullif(trim(v_item->>'name'),''),'ملف'),200),
              left(coalesce(nullif(v_item->>'mime',''),'application/octet-stream'),120),
              greatest(0, least(coalesce(nullif(v_item->>'size','')::bigint,0), 1073741824)),
              v_url, left(nullif(v_item->>'file_id',''),200));
  end loop;

  insert into public.task_notifications(recipient_id, task_id, kind, message)
    select r.admin_id, p_task_id, 'comment',
      case when r.admin_id = v_to then 'تعليق موجّه لك على المهمة: ' else 'تعليق جديد على المهمة: ' end || v_task.title
    from (
      select v_task.assignee_id as admin_id
      union select p.manager_id from public.task_projects p where p.id = v_task.project_id
      union select m.admin_id from public.task_project_members m where m.project_id = v_task.project_id and m.role_name = 'manager'
      union select v_to
    ) r
    where r.admin_id is not null and r.admin_id <> v_actor
    on conflict (recipient_id, task_id, kind, reference_date)
    do update set message = excluded.message, read_at = null, created_at = now();

  if v_claude is not null and v_to = v_claude and v_actor <> v_claude
     and (public.task_can_manage_project(v_task.project_id) or public.can_manage_all_content()) then
    insert into public.claude_task_requests(task_id, update_id, requested_by, body)
      values (p_task_id, v_update, v_actor, v_body) on conflict (update_id) do nothing;
  end if;

  if v_task.status = 'review' and v_actor <> v_task.assignee_id and v_body <> ''
     and (v_to is null or v_to = v_task.assignee_id)
     and public.task_can_manage_project(v_task.project_id) then
    update public.tasks set status = 'revision', return_note = v_body, completed_at = null, updated_at = now() where id = p_task_id;
    insert into public.task_updates(task_id, author_id, body, status_from, status_to)
      values (p_task_id, v_actor, 'إعادة للتعديل من تعليق: ' || left(v_body, 4900), 'review', 'revision');
    insert into public.task_notifications(recipient_id, task_id, kind, message)
      values (v_task.assignee_id, p_task_id, 'returned', 'أُعيدت المهمة للتعديل: ' || v_task.title)
      on conflict (recipient_id, task_id, kind, reference_date)
      do update set message = excluded.message, read_at = null, created_at = now();
  end if;

  return v_update;
end
$function$;
