-- ============================================================
--  SSMPD — إعداد قاعدة بيانات Supabase (مشروع منفصل تماماً)
--  شغّله مرة واحدة: Supabase → SQL Editor → New query → Run
--  آمن للتشغيل أكثر من مرة.
-- ============================================================

-- ============================================================
--  0) دوال مساعدة عامة
-- ============================================================
create extension if not exists pgcrypto;

-- ============================================================
--  1) جدول المستخدمين والأدوار
-- ============================================================
create table if not exists public.admins (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid unique references auth.users(id) on delete cascade,
  email       text not null unique,
  name        text,
  role        text not null default 'page_manager'
              check (role in ('page_manager','designer','approver','super_admin')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create index if not exists admins_email_idx on public.admins (lower(email));

create or replace function public.is_super()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.admins
    where user_id = auth.uid() and active and role = 'super_admin'
  );
$$;
revoke all on function public.is_super() from public;
grant execute on function public.is_super() to authenticated;

create or replace function public.my_admin_id()
returns uuid language sql security definer stable set search_path = public as $$
  select id from public.admins where user_id = auth.uid() and active limit 1;
$$;
revoke all on function public.my_admin_id() from public;
grant execute on function public.my_admin_id() to authenticated;

create or replace function public.my_role()
returns text language sql security definer stable set search_path = public as $$
  select role from public.admins where user_id = auth.uid() and active limit 1;
$$;
revoke all on function public.my_role() from public;
grant execute on function public.my_role() to authenticated;

alter table public.admins enable row level security;

drop policy if exists "read own or pending" on public.admins;
drop policy if exists "super reads all"     on public.admins;
drop policy if exists "super writes all"    on public.admins;
drop policy if exists "claim own invite"    on public.admins;

create policy "read own or pending"
  on public.admins for select to authenticated
  using (
    user_id = auth.uid()
    or (user_id is null and lower(email) = lower(auth.jwt() ->> 'email'))
  );

create policy "super reads all"
  on public.admins for select to authenticated
  using (public.is_super());

create policy "super writes all"
  on public.admins for all to authenticated
  using (public.is_super())
  with check (public.is_super());

create policy "claim own invite"
  on public.admins for update to authenticated
  using (user_id is null and lower(email) = lower(auth.jwt() ->> 'email'))
  with check (user_id = auth.uid());

create or replace function public.guard_admin_changes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_super() then return new; end if;
  if new.role is distinct from old.role or new.active is distinct from old.active then
    raise exception 'غير مسموح بتغيير الدور أو الحالة';
  end if;
  return new;
end $$;

drop trigger if exists admins_guard on public.admins;
create trigger admins_guard before update on public.admins
  for each row execute function public.guard_admin_changes();

-- ============================================================
--  2) جدول المحتوى — قلب النظام
-- ============================================================
create table if not exists public.content_items (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null,
  body               text,
  stage              text not null default 'idea_selection'
                     check (stage in (
                       'idea_selection','initial_approval','in_design',
                       'final_approval','needs_revision','ready_to_publish','published'
                     )),
  created_by         uuid references public.admins(id),
  assigned_designer  uuid references public.admins(id),
  design_file_url    text,
  design_drive_folder text,
  published_url      text,
  published_by       uuid references public.admins(id),
  published_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists content_items_stage_idx on public.content_items (stage);
create index if not exists content_items_created_by_idx on public.content_items (created_by);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists content_items_touch on public.content_items;
create trigger content_items_touch before update on public.content_items
  for each row execute function public.touch_updated_at();

alter table public.content_items enable row level security;

drop policy if exists "active admins read content"   on public.content_items;
drop policy if exists "page_manager inserts content" on public.content_items;
drop policy if exists "active admins update content" on public.content_items;
drop policy if exists "super deletes content"        on public.content_items;

-- القراءة: أي موظف نشط (كل الأدوار الأربعة تحتاج ترى المحتوى في مكان ما)
create policy "active admins read content"
  on public.content_items for select to authenticated
  using (public.my_admin_id() is not null);

-- الإنشاء: موظف صفحات أو سوبر أدمن، وباسمه هو فقط
create policy "page_manager inserts content"
  on public.content_items for insert to authenticated
  with check (
    (public.my_role() in ('page_manager','super_admin'))
    and created_by = public.my_admin_id()
  );

-- التعديل: مسموح لكل موظف نشط، والحارس أدناه يتحقق من صلاحية كل انتقال مرحلة
create policy "active admins update content"
  on public.content_items for update to authenticated
  using (public.my_admin_id() is not null)
  with check (public.my_admin_id() is not null);

create policy "super deletes content"
  on public.content_items for delete to authenticated
  using (public.is_super());

-- حارس انتقالات المراحل — يمنع أي دور من تخطي دوره في سير العمل
create or replace function public.guard_content_transition()
returns trigger language plpgsql security definer set search_path = public as $$
declare r text; me uuid;
begin
  if public.is_super() then return new; end if;
  r := public.my_role();
  me := public.my_admin_id();

  -- موظف الصفحات: يرسل فكرته للاعتماد، وينشر بعد الجاهزية، ولا يلمس حاجة غير بتاعته
  if r = 'page_manager' then
    if old.created_by is distinct from me then
      raise exception 'غير مسموح: هذه المادة ليست لك';
    end if;
    if not (
      (old.stage = 'idea_selection' and new.stage = 'initial_approval')
      or (old.stage = 'ready_to_publish' and new.stage = 'published')
      -- رفض قبل ما التصميم يبدأ (لسه مفيش مصمم مسند) بيرجع لموظف الصفحات
      or (old.stage = 'needs_revision' and old.assigned_designer is null and new.stage = 'initial_approval')
      or (old.stage = new.stage) -- تعديل نص قبل الإرسال
    ) then
      raise exception 'انتقال مرحلة غير مسموح لموظف الصفحات';
    end if;
    return new;
  end if;

  -- المصمم: يعمل على اللي معاه بس، من in_design لـ final_approval
  if r = 'designer' then
    if not (old.assigned_designer is null or old.assigned_designer = me) then
      raise exception 'غير مسموح: هذه المادة مسندة لمصمم آخر';
    end if;
    if not (
      (old.stage = 'in_design' and new.stage = 'final_approval')
      -- رفض بعد ما التصميم خلص (فيه مصمم مسند) بيرجع للمصمم
      or (old.stage = 'needs_revision' and old.assigned_designer is not null and new.stage = 'final_approval')
      or (old.stage = new.stage)
    ) then
      raise exception 'انتقال مرحلة غير مسموح للمصمم';
    end if;
    return new;
  end if;

  -- مسؤول الاعتماد: يعتمد أو يطلب تعديل في نقطتي الاعتماد، ويسند مصمم
  if r = 'approver' then
    if not (
      (old.stage = 'initial_approval' and new.stage in ('in_design','needs_revision'))
      or (old.stage = 'final_approval' and new.stage in ('ready_to_publish','needs_revision'))
      or (old.stage = new.stage)
    ) then
      raise exception 'انتقال مرحلة غير مسموح لمسؤول الاعتماد';
    end if;
    return new;
  end if;

  raise exception 'دور غير معروف';
end $$;

drop trigger if exists content_items_guard on public.content_items;
create trigger content_items_guard before update on public.content_items
  for each row execute function public.guard_content_transition();

-- ============================================================
--  3) الكومنتات (Threads) — مرتبطة بالمادة
-- ============================================================
create table if not exists public.comments (
  id          uuid primary key default gen_random_uuid(),
  content_id  uuid not null references public.content_items(id) on delete cascade,
  author_id   uuid references public.admins(id),
  body        text not null,
  created_at  timestamptz not null default now()
);

