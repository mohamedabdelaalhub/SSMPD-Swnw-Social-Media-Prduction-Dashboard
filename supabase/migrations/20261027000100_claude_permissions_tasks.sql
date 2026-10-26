-- صلاحيات Claude Creative في إدارة المهام — بحدود على مستوى القاعدة (محمد، 2026-10-27)
--
-- • claude_capabilities: مفتاح تشغيل/إيقاف + حد يومي لكل صلاحية (محمد يقدر يقفل أي واحدة).
-- • claude_action_log: سجل بكل استخدام لصلاحية محدودة (أساس العدّاد اليومي).
-- • claude_task_create / claude_task_update: إنشاء وتعديل مهام لـ Claude بس في مشروع هو «مدير» فيه،
--   والمسؤول لازم يكون عضو في المشروع أصلاً (task_create العادية كانت بتضيف أي حد للمشروع بمجرد الإسناد).
-- • تريجر على tasks: Claude ما بيعتمدش ولا بيقفل مهمة (done) ولا بيحذف — حتى لو نادى task_review.
--   الرجوع للتعديل (review → revision) مسموح وبعدّاد يومي.
-- • تريجر على task_updates: تعليقات Claude للفريق بعدّاد يومي (مفيش لوب).
-- ملاحظة: الحراسة دي بتحمي المسار اللي بيشتغل بحساب Claude (البوابة). مسار Supabase MCP بصلاحية الخادم
-- مش بيتحمى بالحراسة دي، وده معروف ومحكوم بتعليمات المهام المجدولة.

