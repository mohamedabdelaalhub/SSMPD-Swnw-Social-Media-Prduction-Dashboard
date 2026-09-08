begin;
-- 48) Video Assets — optional uploads from Dashboard
-- ============================================================
-- الصور/الفيديو/الـVoice-over/الموسيقى اختيارية. يتم ربطها بالمحتوى،
-- ثم يأخذ Video Job Snapshot منها وقت إنشائه أو إعادة إنتاجه.

alter table public.content_items
  add column if not exists video_media_mode text not null default 'uploaded_plus_auto';

alter table public.content_items
  drop constraint if exists content_items_video_media_mode_check;
alter table public.content_items
  add constraint content_items_video_media_mode_check
  check (video_media_mode in ('uploaded_only','uploaded_plus_auto','auto'));

alter table public.video_jobs
  add column if not exists media_mode text not null default 'uploaded_plus_auto';

alter table public.video_jobs
  drop constraint if exists video_jobs_media_mode_check;
alter table public.video_jobs
  add constraint video_jobs_media_mode_check
  check (media_mode in ('uploaded_only','uploaded_plus_auto','auto'));

create table if not exists public.video_assets (
  id            uuid primary key default gen_random_uuid(),
  content_id    uuid not null references public.content_items(id) on delete cascade,
  created_by    uuid not null references public.admins(id),
  asset_type    text not null
                check (asset_type in ('image','video','voiceover','music')),
  storage_path  text not null unique,
  file_name     text not null,
  mime_type     text,
  file_size     bigint not null check (file_size > 0 and file_size <= 52428800),
  created_at    timestamptz not null default now()
);

create index if not exists video_assets_content_idx
  on public.video_assets (content_id, created_at);

alter table public.video_assets enable row level security;

drop policy if exists "active admins read video assets" on public.video_assets;
create policy "active admins read video assets"
  on public.video_assets for select to authenticated
  using (public.my_admin_id() is not null);

grant select on public.video_assets to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'video-inputs',
  'video-inputs',
  false,
  52428800,
  array[
    'image/jpeg','image/png','image/webp','image/heic',
    'video/mp4','video/quicktime','video/x-m4v','video/webm',
    'audio/mpeg','audio/mp4','audio/wav','audio/x-wav','audio/aac','audio/x-m4a'
  ]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "active admins read video inputs" on storage.objects;
create policy "active admins read video inputs"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'video-inputs'
    and public.my_admin_id() is not null
  );

drop policy if exists "admins upload own video inputs" on storage.objects;
create policy "admins upload own video inputs"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'video-inputs'
    and (storage.foldername(name))[1] = public.my_admin_id()::text
  );

drop policy if exists "admins delete video inputs" on storage.objects;
create policy "admins delete video inputs"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'video-inputs'
    and (
      (storage.foldername(name))[1] = public.my_admin_id()::text
      or public.can_manage_all_content()
    )
  );

create or replace function public.register_video_asset(
  p_content_id uuid,
  p_asset_type text,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_file_size bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid;
  r text;
  item public.content_items%rowtype;
  created_asset public.video_assets%rowtype;
begin
  me := public.my_admin_id();
  r := public.my_role();

  if me is null then
    raise exception 'غير مسموح: المستخدم غير مسجل كموظف نشط';
  end if;

  if r not in ('page_manager','general_manager','super_admin') then
    raise exception 'غير مسموح برفع مواد الفيديو لهذا الدور';
  end if;

  select * into item from public.content_items where id = p_content_id;
  if not found then
    raise exception 'المادة غير موجودة';
  end if;

  if not public.can_manage_all_content() and item.created_by is distinct from me then
    raise exception 'غير مسموح بتعديل هذه المادة';
  end if;

  if p_asset_type not in ('image','video','voiceover','music') then
    raise exception 'نوع الملف غير مدعوم';
  end if;

  if p_file_size is null or p_file_size <= 0 or p_file_size > 52428800 then
    raise exception 'حجم الملف يجب ألا يتجاوز 50MB';
  end if;

  if split_part(p_storage_path, '/', 1) <> me::text
     or split_part(p_storage_path, '/', 2) <> p_content_id::text then
    raise exception 'مسار الملف غير صالح';
  end if;

  insert into public.video_assets (
    content_id, created_by, asset_type, storage_path,
    file_name, mime_type, file_size
  ) values (
    p_content_id, me, p_asset_type, p_storage_path,
    p_file_name, nullif(p_mime_type,''), p_file_size
  )
  returning * into created_asset;

  return to_jsonb(created_asset);
end;
$$;

revoke all on function public.register_video_asset(uuid,text,text,text,text,bigint) from public;
grant execute on function public.register_video_asset(uuid,text,text,text,text,bigint) to authenticated;

create or replace function public.delete_video_asset_record(p_asset_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid;
  a public.video_assets%rowtype;
  item public.content_items%rowtype;
begin
  me := public.my_admin_id();
  if me is null then
    raise exception 'غير مسموح';
  end if;

  select * into a from public.video_assets where id = p_asset_id;
  if not found then
    return jsonb_build_object('deleted', false);
  end if;

  select * into item from public.content_items where id = a.content_id;

  if not public.can_manage_all_content()
     and a.created_by is distinct from me
     and item.created_by is distinct from me then
    raise exception 'غير مسموح بحذف الملف';
  end if;

  delete from public.video_assets where id = p_asset_id;
  return jsonb_build_object('deleted', true, 'storage_path', a.storage_path);
end;
$$;

revoke all on function public.delete_video_asset_record(uuid) from public;
grant execute on function public.delete_video_asset_record(uuid) to authenticated;

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
    media_mode, input_assets
  ) values (
    item.id, me, 'pending',
    item.title, item.brand, item.specialty,
    item.script_text, item.caption_text, item.cta_type, item.cta_text,
    item.target_duration_min_seconds, item.target_duration_max_seconds,
    item.video_template,
    coalesce(item.video_media_mode, 'uploaded_plus_auto'),
    asset_snapshot
  )
  returning * into created_job;

  return to_jsonb(created_job);
end;
$$;

revoke all on function public.create_video_job(uuid) from public;
grant execute on function public.create_video_job(uuid) to authenticated;



-- 49) Google Drive video archive metadata. No change to booking or patient data.
alter table public.video_jobs
  add column if not exists drive_video_url text,
  add column if not exists drive_video_id text,
  add column if not exists drive_folder_url text,
  add column if not exists archive_status text not null default 'pending'
    check (archive_status in ('pending','uploading','archived','failed')),
  add column if not exists archive_error text,
  add column if not exists archived_at timestamptz;

commit;
