-- تصميم Claude مباشرة من نموذج إنشاء المحتوى (2026-11-10، قرار محمد):
-- الموظف يختار «تصميم Claude» وهو بينشئ المادة، فتروح لـ Claude Creative على طول من غير الاعتماد الأولي،
-- ومسؤول الاعتماد يشوفها في الاعتماد النهائي بس. المسار الوحيد لده هو الدالة request_claude_design_direct.
create or replace function public.guard_content_transition()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare me uuid; allowed boolean := false;
begin
  if auth.role() = 'service_role' then return new; end if;
  if coalesce(current_setting('ssmpd.comment_revision', true), '') = old.id::text
     and new.stage = 'needs_revision' then return new; end if;
  -- تصميم Claude المباشر: بيتفعّل من جوه request_claude_design_direct بس (إعداد محلي للمعاملة)
  if coalesce(current_setting('ssmpd.claude_direct', true), '') = old.id::text
     and old.stage in ('idea_selection','initial_approval') and new.stage = 'in_design'
     and new.assigned_designer = 'a0fbdfee-d147-4282-b988-186a9ae3e88c'::uuid then return new; end if;
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

create or replace function public.request_claude_design_direct(p_content_id uuid, p_style text default 'photo', p_note text default null)
 returns public.claude_design_requests
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  me uuid := public.my_admin_id();
  item public.content_items;
  req public.claude_design_requests;
  claude constant uuid := 'a0fbdfee-d147-4282-b988-186a9ae3e88c';
begin
  if me is null then raise exception 'غير مسموح: المستخدم غير مسجل كموظف نشط'; end if;
  if p_style is null or p_style not in ('photo','illustration') then raise exception 'شكل الصور غير صحيح'; end if;
  if p_note is not null and length(p_note) > 20000 then raise exception 'ملاحظة الطلب أطول من المسموح'; end if;
  select * into item from public.content_items where id = p_content_id for update;
  if not found then raise exception 'المادة غير موجودة'; end if;
  if item.created_by is distinct from me and not public.can_manage_all_content() then
    raise exception 'غير مسموح بطلب تصميم لمادة غيرك'; end if;
  if item.stage not in ('idea_selection','initial_approval') then
    raise exception 'المادة عدّت مرحلة الاعتماد الأولي بالفعل'; end if;
  if item.content_format = 'video' then raise exception 'التصميم المباشر للبوست والكاروسيل فقط'; end if;
  perform set_config('ssmpd.claude_direct', p_content_id::text, true);
  update public.content_items set stage = 'in_design', assigned_designer = claude, design_execution = 'human' where id = p_content_id;
  perform set_config('ssmpd.claude_direct', '', true);
  insert into public.claude_design_requests (content_id, style, requested_by, note)
    values (p_content_id, p_style, me, p_note) returning * into req;
  return req;
end $function$;
revoke all on function public.request_claude_design_direct(uuid, text, text) from public, anon;
grant execute on function public.request_claude_design_direct(uuid, text, text) to authenticated;
