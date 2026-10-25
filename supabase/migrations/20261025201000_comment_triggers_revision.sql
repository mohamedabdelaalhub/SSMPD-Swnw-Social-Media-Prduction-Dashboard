-- الكومنت = طلب تعديل فعلي (محمد، 2026-10-25)
--
-- المشكلة: كومنت «في انتظار التعديل» على مادة كان بيتحفظ في جدول comments وبس —
-- المادة تفضل «مجدولة/جاهزة للنشر» وتتنشر بالغلط، ومحدش (لا المصمم ولا Claude Creative)
-- بيتابع إلا لو حد داس «رفض/طلب تعديل» أو «نفّذ التعديل» يدوي. وكمان مسؤول الاعتماد
-- مكانش يقدر يرجّع مادة «مجدولة» للتعديل أصلاً (الحارس بيرفض).
-- ونفس الحكاية في المهام: تعليق المدير على مهمة «في المراجعة» كان بيبعت إشعار بس.
--
-- الإصلاح (على مستوى القاعدة، فبيشتغل من أي شاشة):
-- • تعليق pending من مراجع (مسؤول اعتماد/مدير/سوبر أدمن) أو صاحب المادة — مش من مصممها —
--   على مادة في initial_approval / final_approval / ready_to_publish / scheduled
--   ⇒ المادة ترجع needs_revision، الجدولة تتلغي، ومهام النشر pending تتلغي.
--   (لو النشر بدأ فعلاً processing/published/partial مابنلمسهاش.)
-- • لو المادة مع Claude Creative ⇒ طلب «نفّذ التعديل» بيتعمل تلقائي في claude_design_requests
--   فمهمة «SSMPD Claude design queue» تلقطه في أول تشغيل.
-- • لو المادة كانت أصلاً needs_revision ⇒ بنحدّث updated_at عشان يطلع إشعار
--   «مادة مطلوب تعديلها» جديد في صندوق المسؤول (personal_home_inbox)، وبنفتح طلب Claude لو مفيش.
-- • سجل في activity_log.
-- • مهام الموظفين: تعليق المدير (مش المسؤول عن المهمة) على مهمة review ⇒ revision + إشعار returned.

-- 1) الحارس: سماح داخلي واحد بس لتريجر الكومنت (متغير جلسة محلي للمعاملة؛ العميل مايقدرش يضبطه)
create or replace function public.guard_content_transition()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare me uuid; allowed boolean := false;
begin
  if auth.role() = 'service_role' then return new; end if;
  -- رجوع للتعديل من تريجر الكومنت (comment_auto_revision) — لنفس المادة بس
  if coalesce(current_setting('ssmpd.comment_revision', true), '') = old.id::text
     and new.stage = 'needs_revision' then return new; end if;
  if public.can_manage_all_content() then return new; end if;
  me := public.my_admin_id();
  if old.stage in ('ready_to_publish','scheduled') and new.stage='final_approval'
    and (old.created_by=me or public.has_role('approver')) then return new; end if;

  if public.has_role('page_manager') and old.created_by = me and (
    (old.stage = 'idea_selection' and new.stage = 'initial_approval')
    or (old.stage = 'ready_to_publish' and new.stage = 'published')
    or (old.stage = 'ready_to_publish' and new.stage = 'scheduled')
    or (old.stage = 'scheduled' and new.stage = 'published')
    or (old.stage = 'scheduled' and new.stage = 'ready_to_publish')
    or (old.stage = 'needs_revision' and old.assigned_designer is null and new.stage = 'initial_approval')
    or (old.stage = new.stage)
  ) then
    allowed := true;
  end if;

  if not allowed and public.has_role('designer') and (old.assigned_designer is null or old.assigned_designer = me) and (
    (old.stage = 'in_design' and new.stage = 'final_approval')
    or (old.stage = 'needs_revision' and old.assigned_designer is not null and new.stage = 'final_approval')
    or (old.stage = new.stage)
  ) then
    allowed := true;
  end if;

  if not allowed and public.has_role('approver') and (
    (old.stage = 'initial_approval' and new.stage in ('in_design','needs_revision'))
    or (old.stage = 'final_approval' and new.stage in ('ready_to_publish','needs_revision'))
    or (old.stage = 'ready_to_publish' and new.stage = 'published')
    or (old.stage = 'ready_to_publish' and new.stage = 'scheduled')
    or (old.stage = 'scheduled' and new.stage = 'published')
    or (old.stage = 'scheduled' and new.stage = 'ready_to_publish')
    or (old.stage = new.stage)
  ) then
    allowed := true;
  end if;

  if not allowed and old.design_execution = 'ai' and new.design_execution = 'ai'
    and old.stage in ('in_design','needs_revision') and new.stage = 'final_approval'
    and (old.created_by = me or public.has_role('approver'))
    and new.design_file_url is not null then allowed := true; end if;
  if allowed then return new; end if;
  raise exception 'انتقال مرحلة غير مسموح لدورك الحالي';
