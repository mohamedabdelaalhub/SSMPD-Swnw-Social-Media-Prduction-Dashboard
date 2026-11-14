-- «اللي اتعلمته من تعليقاتك» — موافقة المالك 2026-11-14 (اختيار «أ»). إضافي فقط، مفيش تغيير على الجداول الموجودة.
-- Claude Creative بيقرا تعليقات التعديل (جدول comments) القديمة والجديدة، ويطلّع منها «دروس» عامة لكل صفحة/نوع مادة.
-- الدرس بيبقى «فعّال» تلقائي لما نفس الملاحظة تتكرر في تعليقين مختلفين أو أكتر، وبيتطبّق على أي مادة جديدة من أول نسخة.
-- المالك/المدير العام يقدر يقفل أي درس (disabled) — الدرس المقفول مابيرجعش فعّال لوحده حتى لو اتكرر تاني.
-- التراجع: supabase/rollbacks/20261114200000_content_comment_lessons.rollback.sql

create table if not exists public.content_comment_lessons (
  id                 uuid primary key default gen_random_uuid(),
  brand              text check (brand is null or brand in ('sono','dr_dina')),           -- null = الصفحتين
  content_format     text check (content_format is null or content_format in ('video','image_post','carousel','link_post')), -- null = كل الأنواع
  category           text not null default 'other' check (category in
                       ('font','text','voice','music','visual','layout','branding','ending','caption','medical','other')),
  lesson             text not null check (length(btrim(lesson)) between 5 and 400),
  example_comment    text,
  source_comment_ids uuid[] not null default '{}',
  hits               integer not null default 0,
  status             text not null default 'candidate' check (status in ('candidate','active','disabled')),
  status_changed_by  uuid references public.admins(id),
  status_changed_at  timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  last_seen_at       timestamptz not null default now()
);
create index if not exists content_comment_lessons_scope_idx on public.content_comment_lessons (status, brand, content_format);

-- كل تعليق اتقرا مرة واحدة بس (عشان المراجعة الأولى للتعليقات القديمة + اللي بعدها).
create table if not exists public.content_comment_lesson_scans (
  comment_id uuid primary key references public.comments(id) on delete cascade,
  lesson_id  uuid references public.content_comment_lessons(id) on delete set null,
  note       text,
  scanned_at timestamptz not null default now()
);

-- عدد التكرار = عدد التعليقات المختلفة اللي ورا الدرس؛ مرشّح + تكرار ≥ ٢ ⇒ فعّال تلقائي.
create or replace function public.content_comment_lessons_normalize()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  new.source_comment_ids := coalesce((select array_agg(distinct x order by x) from unnest(new.source_comment_ids) x where x is not null), '{}');
  new.hits := cardinality(new.source_comment_ids);
  new.lesson := btrim(new.lesson);
  if new.status = 'candidate' and new.hits >= 2 then new.status := 'active'; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_content_comment_lessons_normalize on public.content_comment_lessons;
create trigger trg_content_comment_lessons_normalize before insert or update on public.content_comment_lessons
  for each row execute function public.content_comment_lessons_normalize();

alter table public.content_comment_lessons enable row level security;
alter table public.content_comment_lesson_scans enable row level security;
revoke all on public.content_comment_lessons, public.content_comment_lesson_scans from public, anon, authenticated;
grant select on public.content_comment_lessons to authenticated;
drop policy if exists "active admins read comment lessons" on public.content_comment_lessons;
create policy "active admins read comment lessons" on public.content_comment_lessons
  for select to authenticated using (public.my_admin_id() is not null);
-- مفيش كتابة مباشرة من الواجهة: تغيير الحالة من الدالة تحت بس، والدروس نفسها من Claude (service_role).

-- المالك/المدير العام: تفعيل/قفل درس.
create or replace function public.content_comment_lesson_set_status(p_id uuid, p_status text)
returns public.content_comment_lessons
language plpgsql security definer set search_path = pg_catalog, public as $$
declare r public.content_comment_lessons;
begin
  if not public.can_manage_all_content() then raise exception 'not allowed'; end if;
  if p_status not in ('active','disabled') then raise exception 'bad status'; end if;
  update public.content_comment_lessons
     set status = p_status, status_changed_by = public.my_admin_id(), status_changed_at = now()
   where id = p_id returning * into r;
  if r.id is null then raise exception 'lesson not found'; end if;
  return r;
