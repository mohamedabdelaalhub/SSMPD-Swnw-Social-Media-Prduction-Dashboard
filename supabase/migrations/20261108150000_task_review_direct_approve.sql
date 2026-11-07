-- «اعتماد مباشر» (محمد، 2026-11-08): مدير المشروع يقدر يعتمد ويقفل مهمة حتى لو الموظف ماسلّمهاش رسميًا
-- (لم تبدأ / جاري العمل / متوقفة)، بشرط يكتب سبب الاعتماد — بيتسجّل في السجل «اعتماد مباشر من المدير: …».
-- الاعتماد العادي من «بانتظار المراجعة»/«مطلوب تعديل» زي ما هو (الملاحظة اختيارية)، والإرجاع للتعديل زي ما هو.
-- Claude لسه ممنوع يعتمد/يقفل أي مهمة (claude_task_guard على الجدول).
create or replace function public.task_review(p_task_id uuid, p_approve boolean, p_note text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_task public.tasks%rowtype;
  v_status text;
  v_note text := trim(coalesce(p_note,''));
  v_direct boolean;
begin
  if not public.finance_module_allowed('tasks','update') then
    raise exception 'ليس لديك صلاحية هذا الإجراء في المهام';
  end if;

  select * into v_task
  from public.tasks
  where id=p_task_id
  for update;

  if not found or not public.task_can_manage_project(v_task.project_id) then
    raise exception 'Not allowed to review this task';
  end if;

  v_direct := p_approve and v_task.status in ('todo','in_progress','blocked');

  -- الاعتماد: من «في المراجعة» أو «مطلوب تعديل»، أو مباشر من أي حالة مفتوحة.
  -- طلب/تحديث التعديل: من «في المراجعة» أو «مطلوب تعديل».
  if not (
    v_task.status='review'
    or (p_approve and v_task.status='revision')
    or v_direct
    or (not p_approve and v_task.status='revision')
  ) then
    raise exception 'المهمة مش مستنية مراجعة (حالتها الحالية: %)', v_task.status;
  end if;

  if v_direct and length(v_note)=0 then
    raise exception 'اكتب سبب الاعتماد المباشر (الموظف ماسلّمش المهمة رسميًا)';
  end if;

  if not p_approve and length(v_note)=0 then
    raise exception 'A return note is required';
  end if;

  -- لو الهاتف/الشبكة أعاد نفس الطلب وهو بالفعل «مطلوب تعديل»، لا نكرر السجل أو التنبيه.
  if not p_approve
     and v_task.status='revision'
     and v_note=trim(coalesce(v_task.return_note,'')) then
    return;
  end if;

  v_status := case when p_approve then 'done' else 'revision' end;

  update public.tasks
  set status=v_status,
      return_note=case when p_approve then null else v_note end,
      completed_at=case when p_approve then now() else null end,
      updated_at=now()
  where id=p_task_id;

  insert into public.task_updates(task_id,author_id,body,status_from,status_to)
  values(
    p_task_id,
    public.my_admin_id(),
    case
      when v_direct then 'اعتماد مباشر من المدير: '||v_note
      when p_approve then coalesce(nullif(v_note,''),'تم اعتماد المهمة')
      when v_task.status='revision' then 'تحديث طلب التعديل: '||v_note
      else 'إعادة للتعديل: '||v_note
    end,
    v_task.status,
    v_status
  );

  if not p_approve and v_task.status='revision' then
    insert into public.task_notifications(recipient_id,task_id,kind,message)
    values(v_task.assignee_id,p_task_id,'returned','تم تحديث طلب التعديل: '||v_task.title)
    on conflict (recipient_id,task_id,kind,reference_date)
    do update set
      message=excluded.message,
      created_at=now(),
      read_at=null;
  else
    insert into public.task_notifications(recipient_id,task_id,kind,message)
    values(
      v_task.assignee_id,
      p_task_id,
      case when p_approve then 'status' else 'returned' end,
      case when p_approve then 'تم اعتماد المهمة: ' else 'أُعيدت المهمة للتعديل: ' end||v_task.title
    )
    on conflict do nothing;
  end if;
end
$function$;
