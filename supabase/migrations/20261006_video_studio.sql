begin;
alter table public.video_jobs add column if not exists generation_state jsonb not null default '{}'::jsonb;
alter table public.content_items drop constraint if exists content_items_video_media_mode_check;
alter table public.content_items add constraint content_items_video_media_mode_check
 check(video_media_mode in ('uploaded_only','uploaded_plus_auto','auto','image_storyboard','studio_storyboard'));
alter table public.video_jobs drop constraint if exists video_jobs_media_mode_check;
alter table public.video_jobs add constraint video_jobs_media_mode_check
 check(media_mode in ('uploaded_only','uploaded_plus_auto','auto','image_storyboard','studio_storyboard'));

create or replace function public.validate_studio_storyboard(p_content_id uuid,p_script text,p_min_seconds integer,p_board jsonb,p_complete boolean)
returns void language plpgsql security definer set search_path=public as $$
declare s jsonb; joined text; minimum integer;
begin
 if p_board is null or jsonb_typeof(p_board) <> 'object' or jsonb_typeof(p_board->'version') is distinct from 'number' or p_board->>'version' is distinct from '2'
   or jsonb_typeof(p_board->'scenes') is distinct from 'array' then raise exception 'قسّم السكريبت إلى مشاهد'; end if;
 if regexp_replace(btrim(coalesce(p_board->>'source_script','')),'\s+',' ','g') is distinct from regexp_replace(btrim(coalesce(p_script,'')),'\s+',' ','g')
 then raise exception 'السكريبت اتغير. أعد تقسيم المشاهد'; end if;
 minimum := greatest(3,ceil(coalesce(p_min_seconds,0)/8.0)::integer);
 if jsonb_array_length(p_board->'scenes') not between minimum and 20 then raise exception 'عدد المشاهد لا يناسب المدة'; end if;
 if coalesce(p_board->>'transition','') not in ('fade','slide','none') then raise exception 'نوع الانتقال غير صالح'; end if;
 for s in select value from jsonb_array_elements(p_board->'scenes') loop
   if jsonb_typeof(s) <> 'object' or nullif(btrim(s->>'text'),'') is null
      or cardinality(regexp_split_to_array(btrim(s->>'text'),'\s+')) > 35 then raise exception 'راجع نص كل مشهد'; end if;
   if coalesce(s->>'source','') not in ('upload','ai_image','ai_video') then raise exception 'اختر مصدر المشهد'; end if;
   if coalesce(s->>'framing','cover') not in ('cover','contain') then raise exception 'طريقة عرض المقطع غير صالحة'; end if;
   if coalesce(s->>'motion','') not in ('pan_left','pan_right','zoom_in','zoom_out') then raise exception 'حركة المشهد غير صالحة'; end if;
   if jsonb_typeof(s->'clip_start') is distinct from 'number' or (s->>'clip_start')::numeric not between 0 and 3600 then raise exception 'بداية المقطع غير صالحة'; end if;
   if s->>'source'='upload' then
     if p_complete and nullif(s->>'asset_id','') is null then raise exception 'اختر ملفًا لكل مشهد'; end if;
     if nullif(s->>'asset_id','') is not null and not exists(select 1 from public.video_assets a
       where a.id::text=s->>'asset_id' and a.content_id=p_content_id and a.asset_role='footage' and a.asset_type in ('image','video'))
     then raise exception 'ملف المشهد لا يخص هذه المادة أو تم حذفه'; end if;
   else
     if p_complete and length(btrim(coalesce(s->>'prompt',''))) not between 10 and 3000 then raise exception 'اكتب وصفًا للمشهد من 10 إلى 3000 حرف'; end if;
     if s->>'source'='ai_video' and coalesce(s->>'generation_seconds','') not in ('4','8','12') then raise exception 'مدة التوليد غير صالحة'; end if;
   end if;
 end loop;
 select string_agg(value->>'text',' ' order by ord) into joined from jsonb_array_elements(p_board->'scenes') with ordinality as x(value,ord);
 if regexp_replace(btrim(joined),'\s+',' ','g') is distinct from regexp_replace(btrim(p_script),'\s+',' ','g')
 then raise exception 'المشاهد يجب أن تغطي السكريبت كاملًا وبنفس الترتيب'; end if;
end; $$;
revoke all on function public.validate_studio_storyboard(uuid,text,integer,jsonb,boolean) from public,anon,authenticated;

