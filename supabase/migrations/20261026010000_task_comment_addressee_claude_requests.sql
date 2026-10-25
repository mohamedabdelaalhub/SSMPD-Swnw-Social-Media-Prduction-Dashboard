-- تعليقات المهام موجّهة لشخص + طلبات Claude من التعليقات (محمد، 2026-10-26)
--
-- • task_updates.addressed_to: التعليق موجّه لمين (null = الكل).
-- • اللي التعليق موجّه له بيوصله إشعار، وبيقدر يشوف المهمة ويرد عليها حتى لو مش مسؤول عنها
--   (task_can_access بقت تشمل «اتوجّه لي تعليق على المهمة دي»).
-- • تعليق موجّه لـ Claude Creative من مدير المشروع/سوبر أدمن ⇒ طلب في claude_task_requests
--   بتلقطه المهمة المجدولة «SSMPD Claude task comments» كل ساعة وتنفّذه وترد في نفس المهمة.
-- • قاعدة «تعليق المدير على مهمة في المراجعة ⇒ revision» بقت تشتغل بس لو التعليق للكل أو للمسؤول عن المهمة.

alter table public.task_updates add column if not exists addressed_to uuid references public.admins(id) on delete set null;
create index if not exists task_updates_addressed_to_idx on public.task_updates(addressed_to, task_id) where addressed_to is not null;

