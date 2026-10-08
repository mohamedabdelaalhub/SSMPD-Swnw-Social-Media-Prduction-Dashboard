begin;
create or replace function public.guard_content_transition()
returns trigger language plpgsql security definer set search_path = public as $$
declare me uuid; allowed boolean := false;
begin
  if auth.role() = 'service_role' then return new; end if;
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
end $$;

create or replace function public.guard_prepublication_revision() returns trigger
language plpgsql security definer set search_path=public as $$
declare changed boolean; website_status text;
begin
 changed=(new.title,new.brand,new.specialty,new.body,new.caption_text,new.hook_text,new.cta_text,new.cta_type,new.script_text,new.design_file_url,new.content_format,new.content_angle,new.topic_service,new.advertising_objective,new.hypothesis_reason,new.video_template,new.target_duration_min_seconds,new.target_duration_max_seconds)
 is distinct from (old.title,old.brand,old.specialty,old.body,old.caption_text,old.hook_text,old.cta_text,old.cta_type,old.script_text,old.design_file_url,old.content_format,old.content_angle,old.topic_service,old.advertising_objective,old.hypothesis_reason,old.video_template,old.target_duration_min_seconds,old.target_duration_max_seconds);
 if old.stage not in ('ready_to_publish','scheduled') or not(changed or new.stage='final_approval') then return new; end if;
 if public.my_admin_id() is null or not(public.can_manage_all_content() or public.has_role('approver') or old.created_by=public.my_admin_id()) then raise exception 'غير مسموح بتعديل هذه المادة'; end if;
 -- Lock the same rows that the publisher claims, before changing the approved content.
 perform 1 from public.meta_publish_jobs where content_id=old.id for update;
 if exists(select 1 from public.meta_publish_jobs where content_id=old.id and status in ('processing','published','partial')) then raise exception 'النشر بدأ أو تم جزئيًا. حدّث الحالة قبل التعديل'; end if;
 if to_regclass('public.website_publications') is not null then
  execute 'select website_publish_status from public.website_publications where content_id=$1 for update' into website_status using old.id;
  if website_status='processing' then raise exception 'إرسال الموقع بدأ. حدّث الحالة قبل التعديل'; end if;
 end if;
 update public.meta_publish_jobs set status='cancelled' where content_id=old.id and status='pending';
 new.stage='final_approval';new.scheduled_publish_at=null;new.scheduled_by=null;
 return new;
end $$;
drop trigger if exists content_items_prepublication_revision on public.content_items;
create trigger content_items_prepublication_revision before update on public.content_items for each row execute function public.guard_prepublication_revision();
revoke all on function public.guard_prepublication_revision() from public,anon,authenticated;

create or replace function public.revise_content_before_publish(p_id uuid,p_patch jsonb,p_expected_updated_at timestamptz) returns jsonb
language plpgsql security definer set search_path=public as $$
declare current public.content_items; proposed public.content_items; updated public.content_items;
begin
 select * into current from public.content_items where id=p_id for update;
 if not found then raise exception 'المادة غير موجودة'; end if;
 if public.my_admin_id() is null or not(public.can_manage_all_content() or public.has_role('approver') or current.created_by=public.my_admin_id()) then raise exception 'غير مسموح بتعديل هذه المادة'; end if;
 if current.stage not in ('ready_to_publish','scheduled') then raise exception 'المادة لم تعد متاحة للتعديل قبل النشر'; end if;
 if p_expected_updated_at is null or current.updated_at is distinct from p_expected_updated_at then raise exception 'المادة اتغيرت منذ فتحها. حدّث القائمة وافتح التعديل مجددًا'; end if;
 if p_patch is null or jsonb_typeof(p_patch)<>'object' then raise exception 'مدخلات غير صالحة'; end if;
 if exists(select 1 from jsonb_object_keys(p_patch) as k(key) where key not in ('title','body','brand','specialty','advertising_objective','content_format','topic_service','hook_text','content_angle','script_text','caption_text','cta_type','cta_text','target_duration_min_seconds','target_duration_max_seconds','video_template','hypothesis_reason')) then raise exception 'حقل تعديل غير مسموح'; end if;
 proposed=jsonb_populate_record(current,p_patch);
 if nullif(btrim(proposed.title),'') is null or proposed.brand not in ('sono','dr_dina') or proposed.brand is null then raise exception 'العنوان والصفحة مطلوبان'; end if;
 if proposed.target_duration_max_seconds<proposed.target_duration_min_seconds then raise exception 'مدة الفيديو غير صالحة'; end if;
 update public.content_items set title=proposed.title,body=proposed.body,brand=proposed.brand,specialty=proposed.specialty,
 advertising_objective=proposed.advertising_objective,content_format=proposed.content_format,topic_service=proposed.topic_service,
 hook_text=proposed.hook_text,content_angle=proposed.content_angle,script_text=proposed.script_text,caption_text=proposed.caption_text,
 cta_type=proposed.cta_type,cta_text=proposed.cta_text,target_duration_min_seconds=proposed.target_duration_min_seconds,
 target_duration_max_seconds=proposed.target_duration_max_seconds,video_template=proposed.video_template,hypothesis_reason=proposed.hypothesis_reason,
 stage='final_approval',scheduled_publish_at=null,scheduled_by=null where id=p_id returning * into updated;
 return to_jsonb(updated);
end $$;
revoke all on function public.revise_content_before_publish(uuid,jsonb,timestamptz) from public,anon;
grant execute on function public.revise_content_before_publish(uuid,jsonb,timestamptz) to authenticated;
commit;