create index if not exists comments_content_idx on public.comments (content_id);

alter table public.comments enable row level security;

drop policy if exists "active admins read comments"  on public.comments;
drop policy if exists "active admins write comments" on public.comments;

create policy "active admins read comments"
  on public.comments for select to authenticated
  using (public.my_admin_id() is not null);

create policy "active admins write comments"
  on public.comments for insert to authenticated
  with check (public.my_admin_id() is not null and author_id = public.my_admin_id());

-- ============================================================
--  4) سجل النشاط (Activity Log)
-- ============================================================
create table if not exists public.activity_log (
  id          uuid primary key default gen_random_uuid(),
  content_id  uuid not null references public.content_items(id) on delete cascade,
  actor_id    uuid references public.admins(id),
  action      text not null,
  from_stage  text,
  to_stage    text,
  created_at  timestamptz not null default now()
);

create index if not exists activity_content_idx on public.activity_log (content_id);

alter table public.activity_log enable row level security;

drop policy if exists "active admins read activity"  on public.activity_log;
drop policy if exists "active admins write activity" on public.activity_log;

create policy "active admins read activity"
  on public.activity_log for select to authenticated
  using (public.my_admin_id() is not null);

create policy "active admins write activity"
  on public.activity_log for insert to authenticated
  with check (public.my_admin_id() is not null and actor_id = public.my_admin_id());

-- ============================================================
--  5) مؤشرات السوشيال ميديا الأسبوعية (إدخال يدوي)
-- ============================================================
create table if not exists public.weekly_social_metrics (
  id              uuid primary key default gen_random_uuid(),
  week_start      date not null unique,
  reach           integer default 0,
  engagement_rate numeric(5,2) default 0,
  new_followers   integer default 0,
  notes           text,
  entered_by      uuid references public.admins(id),
  created_at      timestamptz not null default now()
);

alter table public.weekly_social_metrics enable row level security;

drop policy if exists "active admins read metrics"  on public.weekly_social_metrics;
drop policy if exists "approver writes metrics"     on public.weekly_social_metrics;

create policy "active admins read metrics"
  on public.weekly_social_metrics for select to authenticated
  using (public.my_admin_id() is not null);

create policy "approver writes metrics"
  on public.weekly_social_metrics for all to authenticated
  using (public.my_role() in ('approver','super_admin'))
  with check (public.my_role() in ('approver','super_admin'));

-- ============================================================
--  6) تفعيل Realtime على الجداول التفاعلية
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname='public' and tablename='content_items'
  ) then
    alter publication supabase_realtime add table public.content_items;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname='public' and tablename='comments'
  ) then
    alter publication supabase_realtime add table public.comments;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname='public' and tablename='activity_log'
  ) then
    alter publication supabase_realtime add table public.activity_log;
  end if;
end $$;

-- ============================================================
--  7) أول سوبر أدمن
-- ============================================================
-- الخطوة أ) Authentication → Users → Add user → Create new user
--            ضع بريدك وكلمة السر، وفعّل «Auto Confirm User».
-- الخطوة ب) عدّل البريد والاسم تحت لو مختلفين ثم شغّل السطر:

insert into public.admins (user_id, email, name, role, active)
select u.id, u.email, 'محمد عبدالعال', 'super_admin', true
from auth.users u
where lower(u.email) = lower('mohamadmh32@gmail.com')
on conflict (email) do update
  set user_id = excluded.user_id,
      role    = 'super_admin',
      name    = excluded.name,
      active  = true;

-- ============================================================
--  مراجعة
-- ============================================================
-- select email, name, role, active, (user_id is not null) as حساب_مفعل
-- from public.admins order by created_at;
