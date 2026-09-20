begin;
alter table public.content_items add column if not exists design_execution text not null default 'human'
 check (design_execution in ('human','ai'));
-- Keep assignment changes in the approval role, including same-stage edits.
create or replace function public.guard_design_execution()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if auth.role()='service_role' then return new; end if;
 if TG_OP='INSERT' then
   if new.design_execution <> 'human' then raise exception 'اختر جهة التنفيذ عند الاعتماد الأولي'; end if;
 elsif new.design_execution is distinct from old.design_execution then
   if public.my_admin_id() is null or not (public.can_manage_all_content() or public.has_role('approver')) then
     raise exception 'تغيير جهة التنفيذ يحتاج مسؤول اعتماد';
   end if;
 end if;
 if new.design_execution='ai' and new.assigned_designer is not null then
   raise exception 'الوكيل لا يحتاج تعيين مصمم بشري';
 end if;
 return new;
end; $$;
drop trigger if exists content_design_execution_guard on public.content_items;
create trigger content_design_execution_guard before insert or update on public.content_items
 for each row execute function public.guard_design_execution();

create or replace function public.guard_content_transition()
returns trigger language plpgsql security definer set search_path = public as $$
declare me uuid; allowed boolean := false;
begin
  if auth.role() = 'service_role' then return new; end if;
  if public.can_manage_all_content() then return new; end if;
  me := public.my_admin_id();

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
create or replace function public.create_video_job(p_content_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid;
  r text;
  item public.content_items%rowtype;
  existing_job public.video_jobs%rowtype;
  created_job public.video_jobs%rowtype;
  asset_snapshot jsonb;
  logo public.brand_logos%rowtype;
  settings jsonb;
  chosen_variant text;
begin
  me := public.my_admin_id();
  r := public.my_role();

  if me is null then
    raise exception 'غير مسموح: المستخدم غير مسجل كموظف نشط';
  end if;

  if not (public.has_role('page_manager') or public.has_role('approver') or public.can_manage_all_content()) then
    raise exception 'غير مسموح بإنشاء Video Job لهذا الدور';
  end if;

  select * into item
  from public.content_items
  where id = p_content_id for update;

  if not found then
    raise exception 'المادة غير موجودة';
  end if;

  if not public.can_manage_all_content() and item.created_by is distinct from me
    and not (public.has_role('approver') and item.design_execution='ai' and item.stage in ('in_design','needs_revision')) then
    raise exception 'غير مسموح: هذه المادة ليست لك';
  end if;

  if item.content_format is distinct from 'video' then
    raise exception 'لا يمكن إنشاء Video Job لمادة ليست Video';
  end if;

  if nullif(btrim(item.script_text), '') is null then
    raise exception 'السكريبت مطلوب قبل إنشاء Video Job';
  end if;

  if item.target_duration_min_seconds is null
     or item.target_duration_max_seconds is null then
    raise exception 'مدة الفيديو المطلوبة غير مكتملة';
  end if;

  if nullif(btrim(item.video_template), '') is null then
    raise exception 'Video Template مطلوب قبل إنشاء Video Job';
  end if;

  if coalesce((item.cover_settings->>'enabled')::boolean, false) then
    if length(btrim(coalesce(item.cover_settings->>'title', item.title))) not between 1 and 80 then
      raise exception 'عنوان الكفر مطلوب وبحد أقصى 80 حرف';
    end if;
    if coalesce(item.cover_settings->>'position','bottom') not in ('top','bottom') then
      raise exception 'موضع عنوان الكفر غير صالح';
    end if;
  end if;
  chosen_variant := coalesce(item.cover_settings->>'logo_variant','primary');
  if chosen_variant not in ('primary','alternate') then raise exception 'نسخة اللوجو غير صالحة'; end if;
  select * into logo from public.brand_logos where brand=item.brand and variant=chosen_variant;
  if not found then raise exception 'احفظ نسخة اللوجو المختارة لهذا البراند في لوحة الإدارة أولاً'; end if;
  settings := (item.cover_settings - 'logo_asset_id' - 'logo_brand' - 'logo_source') ||
    jsonb_build_object('logo_asset_id',logo.id,'logo_brand',item.brand,'logo_source','brand_library','logo_variant',chosen_variant);

  -- Idempotent: لو فيه Job شغال بالفعل لنفس المادة رجّعه بدل التكرار.
  select * into existing_job
  from public.video_jobs
  where content_id = p_content_id
    and status in ('pending','preparing','rendering','uploading')
  order by created_at desc
  limit 1 for update;

  if found and existing_job.status <> 'pending' then
    return to_jsonb(existing_job);
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', a.id,
        'asset_type', a.asset_type,
        'storage_path', a.storage_path,
        'file_name', a.file_name,
        'mime_type', a.mime_type,
        'file_size', a.file_size
      )
      order by a.created_at
    ),
    '[]'::jsonb
  )
  into asset_snapshot
  from public.video_assets a
  where a.content_id = item.id and a.asset_role='footage'
    and a.id::text is distinct from item.cover_settings->>'logo_asset_id';
  asset_snapshot := asset_snapshot || jsonb_build_array(jsonb_build_object(
    'id',logo.id,'asset_type','brand_logo','brand',logo.brand,'variant',logo.variant,
    'storage_bucket','brand-logos','storage_path',logo.storage_path,'file_name',logo.file_name));

  if existing_job.id is not null then
    update public.video_jobs set title=item.title,brand=item.brand,specialty=item.specialty,
      script_text=item.script_text,caption_text=item.caption_text,cta_type=item.cta_type,cta_text=item.cta_text,
      duration_min_seconds=item.target_duration_min_seconds,duration_max_seconds=item.target_duration_max_seconds,
      video_template=item.video_template,media_mode=item.video_media_mode,music_mood=coalesce(item.video_music_mood,'calm'),input_assets=asset_snapshot,
      cover_settings=settings,input_schema_version=2
    where id=existing_job.id and status='pending' returning * into created_job;
    return to_jsonb(created_job);
  end if;

  insert into public.video_jobs (
    content_id, created_by, status,
    title, brand, specialty,
    script_text, caption_text, cta_type, cta_text,
    duration_min_seconds, duration_max_seconds, video_template,
    media_mode, music_mood, input_assets, cover_settings, input_schema_version
  ) values (
    item.id, me, 'pending',
    item.title, item.brand, item.specialty,
    item.script_text, item.caption_text, item.cta_type, item.cta_text,
    item.target_duration_min_seconds, item.target_duration_max_seconds,
    item.video_template,
    coalesce(item.video_media_mode, 'uploaded_plus_auto'),
    coalesce(item.video_music_mood, 'calm'),
    asset_snapshot, settings, 2
  )
  returning * into created_job;

  return to_jsonb(created_job);
