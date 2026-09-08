begin;
-- 50) Optional branded cover candidates and owner-authorized selection.
alter table public.content_items add column if not exists cover_settings jsonb not null default '{}'::jsonb;
alter table public.video_jobs add column if not exists cover_settings jsonb not null default '{}'::jsonb;
alter table public.video_jobs add column if not exists selected_cover_id uuid;
create table if not exists public.video_cover_candidates (
  id uuid primary key,
  job_id uuid not null references public.video_jobs(id) on delete cascade,
  candidate_index integer not null check (candidate_index between 1 and 5),
  timestamp_seconds numeric not null check (timestamp_seconds >= 0),
  storage_path text not null,
  drive_url text not null,
  created_at timestamptz not null default now(),
  unique (job_id, candidate_index)
);
alter table public.video_cover_candidates enable row level security;
drop policy if exists "active admins read cover candidates" on public.video_cover_candidates;
create policy "active admins read cover candidates" on public.video_cover_candidates
  for select to authenticated using (public.my_admin_id() is not null);
grant select on public.video_cover_candidates to authenticated;
grant all on public.video_cover_candidates to service_role;

create or replace function public.select_video_cover(p_job_id uuid, p_candidate_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  j public.video_jobs%rowtype;
  c public.video_cover_candidates%rowtype;
  me uuid := public.my_admin_id();
begin
  if me is null or public.my_role() not in ('page_manager','general_manager','super_admin') then
    raise exception 'غير مسموح باختيار الكفر';
  end if;
  select * into j from public.video_jobs where id=p_job_id for update;
  if not found then raise exception 'الفيديو غير موجود'; end if;
  if not public.can_manage_all_content() and not exists (
    select 1 from public.content_items where id=j.content_id and created_by=me
  ) then raise exception 'غير مسموح بتعديل هذه المادة'; end if;
  if j.status <> 'ready' then raise exception 'انتظر اكتمال إنتاج الفيديو'; end if;
  select * into c from public.video_cover_candidates where id=p_candidate_id and job_id=p_job_id;
  if not found then raise exception 'الكفر لا يخص هذا الفيديو'; end if;
  update public.video_jobs set selected_cover_id=c.id, cover_url=c.drive_url where id=j.id;
  return jsonb_build_object('selected_cover_id',c.id,'cover_url',c.drive_url);
end;
$$;
revoke all on function public.select_video_cover(uuid,uuid) from public;
grant execute on function public.select_video_cover(uuid,uuid) to authenticated;

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
begin
  me := public.my_admin_id();
  r := public.my_role();

  if me is null then
    raise exception 'غير مسموح: المستخدم غير مسجل كموظف نشط';
  end if;

  if r not in ('page_manager','general_manager','super_admin') then
    raise exception 'غير مسموح بإنشاء Video Job لهذا الدور';
  end if;

  select * into item
  from public.content_items
  where id = p_content_id;

  if not found then
    raise exception 'المادة غير موجودة';
  end if;

  if not public.can_manage_all_content() and item.created_by is distinct from me then
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
    if not exists (select 1 from public.video_assets where content_id=item.id
      and id::text=item.cover_settings->>'logo_asset_id' and asset_type='image') then
      raise exception 'ارفع لوجو البراند وحدده في إعدادات الكفر';
    end if;
  end if;

  -- Idempotent: لو فيه Job شغال بالفعل لنفس المادة رجّعه بدل التكرار.
  select * into existing_job
  from public.video_jobs
  where content_id = p_content_id
    and status in ('pending','preparing','rendering','uploading')
  order by created_at desc
  limit 1;

  if found then
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
  where a.content_id = item.id;

  insert into public.video_jobs (
    content_id, created_by, status,
    title, brand, specialty,
    script_text, caption_text, cta_type, cta_text,
    duration_min_seconds, duration_max_seconds, video_template,
    media_mode, input_assets, cover_settings
  ) values (
    item.id, me, 'pending',
    item.title, item.brand, item.specialty,
    item.script_text, item.caption_text, item.cta_type, item.cta_text,
    item.target_duration_min_seconds, item.target_duration_max_seconds,
    item.video_template,
    coalesce(item.video_media_mode, 'uploaded_plus_auto'),
    asset_snapshot, item.cover_settings
  )
  returning * into created_job;

  return to_jsonb(created_job);
end;
$$;

revoke all on function public.create_video_job(uuid) from public;
grant execute on function public.create_video_job(uuid) to authenticated;

commit;
