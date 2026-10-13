-- مهام الموظفين والمشاريع المشتركة
-- شغّل هذا الملف مرة واحدة من Supabase SQL Editor بعد مراجعة الـ PR.
create extension if not exists pgcrypto;

create table if not exists public.task_projects (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 2 and 180),
  description text not null default '',
  created_by uuid not null references public.admins(id),
  manager_id uuid not null references public.admins(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table if not exists public.task_project_members (
  project_id uuid not null references public.task_projects(id) on delete cascade,
  admin_id uuid not null references public.admins(id) on delete cascade,
  role_name text not null default 'contributor' check (role_name in ('manager','contributor','reviewer')),
  added_at timestamptz not null default now(),
  primary key (project_id, admin_id)
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.task_projects(id) on delete cascade,
  parent_task_id uuid references public.tasks(id) on delete cascade,
  title text not null check (length(trim(title)) between 2 and 180),
  description text not null default '',
  expected_output text not null default '',
  assignee_id uuid not null references public.admins(id),
  created_by uuid not null references public.admins(id),
  status text not null default 'todo' check (status in ('todo','in_progress','review','revision','done','blocked')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  due_at timestamptz,
  return_note text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (parent_task_id is null or parent_task_id <> id)
);

create table if not exists public.task_updates (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_id uuid not null references public.admins(id),
  body text not null check (length(trim(body)) between 1 and 5000),
  status_from text,
  status_to text,
  created_at timestamptz not null default now()
);

create table if not exists public.task_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.admins(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  kind text not null check (kind in ('assigned','status','review','returned','overdue')),
  message text not null,
  reference_date date not null default current_date,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (recipient_id, task_id, kind, reference_date)
);

create index if not exists task_projects_manager_idx on public.task_projects(manager_id);
create index if not exists task_project_members_admin_idx on public.task_project_members(admin_id);
create index if not exists tasks_assignee_status_idx on public.tasks(assignee_id,status);
create index if not exists tasks_project_parent_idx on public.tasks(project_id,parent_task_id);
create index if not exists tasks_due_idx on public.tasks(due_at) where status not in ('done');
create index if not exists task_updates_task_created_idx on public.task_updates(task_id,created_at desc);
create index if not exists task_notifications_recipient_idx on public.task_notifications(recipient_id,read_at,created_at desc);

create or replace function public.task_can_manage_project(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.task_projects p
    where p.id = p_project_id and p.archived_at is null
      and (public.has_role('super_admin') or public.has_role('general_manager')
           or p.manager_id = public.my_admin_id()
           or exists (select 1 from public.task_project_members m
                      where m.project_id=p.id and m.admin_id=public.my_admin_id() and m.role_name='manager'))
  );
$$;

create or replace function public.task_can_access_project(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.task_projects p
    where p.id = p_project_id and p.archived_at is null
      and (public.has_role('super_admin') or public.has_role('general_manager')
           or p.manager_id = public.my_admin_id()
           or exists (select 1 from public.task_project_members m
                      where m.project_id=p.id and m.admin_id=public.my_admin_id()))
  );
$$;

create or replace function public.task_can_access(p_task_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tasks t
    where t.id=p_task_id and (
      public.task_can_manage_project(t.project_id)
      or t.assignee_id=public.my_admin_id()

    )
  );
$$;

revoke all on function public.task_can_manage_project(uuid) from public;
revoke all on function public.task_can_access_project(uuid) from public;
revoke all on function public.task_can_access(uuid) from public;
grant execute on function public.task_can_manage_project(uuid) to authenticated;
grant execute on function public.task_can_access_project(uuid) to authenticated;
grant execute on function public.task_can_access(uuid) to authenticated;

alter table public.task_projects enable row level security;
alter table public.task_project_members enable row level security;
alter table public.tasks enable row level security;
alter table public.task_updates enable row level security;
alter table public.task_notifications enable row level security;

drop policy if exists task_projects_read on public.task_projects;
create policy task_projects_read on public.task_projects for select to authenticated using (public.task_can_access_project(id));
drop policy if exists task_projects_create on public.task_projects;
create policy task_projects_create on public.task_projects for insert to authenticated
  with check (created_by=public.my_admin_id() and (public.has_role('super_admin') or public.has_role('general_manager')));
drop policy if exists task_projects_update on public.task_projects;
create policy task_projects_update on public.task_projects for update to authenticated using (public.task_can_manage_project(id)) with check (public.task_can_manage_project(id));

drop policy if exists task_members_read on public.task_project_members;
create policy task_members_read on public.task_project_members for select to authenticated
  using (admin_id=public.my_admin_id() or public.task_can_manage_project(project_id));
drop policy if exists task_members_manage on public.task_project_members;
create policy task_members_manage on public.task_project_members for all to authenticated
  using (public.task_can_manage_project(project_id)) with check (public.task_can_manage_project(project_id));

drop policy if exists tasks_read on public.tasks;
create policy tasks_read on public.tasks for select to authenticated
  using (public.task_can_manage_project(project_id) or assignee_id=public.my_admin_id());
drop policy if exists tasks_create on public.tasks;
create policy tasks_create on public.tasks for insert to authenticated with check (
  created_by=public.my_admin_id() and public.task_can_manage_project(project_id)
  and exists (select 1 from public.task_project_members m where m.project_id=tasks.project_id and m.admin_id=tasks.assignee_id)
  and (parent_task_id is null or exists (select 1 from public.tasks p where p.id=parent_task_id and p.project_id=tasks.project_id))
);
drop policy if exists tasks_manager_update on public.tasks;
create policy tasks_manager_update on public.tasks for update to authenticated using (public.task_can_manage_project(project_id)) with check (public.task_can_manage_project(project_id));

drop policy if exists task_updates_read on public.task_updates;
create policy task_updates_read on public.task_updates for select to authenticated using (public.task_can_access(task_id));
drop policy if exists task_updates_add on public.task_updates;
create policy task_updates_add on public.task_updates for insert to authenticated
  with check (author_id=public.my_admin_id() and public.task_can_access(task_id));
drop policy if exists task_notifications_read on public.task_notifications;
create policy task_notifications_read on public.task_notifications for select to authenticated using (recipient_id=public.my_admin_id());
drop policy if exists task_notifications_update on public.task_notifications;
create policy task_notifications_update on public.task_notifications for update to authenticated
  using (recipient_id=public.my_admin_id()) with check (recipient_id=public.my_admin_id());

grant select,insert,update on public.task_projects to authenticated;
grant select,insert,update on public.task_project_members to authenticated;
grant select,insert,update on public.tasks to authenticated;
grant select,insert on public.task_updates to authenticated;
grant select on public.task_notifications to authenticated;
grant update(read_at) on public.task_notifications to authenticated;

create or replace function public.task_people()
returns table(id uuid,name text)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.my_admin_id() is null then raise exception 'Authentication required'; end if;
  return query select a.id, coalesce(nullif(a.name,''),a.email)
    from public.admins a where a.active order by coalesce(nullif(a.name,''),a.email);
end $$;
revoke all on function public.task_people() from public;
grant execute on function public.task_people() to authenticated;

create or replace function public.task_create_project(p_title text,p_description text,p_manager_id uuid,p_members jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not (public.has_role('super_admin') or public.has_role('general_manager')) then raise exception 'Not allowed to create projects'; end if;
  if not exists(select 1 from public.admins where id=p_manager_id and active) then raise exception 'Project manager is not active'; end if;
  insert into public.task_projects(title,description,created_by,manager_id)
    values(trim(p_title),coalesce(p_description,''),public.my_admin_id(),p_manager_id) returning id into v_id;
  insert into public.task_project_members(project_id,admin_id,role_name) values(v_id,p_manager_id,'manager');
  insert into public.task_project_members(project_id,admin_id,role_name)
    select v_id,x.admin_id,case when x.role_name in ('manager','contributor','reviewer') then x.role_name else 'contributor' end
    from jsonb_to_recordset(coalesce(p_members,'[]'::jsonb)) as x(admin_id uuid,role_name text)
    join public.admins a on a.id=x.admin_id and a.active
    on conflict(project_id,admin_id) do update set role_name=case when excluded.admin_id=p_manager_id then 'manager' else excluded.role_name end;
  return v_id;
end $$;
revoke all on function public.task_create_project(text,text,uuid,jsonb) from public;
grant execute on function public.task_create_project(text,text,uuid,jsonb) to authenticated;

create or replace function public.task_create(p_project_id uuid,p_parent_task_id uuid,p_title text,p_description text,p_expected_output text,p_assignee_id uuid,p_due_at timestamptz,p_priority text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.task_can_manage_project(p_project_id) then raise exception 'Not allowed to manage this project'; end if;
  if not exists(select 1 from public.admins where id=p_assignee_id and active) then
    raise exception 'Assignee is not active';
  end if;
  insert into public.task_project_members(project_id,admin_id,role_name)
    values(p_project_id,p_assignee_id,'contributor') on conflict(project_id,admin_id) do nothing;
  if p_parent_task_id is not null and not exists(select 1 from public.tasks where id=p_parent_task_id and project_id=p_project_id) then
    raise exception 'Parent task must belong to this project';
  end if;
  insert into public.tasks(project_id,parent_task_id,title,description,expected_output,assignee_id,created_by,due_at,priority)
   values(p_project_id,p_parent_task_id,trim(p_title),coalesce(p_description,''),coalesce(p_expected_output,''),p_assignee_id,public.my_admin_id(),p_due_at,
          case when p_priority in ('low','normal','high','urgent') then p_priority else 'normal' end)
   returning id into v_id;
  insert into public.task_notifications(recipient_id,task_id,kind,message)
   values(p_assignee_id,v_id,'assigned','تم إسناد مهمة جديدة إليك: '||trim(p_title));
  return v_id;
end $$;
revoke all on function public.task_create(uuid,uuid,text,text,text,uuid,timestamptz,text) from public;
grant execute on function public.task_create(uuid,uuid,text,text,text,uuid,timestamptz,text) to authenticated;

create or replace function public.task_set_status(p_task_id uuid,p_status text,p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_task public.tasks%rowtype; v_actor uuid:=public.my_admin_id();
begin
  select * into v_task from public.tasks where id=p_task_id for update;
  if not found then raise exception 'Task not found'; end if;
  if v_task.assignee_id<>v_actor then
    raise exception 'Only the assignee can update this task';
  end if;
  if p_status not in ('in_progress','review','blocked') then raise exception 'Invalid employee status'; end if;
  if length(trim(coalesce(p_note,'')))=0 then raise exception 'Write a short work update first'; end if;
  update public.tasks set status=p_status, return_note=null, updated_at=now() where id=p_task_id;
  insert into public.task_updates(task_id,author_id,body,status_from,status_to)
    values(p_task_id,v_actor,trim(p_note),v_task.status,p_status);
  insert into public.task_notifications(recipient_id,task_id,kind,message)
    select recipients.admin_id,p_task_id,case when p_status='review' then 'review' else 'status' end,
           case when p_status='review' then 'المهمة جاهزة للمراجعة: ' else 'تم تحديث حالة المهمة: ' end||v_task.title
    from (
      select p.manager_id as admin_id from public.task_projects p where p.id=v_task.project_id
      union
      select m.admin_id from public.task_project_members m where m.project_id=v_task.project_id and m.role_name='manager'
    ) recipients where recipients.admin_id<>v_actor
    on conflict do nothing;
end $$;
revoke all on function public.task_set_status(uuid,text,text) from public;
grant execute on function public.task_set_status(uuid,text,text) to authenticated;

create or replace function public.task_review(p_task_id uuid,p_approve boolean,p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_task public.tasks%rowtype; v_status text;
begin
  select * into v_task from public.tasks where id=p_task_id for update;
  if not found or not public.task_can_manage_project(v_task.project_id) then raise exception 'Not allowed to review this task'; end if;
  if v_task.status<>'review' then raise exception 'Task is not waiting for review'; end if;
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
end $$;
revoke all on function public.task_review(uuid,boolean,text) from public;
grant execute on function public.task_review(uuid,boolean,text) to authenticated;

create or replace function public.task_list_visible()
returns table(id uuid,project_id uuid,parent_task_id uuid,title text,description text,expected_output text,
 assignee_id uuid,assignee_name text,created_by uuid,status text,priority text,due_at timestamptz,
 return_note text,completed_at timestamptz,created_at timestamptz,updated_at timestamptz,
 project_title text,project_manager_id uuid,parent_title text,can_manage boolean)
language sql stable security definer set search_path = public as $$
  select t.id,t.project_id,t.parent_task_id,t.title,t.description,t.expected_output,t.assignee_id,
    coalesce(nullif(a.name,''),a.email),t.created_by,t.status,t.priority,t.due_at,t.return_note,
    t.completed_at,t.created_at,t.updated_at,p.title,p.manager_id,pt.title,public.task_can_manage_project(t.project_id)
  from public.tasks t join public.task_projects p on p.id=t.project_id
  join public.admins a on a.id=t.assignee_id left join public.tasks pt on pt.id=t.parent_task_id
  where public.task_can_manage_project(t.project_id) or t.assignee_id=public.my_admin_id()

  order by t.due_at nulls last,t.created_at desc;
$$;
revoke all on function public.task_list_visible() from public;
grant execute on function public.task_list_visible() to authenticated;

create or replace function public.task_refresh_overdue_notifications()
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if public.my_admin_id() is null then raise exception 'Authentication required'; end if;
  insert into public.task_notifications(recipient_id,task_id,kind,message,reference_date)
    select public.my_admin_id(),t.id,'overdue','المهمة متأخرة: '||t.title,current_date
    from public.tasks t where t.status not in ('done') and t.due_at < now()
      and (t.assignee_id=public.my_admin_id() or public.task_can_manage_project(t.project_id))
    on conflict do nothing;
  get diagnostics v_count=row_count;
  return v_count;
end $$;
revoke all on function public.task_refresh_overdue_notifications() from public;
grant execute on function public.task_refresh_overdue_notifications() to authenticated;

create or replace function public.task_list_projects()
returns table(id uuid,title text,description text,created_by uuid,manager_id uuid,created_at timestamptz,can_manage boolean,members jsonb)
language sql stable security definer set search_path = public as $$
 select p.id,p.title,p.description,p.created_by,p.manager_id,p.created_at,public.task_can_manage_project(p.id),
   coalesce((select jsonb_agg(jsonb_build_object('name',coalesce(nullif(a.name,''),a.email),'role',m.role_name)
                              order by coalesce(nullif(a.name,''),a.email))
             from public.task_project_members m join public.admins a on a.id=m.admin_id
             where m.project_id=p.id),'[]'::jsonb)
 from public.task_projects p
 where public.task_can_access_project(p.id) order by p.created_at desc;
$$;
revoke all on function public.task_list_projects() from public;
grant execute on function public.task_list_projects() to authenticated;
