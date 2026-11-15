-- HR: employees WITHOUT a dashboard account (e.g. cleaning staff) are followed by a ROLE, not by a person.
-- Owner decision 2026-11-15: «الحساب بتاع النضافة يتربط بالدور مش بحساب الشخص… لو مشيت نعرف نربطه باللي هييجي مكانها».
--
-- * clinic_people.people.manager_role: the role that follows this employee (e.g. general_manager). Set by HR only.
-- * Recurring duties of such an employee are normal recurring tasks marked with for_person_id; they are ASSIGNED to the
--   current holder of that role, who fills, approves and follows them.
-- * When the role holder changes (left, deactivated, role moved), task_sync_role_owners() moves the series and the
--   open copies to the new holder. It runs every minute with the existing recurrence cron, and right after HR changes
--   the role. Done/cancelled tasks keep their history.
begin;

alter table clinic_people.people add column if not exists manager_role text
  check (manager_role is null or manager_role ~ '^[a-z_]{3,40}$');
alter table public.task_recurrences add column if not exists for_person_id uuid references clinic_people.people(id);
alter table public.tasks add column if not exists for_person_id uuid references clinic_people.people(id);
create index if not exists task_recurrences_for_person on public.task_recurrences(for_person_id) where for_person_id is not null;
create index if not exists tasks_for_person on public.tasks(for_person_id) where for_person_id is not null;

-- The active account that currently holds a role: main role first, then extra roles; oldest account wins (stable choice).
create or replace function clinic_people.role_holder(p_role text) returns uuid
language sql stable security definer set search_path = pg_catalog, public as $$
  select a.id from public.admins a
   where a.active and public.has_role_for(a.id, p_role)
   order by (a.role = p_role) desc, a.created_at, a.id
   limit 1
$$;

create or replace function public.task_sync_role_owners() returns integer
language plpgsql security definer set search_path = pg_catalog, public as $$
declare r record; h uuid; n integer := 0;
begin
  for r in
    select tr.id, tr.project_id, tr.assignee_id, tr.title, p.manager_role
      from public.task_recurrences tr
      join clinic_people.people p on p.id = tr.for_person_id
     where tr.active and p.admin_id is null and p.status <> 'ended' and p.manager_role is not null
  loop
    h := clinic_people.role_holder(r.manager_role);
    continue when h is null;
    insert into public.task_project_members(project_id, admin_id, role_name)
      values (r.project_id, h, 'contributor') on conflict (project_id, admin_id) do nothing;
    if h is distinct from r.assignee_id then
      update public.task_recurrences set assignee_id = h, updated_at = now() where id = r.id;
      n := n + 1;
    end if;
    with moved as (
      update public.tasks set assignee_id = h, updated_at = now()
       where recurrence_id = r.id and status not in ('done', 'cancelled') and assignee_id is distinct from h
      returning id, title)
    insert into public.task_notifications(recipient_id, task_id, kind, message)
      select h, m.id, 'assigned', 'انتقلت إليك متابعة مهمة: ' || m.title from moved m on conflict do nothing;
  end loop;
  return n;
end $$;
revoke all on function public.task_sync_role_owners() from public, anon, authenticated;
revoke all on function clinic_people.role_holder(text) from public, anon, authenticated;

-- HR sets (or clears) the role that follows an employee without an account.
create or replace function public.hr_set_manager_role(p_person uuid, p_role text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); p clinic_people.people%rowtype; role text := nullif(btrim(coalesce(p_role, '')), ''); h uuid;
begin
  if me is null or not clinic_people.manage() then raise exception 'تحتاج إدارة الموارد البشرية'; end if;
  select * into p from clinic_people.people where id = p_person for update;
  if not found then raise exception 'الموظف غير موجود'; end if;
  if p.admin_id is not null and role is not null then raise exception 'الموظف له حساب دخول؛ مهامه تُسند لحسابه مباشرة'; end if;
  if role is not null then
    if role !~ '^[a-z_]{3,40}$' then raise exception 'دور غير صالح'; end if;
    h := clinic_people.role_holder(role);
    if h is null then raise exception 'لا يوجد حساب نشط بهذا الدور الآن'; end if;
  end if;
  update clinic_people.people set manager_role = role, updated_at = now(), revision = revision + 1 where id = p.id;
  insert into clinic_people.audit(actor_id, action, record_id, before_data, after_data)
    values (me, 'manager_role', p.id, jsonb_build_object('manager_role', p.manager_role), jsonb_build_object('manager_role', role));
  perform public.task_sync_role_owners();
  return jsonb_build_object('person_id', p.id, 'manager_role', role, 'holder_id', h,
    'holder_name', (select coalesce(nullif(name, ''), email) from public.admins where id = h));
end $$;
revoke all on function public.hr_set_manager_role(uuid, text) from public, anon;
grant execute on function public.hr_set_manager_role(uuid, text) to authenticated;

