alter table public.admins
  add column if not exists is_system_identity boolean not null default false;

comment on column public.admins.is_system_identity is
  'True for non-login operational identities such as digital agents. These rows are not pending human invites.';

alter table public.admins drop constraint if exists admins_role_check;
alter table public.admins add constraint admins_role_check
  check (role = any (array[
    'page_manager'::text,'designer'::text,'approver'::text,'general_manager'::text,'super_admin'::text,
    'reception'::text,'customer_service'::text,'nursing'::text,'sono_doctor'::text,'contract_manager'::text,
    'accountant'::text,'financial_manager'::text,'psychology_specialist'::text,'head_nursing'::text,
    'digital_agent'::text
  ]));

drop policy if exists "claim own invite" on public.admins;
create policy "claim own invite"
on public.admins for update
to authenticated
using (
  user_id is null
  and not is_system_identity
  and lower(email)=lower((auth.jwt()->>'email'::text))
)
with check (
  user_id=auth.uid()
  and not is_system_identity
);

drop policy if exists "read own or pending" on public.admins;
create policy "read own or pending"
on public.admins for select
to authenticated
using (
  user_id=auth.uid()
  or (
    user_id is null
    and not is_system_identity
    and lower(email)=lower((auth.jwt()->>'email'::text))
  )
);

create table if not exists public.digital_team_members (
  code text primary key,
  display_name text not null,
  title_ar text not null,
  member_kind text not null check (member_kind in ('system_identity','external_agent','existing_admin')),
  admin_id uuid unique references public.admins(id) on delete set null,
  agent_key text,
  reports_to_code text references public.digital_team_members(code) on delete set null,
  authority_note text,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.digital_team_members enable row level security;
revoke all on public.digital_team_members from public, anon;
grant select on public.digital_team_members to authenticated;
grant all on public.digital_team_members to service_role;

drop policy if exists "digital team managers read" on public.digital_team_members;
create policy "digital team managers read"
on public.digital_team_members for select
to authenticated
using ((select public.business_manager()));

insert into public.admins(email,name,role,active,is_system_identity)
values ('sia@system.invalid','سيا','digital_agent',false,true)
on conflict (email) do update
set name=excluded.name,
    role='digital_agent',
    active=false,
    is_system_identity=true;

insert into public.digital_team_members(code,display_name,title_ar,member_kind,admin_id,agent_key,reports_to_code,authority_note,metadata)
select
  'sia','سيا','المساعد الإداري الرقمي','system_identity',a.id,'administrative_assistant',null,
  'ينفذ داخل التفويضات المعتمدة ويصعّد القرارات التي تحتاج المالك.',
  jsonb_build_object('identity','system','login_allowed',false,'kpi_model','digital_operations')
from public.admins a where a.email='sia@system.invalid'
on conflict (code) do update
set display_name=excluded.display_name,title_ar=excluded.title_ar,member_kind=excluded.member_kind,
    admin_id=excluded.admin_id,agent_key=excluded.agent_key,reports_to_code=excluded.reports_to_code,
    authority_note=excluded.authority_note,metadata=excluded.metadata,updated_at=now();

insert into public.digital_team_members(code,display_name,title_ar,member_kind,admin_id,agent_key,reports_to_code,authority_note,metadata)
select
  'claude_creative','Claude Creative','وكيل الإنتاج الإبداعي الرقمي','existing_admin',a.id,'claude_creative','sia',
  'يحتفظ بكامل حسابه وأدواره وصلاحياته وCapabilities وAutomations الحالية دون تغيير.',
  jsonb_build_object('preserve_existing_account',true,'kpi_model','creative_operations')
from public.admins a where a.email='claude.swnw@gmail.com'
on conflict (code) do update
set display_name=excluded.display_name,title_ar=excluded.title_ar,member_kind=excluded.member_kind,
    admin_id=excluded.admin_id,agent_key=excluded.agent_key,reports_to_code=excluded.reports_to_code,
    authority_note=excluded.authority_note,metadata=excluded.metadata,updated_at=now();

insert into public.digital_team_members(code,display_name,title_ar,member_kind,admin_id,agent_key,reports_to_code,authority_note,metadata)
values (
  'hapi','حابي','وكيل خدمة العملاء الرقمي','external_agent',null,'hapi','sia',
  'وكيل خارجي لخدمة العملاء والحجز. لا يتم إنشاء حساب داشبورد له قبل الحاجة التشغيلية لذلك.',
  jsonb_build_object('identity','external_agent','kpi_model','customer_experience')
)
on conflict (code) do update
set display_name=excluded.display_name,title_ar=excluded.title_ar,member_kind=excluded.member_kind,
    agent_key=excluded.agent_key,reports_to_code=excluded.reports_to_code,
    authority_note=excluded.authority_note,metadata=excluded.metadata,updated_at=now();

alter table public.administrative_assistant_config
  add column if not exists assistant_admin_id uuid references public.admins(id) on delete set null;

update public.administrative_assistant_config c
set assistant_admin_id=a.id,
    updated_at=now()
from public.admins a
where c.id=1 and a.email='sia@system.invalid';

create or replace function public.task_people()
returns table(id uuid, name text)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  if not public.finance_module_allowed('tasks','view') then raise exception 'ليس لديك صلاحية عرض المهام';end if;
  if public.my_admin_id() is null then raise exception 'Authentication required'; end if;
  return query select a.id, coalesce(nullif(a.name,''),a.email)
    from public.admins a
    where a.active or a.is_system_identity
    order by coalesce(nullif(a.name,''),a.email);
end
$function$;

create or replace function public.task_create(
  p_project_id uuid, p_parent_task_id uuid, p_title text, p_description text,
  p_expected_output text, p_assignee_id uuid, p_due_at timestamptz, p_priority text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_id uuid;
begin
  if not public.finance_module_allowed('tasks','create') then raise exception 'ليس لديك صلاحية هذا الإجراء في المهام';end if;
  if not public.task_can_manage_project(p_project_id) then raise exception 'Not allowed to manage this project'; end if;
  if not exists(select 1 from public.admins where id=p_assignee_id and (active or is_system_identity)) then
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
end
$function$;

create or replace function public.task_update_details(
  p_task_id uuid, p_title text, p_description text, p_expected_output text, p_assignee_id uuid,
  p_due_at timestamptz, p_priority text, p_repeat_active boolean, p_interval_value integer,
  p_interval_unit text, p_ends_at date, p_update_future boolean
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_task public.tasks%rowtype; v_series public.task_recurrences%rowtype; v_series_id uuid; v_due_offset integer; v_next timestamptz;
begin
  if not public.finance_module_allowed('tasks','update') then raise exception 'ليس لديك صلاحية تعديل المهام';end if;
  select * into v_task from public.tasks where id=p_task_id for update;
  if not found or not public.task_can_manage_project(v_task.project_id) then raise exception 'Not allowed to edit this task'; end if;
  if p_repeat_active and v_task.recurrence_id is null and not public.finance_module_allowed('tasks','create') then raise exception 'تفعيل تكرار جديد يحتاج صلاحية إضافة المهام';end if;
  if length(trim(coalesce(p_title,'')))<2 or length(trim(p_title))>180 then raise exception 'Task title must be between 2 and 180 characters'; end if;
  if not exists(select 1 from public.admins where id=p_assignee_id and (active or is_system_identity)) then raise exception 'Assignee is not active'; end if;
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
end
$function$;
