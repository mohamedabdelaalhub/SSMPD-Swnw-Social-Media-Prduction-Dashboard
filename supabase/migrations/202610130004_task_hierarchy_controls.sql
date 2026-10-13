-- ترتيب المهام وحذف المشاريع والمهام من واجهة المهام.
alter table public.tasks add column if not exists sort_order integer not null default 0;

with ranked as (
  select id,row_number() over (
    partition by project_id,parent_task_id
    order by due_at nulls last,created_at,id
  ) * 1000 as new_order
  from public.tasks
)
update public.tasks t set sort_order=r.new_order
from ranked r where r.id=t.id and t.sort_order=0;

create or replace function public.task_assign_default_order()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.sort_order=0 then
    select coalesce(max(t.sort_order),0)+1000 into new.sort_order
    from public.tasks t
    where t.project_id=new.project_id
      and t.parent_task_id is not distinct from new.parent_task_id;
  end if;
  return new;
end
$$;
drop trigger if exists tasks_default_order on public.tasks;
create trigger tasks_default_order before insert on public.tasks
for each row execute function public.task_assign_default_order();

drop function if exists public.task_list_visible();
create function public.task_list_visible()
returns table(id uuid,project_id uuid,parent_task_id uuid,title text,description text,expected_output text,
 assignee_id uuid,assignee_name text,created_by uuid,status text,priority text,due_at timestamptz,
 return_note text,completed_at timestamptz,created_at timestamptz,updated_at timestamptz,
 project_title text,project_manager_id uuid,parent_title text,can_manage boolean,
 recurrence_id uuid,recurrence_active boolean,recurrence_interval_value integer,recurrence_interval_unit text,
 recurrence_next_run_at timestamptz,recurrence_ends_at date,sort_order integer)
language sql stable security definer set search_path=public as $$
  select t.id,t.project_id,t.parent_task_id,t.title,t.description,t.expected_output,t.assignee_id,
    coalesce(nullif(a.name,''),a.email),t.created_by,t.status,t.priority,t.due_at,t.return_note,
    t.completed_at,t.created_at,t.updated_at,p.title,p.manager_id,pt.title,public.task_can_manage_project(t.project_id),
    t.recurrence_id,coalesce(r.active,false),r.interval_value,r.interval_unit,r.next_run_at,r.ends_at,t.sort_order
  from public.tasks t join public.task_projects p on p.id=t.project_id
  join public.admins a on a.id=t.assignee_id left join public.tasks pt on pt.id=t.parent_task_id
  left join public.task_recurrences r on r.id=t.recurrence_id
  where public.finance_module_allowed('tasks','view')
    and (public.task_can_manage_project(t.project_id) or t.assignee_id=public.my_admin_id())
  order by t.project_id,t.parent_task_id,t.sort_order,t.due_at nulls last,t.created_at;
$$;
revoke all on function public.task_list_visible() from public;
grant execute on function public.task_list_visible() to authenticated;

create or replace function public.task_set_order(p_task_ids uuid[])
returns void language plpgsql security definer set search_path=public as $$
declare
  v_first public.tasks%rowtype;
  v_count integer;
begin
  if coalesce(array_length(p_task_ids,1),0)<1 then
    raise exception 'Choose at least one task';
  end if;
  if cardinality(p_task_ids)<>(select count(distinct x) from unnest(p_task_ids) x) then
    raise exception 'Task order contains duplicates';
  end if;

  select * into v_first from public.tasks where id=p_task_ids[1];
  if not found or not public.task_can_manage_project(v_first.project_id) then
    raise exception 'Not allowed to reorder these tasks';
  end if;

  select count(*) into v_count from public.tasks t
  where t.id=any(p_task_ids)
    and t.project_id=v_first.project_id
    and t.parent_task_id is not distinct from v_first.parent_task_id;
  if v_count<>cardinality(p_task_ids) then
    raise exception 'Tasks must belong to the same project and level';
  end if;

  update public.tasks t
  set sort_order=ordered.position*1000,updated_at=now()
  from unnest(p_task_ids) with ordinality as ordered(id,position)
  where t.id=ordered.id;
end
$$;
revoke all on function public.task_set_order(uuid[]) from public;
grant execute on function public.task_set_order(uuid[]) to authenticated;

create or replace function public.task_delete(p_task_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_project_id uuid;
begin
  select project_id into v_project_id from public.tasks where id=p_task_id for update;
  if not found or not public.task_can_manage_project(v_project_id) then
    raise exception 'Not allowed to delete this task';
  end if;
  delete from public.tasks where id=p_task_id;
end
$$;
revoke all on function public.task_delete(uuid) from public;
grant execute on function public.task_delete(uuid) to authenticated;

create or replace function public.task_delete_project(p_project_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.task_can_manage_project(p_project_id) then
    raise exception 'Not allowed to delete this project';
  end if;
  delete from public.task_projects where id=p_project_id;
end
$$;
revoke all on function public.task_delete_project(uuid) from public;
grant execute on function public.task_delete_project(uuid) to authenticated;

notify pgrst, 'reload schema';
