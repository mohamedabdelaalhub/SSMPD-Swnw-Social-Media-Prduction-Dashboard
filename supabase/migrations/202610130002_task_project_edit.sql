-- Project editing for the tasks workspace.
create or replace function public.task_update_project(
  p_project_id uuid,p_title text,p_description text,p_manager_id uuid,p_members jsonb
) returns void
language plpgsql security definer set search_path=public as $task_project_update$
begin
  if not public.task_can_manage_project(p_project_id) then
    raise exception 'Not allowed to manage this project';
  end if;
  if length(trim(coalesce(p_title,'')))<2 or length(trim(p_title))>180 then
    raise exception 'Project title must be between 2 and 180 characters';
  end if;
  if not exists(select 1 from public.admins where id=p_manager_id and active) then
    raise exception 'Project manager is not active';
  end if;
  if jsonb_typeof(coalesce(p_members,'[]'::jsonb))<>'array' then
    raise exception 'Project members must be a list';
  end if;
  if exists(
    select 1
    from jsonb_to_recordset(coalesce(p_members,'[]'::jsonb)) as x(admin_id uuid,role_name text)
    left join public.admins a on a.id=x.admin_id and a.active
    where a.id is null
  ) then
    raise exception 'All project members must be active';
  end if;

  update public.task_projects
  set title=trim(p_title),description=coalesce(p_description,''),manager_id=p_manager_id,updated_at=now()
  where id=p_project_id;

  delete from public.task_project_members m
  where m.project_id=p_project_id
    and m.admin_id<>p_manager_id
    and not exists(
      select 1
      from jsonb_to_recordset(coalesce(p_members,'[]'::jsonb)) as x(admin_id uuid,role_name text)
      where x.admin_id=m.admin_id
    );

  insert into public.task_project_members(project_id,admin_id,role_name)
  values(p_project_id,p_manager_id,'manager')
  on conflict(project_id,admin_id) do update set role_name='manager';

  insert into public.task_project_members(project_id,admin_id,role_name)
  select p_project_id,x.admin_id,
    case when x.admin_id=p_manager_id then 'manager'
         when x.role_name in ('manager','contributor','reviewer') then x.role_name
         else 'contributor' end
  from jsonb_to_recordset(coalesce(p_members,'[]'::jsonb)) as x(admin_id uuid,role_name text)
  on conflict(project_id,admin_id) do update set role_name=excluded.role_name;
end
$task_project_update$;

revoke all on function public.task_update_project(uuid,text,text,uuid,jsonb) from public;
grant execute on function public.task_update_project(uuid,text,text,uuid,jsonb) to authenticated;

create or replace function public.task_list_projects()
returns table(id uuid,title text,description text,created_by uuid,manager_id uuid,created_at timestamptz,can_manage boolean,members jsonb)
language sql stable security definer set search_path=public as $task_projects_list$
 select p.id,p.title,p.description,p.created_by,p.manager_id,p.created_at,public.task_can_manage_project(p.id),
   coalesce((select jsonb_agg(jsonb_build_object('id',m.admin_id,'name',coalesce(nullif(a.name,''),a.email),'role',m.role_name)
                              order by coalesce(nullif(a.name,''),a.email))
             from public.task_project_members m join public.admins a on a.id=m.admin_id
             where m.project_id=p.id),'[]'::jsonb)
 from public.task_projects p
 where public.task_can_access_project(p.id) order by p.created_at desc;
$task_projects_list$;
revoke all on function public.task_list_projects() from public;
grant execute on function public.task_list_projects() to authenticated;

notify pgrst, 'reload schema';