-- A recurring duty for an employee without an account: assigned to the current holder of the employee's manager role.
create or replace function public.task_create_recurring_for_person(
  p_project_id uuid, p_person uuid, p_title text, p_description text, p_expected_output text,
  p_due_at timestamptz, p_priority text, p_interval_value integer, p_interval_unit text, p_ends_at date
) returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare p clinic_people.people%rowtype; h uuid; v_task uuid; v_series uuid;
begin
  if public.my_admin_id() is null or not clinic_people.manage() then raise exception 'تحتاج إدارة الموارد البشرية'; end if;
  select * into p from clinic_people.people where id = p_person and status <> 'ended';
  if not found then raise exception 'اختر موظفًا مستمرًا'; end if;
  if p.admin_id is not null then raise exception 'الموظف له حساب دخول؛ أسند المهمة لحسابه من شاشة المهام'; end if;
  if p.manager_role is null then raise exception 'حدد أولًا الدور المسؤول عن متابعة الموظف'; end if;
  h := clinic_people.role_holder(p.manager_role);
  if h is null then raise exception 'لا يوجد حساب نشط بالدور المسؤول الآن'; end if;
  v_task := public.task_create_recurring(p_project_id, null, p_title,
    coalesce(p_description, '') || case when coalesce(p_description, '') = '' then '' else E'\n' end || 'الموظف: ' || p.full_name || ' (' || p.code || ')',
    p_expected_output, h, p_due_at, p_priority, p_interval_value, p_interval_unit, p_ends_at);
  select recurrence_id into v_series from public.tasks where id = v_task;
  update public.tasks set for_person_id = p.id where id = v_task;
  update public.task_recurrences set for_person_id = p.id where id = v_series;
  insert into clinic_people.audit(actor_id, action, record_id, after_data)
    values (public.my_admin_id(), 'person_recurring_task', p.id, jsonb_build_object('task_id', v_task, 'series_id', v_series, 'title', p_title));
  return v_task;
end $$;
revoke all on function public.task_create_recurring_for_person(uuid, uuid, text, text, text, timestamptz, text, integer, text, date) from public, anon;
grant execute on function public.task_create_recurring_for_person(uuid, uuid, text, text, text, timestamptz, text, integer, text, date) to authenticated;

-- What HR sees on the profile of an employee without an account: who follows him now, and his recurring duties.
create or replace function public.hr_person_duties(p_person uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare p clinic_people.people%rowtype; h uuid;
begin
  if not clinic_people.manage() then raise exception 'تحتاج إدارة الموارد البشرية'; end if;
  select * into p from clinic_people.people where id = p_person;
  if not found then raise exception 'الموظف غير موجود'; end if;
  h := case when p.manager_role is null then null else clinic_people.role_holder(p.manager_role) end;
  return jsonb_build_object('manager_role', p.manager_role, 'holder_id', h,
    'holder_name', (select coalesce(nullif(name, ''), email) from public.admins where id = h),
    'duties', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'title', r.title, 'interval_value', r.interval_value,
        'interval_unit', r.interval_unit, 'active', r.active, 'project', (select title from public.task_projects where id = r.project_id))
        order by r.created_at) from public.task_recurrences r where r.for_person_id = p.id), '[]'::jsonb));
end $$;
revoke all on function public.hr_person_duties(uuid) from public, anon;
grant execute on function public.hr_person_duties(uuid) to authenticated;

-- Same generator as 20261112150000 (one open copy, cancelled counts as closed), plus: follow the role holder first,
-- and keep the employee mark on every generated copy.
create or replace function public.task_generate_due_recurrences()
 returns integer language plpgsql security definer set search_path to 'public' as $function$
declare r public.task_recurrences%rowtype; v_count integer:=0; v_next timestamptz; v_due timestamptz;
  v_task_id uuid; v_open boolean; v_guard integer;
begin
  perform public.task_sync_role_owners();
  for r in select * from public.task_recurrences where active and next_run_at<=now()
    and (ends_at is null or next_run_at::date<=ends_at) order by next_run_at for update skip locked
  loop
    select exists(select 1 from public.tasks t where t.recurrence_id=r.id and t.status not in ('done','cancelled')) into v_open;
    v_task_id:=null;
    if not v_open then
      v_due:=case when r.due_offset_days is null then null else now()+make_interval(days=>r.due_offset_days) end;
      insert into public.tasks(project_id,parent_task_id,title,description,expected_output,assignee_id,created_by,status,priority,due_at,recurrence_id,recurrence_occurrence,for_person_id)
      values(r.project_id,r.parent_task_id,r.title,r.description,r.expected_output,r.assignee_id,r.created_by,'todo',r.priority,v_due,r.id,r.next_occurrence,r.for_person_id)
      on conflict (recurrence_id,recurrence_occurrence) where recurrence_id is not null do nothing
      returning id into v_task_id;
      if v_task_id is not null then
        insert into public.task_notifications(recipient_id,task_id,kind,message)
        values(r.assignee_id,v_task_id,'assigned','تم إنشاء المهمة الدورية: '||r.title) on conflict do nothing;
        v_count:=v_count+1;
      end if;
    end if;
    v_next:=public.task_recurrence_step(r.next_run_at,r.interval_value,r.interval_unit); v_guard:=0;
    while v_next<=now() and v_guard<1000 loop
      v_next:=public.task_recurrence_step(v_next,r.interval_value,r.interval_unit); v_guard:=v_guard+1;
    end loop;
    update public.task_recurrences set next_run_at=v_next,
      next_occurrence=next_occurrence+case when v_open then 0 else 1 end,
      active=(ends_at is null or v_next::date<=ends_at),updated_at=now() where id=r.id;
  end loop;
  return v_count;
end $function$;

commit;
