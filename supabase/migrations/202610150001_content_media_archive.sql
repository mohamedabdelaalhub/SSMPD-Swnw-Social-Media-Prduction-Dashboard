-- أرشفة وسائط المحتوى المنشور على Google Drive بعد يومين من النشر (تصميمات + كاروسيل + أغلفة + فيديوهات مرفوعة).
-- الفكرة: نسخ الملف للدرايف والتأكد منه (sha256 في جسر الدرايف) → تبديل الروابط في المادة → بعد يوم إضافي يتم مسح الملفات من Supabase.
-- كل الدوال للـ service_role بس (بتتنادى من Edge Function content-archive-process). الحذف الفعلي بيتم في الـEdge Function.
-- (اتطبقت على قاعدة البيانات على مراحل صغيرة؛ الملف ده هو الشكل النهائي المجمّع.)

alter table public.content_items add column if not exists media_archived_at timestamptz;
alter table public.content_items add column if not exists media_storage_cleared_at timestamptz;

create table if not exists public.content_archive_files (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.content_items(id) on delete cascade,
  kind text not null check (kind in ('design','video','slide','cover')),
  position integer not null default 0,
  original_bucket text not null check (original_bucket in ('content-designs','video-inputs')),
  original_path text not null,
  drive_url text not null check (drive_url ~ '^https://drive\.google\.com/'),
  drive_file_id text,
  size_bytes bigint not null default 0,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  storage_deleted_at timestamptz,
  unique (original_bucket, original_path)
);
create index if not exists content_archive_files_content_idx on public.content_archive_files(content_id);
alter table public.content_archive_files enable row level security;
create policy content_archive_files_read on public.content_archive_files for select to authenticated
  using (public.can_manage_all_content());

create table if not exists public.content_archive_state (
  content_id uuid primary key references public.content_items(id) on delete cascade,
  attempts integer not null default 0,
  last_error text,
  last_attempt_at timestamptz
);
alter table public.content_archive_state enable row level security;
create policy content_archive_state_read on public.content_archive_state for select to authenticated
  using (public.can_manage_all_content());

-- تبديل الروابط ما يعتبرش "نشاط" على المادة ولا تعديل محتوى يستدعي إعادة نشر على الموقع:
-- التريجرين دول بيتخطّوا لما content_archive_commit/mark_cleared يظبطوا الإعداد ssmpd.media_archive داخل نفس العملية.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('ssmpd.media_archive', true), '') = '1' then return new; end if;
  new.updated_at = now(); return new;
end $$;

create or replace function public.website_content_changed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
 if coalesce(current_setting('ssmpd.media_archive', true), '') = '1' then return new; end if;
 if exists(select 1 from public.website_publications where content_id=new.id and action='upsert')
 and (new.title,new.caption_text,new.body,new.cta_text,new.hook_text,new.brand,new.design_file_url,new.published_url,new.publish_platforms,new.publish_platform,new.stage,new.content_format,new.carousel_slides)
 is distinct from (old.title,old.caption_text,old.body,old.cta_text,old.hook_text,old.brand,old.design_file_url,old.published_url,old.publish_platforms,old.publish_platform,old.stage,old.content_format,old.carousel_slides) then
  if new.stage not in ('ready_to_publish','scheduled','published') or not(coalesce(new.publish_platforms,'[]'::jsonb)?'website' or new.publish_platform='website') then
   perform public.website_enqueue(new.id,'unpublish');
  else perform public.website_enqueue(new.id,'upsert'); end if;
 end if;
 return new;
end $$;

-- المواد الجاهزة للنقل: منشورة من يومين على الأقل، وفيها ملفات على Supabase.
-- بنستثني الكاروسيل/الفيديو المنشور على الموقع (مزامنة الموقع لسه بتحتاج ملف Supabase للنوعين دول).
create or replace function public.content_archive_candidates(p_limit integer default 2, p_content uuid default null)
returns table(content_id uuid, title text, brand text, content_format text, published_at timestamptz,
              design_file_url text, carousel_slides jsonb, cover_image_url text)