end $$;
revoke all on function public.content_comment_lesson_set_status(uuid, text) from public, anon;
grant execute on function public.content_comment_lesson_set_status(uuid, text) to authenticated;

-- Claude (service_role): التعليقات اللي لسه ماتقرتش — الأقدم الأول (أول تشغيل = مراجعة كل التعليقات القديمة).
-- بيستبعد تعليقات حساب Claude Creative نفسه.
create or replace function public.content_comment_lessons_unscanned(p_limit integer default 200)
returns table (comment_id uuid, body text, comment_status text, created_at timestamptz,
               content_id uuid, title text, brand text, content_format text, stage text)
language sql stable security definer set search_path = pg_catalog, public as $$
  select c.id, c.body, c.status, c.created_at, ci.id, ci.title, ci.brand, ci.content_format, ci.stage
    from public.comments c
    join public.content_items ci on ci.id = c.content_id
   where c.author_id is distinct from 'a0fbdfee-d147-4282-b988-186a9ae3e88c'::uuid
     and length(btrim(c.body)) > 0
     and not exists (select 1 from public.content_comment_lesson_scans s where s.comment_id = c.id)
   order by c.created_at
   limit least(greatest(coalesce(p_limit, 200), 1), 500)
$$;

-- Claude (service_role): سجّل درس (جديد أو ضيف تعليقات لدرس موجود) واعلّم التعليقات إنها اتقرت.
create or replace function public.content_comment_lesson_record(
  p_comment_ids uuid[], p_lesson_id uuid default null, p_brand text default null,
  p_format text default null, p_category text default 'other', p_lesson text default null, p_example text default null)
returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_id uuid := p_lesson_id; v_ids uuid[];
begin
  select coalesce(array_agg(c.id), '{}') into v_ids from public.comments c where c.id = any(coalesce(p_comment_ids, '{}'));
  if cardinality(v_ids) = 0 then raise exception 'no valid comments'; end if;
  if v_id is null then
    insert into public.content_comment_lessons(brand, content_format, category, lesson, example_comment, source_comment_ids)
    values (nullif(p_brand, ''), nullif(p_format, ''), coalesce(nullif(p_category, ''), 'other'), p_lesson, left(p_example, 400), v_ids)
    returning id into v_id;
  else
    update public.content_comment_lessons
       set source_comment_ids = source_comment_ids || v_ids, last_seen_at = now(),
           lesson = coalesce(nullif(btrim(p_lesson), ''), lesson),
           example_comment = coalesce(left(p_example, 400), example_comment)
     where id = v_id;
    if not found then raise exception 'lesson not found'; end if;
  end if;
  insert into public.content_comment_lesson_scans(comment_id, lesson_id)
  select unnest(v_ids), v_id
  on conflict (comment_id) do update set lesson_id = excluded.lesson_id, scanned_at = now();
  return v_id;
end $$;

-- Claude (service_role): تعليقات خاصة بمادة واحدة بس (مثلاً «غيّر الصورة دي») — اتقرت ومفيش درس عام.
create or replace function public.content_comment_lesson_skip(p_comment_ids uuid[], p_note text default null)
returns integer
language plpgsql security definer set search_path = pg_catalog, public as $$
declare n integer;
begin
  insert into public.content_comment_lesson_scans(comment_id, note)
  select c.id, left(p_note, 200) from public.comments c where c.id = any(coalesce(p_comment_ids, '{}'))
  on conflict (comment_id) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.content_comment_lessons_unscanned(integer) from public, anon, authenticated;
revoke all on function public.content_comment_lesson_record(uuid[], uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.content_comment_lesson_skip(uuid[], text) from public, anon, authenticated;
grant execute on function public.content_comment_lessons_unscanned(integer) to service_role;
grant execute on function public.content_comment_lesson_record(uuid[], uuid, text, text, text, text, text) to service_role;
grant execute on function public.content_comment_lesson_skip(uuid[], text) to service_role;
grant select, insert, update on public.content_comment_lessons, public.content_comment_lesson_scans to service_role;
