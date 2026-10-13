-- Edit task details and generate recurring tasks server-side.
create table if not exists public.task_recurrences (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.task_projects(id) on delete cascade,
  parent_task_id uuid references public.tasks(id) on delete set null,
  created_by uuid not null references public.admins(id),
  assignee_id uuid not null references public.admins(id),
  title text not null,
  description text not null default '',
  expected_output text not null default '',
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  interval_value integer not null check (interval_value between 1 and 365),
  interval_unit text not null check (interval_unit in ('day','week','month')),
  due_offset_days integer,
  next_run_at timestamptz not null,
  ends_at date,
  active boolean not null default true,
  next_occurrence integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tasks add column if not exists recurrence_id uuid references public.task_recurrences(id) on delete set null;
alter table public.tasks add column if not exists recurrence_occurrence integer;
create unique index if not exists tasks_recurrence_occurrence_uidx
  on public.tasks(recurrence_id,recurrence_occurrence) where recurrence_id is not null;
create index if not exists task_recurrences_due_idx
  on public.task_recurrences(next_run_at) where active;

alter table public.task_recurrences enable row level security;
drop policy if exists task_recurrences_read on public.task_recurrences;
create policy task_recurrences_read on public.task_recurrences for select to authenticated
  using (public.task_can_manage_project(project_id) or assignee_id=public.my_admin_id());
drop policy if exists task_recurrences_manage on public.task_recurrences;
create policy task_recurrences_manage on public.task_recurrences for all to authenticated
  using (public.task_can_manage_project(project_id)) with check (public.task_can_manage_project(project_id));
grant select,insert,update on public.task_recurrences to authenticated;

create or replace function public.task_create_recurring(
  p_project_id uuid,p_parent_task_id uuid,p_title text,p_description text,p_expected_output text,
  p_assignee_id uuid,p_due_at timestamptz,p_priority text,p_interval_value integer,p_interval_unit text,p_ends_at date
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_task_id uuid; v_series_id uuid; v_next timestamptz;
begin
  if p_interval_value not between 1 and 365 or p_interval_unit not in ('day','week','month') then
    raise exception 'Invalid recurrence interval';
  end if;
  if p_ends_at is not null and p_ends_at < current_date then raise exception 'Recurrence end date must be in the future'; end if;
  v_task_id:=public.task_create(p_project_id,p_parent_task_id,p_title,p_description,p_expected_output,p_assignee_id,p_due_at,p_priority);
  v_next:=case p_interval_unit when 'day' then now()+make_interval(days=>p_interval_value)
    when 'week' then now()+make_interval(days=>p_interval_value*7)
    else now()+make_interval(months=>p_interval_value) end;
  insert into public.task_recurrences(project_id,parent_task_id,created_by,assignee_id,title,description,expected_output,priority,
    interval_value,interval_unit,due_offset_days,next_run_at,ends_at,active)
  values(p_project_id,p_parent_task_id,public.my_admin_id(),p_assignee_id,trim(p_title),coalesce(p_description,''),coalesce(p_expected_output,''),
    case when p_priority in ('low','normal','high','urgent') then p_priority else 'normal' end,p_interval_value,p_interval_unit,
    case when p_due_at is null then null else (p_due_at::date-current_date) end,v_next,p_ends_at,(p_ends_at is null or v_next::date<=p_ends_at))
  returning id into v_series_id;
  update public.tasks set recurrence_id=v_series_id,recurrence_occurrence=0 where id=v_task_id;
  return v_task_id;
end $$;
revoke all on function public.task_create_recurring(uuid,uuid,text,text,text,uuid,timestamptz,text,integer,text,date) from public;
grant execute on function public.task_create_recurring(uuid,uuid,text,text,text,uuid,timestamptz,text,integer,text,date) to authenticated;

create or replace function public.task_update_details(
  p_task_id uuid,p_title text,p_description text,p_expected_output text,p_assignee_id uuid,p_due_at timestamptz,p_priority text,
  p_repeat_active boolean,p_interval_value integer,p_interval_unit text,p_ends_at date,p_update_future boolean
) returns void language plpgsql security definer set search_path=public as $$
declare v_task public.tasks%rowtype; v_series public.task_recurrences%rowtype; v_series_id uuid; v_due_offset integer; v_next timestamptz;
begin
  select * into v_task from public.tasks where id=p_task_id for update;
  if not found or not public.task_can_manage_project(v_task.project_id) then raise exception 'Not allowed to edit this task'; end if;
  if length(trim(coalesce(p_title,'')))<2 or length(trim(p_title))>180 then raise exception 'Task title must be between 2 and 180 characters'; end if;
  if not exists(select 1 from public.admins where id=p_assignee_id and active) then raise exception 'Assignee is not active'; end if;
  if p_repeat_active and (p_interval_value not between 1 and 365 or p_interval_unit not in ('day','week','month')) then raise exception 'Invalid recurrence interval'; end if;
  if p_repeat_active and p_ends_at is not null and p_ends_at<current_date then raise exception 'Recurrence end date must be in the future'; end if;
  insert into public.task_project_members(project_id,admin_id,role_name) values(v_task.project_id,p_assignee_id,'contributor') on conflict(project_id,admin_id) do nothing;
  update public.tasks set title=trim(p_title),description=coalesce(p_description,''),expected_output=coalesce(p_expected_output,''),
    assignee_id=p_assignee_id,due_at=p_due_at,priority=case when p_priority in ('low','normal','high','urgent') then p_priority else 'normal' end,
    updated_at=now() where id=p_task_id;

  if v_task.recurrence_id is not null then
    v_series_id:=v_task.recurrence_id;
    if not p_repeat_active then
      update public.task_recurrences set active=false,updated_at=now() where id=v_series_id;
    elsif p_update_future then
      v_next:=case p_interval_unit when 'day' then now()+make_interval(days=>p_interval_value)
        when 'week' then now()+make_interval(days=>p_interval_value*7)
        else now()+make_interval(months=>p_interval_value) end;
      update public.task_recurrences set assignee_id=p_assignee_id,title=trim(p_title),description=coalesce(p_description,''),
        expected_output=coalesce(p_expected_output,''),priority=case when p_priority in ('low','normal','high','urgent') then p_priority else 'normal' end,
        interval_value=p_interval_value,interval_unit=p_interval_unit,
        due_offset_days=case when p_due_at is null then null else (p_due_at::date-current_date) end,
        next_run_at=v_next,ends_at=p_ends_at,active=true,updated_at=now() where id=v_series_id;
    else
      update public.task_recurrences set active=true,updated_at=now() where id=v_series_id and p_repeat_active;
    end if;
  elsif p_repeat_active then
    v_next:=case p_interval_unit when 'day' then now()+make_interval(days=>p_interval_value)
      when 'week' then now()+make_interval(days=>p_interval_value*7)
      else now()+make_interval(months=>p_interval_value) end;
    insert into public.task_recurrences(project_id,parent_task_id,created_by,assignee_id,title,description,expected_output,priority,
      interval_value,interval_unit,due_offset_days,next_run_at,ends_at,active)
    values(v_task.project_id,v_task.parent_task_id,public.my_admin_id(),p_assignee_id,trim(p_title),coalesce(p_description,''),
      coalesce(p_expected_output,''),case when p_priority in ('low','normal','high','urgent') then p_priority else 'normal' end,
      p_interval_value,p_interval_unit,case when p_due_at is null then null else (p_due_at::date-current_date) end,v_next,p_ends_at,(p_ends_at is null or v_next::date<=p_ends_at))
    returning id into v_series_id;
    update public.tasks set recurrence_id=v_series_id,recurrence_occurrence=0 where id=p_task_id;
  end if;

  if v_task.assignee_id<>p_assignee_id then
    insert into public.task_notifications(recipient_id,task_id,kind,message)
    values(p_assignee_id,p_task_id,'assigned','تم إسناد المهمة إليك: '||trim(p_title)) on conflict do nothing;
  end if;
  insert into public.task_updates(task_id,author_id,body,status_from,status_to)
  values(p_task_id,public.my_admin_id(),'تم تعديل تفاصيل المهمة',v_task.status,v_task.status);
end $$;
revoke all on function public.task_update_details(uuid,text,text,text,uuid,timestamptz,text,boolean,integer,text,date,boolean) from public;
grant execute on function public.task_update_details(uuid,text,text,text,uuid,timestamptz,text,boolean,integer,text,date,boolean) to authenticated;

create or replace function public.task_generate_due_recurrences()
returns integer language plpgsql security definer set search_path=public as $$
declare r public.task_recurrences%rowtype; v_count integer:=0; v_next timestamptz; v_due timestamptz;
begin
  for r in select * from public.task_recurrences where active and next_run_at<=now()
    and (ends_at is null or next_run_at::date<=ends_at) order by next_run_at for update skip locked
  loop
    v_due:=case when r.due_offset_days is null then null else now()+make_interval(days=>r.due_offset_days) end;
    insert into public.tasks(project_id,parent_task_id,title,description,expected_output,assignee_id,created_by,status,priority,due_at,recurrence_id,recurrence_occurrence)
    values(r.project_id,r.parent_task_id,r.title,r.description,r.expected_output,r.assignee_id,r.created_by,'todo',r.priority,v_due,r.id,r.next_occurrence)
    on conflict (recurrence_id,recurrence_occurrence) where recurrence_id is not null do nothing;
    if found then
      insert into public.task_notifications(recipient_id,task_id,kind,message)
      values(r.assignee_id,(select id from public.tasks where recurrence_id=r.id order by recurrence_occurrence desc limit 1),'assigned',
        'تم إنشاء المهمة الدورية: '||r.title) on conflict do nothing;
      v_count:=v_count+1;
    end if;
    v_next:=case r.interval_unit when 'day' then now()+make_interval(days=>r.interval_value)
      when 'week' then now()+make_interval(days=>r.interval_value*7)
      else now()+make_interval(months=>r.interval_value) end;
    update public.task_recurrences set next_run_at=v_next,next_occurrence=next_occurrence+1,active=(ends_at is null or v_next::date<=ends_at),updated_at=now() where id=r.id;
  end loop;
  return v_count;
end $$;
revoke all on function public.task_generate_due_recurrences() from public,authenticated;
grant execute on function public.task_generate_due_recurrences() to service_role;

drop function if exists public.task_list_visible();
create function public.task_list_visible()
returns table(id uuid,project_id uuid,parent_task_id uuid,title text,description text,expected_output text,
 assignee_id uuid,assignee_name text,created_by uuid,status text,priority text,due_at timestamptz,
 return_note text,completed_at timestamptz,created_at timestamptz,updated_at timestamptz,
 project_title text,project_manager_id uuid,parent_title text,can_manage boolean,
 recurrence_id uuid,recurrence_active boolean,recurrence_interval_value integer,recurrence_interval_unit text,recurrence_next_run_at timestamptz,recurrence_ends_at date)
language sql stable security definer set search_path=public as $$
  select t.id,t.project_id,t.parent_task_id,t.title,t.description,t.expected_output,t.assignee_id,
    coalesce(nullif(a.name,''),a.email),t.created_by,t.status,t.priority,t.due_at,t.return_note,
    t.completed_at,t.created_at,t.updated_at,p.title,p.manager_id,pt.title,public.task_can_manage_project(t.project_id),
    t.recurrence_id,coalesce(r.active,false),r.interval_value,r.interval_unit,r.next_run_at,r.ends_at
  from public.tasks t join public.task_projects p on p.id=t.project_id
  join public.admins a on a.id=t.assignee_id left join public.tasks pt on pt.id=t.parent_task_id
  left join public.task_recurrences r on r.id=t.recurrence_id
  where public.task_can_manage_project(t.project_id) or t.assignee_id=public.my_admin_id()
  order by t.due_at nulls last,t.created_at desc;
$$;
revoke all on function public.task_list_visible() from public;
grant execute on function public.task_list_visible() to authenticated;

create extension if not exists pg_cron with schema pg_catalog;
do $$
declare j record;
begin
  for j in select jobid from cron.job where jobname='ssmpd-task-recurrences' loop
    perform cron.unschedule(j.jobid);
  end loop;
  perform cron.schedule('ssmpd-task-recurrences','* * * * *','select public.task_generate_due_recurrences();');
end $$;

notify pgrst, 'reload schema';
