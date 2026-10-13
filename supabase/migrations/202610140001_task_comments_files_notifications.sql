set local lock_timeout = '10s';
-- تاب المهام: مرفقات التعليقات (ملفات خاصة) + إشعار تلقائي عند كل تعليق.
-- الكتابة على المرفقات والتعليقات الجديدة بتم عن طريق دالة task_add_comment فقط (SECURITY DEFINER).
-- مفيش حذف لأي بيانات موجودة. آمن للتشغيل أكتر من مرة.

-- ١) نوع إشعار جديد "comment"
alter table public.task_notifications drop constraint if exists task_notifications_kind_check;
alter table public.task_notifications add constraint task_notifications_kind_check
  check (kind in ('assigned','status','review','returned','overdue','comment'));

-- ٢) جدول المرفقات (metadata بس — الملف نفسه في Storage خاص)
create table if not exists public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  update_id uuid not null references public.task_updates(id) on delete cascade,
  uploaded_by uuid not null references public.admins(id),
  file_name text not null check (length(trim(file_name)) between 1 and 200),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  storage_path text not null unique,
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

-- ٣) Storage bucket خاص + سياسات (مفيش تعديل ولا حذف من العميل)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('task-attachments','task-attachments',false,10485760,array[
  'image/png','image/jpeg','image/webp','image/gif','application/pdf','text/plain','text/csv',
  'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation'])
on conflict (id) do update set public=false, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;

-- أول جزء من مسار الملف لازم يكون task_id صحيح
create or replace function public.task_attachment_task_id(p_name text)
returns uuid language sql immutable set search_path = public as $$
  select case when split_part(p_name,'/',1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then split_part(p_name,'/',1)::uuid end;
$$;

drop policy if exists "task attachments read" on storage.objects;
create policy "task attachments read" on storage.objects for select to authenticated
  using (bucket_id='task-attachments' and public.task_can_access(public.task_attachment_task_id(name)));
drop policy if exists "task attachments upload" on storage.objects;
create policy "task attachments upload" on storage.objects for insert to authenticated
  with check (bucket_id='task-attachments' and public.finance_module_allowed('tasks','update')
              and public.task_can_access(public.task_attachment_task_id(name)));

-- ٤) إضافة تعليق (+ مرفقات اختيارية) وإرسال الإشعارات في خطوة واحدة
create or replace function public.task_add_comment(p_task_id uuid, p_body text, p_attachments jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := public.my_admin_id();
  v_task public.tasks%rowtype;
  v_update uuid;
  v_item jsonb;
  v_path text;
  v_obj storage.objects%rowtype;
  v_body text := trim(coalesce(p_body,''));
  v_atts jsonb := case when jsonb_typeof(coalesce(p_attachments,'[]'::jsonb))='array' then coalesce(p_attachments,'[]'::jsonb) else '[]'::jsonb end;
begin
  if not public.finance_module_allowed('tasks','update') then raise exception 'ليس لديك صلاحية هذا الإجراء في المهام'; end if;
  if v_actor is null then raise exception 'Authentication required'; end if;
  if not public.task_can_access(p_task_id) then raise exception 'Task not found'; end if;
  select * into v_task from public.tasks where id = p_task_id;
  if jsonb_array_length(v_atts) > 5 then raise exception 'الحد الأقصى 5 ملفات في التعليق الواحد'; end if;
  if v_body = '' and jsonb_array_length(v_atts) = 0 then raise exception 'اكتب تعليقاً أو أرفق ملفاً'; end if;
  if length(v_body) > 5000 then raise exception 'التعليق أطول من المسموح'; end if;

  insert into public.task_updates(task_id, author_id, body)
    values (p_task_id, v_actor, case when v_body = '' then 'مرفقات' else v_body end)
    returning id into v_update;

  for v_item in select * from jsonb_array_elements(v_atts) loop
    v_path := v_item->>'path';
    if v_path is null or split_part(v_path,'/',1) <> p_task_id::text then raise exception 'مسار المرفق غير صالح'; end if;
    select * into v_obj from storage.objects o where o.bucket_id = 'task-attachments' and o.name = v_path;
    if not found then raise exception 'الملف لم يُرفع بنجاح، أعد المحاولة'; end if;
    insert into public.task_attachments(task_id, update_id, uploaded_by, file_name, mime_type, size_bytes, storage_path)
      values (p_task_id, v_update, v_actor,
              left(coalesce(nullif(trim(v_item->>'name'),''),'ملف'),200),
              coalesce(v_obj.metadata->>'mimetype','application/octet-stream'),
              greatest(1, coalesce((v_obj.metadata->>'size')::bigint, 1)),
              v_path);
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
