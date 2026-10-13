set local lock_timeout = '10s';
-- تاب المهام: مرفقات التعليقات (الملفات نفسها على Google Drive، والقاعدة بتحفظ الرابط بس) + إشعار تلقائي عند كل تعليق.
-- الكتابة على المرفقات والتعليقات الجديدة بتم عن طريق دالة task_add_comment فقط (SECURITY DEFINER).
-- مفيش حذف لأي بيانات موجودة. آمن للتشغيل أكتر من مرة. مفيش استخدام لمساحة Supabase Storage.

-- ١) نوع إشعار جديد "comment"
alter table public.task_notifications drop constraint if exists task_notifications_kind_check;
alter table public.task_notifications add constraint task_notifications_kind_check
  check (kind in ('assigned','status','review','returned','overdue','comment'));

-- ٢) جدول المرفقات (metadata + رابط الدرايف)
create table if not exists public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  update_id uuid not null references public.task_updates(id) on delete cascade,
  uploaded_by uuid not null references public.admins(id),
  file_name text not null check (length(trim(file_name)) between 1 and 200),
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  file_url text not null check (file_url ~ '^https://(drive|docs)\.google\.com/'),
  drive_file_id text,
  created_at timestamptz not null default now()
);
create index if not exists task_attachments_task_idx on public.task_attachments(task_id, created_at desc);
create index if not exists task_attachments_update_idx on public.task_attachments(update_id);
alter table public.task_attachments enable row level security;

drop policy if exists task_attachments_read on public.task_attachments;
create policy task_attachments_read on public.task_attachments for select to authenticated
  using (public.task_can_access(task_id));
drop policy if exists "finance restrict select" on public.task_attachments;
create policy "finance restrict select" on public.task_attachments as restrictive for select to authenticated
  using (public.finance_module_allowed('tasks','view'));
-- مفيش INSERT/UPDATE/DELETE مباشر من العميل: الكتابة عن طريق task_add_comment فقط.

-- ٣) إضافة تعليق (+ مرفقات اختيارية) وإرسال الإشعارات في خطوة واحدة
create or replace function public.task_add_comment(p_task_id uuid, p_body text, p_attachments jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := public.my_admin_id();
  v_task public.tasks%rowtype;
  v_update uuid;
  v_item jsonb;
  v_url text;
  v_body text := trim(coalesce(p_body,''));
  v_atts jsonb := case when jsonb_typeof(coalesce(p_attachments,'[]'::jsonb))='array' then coalesce(p_attachments,'[]'::jsonb) else '[]'::jsonb end;
begin
  if not public.finance_module_allowed('tasks','update') then raise exception 'ليس لديك صلاحية هذا الإجراء في المهام'; end if;
  if v_actor is null then raise exception 'Authentication required'; end if;
  if not public.task_can_access(p_task_id) then raise exception 'Task not found'; end if;
  select * into v_task from public.tasks where id = p_task_id;
  if jsonb_array_length(v_atts) > 10 then raise exception 'الحد الأقصى 10 ملفات في التعليق الواحد'; end if;
  if v_body = '' and jsonb_array_length(v_atts) = 0 then raise exception 'اكتب تعليقاً أو أرفق ملفاً'; end if;
  if length(v_body) > 5000 then raise exception 'التعليق أطول من المسموح'; end if;

  insert into public.task_updates(task_id, author_id, body)
    values (p_task_id, v_actor, case when v_body = '' then 'مرفقات' else v_body end)
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
    select r.admin_id, p_task_id, 'comment', 'تعليق جديد على المهمة: ' || v_task.title
    from (
      select v_task.assignee_id as admin_id
      union select p.manager_id from public.task_projects p where p.id = v_task.project_id
      union select m.admin_id from public.task_project_members m where m.project_id = v_task.project_id and m.role_name = 'manager'
    ) r
    where r.admin_id is not null and r.admin_id <> v_actor
    on conflict (recipient_id, task_id, kind, reference_date)
    do update set message = excluded.message, read_at = null, created_at = now();

  return v_update;
end $$;
revoke all on function public.task_add_comment(uuid, text, jsonb) from public;
grant execute on function public.task_add_comment(uuid, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
