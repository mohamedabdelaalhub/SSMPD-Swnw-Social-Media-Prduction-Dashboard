begin;
-- 51) Permanent brand logos. Requires migrations 48–50.
create table if not exists public.brand_logos (
  brand text primary key check (brand in ('sono','dr_dina')),
  id uuid not null unique default gen_random_uuid(),
  storage_path text not null unique,
  file_name text not null,
  updated_by uuid not null references public.admins(id),
  updated_at timestamptz not null default now()
);
alter table public.brand_logos enable row level security;
drop policy if exists "active admins read brand logos" on public.brand_logos;
create policy "active admins read brand logos" on public.brand_logos for select
  to authenticated using (public.my_admin_id() is not null);
grant select on public.brand_logos to authenticated;
grant all on public.brand_logos to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('brand-logos','brand-logos',false,5242880,array['image/png','image/jpeg','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists "active admins view brand logos" on storage.objects;
create policy "active admins view brand logos" on storage.objects for select to authenticated
  using(bucket_id='brand-logos' and public.my_admin_id() is not null);
drop policy if exists "super admin upload brand logos" on storage.objects;
create policy "super admin upload brand logos" on storage.objects for insert to authenticated
  with check(bucket_id='brand-logos' and public.my_admin_id() is not null and public.my_role()='super_admin'
    and (storage.foldername(name))[1] in ('sono','dr_dina'));
-- Existing logo objects stay immutable so running/historical snapshots remain valid.
create or replace function public.set_brand_logo(p_brand text,p_storage_path text,p_file_name text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result public.brand_logos%rowtype;
begin
  if public.my_admin_id() is null or public.my_role() is distinct from 'super_admin' then
    raise exception 'إدارة لوجوهات البراند متاحة للسوبر أدمن فقط';
  end if;
  if p_brand is null or p_brand not in ('sono','dr_dina') or split_part(p_storage_path,'/',1) is distinct from p_brand then
    raise exception 'البراند ومسار اللوجو غير متطابقين';
  end if;
  if not exists(select 1 from storage.objects where bucket_id='brand-logos' and name=p_storage_path) then
    raise exception 'ارفع ملف اللوجو أولاً';
  end if;
  insert into public.brand_logos(brand,storage_path,file_name,updated_by)
  values(p_brand,p_storage_path,p_file_name,public.my_admin_id())
  on conflict(brand) do update set id=gen_random_uuid(),storage_path=excluded.storage_path,
    file_name=excluded.file_name,updated_by=excluded.updated_by,updated_at=now()
  returning * into result;
  return to_jsonb(result);
end;
$$;
revoke all on function public.set_brand_logo(text,text,text) from public;
grant execute on function public.set_brand_logo(text,text,text) to authenticated;

alter table public.video_assets add column if not exists asset_role text not null default 'footage'
  check(asset_role in ('footage','legacy_logo'));
-- Exclude logos already selected in the old per-video controls from scene footage.
update public.video_assets a set asset_role='legacy_logo'
where exists(select 1 from public.content_items i where i.cover_settings->>'logo_asset_id'=a.id::text)
   or exists(select 1 from public.video_jobs j where j.cover_settings->>'logo_asset_id'=a.id::text);
alter table public.video_jobs add column if not exists input_schema_version integer not null default 1;

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
  where id = p_content_id for update;

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
  end if;
  select * into logo from public.brand_logos where brand=item.brand;
  if not found then raise exception 'احفظ لوجو هذا البراند في لوحة الإدارة أولاً'; end if;
  settings := (item.cover_settings - 'logo_asset_id' - 'logo_brand' - 'logo_source') ||
    jsonb_build_object('logo_asset_id',logo.id,'logo_brand',item.brand,'logo_source','brand_library');

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
    'id',logo.id,'asset_type','brand_logo','brand',logo.brand,
    'storage_bucket','brand-logos','storage_path',logo.storage_path,'file_name',logo.file_name));

  if existing_job.id is not null then
    update public.video_jobs set title=item.title,brand=item.brand,specialty=item.specialty,
      script_text=item.script_text,caption_text=item.caption_text,cta_type=item.cta_type,cta_text=item.cta_text,
      duration_min_seconds=item.target_duration_min_seconds,duration_max_seconds=item.target_duration_max_seconds,
      video_template=item.video_template,media_mode=item.video_media_mode,input_assets=asset_snapshot,
      cover_settings=settings,input_schema_version=2
    where id=existing_job.id and status='pending' returning * into created_job;
    return to_jsonb(created_job);
  end if;

  insert into public.video_jobs (
    content_id, created_by, status,
    title, brand, specialty,
    script_text, caption_text, cta_type, cta_text,
    duration_min_seconds, duration_max_seconds, video_template,
    media_mode, input_assets, cover_settings, input_schema_version
  ) values (
    item.id, me, 'pending',
    item.title, item.brand, item.specialty,
    item.script_text, item.caption_text, item.cta_type, item.cta_text,
    item.target_duration_min_seconds, item.target_duration_max_seconds,
    item.video_template,
    coalesce(item.video_media_mode, 'uploaded_plus_auto'),
    asset_snapshot, settings, 2
  )
  returning * into created_job;

  return to_jsonb(created_job);
end;
$$;

revoke all on function public.create_video_job(uuid) from public;
grant execute on function public.create_video_job(uuid) to authenticated;

commit;