create table if not exists public.claude_capabilities (
  key text primary key,
  label text not null,
  enabled boolean not null default true,
  daily_limit integer check (daily_limit is null or daily_limit >= 0),
  note text,
  updated_by uuid references public.admins(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.claude_capabilities(key,label,enabled,daily_limit) values
  ('tasks_create','إنشاء مهام وإسنادها',true,30),
  ('tasks_edit','تعديل مهام',true,60),
  ('tasks_return','إرجاع مهمة للتعديل',true,30),
  ('internal_messages','تعليقات وتنبيهات للفريق',true,80),
  ('ads_propose','اقتراح خطط حملات إعلانية',true,5)
on conflict (key) do nothing;

create table if not exists public.claude_action_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  action text not null,
  detail jsonb not null default '{}'::jsonb
);
create index if not exists claude_action_log_action_at on public.claude_action_log(action, at desc);

alter table public.claude_capabilities enable row level security;
alter table public.claude_action_log enable row level security;
drop policy if exists claude_capabilities_read on public.claude_capabilities;
create policy claude_capabilities_read on public.claude_capabilities for select to authenticated using (public.can_manage_all_content());
drop policy if exists claude_capabilities_write on public.claude_capabilities;
create policy claude_capabilities_write on public.claude_capabilities for update to authenticated using (public.is_super()) with check (public.is_super());
drop policy if exists claude_action_log_read on public.claude_action_log;
create policy claude_action_log_read on public.claude_action_log for select to authenticated using (public.can_manage_all_content());
grant select, update on public.claude_capabilities to authenticated;
grant select on public.claude_action_log to authenticated;

-- يفحص الصلاحية (مفعّلة؟ والحد اليومي بتوقيت القاهرة) ويسجّل الاستخدام. بيرمي خطأ واضح لو ممنوعة.
create or replace function public.claude_cap_use(p_key text, p_detail jsonb default '{}'::jsonb)
 returns void language plpgsql security definer set search_path to 'public' as $$
declare c public.claude_capabilities%rowtype; n integer;
begin
  select * into c from public.claude_capabilities where key = p_key;
  if not found or not c.enabled then
    raise exception 'صلاحية «%» مقفولة لـ Claude حاليًا (من إعدادات الصلاحيات)', coalesce(c.label, p_key);
  end if;
  if c.daily_limit is not null then
    select count(*) into n from public.claude_action_log
      where action = p_key and (at at time zone 'Africa/Cairo')::date = (now() at time zone 'Africa/Cairo')::date;
    if n >= c.daily_limit then
      raise exception 'Claude وصل للحد اليومي (%) في «%» — يكمّل بكرة أو محمد يرفع الحد', c.daily_limit, c.label;
    end if;
  end if;
  insert into public.claude_action_log(action, detail) values (p_key, coalesce(p_detail, '{}'::jsonb));
end $$;
revoke all on function public.claude_cap_use(text, jsonb) from public, anon, authenticated;

-- هل المسؤول عضو (أو مدير) في المشروع؟
create or replace function public.claude_assignee_ok(p_project uuid, p_assignee uuid)
 returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists(select 1 from public.admins a where a.id = p_assignee and a.active)
     and (exists(select 1 from public.task_project_members m where m.project_id = p_project and m.admin_id = p_assignee)
          or exists(select 1 from public.task_projects p where p.id = p_project and p.manager_id = p_assignee));
$$;
revoke all on function public.claude_assignee_ok(uuid, uuid) from public, anon, authenticated;

create or replace function public.claude_task_create(
  p_project_id uuid, p_title text, p_description text, p_expected_output text,
  p_assignee_id uuid, p_due_at timestamptz, p_priority text default 'normal', p_parent_task_id uuid default null
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare claude constant uuid := 'a0fbdfee-d147-4282-b988-186a9ae3e88c'; v_id uuid;
begin
  if public.my_admin_id() is distinct from claude then raise exception 'الدالة دي لحساب Claude Creative بس'; end if;
  if not public.task_can_manage_project(p_project_id) then raise exception 'Claude مش مدير في المشروع ده'; end if;
  if not public.claude_assignee_ok(p_project_id, p_assignee_id) then
    raise exception 'الشخص ده مش عضو في المشروع — ضيفه من الداشبورد الأول (Claude مبيضيفش أعضاء)';
  end if;
  if length(trim(coalesce(p_title,''))) < 2 then raise exception 'عنوان المهمة قصير'; end if;
  if length(trim(coalesce(p_description,''))) < 5 or length(trim(coalesce(p_expected_output,''))) < 3 then
    raise exception 'اكتب المطلوب وشكل التسليم بوضوح';
  end if;
  perform public.claude_cap_use('tasks_create', jsonb_build_object('project', p_project_id, 'assignee', p_assignee_id, 'title', left(p_title, 80)));
  v_id := public.task_create(p_project_id, p_parent_task_id, p_title, p_description, p_expected_output, p_assignee_id, p_due_at, p_priority);
  return v_id;
end $$;

create or replace function public.claude_task_update(
  p_task_id uuid, p_title text default null, p_description text default null, p_expected_output text default null,
  p_assignee_id uuid default null, p_due_at timestamptz default null, p_priority text default null
) returns void language plpgsql security definer set search_path to 'public' as $$
declare claude constant uuid := 'a0fbdfee-d147-4282-b988-186a9ae3e88c'; t public.tasks%rowtype;
begin
  if public.my_admin_id() is distinct from claude then raise exception 'الدالة دي لحساب Claude Creative بس'; end if;
  select * into t from public.tasks where id = p_task_id;
  if not found then raise exception 'المهمة مش موجودة'; end if;
  if not public.task_can_manage_project(t.project_id) then raise exception 'Claude مش مدير في المشروع ده'; end if;
  if t.status = 'done' then raise exception 'المهمة مقفولة'; end if;
  if t.recurrence_id is not null then raise exception 'مهمة متكررة — تتعدّل من الداشبورد'; end if;
  if p_assignee_id is not null and p_assignee_id is distinct from t.assignee_id
     and not public.claude_assignee_ok(t.project_id, p_assignee_id) then
    raise exception 'الشخص ده مش عضو في المشروع — ضيفه من الداشبورد الأول';
  end if;
  perform public.claude_cap_use('tasks_edit', jsonb_build_object('task', p_task_id));
  perform public.task_update_details(p_task_id,
    coalesce(p_title, t.title), coalesce(p_description, t.description), coalesce(p_expected_output, t.expected_output),
    coalesce(p_assignee_id, t.assignee_id), coalesce(p_due_at, t.due_at), coalesce(p_priority, t.priority),
    false, 1, 'day', null, false);
end $$;
revoke all on function public.claude_task_create(uuid, text, text, text, uuid, timestamptz, text, uuid) from public, anon;
revoke all on function public.claude_task_update(uuid, text, text, text, uuid, timestamptz, text) from public, anon;
grant execute on function public.claude_task_create(uuid, text, text, text, uuid, timestamptz, text, uuid) to authenticated;
grant execute on function public.claude_task_update(uuid, text, text, text, uuid, timestamptz, text) to authenticated;

-- حراسة على tasks: Claude لا يعتمد ولا يقفل ولا يحذف، والرجوع للتعديل بعدّاد
create or replace function public.claude_task_guard() returns trigger
 language plpgsql security definer set search_path to 'public' as $$
declare claude constant uuid := 'a0fbdfee-d147-4282-b988-186a9ae3e88c';
begin
  if public.my_admin_id() is distinct from claude then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then raise exception 'Claude لا يحذف مهام — الحذف من الداشبورد بس'; end if;
  if new.project_id is distinct from old.project_id then raise exception 'Claude لا ينقل مهام بين المشاريع'; end if;
  if new.status = 'done' and old.status is distinct from 'done' then
    raise exception 'Claude لا يعتمد ولا يقفل مهام — الاعتماد ليك أو لمدير المشروع من البشر';
  end if;
  if new.status = 'revision' and old.status = 'review' then
    perform public.claude_cap_use('tasks_return', jsonb_build_object('task', new.id));
  end if;
  return new;
end $$;
drop trigger if exists claude_task_guard_trg on public.tasks;
create trigger claude_task_guard_trg before update or delete on public.tasks
  for each row execute function public.claude_task_guard();

-- تعليقات Claude للفريق (مش سجل تغيير الحالة) بعدّاد يومي
create or replace function public.claude_task_update_guard() returns trigger
 language plpgsql security definer set search_path to 'public' as $$
declare claude constant uuid := 'a0fbdfee-d147-4282-b988-186a9ae3e88c';
begin
  if new.author_id = claude and new.status_to is null then
    perform public.claude_cap_use('internal_messages', jsonb_build_object('task', new.task_id));
  end if;
  return new;
end $$;
drop trigger if exists claude_task_update_guard_trg on public.task_updates;
create trigger claude_task_update_guard_trg before insert on public.task_updates
  for each row execute function public.claude_task_update_guard();

notify pgrst, 'reload schema';
