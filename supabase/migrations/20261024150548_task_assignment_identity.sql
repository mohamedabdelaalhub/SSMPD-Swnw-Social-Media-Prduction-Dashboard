begin;
alter table public.tasks add column assigned_by uuid references public.admins(id),add column assigned_at timestamptz;
-- Historical tasks keep an unknown current assigner; creation identity is shown separately.
create function public.stamp_task_assignment() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if tg_op='INSERT' then new.assigned_by:=new.created_by;new.assigned_at:=coalesce(new.created_at,now());
 elsif new.assignee_id is distinct from old.assignee_id then new.assigned_by:=public.my_admin_id();new.assigned_at:=now();
 else new.assigned_by:=old.assigned_by;new.assigned_at:=old.assigned_at;end if;return new;
end $$;
revoke all on function public.stamp_task_assignment() from public,anon,authenticated;
create trigger stamp_task_assignment before insert or update on public.tasks for each row execute function public.stamp_task_assignment();
create function public.task_list_with_assignment() returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce(jsonb_agg(to_jsonb(v)||jsonb_build_object('creator_name',coalesce(nullif(c.name,''),c.email),'assigner_name',coalesce(nullif(a.name,''),a.email),'assigned_at',t.assigned_at) order by v.project_id,v.parent_task_id,v.sort_order,v.due_at nulls last,v.created_at),'[]'::jsonb)
 from public.task_list_visible() v join public.tasks t on t.id=v.id left join public.admins c on c.id=v.created_by left join public.admins a on a.id=t.assigned_by;
$$;
revoke all on function public.task_list_with_assignment() from public,anon;
grant execute on function public.task_list_with_assignment() to authenticated;
commit;