end $function$;

-- 2) تريجر الكومنت
create or replace function public.comment_auto_revision()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare
  claude constant uuid := 'a0fbdfee-d147-4282-b988-186a9ae3e88c';
  ci public.content_items%rowtype;
  v_author uuid := new.author_id;
  v_reviewer boolean;
  v_style text;
  v_web text;
begin
  if coalesce(new.status, 'pending') <> 'pending' or v_author is null or v_author = claude then return null; end if;
  select * into ci from public.content_items where id = new.content_id for update;
  if not found or ci.stage in ('published', 'idea_selection', 'in_design') then return null; end if;
  -- رد المصمم نفسه على مادته مش طلب تعديل
  if ci.assigned_designer is not null and v_author = ci.assigned_designer then return null; end if;
  -- سياسة الإدخال بتفرض author_id = my_admin_id()، فأدوار المستخدم الحالي = أدوار الكاتب
  v_reviewer := public.can_manage_all_content() or public.has_role('approver');
  -- مراجع، أو صاحب المادة (بعد ما الفكرة اتقدمت للاعتماد بس)
  if not (v_reviewer or (ci.created_by = v_author and ci.stage <> 'initial_approval')) then return null; end if;

  if ci.stage in ('initial_approval', 'final_approval', 'ready_to_publish', 'scheduled') then
    -- لو النشر بدأ فعلاً متلمسهاش (نفس قاعدة guard_prepublication_revision)
    perform 1 from public.meta_publish_jobs where content_id = ci.id for update;
    if exists(select 1 from public.meta_publish_jobs where content_id = ci.id and status in ('processing','published','partial')) then return null; end if;
    if to_regclass('public.website_publications') is not null then
      execute 'select website_publish_status from public.website_publications where content_id=$1 for update' into v_web using ci.id;
      if v_web = 'processing' then return null; end if;
    end if;
    if to_regclass('public.tiktok_publish_jobs') is not null then
      perform 1 from public.tiktok_publish_jobs where content_id = ci.id for update;
      if exists(select 1 from public.tiktok_publish_jobs where content_id = ci.id and status in ('processing','published','partial')) then return null; end if;
      update public.tiktok_publish_jobs set status = 'cancelled', updated_at = now() where content_id = ci.id and status = 'pending';
    end if;
    update public.meta_publish_jobs set status = 'cancelled' where content_id = ci.id and status = 'pending';
    perform set_config('ssmpd.comment_revision', ci.id::text, true);
    update public.content_items set stage = 'needs_revision', scheduled_publish_at = null, scheduled_by = null
      where id = ci.id;
    perform set_config('ssmpd.comment_revision', '', true);
    insert into public.activity_log(content_id, actor_id, action, from_stage, to_stage)
      values (ci.id, v_author, 'طلب تعديل (تعليق)', ci.stage, 'needs_revision');
  elsif ci.stage = 'needs_revision' then
    -- تعليق جديد على مادة في التعديل: إشعار جديد للمسؤول (مفتاح الإشعار فيه updated_at)
    perform set_config('ssmpd.comment_revision', ci.id::text, true);
    update public.content_items set stage = 'needs_revision' where id = ci.id;
    perform set_config('ssmpd.comment_revision', '', true);
  else
    return null;
  end if;

  -- Claude Creative: افتح طلب «نفّذ التعديل» لو مفيش طلب مفتوح
  if ci.assigned_designer = claude and to_regclass('public.claude_design_requests') is not null then
    select style into v_style from public.claude_design_requests where content_id = ci.id order by created_at desc limit 1;
    insert into public.claude_design_requests(content_id, style, requested_by, status, note)
      values (ci.id, coalesce(v_style, 'photo'), v_author, 'pending', 'تعديل تلقائي من تعليق جديد')
      on conflict (content_id) where status in ('pending','working') do nothing;
  end if;
  return null;
end $function$;
revoke all on function public.comment_auto_revision() from public, anon, authenticated;

drop trigger if exists comments_auto_revision on public.comments;
create trigger comments_auto_revision after insert on public.comments
  for each row execute function public.comment_auto_revision();

-- 3) تعليقات المهام: تعليق المدير على مهمة «في المراجعة» = إعادة للتعديل
create or replace function public.task_add_comment(p_task_id uuid, p_body text, p_attachments jsonb DEFAULT '[]'::jsonb)
 returns uuid language plpgsql security definer set search_path to 'public'
as $function$
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
  select * into v_task from public.tasks where id = p_task_id for update;
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

  -- تعليق المدير على مهمة مستنية مراجعته = طلب تعديل: ترجع للموظف فوراً
  if v_task.status = 'review' and v_actor <> v_task.assignee_id and v_body <> ''
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

notify pgrst, 'reload schema';
