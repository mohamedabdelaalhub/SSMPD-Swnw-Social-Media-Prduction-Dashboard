-- Run in the SSMPD content project. Adds roles and per-account grants; preserves existing data.
begin;
do $$ begin
 if to_regclass('public.task_projects') is null or to_regclass('public.contracting_entities') is null then
  raise exception 'شغّل إعداد المهام وجهات التعاقد أولاً في مشروع إنتاج المحتوى';
 end if;
end $$;
alter table public.admins drop constraint if exists admins_role_check;
alter table public.admins add constraint admins_role_check check(role in ('page_manager','designer','approver','general_manager','super_admin','reception','customer_service','nursing','sono_doctor','contract_manager','accountant','financial_manager'));
alter table public.admin_extra_roles drop constraint if exists admin_extra_roles_role_check;
alter table public.admin_extra_roles add constraint admin_extra_roles_role_check check(role in ('page_manager','designer','approver','general_manager','super_admin','reception','customer_service','nursing','sono_doctor','contract_manager','accountant','financial_manager'));
create table if not exists public.admin_module_permissions(
 admin_id uuid not null references public.admins(id) on delete cascade,
 module_key text not null check(module_key in ('accounting','contracting_entities','tasks')),
 can_view boolean not null default false,can_create boolean not null default false,
 can_update boolean not null default false,can_delete boolean not null default false,
 updated_by uuid references public.admins(id),updated_at timestamptz not null default now(),
 primary key(admin_id,module_key),
 check(can_view or not(can_create or can_update or can_delete)),
 check(module_key<>'tasks' or not can_delete)
);
alter table public.admin_module_permissions enable row level security;
revoke all on public.admin_module_permissions from public,anon,authenticated;
grant select on public.admin_module_permissions to authenticated;
drop policy if exists "own module permissions" on public.admin_module_permissions;
create policy "own module permissions" on public.admin_module_permissions for select to authenticated
 using(public.my_admin_id() is not null and (admin_id=public.my_admin_id() or public.has_role('super_admin')));
create or replace function public.is_controlled_finance()
returns boolean language sql stable security definer set search_path=public as $$
 select (public.has_role('accountant') or public.has_role('financial_manager'))
 and not(public.has_role('super_admin') or public.has_role('general_manager'));
$$;
create or replace function public.finance_module_allowed(p_module text,p_action text)
returns boolean language sql stable security definer set search_path=public as $$
 select public.my_admin_id() is not null and p_module in ('accounting','contracting_entities','tasks')
 and p_action in ('view','create','update','delete') and
 (not public.is_controlled_finance() or exists(select 1 from public.admin_module_permissions p
 where p.admin_id=public.my_admin_id() and p.module_key=p_module and p.can_view and
 case p_action when 'view' then true when 'create' then p.can_create when 'update' then p.can_update else p.can_delete end));