create or replace function public.save_video_storyboard(p_content_id uuid,p_storyboard jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare item public.content_items%rowtype; me uuid := public.my_admin_id();
begin
 select * into item from public.content_items where id=p_content_id for update;
 if not found then raise exception 'المادة غير موجودة'; end if;
 if me is null or not (public.can_manage_all_content() or (public.has_role('page_manager') and item.created_by=me)
   or (public.has_role('approver') and item.design_execution='ai' and item.stage in ('in_design','needs_revision')))
 then raise exception 'غير مسموح بتعديل مشاهد هذه المادة'; end if;
 if item.content_format <> 'video' then raise exception 'المادة ليست فيديو'; end if;
 if p_storyboard->>'version'='2' then
   perform public.validate_studio_storyboard(item.id,item.script_text,item.target_duration_min_seconds,p_storyboard,false);
 else
   perform public.validate_video_storyboard(item.id,item.script_text,item.target_duration_min_seconds,p_storyboard,false);
 end if;
 update public.content_items set video_media_mode=case when p_storyboard->>'version'='2' then 'studio_storyboard' else 'image_storyboard' end,video_storyboard=p_storyboard where id=item.id returning * into item;
 return to_jsonb(item);
end; $$;
revoke all on function public.save_video_storyboard(uuid,jsonb) from public,anon;
grant execute on function public.save_video_storyboard(uuid,jsonb) to authenticated;

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

  if item.video_media_mode='studio_storyboard' then
    perform public.validate_studio_storyboard(item.id,item.script_text,item.target_duration_min_seconds,item.video_storyboard,true);
  end if;
  if item.video_media_mode='image_storyboard' then
    perform public.validate_video_storyboard(item.id,item.script_text,item.target_duration_min_seconds,item.video_storyboard,true);
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
    and a.id::text is distinct from item.cover_settings->>'logo_asset_id'
    and (item.video_media_mode not in ('image_storyboard','studio_storyboard') or a.asset_type in ('voiceover','music')
      or a.id::text in (select s->>'asset_id' from jsonb_array_elements(item.video_storyboard->'scenes') s
        where coalesce(s->>'source','upload')='upload'));
  asset_snapshot := asset_snapshot || jsonb_build_array(jsonb_build_object(
    'id',logo.id,'asset_type','brand_logo','brand',logo.brand,'variant',logo.variant,
    'storage_bucket','brand-logos','storage_path',logo.storage_path,'file_name',logo.file_name));

  if existing_job.id is not null then
    update public.video_jobs set title=item.title,brand=item.brand,specialty=item.specialty,
      script_text=item.script_text,caption_text=item.caption_text,cta_type=item.cta_type,cta_text=item.cta_text,
      duration_min_seconds=item.target_duration_min_seconds,duration_max_seconds=item.target_duration_max_seconds,
      video_template=item.video_template,media_mode=item.video_media_mode,music_mood=coalesce(item.video_music_mood,'calm'),input_assets=asset_snapshot,
      cover_settings=settings,storyboard=case when item.video_media_mode in ('image_storyboard','studio_storyboard') then item.video_storyboard else null end,
      input_schema_version=case when item.video_media_mode='studio_storyboard' then 4 when item.video_media_mode='image_storyboard' then 3 else 2 end
    where id=existing_job.id and status='pending' returning * into created_job;
    return to_jsonb(created_job);
  end if;

  insert into public.video_jobs (
    content_id, created_by, status,
    title, brand, specialty,
    script_text, caption_text, cta_type, cta_text,
    duration_min_seconds, duration_max_seconds, video_template,
    media_mode, music_mood, input_assets, cover_settings, input_schema_version, storyboard
  ) values (
    item.id, me, 'pending',
    item.title, item.brand, item.specialty,
    item.script_text, item.caption_text, item.cta_type, item.cta_text,
    item.target_duration_min_seconds, item.target_duration_max_seconds,
    item.video_template,
    coalesce(item.video_media_mode, 'uploaded_plus_auto'),
    coalesce(item.video_music_mood, 'calm'),
    asset_snapshot, settings, case when item.video_media_mode='studio_storyboard' then 4 when item.video_media_mode='image_storyboard' then 3 else 2 end,
    case when item.video_media_mode in ('image_storyboard','studio_storyboard') then item.video_storyboard else null end
  )
  returning * into created_job;

  return to_jsonb(created_job);
end;
$$;

revoke all on function public.create_video_job(uuid) from public;
grant execute on function public.create_video_job(uuid) to authenticated;
create or replace function public.claim_next_video_job(p_worker_id text, p_max_input_schema_version integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.video_jobs%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service_role required';
  end if;

  update public.video_jobs v
  set status = 'failed',
      error_message = 'تم إيقاف المحاولات بعد 3 محاولات غير مكتملة.',
      render_finished_at = now(),
      worker_id = null,
      progress_percent = 0,
      progress_stage = 'تحتاج مراجعة'
  where v.status in ('preparing','rendering','uploading')
    and v.updated_at < now() - interval '30 minutes'
    and v.attempt_count >= 3
    and not exists (
      select 1 from public.video_worker_heartbeats h
      where h.current_job_id = v.id
        and h.last_seen_at >= now() - interval '2 minutes'
    );

  update public.video_jobs v
  set status = 'pending',
      worker_id = null,
      error_message = 'استرجع النظام الوظيفة بعد توقف العامل.',
      render_started_at = null,
      progress_percent = 0,
      progress_stage = 'في الانتظار'
  where v.status in ('preparing','rendering','uploading')
    and v.updated_at < now() - interval '30 minutes'
    and v.attempt_count < 3
    and not exists (
      select 1 from public.video_worker_heartbeats h
      where h.current_job_id = v.id
        and h.last_seen_at >= now() - interval '2 minutes'
    );

  with next_job as (
    select id
    from public.video_jobs
    where status = 'pending' and input_schema_version <= least(p_max_input_schema_version,4)
    order by created_at asc
    for update skip locked
    limit 1
  )
  update public.video_jobs v
  set status = 'preparing',
      worker_id = nullif(btrim(p_worker_id), ''),
      attempt_count = v.attempt_count + 1,
      error_message = null,
      render_started_at = now(),
      progress_percent = 15,
      progress_stage = 'تجهيز الملفات'
  from next_job
  where v.id = next_job.id
  returning v.* into claimed;

  if not found then
    return null;
  end if;

  return to_jsonb(claimed);
end;
$$;

revoke all on function public.claim_next_video_job(text,integer) from public;
revoke all on function public.claim_next_video_job(text,integer) from anon;
revoke all on function public.claim_next_video_job(text,integer) from authenticated;
grant execute on function public.claim_next_video_job(text,integer) to service_role;

create or replace function public.get_video_studio_capabilities()
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if public.my_admin_id() is null then raise exception 'موظف نشط مطلوب'; end if;
 return jsonb_build_object('schema_version',4);
end; $$;
revoke all on function public.get_video_studio_capabilities() from public,anon;
grant execute on function public.get_video_studio_capabilities() to authenticated;
commit;