end;
$$;

revoke all on function public.create_video_job(uuid) from public;
grant execute on function public.create_video_job(uuid) to authenticated;
create or replace function public.reserve_design_scene(p_content_id uuid,p_request_key uuid,p_prompt text,p_quality text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me uuid := public.my_admin_id(); job public.design_jobs%rowtype; reserve numeric;
begin
 if me is null then raise exception 'غير مسموح'; end if;
 if not exists(select 1 from public.content_items where id=p_content_id and brand='sono' and stage not in ('published','scheduled','ready_to_publish') and
 (created_by=me or assigned_designer=me or public.can_manage_all_content() or
 (design_execution='ai' and stage in ('in_design','needs_revision') and public.has_role('approver')))) then raise exception 'غير مسموح لهذه المادة'; end if;
 if p_request_key is null or p_prompt is null or p_quality is null or p_quality not in ('medium','high') or length(trim(p_prompt)) not between 10 and 3000 then raise exception 'وصف الصورة أو الجودة غير صالح'; end if;
 -- Serialize all account reservations, including different users, before checking the monthly cap.
 perform pg_advisory_xact_lock(20260920,1080);
 select * into job from public.design_jobs where request_key=p_request_key;
 if found then
   if job.content_id<>p_content_id or job.created_by<>me then raise exception 'طلب غير مطابق'; end if;
   return jsonb_build_object('job',to_jsonb(job),'new',false);
 end if;
 if exists(select 1 from public.design_jobs where content_id=p_content_id and status in ('pending','generating_scene')) then
   raise exception 'يوجد توليد قيد التنفيذ. انتظر أو راجع آخر محاولة';
 end if;
 if (select count(*) from public.design_jobs where content_id=p_content_id and attempt_count>0)>=3 then raise exception 'وصلت لحد ٣ محاولات لهذه المادة'; end if;
 -- Conservative reservation, not an exact OpenAI bill. Failed/ambiguous requests stay charged against the cap.
 reserve := case when p_quality='high' then 0.30 else 0.10 end;
 if coalesce((select sum(estimated_cost_usd) from public.design_jobs where created_at>=date_trunc('month',now())),0)+reserve>5 then
   raise exception 'تم بلوغ حد التجربة الشهري: ٥ دولارات';
 end if;
 insert into public.design_jobs(content_id,created_by,template_id,request_key,status,scene_prompt,image_model,image_quality,attempt_count,estimated_cost_usd)
 values(p_content_id,me,(select id from public.design_templates where template_key='sono-white-v1'),p_request_key,'generating_scene',p_prompt,'gpt-image-1.5',p_quality,1,reserve)
 returning * into job;
 return jsonb_build_object('job',to_jsonb(job),'new',true);
end; $$;
revoke all on function public.reserve_design_scene(uuid,uuid,text,text) from public;
grant execute on function public.reserve_design_scene(uuid,uuid,text,text) to authenticated;
create or replace function public.save_design_version(p_content_id uuid,p_output_url text,p_source_url text,p_scene_job_id uuid,p_settings jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare me uuid:=public.my_admin_id(); version_id uuid;
begin
 if me is null or not exists(select 1 from public.content_items where id=p_content_id and brand='sono' and stage not in ('published','scheduled','ready_to_publish') and
 (created_by=me or assigned_designer=me or public.can_manage_all_content() or
 (design_execution='ai' and stage in ('in_design','needs_revision') and public.has_role('approver')))) then raise exception 'غير مسموح'; end if;
 if p_output_url !~ '^https://' or jsonb_typeof(p_settings)<>'object' then raise exception 'بيانات النسخة غير صالحة'; end if;
 if p_scene_job_id is not null and not exists(select 1 from public.design_jobs where id=p_scene_job_id and scene_storage_path like 'sono/%') then raise exception 'الصورة غير موجودة'; end if;
 insert into public.design_versions(content_id,created_by,scene_job_id,source_file_url,output_file_url,settings)
 values(p_content_id,me,p_scene_job_id,p_source_url,p_output_url,p_settings) returning id into version_id;
 return version_id;
end; $$;
revoke all on function public.save_design_version(uuid,text,text,uuid,jsonb) from public;
grant execute on function public.save_design_version(uuid,text,text,uuid,jsonb) to authenticated;


create or replace function public.route_content_design(p_content_id uuid, p_target text, p_designer_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare item public.content_items%rowtype; me uuid:=public.my_admin_id(); job jsonb;
begin
 if me is null or not (public.can_manage_all_content() or public.has_role('approver')) then
   raise exception 'الإرسال للتصميم يحتاج مسؤول اعتماد'; end if;
 if p_target is null or p_target not in ('human','ai') then raise exception 'اختر جهة التنفيذ'; end if;
 select * into item from public.content_items where id=p_content_id for update;
 if not found then raise exception 'المادة غير موجودة'; end if;
 -- A repeated click must not create a second paid production request.
 if item.stage='in_design' and item.design_execution=p_target
   and item.assigned_designer is not distinct from p_designer_id then return to_jsonb(item); end if;
 if item.stage <> 'initial_approval' then raise exception 'المادة ليست في الاعتماد الأولي'; end if;
 if p_target='human' then
   if p_designer_id is null or not exists(select 1 from public.admins a where a.id=p_designer_id and a.active
     and (a.role='designer' or exists(select 1 from public.admin_extra_roles e where e.admin_id=a.id and e.role='designer'))) then
       raise exception 'اختر مصممًا نشطًا'; end if;
 else
   if p_designer_id is not null then raise exception 'لا تعيّن مصممًا بشريًا للوكيل'; end if;
   if not (coalesce(item.content_format,'')='video' or (coalesce(item.brand,'')='sono' and coalesce(item.content_format,'')='image_post')) then
     raise exception 'وكيل الصور متاح لبوستات سونو حاليًا'; end if;
 end if;
 update public.content_items set stage='in_design', design_execution=p_target,
   assigned_designer=case when p_target='human' then p_designer_id else null end, design_received_at=null
 where id=item.id returning * into item;
 if p_target='ai' and item.content_format='video' then
   -- Same transaction: missing fields roll back approval and assignment too.
   job:=public.create_video_job(item.id);
 end if;
 insert into public.activity_log(content_id,actor_id,action,from_stage,to_stage)
 values(item.id,me,case when p_target='ai' then 'اعتماد أولي وإرسال لوكيل التصميم' else 'اعتماد أولي وإرسال للمصمم' end,'initial_approval','in_design');
 return to_jsonb(item);
end; $$;
revoke all on function public.route_content_design(uuid,text,uuid) from public;
grant execute on function public.route_content_design(uuid,text,uuid) to authenticated;

create or replace function public.submit_ai_design(p_content_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare item public.content_items%rowtype; output_url text; me uuid:=public.my_admin_id(); previous_stage text;
begin
 select * into item from public.content_items where id=p_content_id for update;
 if not found or me is null then raise exception 'غير مسموح'; end if;
 if not (public.can_manage_all_content() or public.has_role('approver') or item.created_by=me) then raise exception 'غير مسموح'; end if;
 if item.design_execution <> 'ai' then raise exception 'المادة ليست موجهة للوكيل'; end if;
 if item.stage='final_approval' then return to_jsonb(item); end if;
 if item.stage not in ('in_design','needs_revision') then raise exception 'المادة ليست في مرحلة التنفيذ'; end if;
 if item.content_format='video' then
   select coalesce(drive_video_url,output_video_url) into output_url from public.video_jobs
   where content_id=item.id and status='ready' order by created_at desc limit 1;
 else
   select output_file_url into output_url from public.design_versions
   where content_id=item.id order by created_at desc limit 1;
 end if;
 if nullif(btrim(output_url),'') is null then raise exception 'أكمل الإنتاج واحفظ نسخة قبل إرسالها للاعتماد النهائي'; end if;
 previous_stage:=item.stage;
 update public.content_items set stage='final_approval',design_file_url=output_url where id=item.id returning * into item;
 insert into public.activity_log(content_id,actor_id,action,from_stage,to_stage)
 values(item.id,me,'إرسال إنتاج الوكيل للاعتماد النهائي',previous_stage,'final_approval');
 return to_jsonb(item);
end; $$;
revoke all on function public.submit_ai_design(uuid) from public;
grant execute on function public.submit_ai_design(uuid) to authenticated;
commit;
