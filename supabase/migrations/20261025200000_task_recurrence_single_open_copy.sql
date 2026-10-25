-- مهام الموظفين المتكررة: نسخة واحدة مفتوحة بس لكل مهمة متكررة (محمد، 2026-10-25)
--
-- المشكلة: task_generate_due_recurrences() (pg_cron كل دقيقة) كانت بتعمل نسخة جديدة
-- كل ما ييجي ميعادها حتى لو النسخة اللي قبلها لسه مفتوحة (todo/in_progress/review/
-- revision/blocked) — فالموظف يلاقي نفس المهمة مرتين وتلاتة.
-- كمان الميعاد التالي كان بيتحسب من now() (وقت تشغيل الكرون) فبيزحف.
--
-- الإصلاح:
-- 1) لو فيه أي نسخة من نفس السلسلة status <> 'done' → مفيش نسخة جديدة في الدورة دي؛
--    الميعاد بيتنقل للدورة اللي بعدها (من غير تعويض الدورات اللي فاتت).
-- 2) الميعاد التالي = الميعاد المجدول + الفترة (مش now()+الفترة)، ولو فات أكتر من دورة
--    بنقفز لأول ميعاد في المستقبل — فمفيش "تعويض" بنسخ كتير مرة واحدة.
-- 3) قفل الصف (for update skip locked) + الفهرس الفريد (recurrence_id, recurrence_occurrence)
--    بيضمنوا إن تشغيلين متزامنين مايعملوش نسختين.

create or replace function public.task_recurrence_step(p_from timestamptz, p_value integer, p_unit text)
returns timestamptz language sql immutable set search_path=public as $$
  select case p_unit when 'day' then p_from+make_interval(days=>p_value)
    when 'week' then p_from+make_interval(days=>p_value*7)
    else p_from+make_interval(months=>p_value) end;
$$;
revoke all on function public.task_recurrence_step(timestamptz,integer,text) from public;

create or replace function public.task_generate_due_recurrences()
returns integer language plpgsql security definer set search_path=public as $$
declare r public.task_recurrences%rowtype; v_count integer:=0; v_next timestamptz; v_due timestamptz;
  v_task_id uuid; v_open boolean; v_guard integer;
begin
  for r in select * from public.task_recurrences where active and next_run_at<=now()
    and (ends_at is null or next_run_at::date<=ends_at) order by next_run_at for update skip locked
  loop
    -- نسخة واحدة مفتوحة بس: لازم آخر نسخة تكون اتعملت done الأول
    select exists(select 1 from public.tasks t where t.recurrence_id=r.id and t.status<>'done') into v_open;
    v_task_id:=null;
    if not v_open then
      v_due:=case when r.due_offset_days is null then null else now()+make_interval(days=>r.due_offset_days) end;
      insert into public.tasks(project_id,parent_task_id,title,description,expected_output,assignee_id,created_by,status,priority,due_at,recurrence_id,recurrence_occurrence)
      values(r.project_id,r.parent_task_id,r.title,r.description,r.expected_output,r.assignee_id,r.created_by,'todo',r.priority,v_due,r.id,r.next_occurrence)
      on conflict (recurrence_id,recurrence_occurrence) where recurrence_id is not null do nothing
      returning id into v_task_id;
      if v_task_id is not null then
        insert into public.task_notifications(recipient_id,task_id,kind,message)
        values(r.assignee_id,v_task_id,'assigned','تم إنشاء المهمة الدورية: '||r.title) on conflict do nothing;
        v_count:=v_count+1;
      end if;
    end if;
    -- الميعاد الجاي على نفس الجدول (مش من وقت التشغيل)، ومن غير تعويض الدورات اللي فاتت
    v_next:=public.task_recurrence_step(r.next_run_at,r.interval_value,r.interval_unit); v_guard:=0;
    while v_next<=now() and v_guard<1000 loop
      v_next:=public.task_recurrence_step(v_next,r.interval_value,r.interval_unit); v_guard:=v_guard+1;
    end loop;
    update public.task_recurrences set next_run_at=v_next,
      next_occurrence=next_occurrence+case when v_open then 0 else 1 end,
      active=(ends_at is null or v_next::date<=ends_at),updated_at=now() where id=r.id;
  end loop;
  return v_count;
end $$;
revoke all on function public.task_generate_due_recurrences() from public,authenticated;
grant execute on function public.task_generate_due_recurrences() to service_role;

notify pgrst, 'reload schema';