create table if not exists public.claude_task_requests (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  update_id uuid not null unique references public.task_updates(id) on delete cascade,
  requested_by uuid references public.admins(id) on delete set null,
  body text not null,
  status text not null default 'pending' check (status in ('pending','working','done','failed')),
  note text,
  reply_update_id uuid references public.task_updates(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists claude_task_requests_open on public.claude_task_requests(created_at) where status in ('pending','working');
alter table public.claude_task_requests enable row level security;
drop policy if exists claude_task_requests_read on public.claude_task_requests;
create policy claude_task_requests_read on public.claude_task_requests for select to authenticated
  using (public.can_manage_all_content() or requested_by = public.my_admin_id());
-- الكتابة من task_add_comment (security definer) ومن مهمة Claude المجدولة بصلاحية الخادم بس

create or replace function public.task_can_access(p_task_id uuid)
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select exists (
    select 1 from public.tasks t
    where t.id=p_task_id and public.finance_module_allowed('tasks','view') and (
      public.task_can_manage_project(t.project_id)
      or t.assignee_id=public.my_admin_id()
      or exists(select 1 from public.task_updates u where u.task_id=t.id and u.addressed_to=public.my_admin_id())
    )
  );
$function$;

-- دالة جديدة للتعليق الموجّه (من غير مسح القديمة)
create or replace function public.task_add_comment_to(p_task_id uuid, p_body text, p_attachments jsonb, p_addressed_to uuid)
 returns uuid language plpgsql security definer set search_path to 'public'
as $function$
declare
  claude constant uuid := 'a0fbdfee-d147-4282-b988-186a9ae3e88c';
  v_actor uuid := public.my_admin_id();
  v_task public.tasks%rowtype;
  v_update uuid;
  v_item jsonb;
  v_url text;
  v_to uuid := p_addressed_to;
  v_body text := trim(coalesce(p_body,''));
  v_atts jsonb := case when jsonb_typeof(coalesce(p_attachments,'[]'::jsonb))='array' then coalesce(p_attachments,'[]'::jsonb) else '[]'::jsonb end;
begin
  if not public.finance_module_allowed('tasks','update') then raise exception 'ليس لديك صلاحية هذا الإجراء في المهام'; end if;
  if v_actor is null then raise exception 'Authentication required'; end if;
  if not public.task_can_access(p_task_id) then raise exception 'Task not found'; end if;
  select * into v_task from public.tasks where id = p_task_id for update;
  if jsonb_array_length(v_atts) > 10 then raise exception 'الحد الأقصى 10 ملفات في التعليق الواحد'; end if;
  if v_body = '' and jsonb_array_length(v_atts) = 0 then raise exception 'اكتب تعليقاً أو أرفق ملفاً'; end if;
  if length(v_body) > 5000 then raise exception 'التعليق أطول من المسموح'; end if;
  if v_to = v_actor then v_to := null; end if;
  if v_to is not null and not exists(select 1 from public.admins where id = v_to and active) then
    raise exception 'الشخص اللي التعليق موجّه له مش موجود أو موقوف';
  end if;
  if v_to = claude and v_body = '' then raise exception 'اكتب لـ Claude المطلوب منه'; end if;

  insert into public.task_updates(task_id, author_id, body, addressed_to)
    values (p_task_id, v_actor, case when v_body = '' then 'مرفقات' else v_body end, v_to)
    returning id into v_update;

  for v_item in select * from jsonb_array_elements(v_atts) loop
    v_url := v_item->>'url';
    if v_url is null or v_url !~ '^https://(drive|docs)\.google\.com/' then raise exception 'رابط المرفق غير صالح'; end if;
    insert into public.task_attachments(task_id, update_id, uploaded_by, file_name, mime_type, size_bytes, file_url, drive_file_id)
      values (p_task_id, v_update, v_actor,
              left(coalesce(nullif(trim(v_item->>'name'),''),'ملف'),200),
              left(coalesce(nullif(v_item->>'mime',''),'application/octet-stream'),120),
              greatest(0, least(coalesce(nullif(v_item->>'size','')::bigint,0), 1073741824)),
              v_url, left(nullif(v_item->>'file_id',''),200));
  end loop;

  insert into public.task_notifications(recipient_id, task_id, kind, message)
    select r.admin_id, p_task_id, 'comment',
      case when r.admin_id = v_to then 'تعليق موجّه لك على المهمة: ' else 'تعليق جديد على المهمة: ' end || v_task.title
    from (
      select v_task.assignee_id as admin_id
      union select p.manager_id from public.task_projects p where p.id = v_task.project_id
      union select m.admin_id from public.task_project_members m where m.project_id = v_task.project_id and m.role_name = 'manager'
      union select v_to
    ) r
    where r.admin_id is not null and r.admin_id <> v_actor
    on conflict (recipient_id, task_id, kind, reference_date)
    do update set message = excluded.message, read_at = null, created_at = now();

  -- تعليق موجّه لـ Claude من مدير المشروع/الإدارة ⇒ طلب شغل
  if v_to = claude and v_actor <> claude
     and (public.task_can_manage_project(v_task.project_id) or public.can_manage_all_content()) then
    insert into public.claude_task_requests(task_id, update_id, requested_by, body)
      values (p_task_id, v_update, v_actor, v_body) on conflict (update_id) do nothing;
  end if;

  -- تعليق المدير (للكل أو للمسؤول) على مهمة مستنية مراجعته = طلب تعديل
  if v_task.status = 'review' and v_actor <> v_task.assignee_id and v_body <> ''
     and (v_to is null or v_to = v_task.assignee_id)
     and public.task_can_manage_project(v_task.project_id) then
    update public.tasks set status = 'revision', return_note = v_body, completed_at = null, updated_at = now() where id = p_task_id;
    insert into public.task_updates(task_id, author_id, body, status_from, status_to)
      values (p_task_id, v_actor, 'إعادة للتعديل من تعليق: ' || left(v_body, 4900), 'review', 'revision');
    insert into public.task_notifications(recipient_id, task_id, kind, message)
      values (v_task.assignee_id, p_task_id, 'returned', 'أُعيدت المهمة للتعديل: ' || v_task.title)
      on conflict (recipient_id, task_id, kind, reference_date)
      do update set message = excluded.message, read_at = null, created_at = now();
  end if;

  return v_update;
end $function$;
revoke all on function public.task_add_comment_to(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.task_add_comment_to(uuid, text, jsonb, uuid) to authenticated, service_role;

-- الدالة القديمة بنفس اسمها وتوقيعها (للأماكن اللي بتناديها) = تعليق للكل
create or replace function public.task_add_comment(p_task_id uuid, p_body text, p_attachments jsonb DEFAULT '[]'::jsonb)
 returns uuid language sql security definer set search_path to 'public'
as $function$ select public.task_add_comment_to(p_task_id, p_body, p_attachments, null::uuid); $function$;

notify pgrst, 'reload schema';
