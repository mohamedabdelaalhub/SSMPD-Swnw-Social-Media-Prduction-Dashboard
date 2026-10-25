-- قاعدة «عدم تكرار» الصور ومقاطع الستوك في شغل Claude Creative (محمد، 2026-10-25)
--
-- المشكلة: مفيش أي مكان كان بيسجل أي صورة/مقطع Pixabay أو صورة مولّدة اتستخدمت في أي مادة
-- (لا content_items ولا design_versions ولا agent_raw_output)، فالمهام المجدولة
-- مكانتش تقدر تعرف هي استخدمت إيه قبل كده وبتختار نفس النتائج الأولى من البحث.
--
-- الحل: سجل استخدام لكل صفحة + دالة ترجع اللي اتستخدم في آخر N مادة للصفحة.
-- البوابة (claude-automation) هي اللي بتكتب السجل وبتفلتر نتائج op=stock
-- وبترفض op=fetch_media / op=image لو نفس الملف/البرومبت اتستخدم مؤخراً لنفس الصفحة.

create table if not exists public.automation_media_usage (
  id bigserial primary key,
  brand text not null check (brand in ('sono','dr_dina')),
  content_id uuid references public.content_items(id) on delete set null,
  provider text not null check (provider in ('pixabay','openai','other')),
  media_kind text not null check (media_kind in ('photo','video')),
  media_key text not null,          -- pixabay:photo:<id> · pixabay:video:<id> · openai:<sha256 للبرومبت>
  search_query text,
  prompt text,
  used_at timestamptz not null default now()
);
create index if not exists automation_media_usage_brand_time on public.automation_media_usage(brand, used_at desc);
create index if not exists automation_media_usage_brand_key on public.automation_media_usage(brand, media_key);
create index if not exists automation_media_usage_content on public.automation_media_usage(content_id);

alter table public.automation_media_usage enable row level security;
drop policy if exists automation_media_usage_read on public.automation_media_usage;
create policy automation_media_usage_read on public.automation_media_usage
  for select to authenticated using (public.can_manage_all_content());
-- الكتابة من البوابة بصلاحية الخادم بس (مفيش سياسة insert/update/delete)

-- اللي اتستخدم في آخر p_items مادة للصفحة (+ أي استخدام من غير مادة في آخر 14 يوم)
create or replace function public.automation_recent_media(p_brand text, p_items integer default 20)
returns table(media_key text, provider text, media_kind text, search_query text, prompt text, content_id uuid, used_at timestamptz)
language sql stable security definer set search_path to 'public' as $$
  with recent as (
    select c.id from public.content_items c
    where c.brand = p_brand
    order by c.created_at desc
    limit greatest(1, least(coalesce(p_items, 20), 100))
  )
  select u.media_key, u.provider, u.media_kind, u.search_query, left(u.prompt, 300), u.content_id, u.used_at
  from public.automation_media_usage u
  where u.brand = p_brand
    and (u.content_id in (select id from recent) or (u.content_id is null and u.used_at > now() - interval '14 days'))
  order by u.used_at desc;
$$;
revoke all on function public.automation_recent_media(text, integer) from public, anon, authenticated;
grant execute on function public.automation_recent_media(text, integer) to service_role;