language sql stable security definer set search_path = public as $$
  select c.id, c.title, c.brand, c.content_format, c.published_at, c.design_file_url, c.carousel_slides,
         c.cover_settings->>'cover_image_url'
  from public.content_items c
  left join public.content_archive_state s on s.content_id = c.id
  where c.stage = 'published'
    and c.published_at <= now() - interval '2 days'
    and c.media_archived_at is null
    and (p_content is null or c.id = p_content)
    and coalesce(s.attempts, 0) < 5
    and (
      c.design_file_url like '%/storage/v1/object/authenticated/content-designs/%'
      or c.design_file_url like '%/storage/v1/object/authenticated/video-inputs/%'
      or (jsonb_typeof(c.carousel_slides) = 'array' and c.carousel_slides::text like '%/storage/v1/object/authenticated/content-designs/%')
      or c.cover_settings->>'cover_image_url' like '%/storage/v1/object/authenticated/content-designs/%'
    )
    and not (c.content_format in ('carousel','video')
             and exists (select 1 from public.website_publications w where w.content_id = c.id and w.action = 'upsert'))
  order by c.published_at
  limit greatest(1, least(coalesce(p_limit, 2), 5));
$$;

-- تبديل روابط المادة للدرايف بعد ما كل ملفاتها اتنسخت وتأكدنا منها (بيفشل لو أي ملف ناقص).
create or replace function public.content_archive_commit(p_content_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.content_items%rowtype;
  v_prefix constant text := 'https://uuijfbpgvtdxgaosqpxo.supabase.co/storage/v1/object/authenticated/';
  v_rest text; v_bucket text; v_path text; v_drive text;
  v_new_design text; v_new_slides jsonb := '[]'::jsonb; v_slide text; v_new_cover text; v_cover jsonb;
  v_old_design text; v_final uuid;
begin
  select * into c from public.content_items where id = p_content_id for update;
  if not found then raise exception 'content not found'; end if;
  if c.stage <> 'published' then raise exception 'المادة مش منشورة'; end if;
  if c.media_archived_at is not null then return jsonb_build_object('ok', true, 'already', true); end if;
  v_new_design := c.design_file_url;
  v_old_design := c.design_file_url;
  if c.design_file_url like v_prefix || '%' then
    v_rest := substr(c.design_file_url, length(v_prefix) + 1);
    v_bucket := split_part(v_rest, '/', 1); v_path := substr(v_rest, length(v_bucket) + 2);
    select f.drive_url into v_drive from public.content_archive_files f where f.original_bucket = v_bucket and f.original_path = v_path;
    if v_drive is null then raise exception 'ملف التصميم لم يُنقل للدرايف بعد'; end if;
    v_new_design := v_drive;
  end if;
  if jsonb_typeof(c.carousel_slides) = 'array' then
    for v_slide in select jsonb_array_elements_text(c.carousel_slides) loop
      if v_slide like v_prefix || '%' then
        v_rest := substr(v_slide, length(v_prefix) + 1);
        v_bucket := split_part(v_rest, '/', 1); v_path := substr(v_rest, length(v_bucket) + 2);
        select f.drive_url into v_drive from public.content_archive_files f where f.original_bucket = v_bucket and f.original_path = v_path;
        if v_drive is null then raise exception 'شريحة كاروسيل لم تُنقل للدرايف بعد'; end if;
        v_new_slides := v_new_slides || to_jsonb(v_drive);
      else
        v_new_slides := v_new_slides || to_jsonb(v_slide);
      end if;
    end loop;
  else
    v_new_slides := c.carousel_slides;
  end if;
  v_cover := coalesce(c.cover_settings, '{}'::jsonb);
  v_new_cover := v_cover->>'cover_image_url';
  if v_new_cover like v_prefix || '%' then
    v_rest := substr(v_new_cover, length(v_prefix) + 1);
    v_bucket := split_part(v_rest, '/', 1); v_path := substr(v_rest, length(v_bucket) + 2);
    select f.drive_url into v_drive from public.content_archive_files f where f.original_bucket = v_bucket and f.original_path = v_path;
    if v_drive is null then raise exception 'غلاف الريل لم يُنقل للدرايف بعد'; end if;
    v_cover := jsonb_set(v_cover, '{cover_image_url}', to_jsonb(v_drive));
  end if;
  perform set_config('ssmpd.media_archive', '1', true);
  update public.content_items
     set design_file_url = v_new_design, carousel_slides = v_new_slides,
         cover_settings = case when c.cover_settings is null then null else v_cover end,
         media_archived_at = now()
   where id = p_content_id;
  select id into v_final from public.design_versions where content_id = p_content_id order by created_at desc, id desc limit 1;
  if v_final is not null and v_old_design is not null and v_new_design is distinct from v_old_design then
    update public.design_versions set output_file_url = v_new_design, source_file_url = null where id = v_final;
  end if;
  perform set_config('ssmpd.media_archive', '', true);
  return jsonb_build_object('ok', true, 'design', v_new_design);
end $$;

-- المواد اللي عدّى يوم على نقلها: جاهزة لمسح ملفاتها من Supabase. مسارات الفيديو بتتعرض بس لو مش مستخدمة في أي مكان تاني.
create or replace function public.content_archive_pending_cleanup(p_limit integer default 3)
returns table(content_id uuid, video_paths jsonb)
language sql stable security definer set search_path = public as $$
  select c.id,
    (select coalesce(jsonb_agg(f.original_path), '[]'::jsonb)
       from public.content_archive_files f
      where f.content_id = c.id and f.original_bucket = 'video-inputs' and f.storage_deleted_at is null
        and not exists (select 1 from public.content_items o where o.id <> c.id and strpos(coalesce(o.design_file_url,''), f.original_path) > 0)
        and not exists (select 1 from public.video_assets a where a.storage_path = f.original_path)
        and not exists (select 1 from public.video_cover_candidates v where v.storage_path = f.original_path)
        and not exists (select 1 from public.video_jobs j
                         where strpos(coalesce(j.cover_url,'') || ' ' || coalesce(j.output_video_url,'') || ' ' || coalesce(j.subtitles_url,'') || ' ' || coalesce(j.voiceover_url,''), f.original_path) > 0))
  from public.content_items c
  where c.media_archived_at is not null and c.media_archived_at <= now() - interval '1 day'
    and c.media_storage_cleared_at is null
  order by c.media_archived_at
  limit greatest(1, least(coalesce(p_limit, 3), 10));
$$;

create or replace function public.content_archive_mark_cleared(p_content_id uuid, p_deleted_paths text[] default '{}')
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.content_items where id = p_content_id and media_archived_at is not null) then
    raise exception 'المادة لم تُؤرشف';
  end if;
  update public.content_archive_files set storage_deleted_at = now()
   where content_id = p_content_id and storage_deleted_at is null
     and (original_bucket || '/' || original_path) = any (coalesce(p_deleted_paths, '{}'::text[]));
  perform set_config('ssmpd.media_archive', '1', true);
  update public.content_items set media_storage_cleared_at = now() where id = p_content_id;
  perform set_config('ssmpd.media_archive', '', true);
end $$;

revoke all on function public.content_archive_candidates(integer, uuid) from public, anon, authenticated;
revoke all on function public.content_archive_commit(uuid) from public, anon, authenticated;
revoke all on function public.content_archive_pending_cleanup(integer) from public, anon, authenticated;
revoke all on function public.content_archive_mark_cleared(uuid, text[]) from public, anon, authenticated;
grant execute on function public.content_archive_candidates(integer, uuid) to service_role;
grant execute on function public.content_archive_commit(uuid) to service_role;
grant execute on function public.content_archive_pending_cleanup(integer) to service_role;
grant execute on function public.content_archive_mark_cleared(uuid, text[]) to service_role;