$$;
revoke all on function public.is_controlled_finance() from public;
revoke all on function public.finance_module_allowed(text,text) from public;
grant execute on function public.is_controlled_finance() to authenticated;
grant execute on function public.finance_module_allowed(text,text) to authenticated;
create or replace function public.set_admin_module_permissions(p_admin_id uuid,p_permissions jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare entry jsonb; me uuid:=public.my_admin_id(); seen text[]:=array[]::text[]; key text; target public.admins%rowtype;
begin
 if me is null or not public.has_role('super_admin') then raise exception 'الصلاحيات متاحة للسوبر أدمن فقط' using errcode='42501';end if;
 select * into target from public.admins where id=p_admin_id for update;
 if not found or not(target.role in ('accountant','financial_manager') or exists(select 1 from public.admin_extra_roles where admin_id=p_admin_id and role in ('accountant','financial_manager'))) then raise exception 'اختر حساب محاسب أو مدير مالي';end if;
 if target.role in ('super_admin','general_manager') or exists(select 1 from public.admin_extra_roles where admin_id=p_admin_id and role in ('super_admin','general_manager')) then raise exception 'الأدوار الإدارية لهذا الحساب لها صلاحياتها الحالية؛ عدّل الدور أولاً';end if;
 if p_permissions is null or jsonb_typeof(p_permissions)<>'array' or jsonb_array_length(p_permissions)<>3 then raise exception 'أرسل صلاحيات الأقسام الثلاثة';end if;
 for entry in select value from jsonb_array_elements(p_permissions) loop
  key:=entry->>'module_key';
  if key is null or key not in ('accounting','contracting_entities','tasks') or key=any(seen) then raise exception 'قسم غير صالح أو مكرر';end if;
  seen:=array_append(seen,key);
  if coalesce(jsonb_typeof(entry->'can_view'),'')<>'boolean' or coalesce(jsonb_typeof(entry->'can_create'),'')<>'boolean' or coalesce(jsonb_typeof(entry->'can_update'),'')<>'boolean' or coalesce(jsonb_typeof(entry->'can_delete'),'')<>'boolean' then raise exception 'صلاحيات الإجراءات غير صالحة';end if;
  insert into public.admin_module_permissions(admin_id,module_key,can_view,can_create,can_update,can_delete,updated_by,updated_at)
  values(p_admin_id,key,(entry->>'can_view')::boolean,(entry->>'can_create')::boolean,(entry->>'can_update')::boolean,(entry->>'can_delete')::boolean,me,now())
  on conflict(admin_id,module_key) do update set can_view=excluded.can_view,can_create=excluded.can_create,can_update=excluded.can_update,can_delete=excluded.can_delete,updated_by=me,updated_at=now();
 end loop;
 return (select jsonb_agg(to_jsonb(p) order by module_key) from public.admin_module_permissions p where admin_id=p_admin_id);
end $$;
revoke all on function public.set_admin_module_permissions(uuid,jsonb) from public;
grant execute on function public.set_admin_module_permissions(uuid,jsonb) to authenticated;

-- Keep legacy accounting access. Finance grants add only explicitly enabled actions.

drop policy if exists "finance view" on public.pricing_supplies;
create policy "finance view" on public.pricing_supplies for select to authenticated using (public.is_controlled_finance() and public.finance_module_allowed('accounting','view'));

drop policy if exists "finance create" on public.pricing_supplies;
create policy "finance create" on public.pricing_supplies for insert to authenticated with check (public.is_controlled_finance() and public.finance_module_allowed('accounting','create'));

drop policy if exists "finance update" on public.pricing_supplies;
create policy "finance update" on public.pricing_supplies for update to authenticated using (public.is_controlled_finance() and public.finance_module_allowed('accounting','update')) with check (public.is_controlled_finance() and public.finance_module_allowed('accounting','update'));

drop policy if exists "finance delete" on public.pricing_supplies;
create policy "finance delete" on public.pricing_supplies for delete to authenticated using (public.is_controlled_finance() and public.finance_module_allowed('accounting','delete'));

drop policy if exists "finance view" on public.pricing_services;
create policy "finance view" on public.pricing_services for select to authenticated using (public.is_controlled_finance() and public.finance_module_allowed('accounting','view'));

drop policy if exists "finance create" on public.pricing_services;
create policy "finance create" on public.pricing_services for insert to authenticated with check (public.is_controlled_finance() and public.finance_module_allowed('accounting','create'));

drop policy if exists "finance update" on public.pricing_services;
create policy "finance update" on public.pricing_services for update to authenticated using (public.is_controlled_finance() and public.finance_module_allowed('accounting','update')) with check (public.is_controlled_finance() and public.finance_module_allowed('accounting','update'));

drop policy if exists "finance delete" on public.pricing_services;
create policy "finance delete" on public.pricing_services for delete to authenticated using (public.is_controlled_finance() and public.finance_module_allowed('accounting','delete'));

drop policy if exists "finance view" on public.pricing_packages;
create policy "finance view" on public.pricing_packages for select to authenticated using (public.is_controlled_finance() and public.finance_module_allowed('accounting','view'));

drop policy if exists "finance create" on public.pricing_packages;
create policy "finance create" on public.pricing_packages for insert to authenticated with check (public.is_controlled_finance() and public.finance_module_allowed('accounting','create'));

drop policy if exists "finance update" on public.pricing_packages;
create policy "finance update" on public.pricing_packages for update to authenticated using (public.is_controlled_finance() and public.finance_module_allowed('accounting','update')) with check (public.is_controlled_finance() and public.finance_module_allowed('accounting','update'));

drop policy if exists "finance delete" on public.pricing_packages;
create policy "finance delete" on public.pricing_packages for delete to authenticated using (public.is_controlled_finance() and public.finance_module_allowed('accounting','delete'));


create or replace function public.can_manage_contracting_entities()
returns boolean language sql stable security definer set search_path=public as $$
 select case when public.is_controlled_finance() then public.finance_module_allowed('contracting_entities','view')
 else public.has_role('contract_manager') or public.has_role('general_manager') or public.has_role('super_admin') end;
$$;
create or replace function public.can_delete_contracting_entity()
returns boolean language sql stable security definer set search_path=public as $$
 select case when public.is_controlled_finance() then public.finance_module_allowed('contracting_entities','delete')
 else public.has_role('super_admin') or public.has_role('general_manager') end;
$$;
revoke all on function public.can_delete_contracting_entity() from public;
grant execute on function public.can_delete_contracting_entity() to authenticated;
drop policy if exists "contract entities manager delete" on public.contracting_entities;
create policy "contract entities manager delete" on public.contracting_entities as restrictive for delete to authenticated using(public.can_delete_contracting_entity());

drop policy if exists "finance restrict view" on public.contracting_entities;
create policy "finance restrict view" on public.contracting_entities as restrictive for select to authenticated using (public.finance_module_allowed('contracting_entities','view'));

drop policy if exists "finance restrict create" on public.contracting_entities;
create policy "finance restrict create" on public.contracting_entities as restrictive for insert to authenticated with check (public.finance_module_allowed('contracting_entities','create'));

drop policy if exists "finance restrict update" on public.contracting_entities;
create policy "finance restrict update" on public.contracting_entities as restrictive for update to authenticated using (public.finance_module_allowed('contracting_entities','update')) with check (public.finance_module_allowed('contracting_entities','update'));

drop policy if exists "finance restrict delete" on public.contracting_entities;
create policy "finance restrict delete" on public.contracting_entities as restrictive for delete to authenticated using (public.finance_module_allowed('contracting_entities','delete'));

drop policy if exists "finance restrict view" on public.contracting_entity_contacts;
create policy "finance restrict view" on public.contracting_entity_contacts as restrictive for select to authenticated using (public.finance_module_allowed('contracting_entities','view'));

drop policy if exists "finance restrict create" on public.contracting_entity_contacts;
create policy "finance restrict create" on public.contracting_entity_contacts as restrictive for insert to authenticated with check (public.finance_module_allowed('contracting_entities','create'));

drop policy if exists "finance restrict update" on public.contracting_entity_contacts;
create policy "finance restrict update" on public.contracting_entity_contacts as restrictive for update to authenticated using (public.finance_module_allowed('contracting_entities','update')) with check (public.finance_module_allowed('contracting_entities','update'));

drop policy if exists "finance restrict delete" on public.contracting_entity_contacts;
create policy "finance restrict delete" on public.contracting_entity_contacts as restrictive for delete to authenticated using (public.finance_module_allowed('contracting_entities','delete'));

drop policy if exists "finance restrict view" on public.contracting_entity_contracts;
create policy "finance restrict view" on public.contracting_entity_contracts as restrictive for select to authenticated using (public.finance_module_allowed('contracting_entities','view'));

drop policy if exists "finance restrict create" on public.contracting_entity_contracts;
create policy "finance restrict create" on public.contracting_entity_contracts as restrictive for insert to authenticated with check (public.finance_module_allowed('contracting_entities','create'));

drop policy if exists "finance restrict update" on public.contracting_entity_contracts;
create policy "finance restrict update" on public.contracting_entity_contracts as restrictive for update to authenticated using (public.finance_module_allowed('contracting_entities','update')) with check (public.finance_module_allowed('contracting_entities','update'));

drop policy if exists "finance restrict delete" on public.contracting_entity_contracts;
create policy "finance restrict delete" on public.contracting_entity_contracts as restrictive for delete to authenticated using (public.finance_module_allowed('contracting_entities','delete'));

drop policy if exists "finance restrict view" on public.contracting_entity_activities;
create policy "finance restrict view" on public.contracting_entity_activities as restrictive for select to authenticated using (public.finance_module_allowed('contracting_entities','view'));

drop policy if exists "finance restrict create" on public.contracting_entity_activities;
create policy "finance restrict create" on public.contracting_entity_activities as restrictive for insert to authenticated with check (public.finance_module_allowed('contracting_entities','create'));

drop policy if exists "finance restrict update" on public.contracting_entity_activities;
create policy "finance restrict update" on public.contracting_entity_activities as restrictive for update to authenticated using (public.finance_module_allowed('contracting_entities','update')) with check (public.finance_module_allowed('contracting_entities','update'));

drop policy if exists "finance restrict delete" on public.contracting_entity_activities;
create policy "finance restrict delete" on public.contracting_entity_activities as restrictive for delete to authenticated using (public.finance_module_allowed('contracting_entities','delete'));

drop policy if exists "finance restrict view" on public.contract_patient_links;
create policy "finance restrict view" on public.contract_patient_links as restrictive for select to authenticated using (public.finance_module_allowed('contracting_entities','view'));

drop policy if exists "finance restrict create" on public.contract_patient_links;
create policy "finance restrict create" on public.contract_patient_links as restrictive for insert to authenticated with check (public.finance_module_allowed('contracting_entities','create'));

drop policy if exists "finance restrict update" on public.contract_patient_links;
create policy "finance restrict update" on public.contract_patient_links as restrictive for update to authenticated using (public.finance_module_allowed('contracting_entities','update')) with check (public.finance_module_allowed('contracting_entities','update'));

drop policy if exists "finance restrict delete" on public.contract_patient_links;
create policy "finance restrict delete" on public.contract_patient_links as restrictive for delete to authenticated using (public.finance_module_allowed('contracting_entities','delete'));

create or replace function public.delete_contracting_entity(p_entity_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare deleted_id uuid;
begin
  if public.my_admin_id() is null or not public.can_delete_contracting_entity() then
    raise exception 'ليس لديك صلاحية حذف جهة التعاقد' using errcode='42501';
  end if;
  select id into deleted_id from public.contracting_entities where id=p_entity_id for update;
  if deleted_id is null then raise exception 'جهة التعاقد غير موجودة أو تم حذفها بالفعل'; end if;
  perform id from public.contracting_entity_contracts where entity_id=p_entity_id for update;
  if exists(select 1 from public.contract_patient_links l join public.contracting_entity_contracts c on c.id=l.contract_id where c.entity_id=p_entity_id)
     or exists(select 1 from public.patient_visits v join public.contracting_entity_contracts c on c.id=v.contract_id where c.entity_id=p_entity_id) then
    raise exception 'لا يمكن حذف جهة مرتبطة بمرضى أو زيارات. يمكن تعليق العقد بدلًا من الحذف.';
  end if;
  delete from public.contracting_entities where id=p_entity_id;
  return deleted_id;
exception when foreign_key_violation then
  raise exception 'لا يمكن حذف جهة مرتبطة بمرضى أو زيارات. يمكن تعليق العقد بدلًا من الحذف.';
end;
$$;
revoke all on function public.delete_contracting_entity(uuid) from public;
grant execute on function public.delete_contracting_entity(uuid) to authenticated;

create or replace function public.search_patients_basic(p_term text)
returns table(id uuid, full_name text, phone text, patient_code text)
language plpgsql security definer stable set search_path = public as $$
begin
  if public.is_controlled_finance() and not public.finance_module_allowed('contracting_entities','create') then raise exception 'ليس لديك صلاحية البحث لربط مريض';end if;
  if not (public.has_archive_access() or public.has_archive_review_access() or public.can_access_leads()
          or public.has_role('nursing') or public.can_manage_contracting_entities()) then
    raise exception 'not allowed';
  end if;
  return query
    select p.id, p.full_name, p.phone, p.patient_code
    from public.patients p
    where p.full_name ilike '%'||p_term||'%' or p.phone ilike '%'||p_term||'%' or p.patient_code ilike '%'||p_term||'%'
    order by p.full_name limit 20;
end;
$$;
revoke all on function public.search_patients_basic(text) from public;
grant execute on function public.search_patients_basic(text) to authenticated;

drop policy if exists "finance restrict select" on public.task_projects;
create policy "finance restrict select" on public.task_projects as restrictive for select to authenticated using (public.finance_module_allowed('tasks','view'));

drop policy if exists "finance restrict insert" on public.task_projects;
create policy "finance restrict insert" on public.task_projects as restrictive for insert to authenticated with check (public.finance_module_allowed('tasks','create'));

drop policy if exists "finance restrict update" on public.task_projects;
create policy "finance restrict update" on public.task_projects as restrictive for update to authenticated using (public.finance_module_allowed('tasks','update')) with check (public.finance_module_allowed('tasks','update'));

drop policy if exists "finance restrict delete" on public.task_projects;
create policy "finance restrict delete" on public.task_projects as restrictive for delete to authenticated using (not public.is_controlled_finance());

drop policy if exists "finance restrict select" on public.task_project_members;
create policy "finance restrict select" on public.task_project_members as restrictive for select to authenticated using (public.finance_module_allowed('tasks','view'));

drop policy if exists "finance restrict insert" on public.task_project_members;
create policy "finance restrict insert" on public.task_project_members as restrictive for insert to authenticated with check (public.finance_module_allowed('tasks','update'));

drop policy if exists "finance restrict update" on public.task_project_members;
create policy "finance restrict update" on public.task_project_members as restrictive for update to authenticated using (public.finance_module_allowed('tasks','update')) with check (public.finance_module_allowed('tasks','update'));

drop policy if exists "finance restrict delete" on public.task_project_members;
create policy "finance restrict delete" on public.task_project_members as restrictive for delete to authenticated using (public.finance_module_allowed('tasks','update'));

drop policy if exists "finance restrict select" on public.tasks;
create policy "finance restrict select" on public.tasks as restrictive for select to authenticated using (public.finance_module_allowed('tasks','view'));

drop policy if exists "finance restrict insert" on public.tasks;
create policy "finance restrict insert" on public.tasks as restrictive for insert to authenticated with check (public.finance_module_allowed('tasks','create'));

drop policy if exists "finance restrict update" on public.tasks;
create policy "finance restrict update" on public.tasks as restrictive for update to authenticated using (public.finance_module_allowed('tasks','update')) with check (public.finance_module_allowed('tasks','update'));

drop policy if exists "finance restrict delete" on public.tasks;
create policy "finance restrict delete" on public.tasks as restrictive for delete to authenticated using (not public.is_controlled_finance());

drop policy if exists "finance restrict select" on public.task_updates;
create policy "finance restrict select" on public.task_updates as restrictive for select to authenticated using (public.finance_module_allowed('tasks','view'));

drop policy if exists "finance restrict insert" on public.task_updates;
create policy "finance restrict insert" on public.task_updates as restrictive for insert to authenticated with check (public.finance_module_allowed('tasks','update'));

drop policy if exists "finance restrict update" on public.task_updates;
create policy "finance restrict update" on public.task_updates as restrictive for update to authenticated using (not public.is_controlled_finance()) with check (not public.is_controlled_finance());

drop policy if exists "finance restrict delete" on public.task_updates;
create policy "finance restrict delete" on public.task_updates as restrictive for delete to authenticated using (not public.is_controlled_finance());

drop policy if exists "finance restrict select" on public.task_notifications;
create policy "finance restrict select" on public.task_notifications as restrictive for select to authenticated using (public.finance_module_allowed('tasks','view'));

drop policy if exists "finance restrict insert" on public.task_notifications;
create policy "finance restrict insert" on public.task_notifications as restrictive for insert to authenticated with check (not public.is_controlled_finance());

drop policy if exists "finance restrict update" on public.task_notifications;
create policy "finance restrict update" on public.task_notifications as restrictive for update to authenticated using (public.finance_module_allowed('tasks','view')) with check (public.finance_module_allowed('tasks','view'));

drop policy if exists "finance restrict delete" on public.task_notifications;
create policy "finance restrict delete" on public.task_notifications as restrictive for delete to authenticated using (not public.is_controlled_finance());

create or replace function public.task_can_manage_project(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.task_projects p
    where p.id = p_project_id and p.archived_at is null and public.finance_module_allowed('tasks','view')
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
    where p.id = p_project_id and p.archived_at is null and public.finance_module_allowed('tasks','view')
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
    where t.id=p_task_id and public.finance_module_allowed('tasks','view') and (
      public.task_can_manage_project(t.project_id)
      or t.assignee_id=public.my_admin_id()

    )
  );
$$;

create or replace function public.task_people()
returns table(id uuid,name text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.finance_module_allowed('tasks','view') then raise exception 'ليس لديك صلاحية عرض المهام';end if;
  if public.my_admin_id() is null then raise exception 'Authentication required'; end if;
  return query select a.id, coalesce(nullif(a.name,''),a.email)
    from public.admins a where a.active order by coalesce(nullif(a.name,''),a.email);
end $$;

create or replace function public.task_create_project(p_title text,p_description text,p_manager_id uuid,p_members jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not (public.has_role('super_admin') or public.has_role('general_manager') or (public.is_controlled_finance() and public.finance_module_allowed('tasks','create'))) then raise exception 'Not allowed to create projects'; end if;
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

create or replace function public.task_create(p_project_id uuid,p_parent_task_id uuid,p_title text,p_description text,p_expected_output text,p_assignee_id uuid,p_due_at timestamptz,p_priority text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.finance_module_allowed('tasks','create') then raise exception 'ليس لديك صلاحية هذا الإجراء في المهام';end if;
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

create or replace function public.task_set_status(p_task_id uuid,p_status text,p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_task public.tasks%rowtype; v_actor uuid:=public.my_admin_id();
begin
  if not public.finance_module_allowed('tasks','update') then raise exception 'ليس لديك صلاحية هذا الإجراء في المهام';end if;
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

create or replace function public.task_review(p_task_id uuid,p_approve boolean,p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_task public.tasks%rowtype; v_status text;
begin
  if not public.finance_module_allowed('tasks','update') then raise exception 'ليس لديك صلاحية هذا الإجراء في المهام';end if;
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

create or replace function public.task_refresh_overdue_notifications()
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if not public.finance_module_allowed('tasks','view') then raise exception 'ليس لديك صلاحية عرض المهام';end if;
  if public.my_admin_id() is null then raise exception 'Authentication required'; end if;
  insert into public.task_notifications(recipient_id,task_id,kind,message,reference_date)
    select public.my_admin_id(),t.id,'overdue','المهمة متأخرة: '||t.title,current_date
    from public.tasks t where t.status not in ('done') and t.due_at < now()
      and (t.assignee_id=public.my_admin_id() or public.task_can_manage_project(t.project_id))
    on conflict do nothing;
  get diagnostics v_count=row_count;
  return v_count;
end $$;

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

do $recurrence$ begin
 if to_regclass('public.task_recurrences') is not null then

 if position('recurrence_id' in pg_get_function_result('public.task_list_visible()'::regprocedure))=0 then drop function public.task_list_visible();end if;
 execute $listing$create or replace function public.task_list_visible()
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
  where public.finance_module_allowed('tasks','view') and (public.task_can_manage_project(t.project_id) or t.assignee_id=public.my_admin_id())
  order by t.due_at nulls last,t.created_at desc;
$$;$listing$;
 execute $editing$create or replace function public.task_update_details(
  p_task_id uuid,p_title text,p_description text,p_expected_output text,p_assignee_id uuid,p_due_at timestamptz,p_priority text,
  p_repeat_active boolean,p_interval_value integer,p_interval_unit text,p_ends_at date,p_update_future boolean
) returns void language plpgsql security definer set search_path=public as $$
declare v_task public.tasks%rowtype; v_series public.task_recurrences%rowtype; v_series_id uuid; v_due_offset integer; v_next timestamptz;
begin
  if not public.finance_module_allowed('tasks','update') then raise exception 'ليس لديك صلاحية تعديل المهام';end if;
  select * into v_task from public.tasks where id=p_task_id for update;
  if not found or not public.task_can_manage_project(v_task.project_id) then raise exception 'Not allowed to edit this task'; end if;
  if p_repeat_active and v_task.recurrence_id is null and not public.finance_module_allowed('tasks','create') then raise exception 'تفعيل تكرار جديد يحتاج صلاحية إضافة المهام';end if;
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
end $$;$editing$;

drop policy if exists "finance recurrence select" on public.task_recurrences;
create policy "finance recurrence select" on public.task_recurrences as restrictive for select to authenticated using (public.finance_module_allowed('tasks','view'));

drop policy if exists "finance recurrence insert" on public.task_recurrences;
create policy "finance recurrence insert" on public.task_recurrences as restrictive for insert to authenticated with check (public.finance_module_allowed('tasks','create'));

drop policy if exists "finance recurrence update" on public.task_recurrences;
create policy "finance recurrence update" on public.task_recurrences as restrictive for update to authenticated using (public.finance_module_allowed('tasks','update')) with check (public.finance_module_allowed('tasks','update'));

drop policy if exists "finance recurrence delete" on public.task_recurrences;
create policy "finance recurrence delete" on public.task_recurrences as restrictive for delete to authenticated using (public.finance_module_allowed('tasks','delete'));

 else execute $listing$create or replace function public.task_list_visible()
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
  where public.finance_module_allowed('tasks','view') and (public.task_can_manage_project(t.project_id) or t.assignee_id=public.my_admin_id())

  order by t.due_at nulls last,t.created_at desc;
$$;$listing$;
 end if;
end $recurrence$;
revoke all on function public.task_list_visible() from public;
grant execute on function public.task_list_visible() to authenticated;

notify pgrst, 'reload schema';
commit;
