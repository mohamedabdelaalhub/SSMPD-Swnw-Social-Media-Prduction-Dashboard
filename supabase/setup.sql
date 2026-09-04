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
              check (role in ('page_manager','designer','approver','general_manager','super_admin')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ترقية جدول قديم كان قبل إضافة دور "مدير عام"
alter table public.admins drop constraint if exists admins_role_check;
alter table public.admins add constraint admins_role_check
  check (role in ('page_manager','designer','approver','general_manager','super_admin'));

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

-- المدير العام له كل صلاحيات المحتوى زي السوبر أدمن (تخطي مراحل، حذف مواد)،
-- لكن **بدون** إدارة المستخدمين — سياسات جدول admins تحت دي بتستخدم is_super() لوحدها عمداً
create or replace function public.can_manage_all_content()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.admins
    where user_id = auth.uid() and active and role in ('super_admin','general_manager')
  );
$$;
revoke all on function public.can_manage_all_content() from public;
grant execute on function public.can_manage_all_content() to authenticated;

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
                       'final_approval','needs_revision','ready_to_publish','scheduled','published'
                     )),
  created_by         uuid references public.admins(id),
  assigned_designer  uuid references public.admins(id),
  design_file_url    text,
  design_drive_folder text,
  published_url      text,
  published_by       uuid references public.admins(id),
  published_at       timestamptz,
  -- معاد النشر المجدول ومين حددّه — تاب "النشر" بيستخدمهم لحالة "مجدولة للنشر" (قبل التأكيد الفعلي)
  scheduled_publish_at timestamptz,
  scheduled_by        uuid references public.admins(id),
  -- وقت ما المصمم دوس "استلام" فعلياً (يميّز "في انتظار الاستلام" عن "تم الاستلام" في شاشة التصميم)
  design_received_at timestamptz,
  -- سجل تلقائي بكل انتقالة مرحلة [{stage,at},...] — بيُستخدم لحساب مدة رحلة الفكرة للنشر ومدة كل مرحلة في تقرير الأرشيف
  stage_history       jsonb not null default '[]'::jsonb,
  -- تمييز المحتوى: سونو أو د. دينا — بيحدده منشئ المحتوى، ويظهر لكل الأدوار في كل مرحلة
  brand               text check (brand in ('sono','dr_dina')),
  -- المنصة اللي اتنشر عليها (بتتحدد وقت النشر)
  publish_platform    text check (publish_platform in ('facebook','instagram','tiktok','youtube','website')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ترقية جدول قديم كان قبل إضافة الأعمدة دي
alter table public.content_items add column if not exists design_received_at timestamptz;
alter table public.content_items add column if not exists stage_history jsonb not null default '[]'::jsonb;
alter table public.content_items add column if not exists brand text;
alter table public.content_items drop constraint if exists content_items_brand_check;
alter table public.content_items add constraint content_items_brand_check check (brand in ('sono','dr_dina'));
alter table public.content_items add column if not exists publish_platform text;
alter table public.content_items drop constraint if exists content_items_publish_platform_check;
alter table public.content_items add constraint content_items_publish_platform_check
  check (publish_platform in ('facebook','instagram','tiktok','youtube','website'));
-- ترقية جدول قديم كان قبل إضافة مرحلة "مجدولة للنشر" (تاب النشر)
alter table public.content_items add column if not exists scheduled_publish_at timestamptz;
alter table public.content_items add column if not exists scheduled_by uuid references public.admins(id);
alter table public.content_items drop constraint if exists content_items_stage_check;
alter table public.content_items add constraint content_items_stage_check
  check (stage in (
    'idea_selection','initial_approval','in_design',
    'final_approval','needs_revision','ready_to_publish','scheduled','published'
  ));

create index if not exists content_items_stage_idx on public.content_items (stage);
create index if not exists content_items_created_by_idx on public.content_items (created_by);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists content_items_touch on public.content_items;
create trigger content_items_touch before update on public.content_items
  for each row execute function public.touch_updated_at();

-- يسجّل تلقائياً كل مرة الـ stage يتغيّر (أو أول إنشاء) في stage_history — مصدر الحقيقة لحساب أوقات المراحل
create or replace function public.track_stage_history()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.stage_history = jsonb_build_array(jsonb_build_object('stage', new.stage, 'at', now()));
  elsif new.stage is distinct from old.stage then
    new.stage_history = coalesce(old.stage_history, '[]'::jsonb) || jsonb_build_object('stage', new.stage, 'at', now());
  end if;
  return new;
end $$;

drop trigger if exists content_items_stage_history on public.content_items;
create trigger content_items_stage_history before insert or update on public.content_items
  for each row execute function public.track_stage_history();

alter table public.content_items enable row level security;

drop policy if exists "active admins read content"   on public.content_items;
drop policy if exists "page_manager inserts content" on public.content_items;
drop policy if exists "active admins update content" on public.content_items;
drop policy if exists "super deletes content"        on public.content_items;

-- القراءة: أي موظف نشط (كل الأدوار الأربعة تحتاج ترى المحتوى في مكان ما)
create policy "active admins read content"
  on public.content_items for select to authenticated
  using (public.my_admin_id() is not null);

-- الإنشاء: موظف صفحات أو سوبر أدمن أو مدير عام، وباسمه هو فقط
create policy "page_manager inserts content"
  on public.content_items for insert to authenticated
  with check (
    (public.my_role() in ('page_manager','general_manager','super_admin'))
    and created_by = public.my_admin_id()
  );

-- التعديل: مسموح لكل موظف نشط، والحارس أدناه يتحقق من صلاحية كل انتقال مرحلة
create policy "active admins update content"
  on public.content_items for update to authenticated
  using (public.my_admin_id() is not null)
  with check (public.my_admin_id() is not null);

create policy "super deletes content"
  on public.content_items for delete to authenticated
  using (public.can_manage_all_content());

-- حارس انتقالات المراحل — يمنع أي دور من تخطي دوره في سير العمل
create or replace function public.guard_content_transition()
returns trigger language plpgsql security definer set search_path = public as $$
declare r text; me uuid;
begin
  if public.can_manage_all_content() then return new; end if;
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
      -- تاب النشر: جدولة مادة جاهزة، تأكيد نشر مادة مجدولة، أو إلغاء الجدولة
      or (old.stage = 'ready_to_publish' and new.stage = 'scheduled')
      or (old.stage = 'scheduled' and new.stage = 'published')
      or (old.stage = 'scheduled' and new.stage = 'ready_to_publish')
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

  -- مسؤول الاعتماد: يعتمد أو يطلب تعديل في نقطتي الاعتماد، ويسند مصمم، وينشر برضه من شاشة إدارة المحتوى
  if r = 'approver' then
    if not (
      (old.stage = 'initial_approval' and new.stage in ('in_design','needs_revision'))
      or (old.stage = 'final_approval' and new.stage in ('ready_to_publish','needs_revision'))
      or (old.stage = 'ready_to_publish' and new.stage = 'published')
      -- تاب النشر: جدولة مادة جاهزة، تأكيد نشر مادة مجدولة، أو إلغاء الجدولة
      or (old.stage = 'ready_to_publish' and new.stage = 'scheduled')
      or (old.stage = 'scheduled' and new.stage = 'published')
      or (old.stage = 'scheduled' and new.stage = 'ready_to_publish')
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
  status      text not null default 'pending' check (status in ('pending','done')),
  created_at  timestamptz not null default now()
);

-- ترقية جدول قديم كان قبل إضافة status
alter table public.comments add column if not exists status text not null default 'pending';
alter table public.comments drop constraint if exists comments_status_check;
alter table public.comments add constraint comments_status_check check (status in ('pending','done'));

create index if not exists comments_content_idx on public.comments (content_id);

alter table public.comments enable row level security;

drop policy if exists "active admins read comments"   on public.comments;
drop policy if exists "active admins write comments"  on public.comments;
drop policy if exists "active admins update comments" on public.comments;

create policy "active admins read comments"
  on public.comments for select to authenticated
  using (public.my_admin_id() is not null);

create policy "active admins write comments"
  on public.comments for insert to authenticated
  with check (public.my_admin_id() is not null and author_id = public.my_admin_id());

-- تحديث الحالة (في انتظار التعديل / تم التعديل) مسموح لأي موظف نشط،
-- والحارس تحت بيمنع تعديل نص الكومنت أو صاحبه إلا للسوبر أدمن
create policy "active admins update comments"
  on public.comments for update to authenticated
  using (public.my_admin_id() is not null)
  with check (public.my_admin_id() is not null);

create or replace function public.guard_comment_changes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_super() then return new; end if;
  if new.body is distinct from old.body
     or new.author_id is distinct from old.author_id
     or new.content_id is distinct from old.content_id then
    raise exception 'غير مسموح بتعديل نص الكومنت أو صاحبه — بس حالة الكومنت';
  end if;
  return new;
end $$;

drop trigger if exists comments_guard on public.comments;
create trigger comments_guard before update on public.comments
  for each row execute function public.guard_comment_changes();

-- ============================================================
--  3ب) تتبّع قراءة الكومنتات — لعداد "تعليق جديد" (أحمر/رمادي) في الواجهة
-- ============================================================
create table if not exists public.comment_reads (
  admin_id     uuid not null references public.admins(id) on delete cascade,
  content_id   uuid not null references public.content_items(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (admin_id, content_id)
);

alter table public.comment_reads enable row level security;

drop policy if exists "own comment reads" on public.comment_reads;
create policy "own comment reads"
  on public.comment_reads for all to authenticated
  using (admin_id = public.my_admin_id())
  with check (admin_id = public.my_admin_id());

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
  using (public.my_role() in ('approver','general_manager','super_admin'))
  with check (public.my_role() in ('approver','general_manager','super_admin'));

-- ============================================================
--  5-ب) الإعلانات المدفوعة (تقرير حملات Meta Ads مستورد يدوياً من CSV)
--  كل استيراد جديد بيستبدل التقرير القديم بالكامل (مش تراكمي أسبوعي
--  زي weekly_social_metrics) — الصفوف مُجمّعة لكل حملة (campaign_name)
-- ============================================================
create table if not exists public.ad_campaigns (
  id               uuid primary key default gen_random_uuid(),
  campaign_name    text not null,
  objective        text,
  amount_spent     numeric(12,2) default 0,
  impressions      bigint default 0,
  reach            bigint default 0,
  results          numeric default 0,
  result_indicator text,
  cost_per_result  numeric(12,2),
  link_clicks      bigint default 0,
  ctr              numeric(8,3),
  reporting_start  date,
  reporting_end    date,
  imported_by      uuid references public.admins(id),
  created_at       timestamptz not null default now()
);

alter table public.ad_campaigns enable row level security;

drop policy if exists "active admins read ad campaigns" on public.ad_campaigns;
drop policy if exists "approver writes ad campaigns"    on public.ad_campaigns;

create policy "active admins read ad campaigns"
  on public.ad_campaigns for select to authenticated
  using (public.my_admin_id() is not null);

create policy "approver writes ad campaigns"
  on public.ad_campaigns for all to authenticated
  using (public.my_role() in ('approver','general_manager','super_admin'))
  with check (public.my_role() in ('approver','general_manager','super_admin'));

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
--  7) جدول المرضى المشترك (Patients) — موديولي أرشيف المرضى وإدارة الليدز
-- ============================================================

-- توسعة الأدوار: رولين جداد لموديول الليدز + علم صلاحية أرشيف منفصل
alter table public.admins drop constraint if exists admins_role_check;
alter table public.admins add constraint admins_role_check
  check (role in ('page_manager','designer','approver','general_manager','super_admin','reception','customer_service'));

alter table public.admins add column if not exists has_archive_access boolean not null default false;

create sequence if not exists public.patient_code_seq;

create table if not exists public.patients (
  id                 uuid primary key default gen_random_uuid(),
  -- رقم تعريف قصير قابل للقراءة (مش الـ UUID الداخلي) — يُستخدم في اسم فولدر الدرايف وفي الواجهة
  patient_code       text not null unique default (
                       'P-' || to_char(now(), 'YYYY') || '-' ||
                       lpad(nextval('public.patient_code_seq')::text, 6, '0')
                     ),
  national_id_hash   text, -- هاش SHA-256 (+ pepper سري من الـ Edge Function) — الرقم الخام ميتخزنش أبداً
  full_name          text not null,
  phone              text,               -- الرقم زي ما اتكتب
  phone_normalized   text,               -- بعد التطبيع — يُستخدم للمطابقة مع جدول leads
  status             text not null default 'active' check (status in ('active','archived')),
  created_by         uuid references public.admins(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists patients_phone_normalized_idx on public.patients (phone_normalized);
create index if not exists patients_national_id_hash_idx on public.patients (national_id_hash);

create table if not exists public.patient_files (
  id            uuid primary key default gen_random_uuid(),
  patient_id    uuid not null references public.patients(id) on delete cascade,
  category      text not null check (category in ('id_document','insurance','radiology','lab_result','other')),
  drive_file_id text not null,
  file_name     text not null,
  file_size     bigint,
  mime_type     text,
  checksum      text, -- SHA-256 للملف
  uploaded_by   uuid references public.admins(id),
  uploaded_at   timestamptz not null default now(),
  is_encrypted  boolean not null default false
);
create index if not exists patient_files_patient_id_idx on public.patient_files (patient_id);

create table if not exists public.archive_access_log (
  id           uuid primary key default gen_random_uuid(),
  file_id      uuid references public.patient_files(id) on delete set null,
  patient_id   uuid references public.patients(id) on delete set null,
  employee_id  uuid references public.admins(id),
  action       text not null check (action in ('view','download','upload','delete')),
  created_at   timestamptz not null default now()
);
create index if not exists archive_access_log_patient_id_idx on public.archive_access_log (patient_id);

-- ---------- دوال صلاحية مساعدة ----------
create or replace function public.has_archive_access()
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce((
    select has_archive_access or role in ('super_admin')
    from public.admins where user_id = auth.uid() and active limit 1
  ), false);
$$;
revoke all on function public.has_archive_access() from public;
grant execute on function public.has_archive_access() to authenticated;

create or replace function public.can_access_leads()
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce((
    select role in ('reception','customer_service','general_manager','super_admin')
    from public.admins where user_id = auth.uid() and active limit 1
  ), false);
$$;
revoke all on function public.can_access_leads() from public;
grant execute on function public.can_access_leads() to authenticated;

-- ---------- RLS: patients (جدول مشترك — مقروء ومكتوب من الموديولين) ----------
alter table public.patients enable row level security;
drop policy if exists "archive or leads read patients" on public.patients;
create policy "archive or leads read patients" on public.patients
  for select using (public.has_archive_access() or public.can_access_leads());
drop policy if exists "archive or leads write patients" on public.patients;
create policy "archive or leads write patients" on public.patients
  for insert with check (public.has_archive_access() or public.can_access_leads());
drop policy if exists "archive or leads update patients" on public.patients;
create policy "archive or leads update patients" on public.patients
  for update using (public.has_archive_access() or public.can_access_leads());

-- ---------- RLS: patient_files + archive_access_log (أرشيف بس — أكثر حساسية) ----------
alter table public.patient_files enable row level security;
drop policy if exists "archive access reads files" on public.patient_files;
create policy "archive access reads files" on public.patient_files
  for select using (public.has_archive_access());
drop policy if exists "archive access writes files" on public.patient_files;
create policy "archive access writes files" on public.patient_files
  for insert with check (public.has_archive_access());
drop policy if exists "archive access deletes files" on public.patient_files;
create policy "archive access deletes files" on public.patient_files
  for delete using (public.has_archive_access());

alter table public.archive_access_log enable row level security;
drop policy if exists "archive access reads log" on public.archive_access_log;
create policy "archive access reads log" on public.archive_access_log
  for select using (public.has_archive_access());
drop policy if exists "archive access writes log" on public.archive_access_log;
create policy "archive access writes log" on public.archive_access_log
  for insert with check (public.has_archive_access());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname='public' and tablename='patients'
  ) then
    alter publication supabase_realtime add table public.patients;
  end if;
end $$;

-- ============================================================
--  8) موديول إدارة الليدز والتواصل مع العملاء (Leads Module)
-- ============================================================
-- ملاحظة: جدول patients اتبنى بالفعل في المرحلة السابقة (القسم 7) وبيُستخدم هنا كـ FK فقط، من غير أي تكرار.

-- ---------- جدول الليدز الأساسي ----------
create table if not exists public.leads (
  id                   uuid primary key default gen_random_uuid(),
  customer_name        text not null,
  phone_raw            text,
  phone_normalized     text,                 -- نفس منطق التطبيع المستخدم في patients.phone_normalized
  source               text not null check (source in ('whatsapp','messenger')),
  message_text         text,
  attachment_url       text,
  received_at          timestamptz not null default now(),
  received_by          uuid references public.admins(id),
  interested_service   text check (interested_service in ('consultation','radiology','lab','nursing','physiotherapy','treatment','other')),
  requested_department text,
  patient_id           uuid references public.patients(id),
  patient_type         text check (patient_type in ('new','existing')),
  current_status       text not null default 'new' check (current_status in
                          ('new','in_progress','booked','interested_undecided','rejected','no_response','invalid_number')),
  priority             text not null default 'normal' check (priority in ('high','medium','normal')),
  do_not_contact       boolean not null default false,
  assigned_to          uuid references public.admins(id),
  booking_reference    text,
  next_follow_up_date  date,
  closed_at            timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists leads_phone_normalized_idx on public.leads (phone_normalized);
create index if not exists leads_current_status_idx on public.leads (current_status);
create index if not exists leads_assigned_to_idx on public.leads (assigned_to);
create index if not exists leads_patient_id_idx on public.leads (patient_id);
create index if not exists leads_next_follow_up_date_idx on public.leads (next_follow_up_date);

-- ---------- سجل محاولات التواصل (متعدد لكل ليد) ----------
create table if not exists public.lead_attempts (
  id                   uuid primary key default gen_random_uuid(),
  lead_id              uuid not null references public.leads(id) on delete cascade,
  employee_id          uuid references public.admins(id),
  attempt_date         timestamptz not null default now(),
  result               text check (result in ('answered','no_answer','busy','call_back_later','other')),
  next_follow_up_date  date,
  notes                text
);
create index if not exists lead_attempts_lead_id_idx on public.lead_attempts (lead_id);

-- ---------- سجل تغييرات الحالة (audit trail) ----------
create table if not exists public.lead_status_log (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references public.leads(id) on delete cascade,
  changed_by   uuid references public.admins(id),
  old_status   text,
  new_status   text,
  changed_at   timestamptz not null default now()
);
create index if not exists lead_status_log_lead_id_idx on public.lead_status_log (lead_id);

-- ---------- تصنيف الملاحظات كتقييم خدمة (اختياري لكل ليد أو محاولة) ----------
create table if not exists public.lead_feedback_tags (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid references public.leads(id) on delete cascade,
  attempt_id   uuid references public.lead_attempts(id) on delete cascade,
  sentiment    text not null check (sentiment in ('positive','negative','neutral')),
  created_at   timestamptz not null default now(),
  constraint lead_feedback_tags_target_chk check (
    (lead_id is not null and attempt_id is null) or (lead_id is null and attempt_id is not null)
  )
);
create index if not exists lead_feedback_tags_lead_id_idx on public.lead_feedback_tags (lead_id);
create index if not exists lead_feedback_tags_attempt_id_idx on public.lead_feedback_tags (attempt_id);

-- ---------- تريجر: تسجيل تلقائي في lead_status_log عند تغيير current_status ----------
create or replace function public.log_lead_status_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.current_status is distinct from old.current_status then
    insert into public.lead_status_log (lead_id, changed_by, old_status, new_status)
    values (new.id, public.my_admin_id(), old.current_status, new.current_status);
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_log_lead_status_change on public.leads;
create trigger trg_log_lead_status_change
  before update on public.leads
  for each row execute function public.log_lead_status_change();

-- ---------- RLS: leads ----------
-- الاستقبال: يضيف ليدز بس (ومعاه قراءة محدودة لازمة لكشف التكرار وقت الإدخال)
-- خدمة العملاء: يشوف ويعدّل بس الليدز المُسندة له
-- المدير/الأدمن: يشوف ويعدّل كل حاجة
alter table public.leads enable row level security;

drop policy if exists "leads select" on public.leads;
create policy "leads select" on public.leads
  for select using (
    public.is_super()
    or public.my_role() in ('general_manager','reception')
    or (public.my_role() = 'customer_service' and assigned_to = public.my_admin_id())
  );

drop policy if exists "leads insert" on public.leads;
create policy "leads insert" on public.leads
  for insert with check (
    public.is_super() or public.my_role() in ('reception','customer_service','general_manager')
  );

drop policy if exists "leads update" on public.leads;
create policy "leads update" on public.leads
  for update using (
    public.is_super()
    or public.my_role() = 'general_manager'
    or (public.my_role() = 'customer_service' and assigned_to = public.my_admin_id())
  );

-- ---------- RLS: lead_attempts ----------
alter table public.lead_attempts enable row level security;

drop policy if exists "lead_attempts select" on public.lead_attempts;
create policy "lead_attempts select" on public.lead_attempts
  for select using (
    public.is_super()
    or public.my_role() = 'general_manager'
    or exists (
      select 1 from public.leads l
      where l.id = lead_attempts.lead_id
        and public.my_role() = 'customer_service'
        and l.assigned_to = public.my_admin_id()
    )
  );

drop policy if exists "lead_attempts insert" on public.lead_attempts;
create policy "lead_attempts insert" on public.lead_attempts
  for insert with check (
    public.is_super()
    or public.my_role() = 'general_manager'
    or exists (
      select 1 from public.leads l
      where l.id = lead_attempts.lead_id
        and public.my_role() = 'customer_service'
        and l.assigned_to = public.my_admin_id()
    )
  );

-- ---------- RLS: lead_status_log (قراءة فقط — بيتسجل تلقائي بالتريجر) ----------
alter table public.lead_status_log enable row level security;

drop policy if exists "lead_status_log select" on public.lead_status_log;
create policy "lead_status_log select" on public.lead_status_log
  for select using (
    public.is_super()
    or public.my_role() = 'general_manager'
    or exists (
      select 1 from public.leads l
      where l.id = lead_status_log.lead_id
        and public.my_role() = 'customer_service'
        and l.assigned_to = public.my_admin_id()
    )
  );

drop policy if exists "lead_status_log insert" on public.lead_status_log;
create policy "lead_status_log insert" on public.lead_status_log
  for insert with check (true); -- التريجر بيشتغل بصلاحية security definer، السطر ده لأي إدراج مباشر احتياطي بنفس شرط التعديل على leads

-- ---------- RLS: lead_feedback_tags ----------
alter table public.lead_feedback_tags enable row level security;

drop policy if exists "lead_feedback_tags select" on public.lead_feedback_tags;
create policy "lead_feedback_tags select" on public.lead_feedback_tags
  for select using (
    public.is_super()
    or public.my_role() = 'general_manager'
    or exists (
      select 1 from public.leads l
      where l.id = coalesce(lead_feedback_tags.lead_id, (select lead_id from public.lead_attempts where id = lead_feedback_tags.attempt_id))
        and public.my_role() = 'customer_service'
        and l.assigned_to = public.my_admin_id()
    )
  );

drop policy if exists "lead_feedback_tags insert" on public.lead_feedback_tags;
create policy "lead_feedback_tags insert" on public.lead_feedback_tags
  for insert with check (
    public.is_super()
    or public.my_role() in ('general_manager','customer_service')
  );

-- ---------- Realtime (نفس النمط الآمن للتكرار المستخدم سابقاً) ----------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname='public' and tablename='leads'
  ) then
    alter publication supabase_realtime add table public.leads;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname='public' and tablename='lead_attempts'
  ) then
    alter publication supabase_realtime add table public.lead_attempts;
  end if;
end $$;

-- ============================================================
--  9) مراجعة ملفات أرشيف المرضى (اعتماد قبل ما تبقى رسمية) — ٢٠٢٦-٠٨-١٨
-- ============================================================
-- قرار: الرفع لوحده مش كافي — لازم مسؤول تاني (صلاحية منفصلة عن صلاحية
-- الرفع نفسها) يراجع ويعتمد الملف قبل ما يبقى جزء رسمي من ملف المريض.
-- الملف بيدخل الحالة "pending" أول ما يترفع، ومحتاج اعتماد/رفض صريح.

alter table public.admins add column if not exists has_archive_review_access boolean not null default false;

alter table public.patient_files add column if not exists review_status text not null default 'pending';
alter table public.patient_files drop constraint if exists patient_files_review_status_check;
alter table public.patient_files add constraint patient_files_review_status_check
  check (review_status in ('pending','approved','rejected'));
alter table public.patient_files add column if not exists reviewed_by uuid references public.admins(id);
alter table public.patient_files add column if not exists reviewed_at timestamptz;
alter table public.patient_files add column if not exists review_notes text;

alter table public.archive_access_log drop constraint if exists archive_access_log_action_check;
alter table public.archive_access_log add constraint archive_access_log_action_check
  check (action in ('view','download','upload','delete','review_approve','review_reject'));

-- خدمة "كشف" جديدة في قائمة اهتمامات الليد (طلب المستخدم) — فوق "استشارة" في ترتيب الواجهة
alter table public.leads drop constraint if exists leads_interested_service_check;
alter table public.leads add constraint leads_interested_service_check
  check (interested_service in ('checkup','consultation','radiology','lab','nursing','physiotherapy','treatment','other'));

create or replace function public.has_archive_review_access()
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce((
    select has_archive_review_access or role in ('super_admin')
    from public.admins where user_id = auth.uid() and active limit 1
  ), false);
$$;
revoke all on function public.has_archive_review_access() from public;
grant execute on function public.has_archive_review_access() to authenticated;

-- تحديث/اعتماد الملف (تغيير review_status) مقصور على صاحب صلاحية المراجعة —
-- منفصل تماماً عن سياسة "archive access writes files" اللي بتحكم الإدراج الأولي بس
drop policy if exists "archive review updates files" on public.patient_files;
create policy "archive review updates files" on public.patient_files
  for update using (public.has_archive_review_access())
  with check (public.has_archive_review_access());

-- توسعة سياسات القراءة عشان مراجع عنده has_archive_review_access بس (من غير
-- has_archive_access) يقدر يشوف المرضى/الملفات/اللوج برضه — مش لازم يكون رافع
drop policy if exists "archive or leads read patients" on public.patients;
create policy "archive or leads read patients" on public.patients
  for select using (public.has_archive_access() or public.has_archive_review_access() or public.can_access_leads());

drop policy if exists "archive access reads files" on public.patient_files;
create policy "archive access reads files" on public.patient_files
  for select using (public.has_archive_access() or public.has_archive_review_access());

drop policy if exists "archive access reads log" on public.archive_access_log;
create policy "archive access reads log" on public.archive_access_log
  for select using (public.has_archive_access() or public.has_archive_review_access());

-- ---------- سجل تعديلات حقول الليد (طلب المستخدم: شاشة الإدارة تعرف مين عدّل
-- وعدّل إيه وامتى) — منفصل عن lead_status_log اللي مقصور على current_status بس ----------
create table if not exists public.lead_field_changes (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references public.leads(id) on delete cascade,
  changed_by   uuid references public.admins(id),
  field_name   text not null,
  old_value    text,
  new_value    text,
  changed_at   timestamptz not null default now()
);
create index if not exists lead_field_changes_lead_id_idx on public.lead_field_changes (lead_id);

alter table public.lead_field_changes enable row level security;
drop policy if exists "lead_field_changes select" on public.lead_field_changes;
create policy "lead_field_changes select" on public.lead_field_changes
  for select using (
    public.is_super()
    or public.my_role() in ('general_manager','reception')
    or (public.my_role() = 'customer_service' and exists (
      select 1 from public.leads l where l.id = lead_field_changes.lead_id and l.assigned_to = public.my_admin_id()
    ))
  );
-- الإدراج بس من الـ Edge Function (service role) — مفيش سياسة insert للمستخدمين العاديين

-- تريجر تسجيل تعديل priority/booking_reference/do_not_contact/assigned_to تلقائياً
-- (current_status لوحده مغطى بالفعل بتريجر log_lead_status_change القديم)
create or replace function public.log_lead_field_changes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.priority is distinct from old.priority then
    insert into public.lead_field_changes (lead_id, changed_by, field_name, old_value, new_value)
    values (new.id, public.my_admin_id(), 'priority', old.priority, new.priority);
  end if;
  if new.booking_reference is distinct from old.booking_reference then
    insert into public.lead_field_changes (lead_id, changed_by, field_name, old_value, new_value)
    values (new.id, public.my_admin_id(), 'booking_reference', old.booking_reference, new.booking_reference);
  end if;
  if new.do_not_contact is distinct from old.do_not_contact then
    insert into public.lead_field_changes (lead_id, changed_by, field_name, old_value, new_value)
    values (new.id, public.my_admin_id(), 'do_not_contact', old.do_not_contact::text, new.do_not_contact::text);
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    insert into public.lead_field_changes (lead_id, changed_by, field_name, old_value, new_value)
    values (new.id, public.my_admin_id(), 'assigned_to', old.assigned_to::text, new.assigned_to::text);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_log_lead_field_changes on public.leads;
create trigger trg_log_lead_field_changes
  before update on public.leads
  for each row execute function public.log_lead_field_changes();

-- ---------- الحجز الفعلي: تفاصيل إضافية + نقل تلقائي لقائمة "الحجوزات الفعلية" ----------
-- (طلب المستخدم: لما الحالة توصل "booked" لازم تتسجل تفاصيل الحجز، والليد يظهر
-- في قائمة منفصلة "الحجوزات الفعلية"، وأرشيف الليدز يقدر يفلتر بمين أنهى الحجز)
alter table public.leads add column if not exists booking_date date;
alter table public.leads add column if not exists booked_by uuid references public.admins(id);

create or replace function public.stamp_lead_booking()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.current_status = 'booked' and (old.current_status is distinct from 'booked') then
    new.booked_by := coalesce(new.booked_by, public.my_admin_id());
    new.booking_date := coalesce(new.booking_date, current_date);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_stamp_lead_booking on public.leads;
create trigger trg_stamp_lead_booking
  before update on public.leads
  for each row execute function public.stamp_lead_booking();

create index if not exists leads_booked_by_idx on public.leads (booked_by);

-- ---------- فواتير الليدز اللي حجزت وأخدت خدمة فعلاً (طلب المستخدم: تحليل
-- الدخل الحقيقي القادم من الليدز لاحقاً) — الملف نفسه هيترفع Drive عبر
-- نفس أسلوب أرشيف المرضى (Service Account، مش رابط مباشر) ----------
create table if not exists public.lead_invoices (
  id             uuid primary key default gen_random_uuid(),
  lead_id        uuid not null references public.leads(id) on delete cascade,
  amount         numeric(12,2) not null,
  service_name   text,
  drive_file_id  text,
  file_name      text,
  uploaded_by    uuid references public.admins(id),
  uploaded_at    timestamptz not null default now(),
  notes          text
);
create index if not exists lead_invoices_lead_id_idx on public.lead_invoices (lead_id);

alter table public.lead_invoices enable row level security;
drop policy if exists "lead_invoices select" on public.lead_invoices;
create policy "lead_invoices select" on public.lead_invoices
  for select using (
    public.is_super()
    or public.my_role() in ('general_manager','reception')
    or (public.my_role() = 'customer_service' and exists (
      select 1 from public.leads l where l.id = lead_invoices.lead_id and l.assigned_to = public.my_admin_id()
    ))
  );
-- الإدراج بس من الـ Edge Function (service role) — بعد رفع الملف الفعلي على Drive بنجاح

-- ---------- فئتين جداد لملفات المريض: وصفة طبية (روشتة) + رسم مخ، وحقل وصف حر
-- لما الفئة تبقى "أخرى" (طلب المستخدم) ----------
alter table public.patient_files drop constraint if exists patient_files_category_check;
alter table public.patient_files add constraint patient_files_category_check
  check (category in ('id_document','insurance','radiology','lab_result','prescription','eeg','other'));
alter table public.patient_files add column if not exists other_description text;

-- ---------- دور جديد "تمريض" (طلب المستخدم) — بدون تاب افتراضي، زي الاستقبال/خدمة
-- العملاء بيتفعّل وصوله لأرشيف المرضى بس عن طريق has_archive_access من لوحة الأدمن ----------
alter table public.admins drop constraint if exists admins_role_check;
alter table public.admins add constraint admins_role_check
  check (role in ('page_manager','designer','approver','general_manager','super_admin','reception','customer_service','nursing'));

-- ---------- سجل المحاولات: نحفظ حالة الليد وقت المحاولة نفسها (طلب المستخدم:
-- "لازم نوضح الحالة هنا في السجل") — بتتسجل من leads-attempt Edge Function ----------
alter table public.lead_attempts add column if not exists status_at_attempt text;

-- ---------- تصحيح: changed_by/booked_by كانوا دايماً فاضيين لما التحديث بيحصل من
-- Edge Function (service role) — my_admin_id() بيعتمد على auth.uid() اللي مش موجود
-- في سياق service role. الحل: GUC محلي للترانزاكشن (app.caller_admin_id) بيتحدد من
-- leads-update-status عن طريق rpc_update_lead، و effective_admin_id() بيرجع له أول
-- ما يلاقيه قبل ما يرجع لـ my_admin_id() العادي (تفضل شغالة زي ما هي لأي تحديث مباشر
-- من عميل مسجّل دخول عادي) ----------
create or replace function public.effective_admin_id()
returns uuid language plpgsql stable as $$
declare
  v_setting text;
begin
  v_setting := nullif(current_setting('app.caller_admin_id', true), '');
  if v_setting is not null then
    return v_setting::uuid;
  end if;
  return public.my_admin_id();
end;
$$;

create or replace function public.log_lead_status_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.current_status is distinct from old.current_status then
    insert into public.lead_status_log (lead_id, changed_by, old_status, new_status)
    values (new.id, public.effective_admin_id(), old.current_status, new.current_status);
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.log_lead_field_changes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.priority is distinct from old.priority then
    insert into public.lead_field_changes (lead_id, changed_by, field_name, old_value, new_value)
    values (new.id, public.effective_admin_id(), 'priority', old.priority, new.priority);
  end if;
  if new.booking_reference is distinct from old.booking_reference then
    insert into public.lead_field_changes (lead_id, changed_by, field_name, old_value, new_value)
    values (new.id, public.effective_admin_id(), 'booking_reference', old.booking_reference, new.booking_reference);
  end if;
  if new.do_not_contact is distinct from old.do_not_contact then
    insert into public.lead_field_changes (lead_id, changed_by, field_name, old_value, new_value)
    values (new.id, public.effective_admin_id(), 'do_not_contact', old.do_not_contact::text, new.do_not_contact::text);
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    insert into public.lead_field_changes (lead_id, changed_by, field_name, old_value, new_value)
    values (new.id, public.effective_admin_id(), 'assigned_to', old.assigned_to::text, new.assigned_to::text);
  end if;
  return new;
end;
$$;

create or replace function public.stamp_lead_booking()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.current_status = 'booked' and (old.current_status is distinct from 'booked') then
    new.booked_by := coalesce(new.booked_by, public.effective_admin_id());
    new.booking_date := coalesce(new.booking_date, current_date);
  end if;
  return new;
end;
$$;

-- rpc_update_lead: نفس تحديثات leads-update-status Edge Function بالظبط، لكن جوّه
-- ترانزاكشن واحدة بتحدد app.caller_admin_id الأول عشان التريجرز فوق تعرف "مين" فعلياً
-- عمل التحديث حتى لو الاتصال بالكامل بـ service role (مفيش auth.uid() في السياق ده)
create or replace function public.rpc_update_lead(
  p_lead_id uuid,
  p_caller_id uuid,
  p_current_status text default null,
  p_booking_reference text default null,
  p_clear_booking_reference boolean default false,
  p_booking_date date default null,
  p_priority text default null,
  p_do_not_contact boolean default null,
  p_closed_at timestamptz default null,
  p_clear_closed_at boolean default false
) returns public.leads
language plpgsql security definer set search_path = public as $$
declare
  v_row public.leads;
begin
  perform set_config('app.caller_admin_id', p_caller_id::text, true);

  update public.leads set
    current_status    = coalesce(p_current_status, current_status),
    booking_reference  = case when p_clear_booking_reference then null
                              when p_booking_reference is not null then p_booking_reference
                              else booking_reference end,
    booking_date       = coalesce(p_booking_date, booking_date),
    priority            = coalesce(p_priority, priority),
    do_not_contact      = coalesce(p_do_not_contact, do_not_contact),
    closed_at            = case when p_clear_closed_at then null
                              when p_closed_at is not null then p_closed_at
                              else closed_at end
  where id = p_lead_id
  returning * into v_row;

  return v_row;
end;
$$;
revoke all on function public.rpc_update_lead from public;
grant execute on function public.rpc_update_lead to authenticated, service_role;

-- ============================================================
--  10) تعدد الأدوار لكل مستخدم (Multi-Role Support) — ٢٠٢٦-٠٨-١٨
-- ============================================================
-- طلب المستخدم: مستخدم واحد ممكن يبقى له أكتر من دور في نفس الوقت (مثلاً
-- خدمة عملاء + إدارة محتوى، أو خدمة عملاء + استقبال). القرار: admins.role
-- بيفضل "الرول الأساسي" (بيتحكم في التاب الافتراضي وبادچ الدور)، وأي أدوار
-- إضافية بتتسجل في جدول جديد admin_extra_roles. أي فحص صلاحية (RLS أو Edge
-- Function) لازم يستخدم has_role()/الأدوار مجتمعة بدل my_role() المباشرة.
create table if not exists public.admin_extra_roles (
  admin_id  uuid not null references public.admins(id) on delete cascade,
  role      text not null,
  added_at  timestamptz not null default now(),
  added_by  uuid references public.admins(id),
  primary key (admin_id, role)
);
alter table public.admin_extra_roles drop constraint if exists admin_extra_roles_role_check;
alter table public.admin_extra_roles add constraint admin_extra_roles_role_check
  check (role in ('page_manager','designer','approver','general_manager','super_admin','reception','customer_service','nursing'));
create index if not exists admin_extra_roles_admin_id_idx on public.admin_extra_roles (admin_id);

alter table public.admin_extra_roles enable row level security;
drop policy if exists "read own extra roles" on public.admin_extra_roles;
create policy "read own extra roles" on public.admin_extra_roles
  for select using (admin_id = public.my_admin_id() or public.is_super());
drop policy if exists "super manages extra roles" on public.admin_extra_roles;
create policy "super manages extra roles" on public.admin_extra_roles
  for all using (public.is_super()) with check (public.is_super());

-- has_role: true لو الرول ده هو الرول الأساسي للمستخدم الحالي أو من ضمن أدواره
-- الإضافية. الاستخدام من دلوقتي: استبدال "my_role() = 'x'" بـ "has_role('x')"،
-- و"my_role() in ('a','b')" بـ "(has_role('a') or has_role('b'))".
create or replace function public.has_role(p_role text)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.admins
    where user_id = auth.uid() and active and role = p_role
  ) or exists (
    select 1 from public.admin_extra_roles r
    join public.admins a on a.id = r.admin_id
    where a.user_id = auth.uid() and a.active and r.role = p_role
  );
$$;
revoke all on function public.has_role(text) from public;
grant execute on function public.has_role(text) to authenticated;

-- my_roles: كل أدوار المستخدم الحالي (الأساسي + الإضافية) كمصفوفة — الواجهة
-- بتجيبها مرة واحدة بعد الدخول بدل ما تفحص كل رول لوحده
create or replace function public.my_roles()
returns text[] language sql security definer stable set search_path = public as $$
  select coalesce(array_agg(distinct role), array[]::text[]) from (
    select role from public.admins where user_id = auth.uid() and active
    union
    select r.role from public.admin_extra_roles r
    join public.admins a on a.id = r.admin_id
    where a.user_id = auth.uid() and a.active
  ) x;
$$;
revoke all on function public.my_roles() from public;
grant execute on function public.my_roles() to authenticated;

-- has_role_for: نسخة بتاخد admin_id صريح — تُستخدم من Edge Functions (بمفتاح
-- service_role، مفيش auth.uid() في السياق بتاعها) للتحقق من أدوار أي موظف
create or replace function public.has_role_for(p_admin_id uuid, p_role text)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.admins where id = p_admin_id and role = p_role)
      or exists (select 1 from public.admin_extra_roles where admin_id = p_admin_id and role = p_role);
$$;
revoke all on function public.has_role_for(uuid, text) from public;
grant execute on function public.has_role_for(uuid, text) to authenticated, service_role;

-- ---------- إعادة تعريف الدوال المساعدة العامة عشان تحسب الأدوار الإضافية برضه ----------
create or replace function public.is_super()
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_role('super_admin');
$$;

create or replace function public.can_manage_all_content()
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_role('super_admin') or public.has_role('general_manager');
$$;

create or replace function public.has_archive_access()
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce((
    select has_archive_access from public.admins where user_id = auth.uid() and active limit 1
  ), false) or public.has_role('super_admin');
$$;

create or replace function public.can_access_leads()
returns boolean language sql security definer stable set search_path = public as $$
  select public.has_role('reception') or public.has_role('customer_service')
      or public.has_role('general_manager') or public.has_role('super_admin');
$$;

create or replace function public.has_archive_review_access()
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce((
    select has_archive_review_access from public.admins where user_id = auth.uid() and active limit 1
  ), false) or public.has_role('super_admin');
$$;

-- ---------- تحديث سياسات RLS القديمة اللي كانت بتفحص my_role() مباشرة عشان
-- تشتغل صح لو المستخدم عنده أكتر من رول ----------

drop policy if exists "page_manager inserts content" on public.content_items;
create policy "page_manager inserts content"
  on public.content_items for insert to authenticated
  with check (
    (public.has_role('page_manager') or public.has_role('general_manager') or public.has_role('super_admin'))
    and created_by = public.my_admin_id()
  );

drop policy if exists "approver writes metrics" on public.weekly_social_metrics;
create policy "approver writes metrics"
  on public.weekly_social_metrics for all to authenticated
  using (public.has_role('approver') or public.has_role('general_manager') or public.has_role('super_admin'))
  with check (public.has_role('approver') or public.has_role('general_manager') or public.has_role('super_admin'));

drop policy if exists "approver writes ad campaigns" on public.ad_campaigns;
create policy "approver writes ad campaigns"
  on public.ad_campaigns for all to authenticated
  using (public.has_role('approver') or public.has_role('general_manager') or public.has_role('super_admin'))
  with check (public.has_role('approver') or public.has_role('general_manager') or public.has_role('super_admin'));

drop policy if exists "leads select" on public.leads;
create policy "leads select" on public.leads
  for select using (
    public.is_super()
    or public.has_role('general_manager') or public.has_role('reception')
    or (public.has_role('customer_service') and assigned_to = public.my_admin_id())
  );

drop policy if exists "leads insert" on public.leads;
create policy "leads insert" on public.leads
  for insert with check (
    public.is_super() or public.has_role('reception') or public.has_role('customer_service') or public.has_role('general_manager')
  );

drop policy if exists "leads update" on public.leads;
create policy "leads update" on public.leads
  for update using (
    public.is_super()
    or public.has_role('general_manager')
    or (public.has_role('customer_service') and assigned_to = public.my_admin_id())
  );

drop policy if exists "lead_attempts select" on public.lead_attempts;
create policy "lead_attempts select" on public.lead_attempts
  for select using (
    public.is_super()
    or public.has_role('general_manager')
    or exists (
      select 1 from public.leads l
      where l.id = lead_attempts.lead_id
        and public.has_role('customer_service')
        and l.assigned_to = public.my_admin_id()
    )
  );

drop policy if exists "lead_attempts insert" on public.lead_attempts;
create policy "lead_attempts insert" on public.lead_attempts
  for insert with check (
    public.is_super()
    or public.has_role('general_manager')
    or exists (
      select 1 from public.leads l
      where l.id = lead_attempts.lead_id
        and public.has_role('customer_service')
        and l.assigned_to = public.my_admin_id()
    )
  );

drop policy if exists "lead_status_log select" on public.lead_status_log;
create policy "lead_status_log select" on public.lead_status_log
  for select using (
    public.is_super()
    or public.has_role('general_manager')
    or exists (
      select 1 from public.leads l
      where l.id = lead_status_log.lead_id
        and public.has_role('customer_service')
        and l.assigned_to = public.my_admin_id()
    )
  );

drop policy if exists "lead_feedback_tags select" on public.lead_feedback_tags;
create policy "lead_feedback_tags select" on public.lead_feedback_tags
  for select using (
    public.is_super()
    or public.has_role('general_manager')
    or exists (
      select 1 from public.leads l
      where l.id = coalesce(lead_feedback_tags.lead_id, (select lead_id from public.lead_attempts where id = lead_feedback_tags.attempt_id))
        and public.has_role('customer_service')
        and l.assigned_to = public.my_admin_id()
    )
  );

drop policy if exists "lead_feedback_tags insert" on public.lead_feedback_tags;
create policy "lead_feedback_tags insert" on public.lead_feedback_tags
  for insert with check (
    public.is_super()
    or public.has_role('general_manager') or public.has_role('customer_service')
  );

drop policy if exists "lead_field_changes select" on public.lead_field_changes;
create policy "lead_field_changes select" on public.lead_field_changes
  for select using (
    public.is_super()
    or public.has_role('general_manager') or public.has_role('reception')
    or (public.has_role('customer_service') and exists (
      select 1 from public.leads l where l.id = lead_field_changes.lead_id and l.assigned_to = public.my_admin_id()
    ))
  );

drop policy if exists "lead_invoices select" on public.lead_invoices;
create policy "lead_invoices select" on public.lead_invoices
  for select using (
    public.is_super()
    or public.has_role('general_manager') or public.has_role('reception')
    or (public.has_role('customer_service') and exists (
      select 1 from public.leads l where l.id = lead_invoices.lead_id and l.assigned_to = public.my_admin_id()
    ))
  );

-- ---------- guard_content_transition: بقى بيفحص "اتحاد" أدوار المستخدم بدل رول
-- واحد بس — أي دور من أدواره يسمح بالانتقال يخليه مسموح (نفس منطق كل رول
-- بالظبط زي ما كان، بس بقى ممكن يبقى عند المستخدم أكتر من واحد منهم) ----------
create or replace function public.guard_content_transition()
returns trigger language plpgsql security definer set search_path = public as $$
declare me uuid; allowed boolean := false;
begin
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

  if allowed then return new; end if;
  raise exception 'انتقال مرحلة غير مسموح لدورك الحالي';
end $$;

-- ============================================================
--  11) استكمال سير عمل الحجز: "تم الحجز على سيستم المركز" + "تم إجراء
--  الخدمة" + التحويل التلقائي لأرشيف المرضى + إحصائيات دخل الفواتير — ٢٠٢٦-٠٨-١٨
-- ============================================================
-- طلب المستخدم بالظبط: بعد ما خدمة العملاء تخلص تواصل وتقفل الليد بحالة
-- "تم الحجز" (booked — موجودة بالفعل)، الليد بيروح للاستقبال يكمّل الحجز
-- فعلياً على سيستم المركز → حالة جديدة "تم الحجز على سيستم المركز". وبعد ما
-- الخدمة تتم فعلياً، الاستقبال بيقفل بحالة "تم إجراء الخدمة" ويرفع فاتورة
-- المريض — رفع الفاتورة (Edge Function lead-invoice-upload) هو نفسه اللي
-- بيعمل التحويل التلقائي لأرشيف المرضى (مطابقة بالتليفون المُطبَّع، وإلا
-- إنشاء مريض جديد) عشان محدش يعمل الخطوتين يدوي وينسى واحدة فيهم.

alter table public.leads drop constraint if exists leads_current_status_check;
alter table public.leads add constraint leads_current_status_check
  check (current_status in
    ('new','in_progress','booked','booked_on_system','service_done',
     'interested_undecided','rejected','no_response','invalid_number'));

-- فئة جديدة لملفات المريض: فاتورة/إيصال خدمة (بتترفع تلقائياً هنا عند إقفال
-- الليد بـ"تم إجراء الخدمة" — بتظهر في ملف المريض زي أي مستند تاني)
alter table public.patient_files drop constraint if exists patient_files_category_check;
alter table public.patient_files add constraint patient_files_category_check
  check (category in ('id_document','insurance','radiology','lab_result','prescription','eeg','invoice','other'));

-- ربط فاتورة الليد بملف المريض المقابل لها بعد التحويل (لو اتحول) — مفيد
-- للتتبّع، مش شرط أساسي (ممكن يفضل null لو الرفع حصل قبل ما نضيف العمود ده)
alter table public.lead_invoices add column if not exists patient_file_id uuid references public.patient_files(id);

create index if not exists lead_invoices_uploaded_by_idx on public.lead_invoices (uploaded_by);

-- ============================================================
--  13) دور "طبيب سونو" — معاينة أرشيف المرضى فقط (٢٠٢٦-٠٨-٢٢)
-- ============================================================
-- طلب المستخدم: دور جديد بيتبعتله ملفات المرضى من الأرشيف يتصفحها بس —
-- من غير رفع/حذف/مراجعة. القرار المعماري: نفس نمط `has_archive_access`/
-- `has_archive_review_access` الموجودين بالفعل (صلاحية منفصلة عن الرول)،
-- عشان أي مستخدم (مهما كان روله الأساسي) يقدر ياخد "معاينة فقط" لو احتاج.
-- الرول `sono_doctor` نفسه بس تسمية/بادچ في الواجهة — التحكم الفعلي في
-- الوصول عن طريق العمود `has_archive_view_only` (زي `has_archive_access`
-- بالظبط)، وده اللي بيتفحص في RLS والـ Edge Functions.

alter table public.admins drop constraint if exists admins_role_check;
alter table public.admins add constraint admins_role_check
  check (role in ('page_manager','designer','approver','general_manager','super_admin','reception','customer_service','nursing','sono_doctor'));

alter table public.admin_extra_roles drop constraint if exists admin_extra_roles_role_check;
alter table public.admin_extra_roles add constraint admin_extra_roles_role_check
  check (role in ('page_manager','designer','approver','general_manager','super_admin','reception','customer_service','nursing','sono_doctor'));

alter table public.admins add column if not exists has_archive_view_only boolean not null default false;

create or replace function public.has_archive_view_only()
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce((
    select has_archive_view_only from public.admins where user_id = auth.uid() and active limit 1
  ), false) or public.has_role('super_admin');
$$;
revoke all on function public.has_archive_view_only() from public;
grant execute on function public.has_archive_view_only() to authenticated;

-- توسعة سياسات القراءة (بس) عشان صاحب "معاينة فقط" يشوف المرضى/الملفات/اللوج
-- — بدون أي صلاحية رفع/حذف/مراجعة (سياسات الكتابة فضلت زي ما هي بالظبط،
-- مربوطة بـ has_archive_access()/has_archive_review_access() لوحدهم)
drop policy if exists "archive or leads read patients" on public.patients;
create policy "archive or leads read patients" on public.patients
  for select using (public.has_archive_access() or public.has_archive_review_access() or public.has_archive_view_only() or public.can_access_leads());

drop policy if exists "archive access reads files" on public.patient_files;
create policy "archive access reads files" on public.patient_files
  for select using (public.has_archive_access() or public.has_archive_review_access() or public.has_archive_view_only());

drop policy if exists "archive access reads log" on public.archive_access_log;
create policy "archive access reads log" on public.archive_access_log
  for select using (public.has_archive_access() or public.has_archive_review_access() or public.has_archive_view_only());

-- ============================================================
--  15) إحالة مرضى لـ"طبيب سونو" — يشوف بس المحالين ليه، مش الأرشيف كله (٢٠٢٦-٠٨-٢٣)
-- ============================================================
-- تعديل على قرار القسم ١٣: "معاينة فقط" كانت بتدّي وصول لكل الأرشيف، والمستخدم
-- طلب تضييقها — الدكتور يشوف بس الحالات اللي التمريض حوّلها له، ولما يخلص
-- الكشف يعمل "تم الكشف" فتختفي من عنده. التمريض (أو أي حد عنده has_archive_access)
-- هو اللي بيحوّل.

create table if not exists public.patient_doctor_assignments (
  id            uuid primary key default gen_random_uuid(),
  patient_id    uuid not null references public.patients(id) on delete cascade,
  doctor_id     uuid not null references public.admins(id),
  assigned_by   uuid references public.admins(id),
  assigned_at   timestamptz not null default now(),
  status        text not null default 'pending' check (status in ('pending','done')),
  completed_at  timestamptz
);
create index if not exists pda_doctor_pending_idx on public.patient_doctor_assignments (doctor_id, status);
create index if not exists pda_patient_idx on public.patient_doctor_assignments (patient_id);

alter table public.patient_doctor_assignments enable row level security;

drop policy if exists "pda select"  on public.patient_doctor_assignments;
drop policy if exists "pda insert"  on public.patient_doctor_assignments;
drop policy if exists "pda update"  on public.patient_doctor_assignments;
drop policy if exists "pda delete"  on public.patient_doctor_assignments;

create policy "pda select" on public.patient_doctor_assignments
  for select using (
    doctor_id = public.my_admin_id()
    or public.has_archive_access() or public.has_archive_review_access()
    or public.my_role() = 'nursing' or public.can_manage_all_content()
  );

-- ملحوظة (٢٠٢٦-٠٨-٢٣): الـ exists الأصلية هنا كانت بتقرا من admins مباشرة، لكن
-- RLS الأساسية لجدول admins بتدّي كل مستخدم صفه بس — فالـ subquery ده كان بيرجع
-- false دايماً لأي حد مش super_admin (حتى لو مؤهل)، فكانت "تحويل لطبيب سونو"
-- بتفشل بـ RLS error لكل التمريض/الأرشيف. الحل: دالة SECURITY DEFINER بتتخطى
-- RLS بتاعة admins عمداً وبأمان للفحص الضيق ده بس (نفس نمط my_role()/has_archive_access()).
create or replace function public.is_active_sono_doctor(p_doctor_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.admins d
    where d.id = p_doctor_id and d.has_archive_view_only and d.active
  );
$$;
revoke all on function public.is_active_sono_doctor(uuid) from public;
grant execute on function public.is_active_sono_doctor(uuid) to authenticated;

create policy "pda insert" on public.patient_doctor_assignments
  for insert with check (
    (public.my_role() = 'nursing' or public.has_archive_access() or public.can_manage_all_content())
    and assigned_by = public.my_admin_id()
    and public.is_active_sono_doctor(doctor_id)
  );

create policy "pda update" on public.patient_doctor_assignments
  for update
  using (doctor_id = public.my_admin_id() or public.has_archive_access() or public.can_manage_all_content())
  with check (doctor_id = public.my_admin_id() or public.has_archive_access() or public.can_manage_all_content());

create policy "pda delete" on public.patient_doctor_assignments
  for delete using (public.has_archive_access() or public.can_manage_all_content());

-- بيتفحص من RLS مباشرة (تصفح المريض المحال في شاشة الدكتور) ومن الـ Edge Functions
-- (اللي بتستخدم service role وبتفحص الصلاحية بنفسها يدوياً، مش عن طريق RLS)
create or replace function public.is_assigned_doctor_for_patient(p_patient_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.patient_doctor_assignments
    where patient_id = p_patient_id and doctor_id = public.my_admin_id() and status = 'pending'
  );
$$;
revoke all on function public.is_assigned_doctor_for_patient(uuid) from public;
grant execute on function public.is_assigned_doctor_for_patient(uuid) to authenticated;

-- قايمة "طبيب سونو" النشطين — عشان شاشة الإحالة تعرض الأسماء من غير ما نفتح
-- جدول admins كله لكل الموظفين (RLS الأساسية بتديك صفك إنت بس أو لو سوبر أدمن)
create or replace function public.list_active_sono_doctors()
returns table(id uuid, name text, email text)
language sql security definer stable set search_path = public as $$
  select id, name, email from public.admins where has_archive_view_only and active order by name;
$$;
revoke all on function public.list_active_sono_doctors() from public;
grant execute on function public.list_active_sono_doctors() to authenticated;

-- تضييق سياسات القراءة على patients/patient_files: بدل "معاينة فقط" تدّي وصول
-- لكل الأرشيف، بقت تدّي وصول بس للمريض اللي فيه إحالة pending للدكتور ده تحديداً
drop policy if exists "archive or leads read patients" on public.patients;
create policy "archive or leads read patients" on public.patients
  for select using (
    public.has_archive_access() or public.has_archive_review_access() or public.can_access_leads()
    or public.is_assigned_doctor_for_patient(id)
  );

drop policy if exists "archive access reads files" on public.patient_files;
create policy "archive access reads files" on public.patient_files
  for select using (
    public.has_archive_access() or public.has_archive_review_access()
    or public.is_assigned_doctor_for_patient(patient_id)
  );

-- سجل الوصول (archive_access_log) رجع لصلاحيتي الأرشيف الكاملتين بس — مش محتاج
-- الدكتور المحال له يشوفه
drop policy if exists "archive access reads log" on public.archive_access_log;
create policy "archive access reads log" on public.archive_access_log
  for select using (public.has_archive_access() or public.has_archive_review_access());

-- ============================================================
--  16) أعمدة إضافية على ملف المريض — العمر/النوع/تاريخ الزيارة/الرقم
--      الطبي (٢٠٢٦-٠٨-٢٣، v26 — مرحلة ١ من طلب تعديلات الفريق)
-- ============================================================
alter table public.patients
  add column if not exists gender text check (gender in ('male', 'female')),
  add column if not exists age int,
  add column if not exists medical_record_no text,
  add column if not exists last_visit_date date;

-- ============================================================
--  17) تقسيم ملف المريض: بيانات طبية (منفصلة عن البيانات الشخصية)
--      (٢٠٢٦-٠٨-٢٣، v27 — مرحلة ٢ من طلب تعديلات الفريق)
-- ============================================================
-- مبني على ٤ نماذج فايلنج ورقية بعتها المستخدم (كبار/اطفال/تجميل/كماوي):
-- كل نموذج فيه (أ) بيانات ثابتة عن حالة المريض الطبية (طبيب معالج/تخصص/
-- علامات حيوية حالية/أمراض مزمنة/عمليات جراحية/تاريخ مرضي بالعائلة) —
-- وده اللي بنخزنه في patient_medical_profile (صف واحد لكل مريض، بيتحدّث)،
-- و(ب) سجل زيارات متكرر (تاريخ/شكوى/خطة علاجية) — وده patient_visits
-- (صف لكل زيارة). القوائم المتغيرة (أمراض مزمنة/عمليات/تاريخ عائلي)
-- اتخزنت jsonb بدل أعمدة منفصلة لكل حالة — عشان تختلف حسب التخصص
-- (كبار/اطفال/تجميل/كماوي) من غير ما نحتاج تعديل SQL في كل مرة.

create table if not exists public.patient_medical_profile (
  patient_id        uuid primary key references public.patients(id) on delete cascade,
  treating_doctor   text,
  specialty         text,
  blood_pressure    text,
  blood_sugar       text,
  weight            text,
  pulse             text,
  oxygen_percent    text,
  chronic_conditions jsonb not null default '[]'::jsonb, -- [{name,has,medication}]
  surgeries         jsonb not null default '[]'::jsonb,  -- [{name,has,notes}]
  family_history    jsonb not null default '[]'::jsonb,  -- [{disease,has}]
  updated_by        uuid references public.admins(id),
  updated_at        timestamptz not null default now()
);

create table if not exists public.patient_visits (
  id                  uuid primary key default gen_random_uuid(),
  patient_id          uuid not null references public.patients(id) on delete cascade,
  visit_number        text,
  visit_date          date not null default current_date,
  complaint           text,
  medications         text,
  xrays               text,
  labs                text,
  other_recommendations text,
  follow_up_date      date,
  blood_pressure      text,
  blood_sugar         text,
  pulse               text,
  created_by          uuid references public.admins(id),
  created_at          timestamptz not null default now()
);
create index if not exists patient_visits_patient_idx on public.patient_visits (patient_id, visit_date desc);

alter table public.patient_medical_profile enable row level security;
alter table public.patient_visits enable row level security;

-- قراءة: نفس دائرة قراءة patients (أرشيف/مراجعة/leads/الدكتور المحال له) —
-- الدكتور محتاج يشوف البيانات الطبية أصلاً (ده الهدف من الإحالة)
drop policy if exists "medical profile read" on public.patient_medical_profile;
create policy "medical profile read" on public.patient_medical_profile
  for select using (
    public.has_archive_access() or public.has_archive_review_access() or public.can_access_leads()
    or public.is_assigned_doctor_for_patient(patient_id)
  );

drop policy if exists "visits read" on public.patient_visits;
create policy "visits read" on public.patient_visits
  for select using (
    public.has_archive_access() or public.has_archive_review_access() or public.can_access_leads()
    or public.is_assigned_doctor_for_patient(patient_id)
  );

-- كتابة: أرشيف/سوبر أدمن بس — الدكتور "معاينة فقط" (قرار مرحلة ٥ الجاية،
-- بس هنا بنأكد من الأول إنه مايقدرش يعدّل حتى لو اتنسي تقييد في الواجهة)
drop policy if exists "medical profile write" on public.patient_medical_profile;
create policy "medical profile write" on public.patient_medical_profile
  for insert with check (public.has_archive_access() or public.can_manage_all_content());
drop policy if exists "medical profile update" on public.patient_medical_profile;
create policy "medical profile update" on public.patient_medical_profile
  for update using (public.has_archive_access() or public.can_manage_all_content());

drop policy if exists "visits write" on public.patient_visits;
create policy "visits write" on public.patient_visits
  for insert with check (public.has_archive_access() or public.can_manage_all_content());
drop policy if exists "visits update" on public.patient_visits;
create policy "visits update" on public.patient_visits
  for update using (public.has_archive_access() or public.can_manage_all_content());
drop policy if exists "visits delete" on public.patient_visits;
create policy "visits delete" on public.patient_visits
  for delete using (public.has_archive_access() or public.can_manage_all_content());

-- ============================================================
--  18) شاشة الاستقبال: صندوق "ملف جديد" (تعديل/رفع/إرسال للتمريض/حذف)
--      (٢٠٢٦-٠٨-٢٣، v28 — مرحلة ٣ من طلب تعديلات الفريق)
-- ============================================================
-- عمود بسيط لتتبّع "اتبعت للتمريض" — مفيش جدول workflow منفصل، الهدف بس
-- إن الاستقبال يقدر يعلّم إن الملف جاهز وبيتنقل لمرحلة التمريض (اللي بعد
-- كده بتحوّل المريض لطبيب سونو زي ما هو موجود بالفعل في قسم ١٥).
alter table public.patients
  add column if not exists sent_to_nursing_at timestamptz;

-- حذف المريض: بس لأصحاب أرشيف كامل/سوبر أدمن (نفس دائرة الكتابة/التعديل) —
-- patient_files/patient_medical_profile/patient_visits/patient_doctor_assignments
-- كلهم on delete cascade، فبيتشالوا تلقائي. leads.patient_id من غير cascade
-- عمداً (قرار تصميم أصلي) — يعني لو فيه ليدز مرتبطة، الحذف هيفشل بخطأ FK
-- والواجهة لازم تعرض رسالة واضحة بدل ما تفشل صامتة.
drop policy if exists "archive or leads delete patients" on public.patients;
create policy "archive or leads delete patients" on public.patients
  for delete using (public.has_archive_access() or public.can_manage_all_content());

-- ============================================================
--  19) تصنيفات رفع المستندات: علاج طبيعي + تقرير طبي
--      (٢٠٢٦-٠٨-٢٣، v29 — مرحلة ٤ من طلب تعديلات الفريق)
-- ============================================================
-- إضافة تصنيفين جديدين لملفات المرضى المرفوعة (طلب الفريق: تحاليل/أشعة/
-- روشتة موجودين بالفعل بأسماء مختلفة قليلاً lab_result/radiology/
-- prescription — العلاج الطبيعي والتقرير الطبي مكانوش موجودين فاتضافوا).
alter table public.patient_files drop constraint if exists patient_files_category_check;
alter table public.patient_files add constraint patient_files_category_check
  check (category in ('id_document','insurance','radiology','lab_result','prescription','physical_therapy','medical_report','eeg','invoice','other'));

-- ============================================================
--  20) توسيع قائمة "الخدمة" باهتمامات الليدز
--      (٢٠٢٦-٠٨-٢٣، v31 — مرحلة ٦ من طلب تعديلات الفريق)
-- ============================================================
-- طلب الفريق (سكرين شوتس واتساب): كشف/أشعة/معمل/علاج طبيعي/أسنان/تخاطب/
-- نفسية/ليزر تجميل/تمريض تحويل/طوارئ. بمراجعة SERVICE_LABELS الحالية في
-- render-leads.js: كشف/أشعة/تمريض/علاج طبيعي موجودين بالفعل، و"معمل"
-- اتعتبر مرادف لـ "تحاليل" (lab) الموجودة أصلاً فما اتضافش تكرار. اتضافت
-- الخدمات الناقصة الواضحة بس: أسنان/تخاطب/نفسية/ليزر تجميل/طوارئ.
alter table public.leads drop constraint if exists leads_interested_service_check;
alter table public.leads add constraint leads_interested_service_check
  check (interested_service in ('checkup','consultation','radiology','lab','nursing','physiotherapy','treatment','dental','speech_therapy','psychiatry','cosmetic_laser','emergency','other'));

-- ============================================================
--  21) داشبورد الإدارة: فلتر تاريخ + دخل حسب القسم + تصنيف عضوي/إعلان
--      (٢٠٢٦-٠٨-٢٣، v32 — مرحلة ٧ من طلب تعديلات الفريق)
-- ============================================================
-- عمود جديد لتصنيف مصدر اهتمام الليد: عضوي (وصل من نفسه) مقابل إعلان
-- مدفوع — مختلف عن "source" (قناة التواصل واتساب/ماسنجر) الموجودة أصلاً.
-- اختياري (nullable) عشان الليدز القديمة تفضل شغالة من غير قيمة.
alter table public.leads
  add column if not exists acquisition_type text;
alter table public.leads drop constraint if exists leads_acquisition_type_check;
alter table public.leads add constraint leads_acquisition_type_check
  check (acquisition_type is null or acquisition_type in ('organic','ad'));

-- ملحوظة: "الدخل حسب القسم" في الداشبورد بيتجمّع من عمود requested_department
-- الموجود بالفعل على leads (مفيش عمود جديد لازم له) عن طريق join مع
-- lead_invoices — نفس نمط "الدخل حسب الموظف" (booked_by) الموجود أصلاً.
-- فلتر التاريخ (from/to) بيتطبّق على uploaded_at للفواتير (للدخل) وعلى
-- created_at لليدز (لتوزيع الحالة وتصنيف عضوي/إعلان) — أما إجماليات
-- "مفتوحة/مغلقة/تم الحجز" فبتفضل الحالة اللحظية دايماً (مش متأثرة
-- بالفلتر) لأنها بتعبّر عن الوضع الحالي مش سجل تاريخي.

-- ============================================================
--  14) أول سوبر أدمن
-- ============================================================
-- قسم ٢٠: list_admins_basic() — أسماء كل الموظفين النشطين (id/name/role/active)
-- بدون بيانات حساسة (إيميل/user_id)، عشان شاشات النشر/الإدارة/الأرشيف/الكومنتات
-- تقدر تعرض "بواسطة"/اسم صاحب الكومنت/المصمم المسؤول لأي مستخدم مش بس السوبر
-- أدمن — RLS الأصلية على admins ("read own or pending") كانت بتخلي listAdmins()
-- المباشرة ترجع صف المستخدم نفسه بس لأي حد غير سوبر أدمن، فالأسماء كانت بتظهر
-- "—"/"مستخدم محذوف" لأي حد تاني غير سوبر أدمن.
create or replace function public.list_admins_basic()
returns table(id uuid, name text, role text, active boolean)
language sql security definer stable set search_path = public as $$
  select id, name, role, active from public.admins order by name;
$$;
revoke all on function public.list_admins_basic() from public;
grant execute on function public.list_admins_basic() to authenticated;

-- ============================================================
-- قسم ٢١: عملاء ناقصين بيانات (بعد رفع إكسيل فيه اسم أو تليفون ناقص) +
-- أرشيف تراكمي لتقارير الإعلانات المدفوعة (بدل الاستبدال الكامل كل استيراد)
-- ============================================================

-- عميل "ناقص بيانات": صف leads عادي بحالة جديدة current_status='missing_data'
-- (بدل ما يتجاهل تماماً زي ما كان قبل كده) — لحد ما موظف يكمل الاسم/التليفون
-- الناقص ويحوّله لحالة 'new' العادية. missing_data_completed_at بيتسجل وقت
-- الإكمال ده عشان نقدر نحسب "تم استكمال البيانات" حتى بعد ما الحالة تتغيّر.
alter table public.leads drop constraint if exists leads_current_status_check;
alter table public.leads add constraint leads_current_status_check
  check (current_status in
    ('new','in_progress','booked','booked_on_system','service_done',
     'interested_undecided','rejected','no_response','invalid_number','missing_data'));

alter table public.leads add column if not exists missing_data_completed_at timestamptz;

-- تقارير الإعلانات المدفوعة بقت أرشيف تراكمي: كل استيراد بيتحط في دفعة
-- (report_batch_id) منفصلة بدل ما يمسح القديم — عشان يبقى فيه أرشيف/مقارنة/
-- إجماليات بين التقارير المختلفة عبر الوقت.
alter table public.ad_campaigns add column if not exists report_batch_id uuid;
create index if not exists ad_campaigns_batch_idx on public.ad_campaigns (report_batch_id);

-- ============================================================
-- قسم ٢٢: مصادر ليدز إضافية (تليفون/عيادة) + صلاحية حذف الليدز
-- ============================================================

-- طلب الفريق: إضافة "تليفون" و"عيادة" كمصدر استلام ليد، بجانب واتساب/ماسنجر
-- الموجودين أصلاً.
alter table public.leads drop constraint if exists leads_source_check;
alter table public.leads add constraint leads_source_check
  check (source in ('whatsapp','messenger','phone','clinic'));

-- صلاحية حذف الليدز: مقصورة على السوبر أدمن دايماً، أو أي مستخدم تاني
-- السوبر أدمن يفعّلها له صراحة (نفس نمط has_archive_access — صلاحية منفصلة
-- عن الرول الأساسي، تتفعّل من تشيك بوكس في لوحة "المستخدمون والصلاحيات").
alter table public.admins add column if not exists can_delete_leads boolean not null default false;

create or replace function public.can_delete_leads()
returns boolean
language sql security definer stable set search_path = public as $$
  select public.is_super() or coalesce(
    (select can_delete_leads from public.admins where user_id = auth.uid() and active limit 1),
    false
  );
$$;
revoke all on function public.can_delete_leads() from public;
grant execute on function public.can_delete_leads() to authenticated;

drop policy if exists "leads delete" on public.leads;
create policy "leads delete" on public.leads
  for delete using (public.can_delete_leads());

-- ============================================================
--  ٢٣) تحويل مريض لطبيب آخر من داخل سجل الزيارة → بيتحوّل لـ"ليد" جديد
--      (٢٠٢٦-٠٨-٣٠)
-- ============================================================
-- چيكبوكس "محوّل لطبيب آخر" + اسم الطبيب داخل فورم الزيارة نفسها (كل
-- زيارة زيارة، ممكن يتكرر لنفس المريض في زيارات مختلفة)
alter table public.patient_visits add column if not exists referred_to_other_doctor boolean not null default false;
alter table public.patient_visits add column if not exists referred_doctor_name text;

-- مصدر ليد جديد: تحويل من طبيب العيادة (بيظهر كبادچ/فلتر باسمه في شاشة الليدز)
alter table public.leads drop constraint if exists leads_source_check;
alter table public.leads add constraint leads_source_check
  check (source in ('whatsapp','messenger','phone','clinic','doctor_referral'));

-- دالة SECURITY DEFINER: بتعمل ليد جديد من بيانات المريض لما الطبيب يحوّله —
-- لازم SECURITY DEFINER عشان مين بيعدّل الزيارات (تمريض/أرشيف) مش بالضرورة
-- عنده صلاحية "leads insert" الأساسية (مقصورة على استقبال/خدمة عملاء/مدير)
create or replace function public.create_doctor_referral_lead(p_patient_id uuid, p_doctor_name text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_patient record;
  v_lead_id uuid;
begin
  if not (public.has_archive_access() or public.can_manage_all_content()) then
    raise exception 'غير مصرح';
  end if;

  select full_name, phone, phone_normalized into v_patient
  from public.patients where id = p_patient_id;

  if v_patient is null then
    raise exception 'المريض غير موجود';
  end if;

  insert into public.leads (customer_name, phone_raw, phone_normalized, source, message_text, patient_id, patient_type, received_by)
  values (
    v_patient.full_name, v_patient.phone, v_patient.phone_normalized, 'doctor_referral',
    'محوّل من د. ' || coalesce(nullif(trim(p_doctor_name), ''), '—'),
    p_patient_id, 'existing', public.my_admin_id()
  )
  returning id into v_lead_id;

  return v_lead_id;
end;
$$;
revoke all on function public.create_doctor_referral_lead(uuid, text) from public;
grant execute on function public.create_doctor_referral_lead(uuid, text) to authenticated;

-- ============================================================
--  ٢٤) تخصص/قسم طبي لكل مادة محتوى (٢٠٢٦-٠٨-٣٠)
-- ============================================================
-- عمود اختياري بس — لتصنيف المحتوى حسب القسم الطبي وعرض إحصائيات الداشبورد
-- بالتخصص. مفيش check constraint هنا عمداً (القائمة معرّفة في الفرونت‌إند
-- workflow.js → SPECIALTIES بس، زي ما البراند مقيّد في الواجهة مش في القاعدة).
alter table public.content_items add column if not exists specialty text;

-- ============================================================
--  ٢٥) تاريخ إصدار المستند (يُدخل عند رفع الملف) (٢٠٢٦-٠٨-٣٠)
-- ============================================================
-- تاريخ إصدار المستند الفعلي (مختلف عن uploaded_at اللي هو وقت رفع الملف
-- على النظام) — اختياري، بيتسجل من الموظف وقت الرفع لو متاح، ومستخدم في
-- طباعة بروفايل المريض لعرض تاريخ كل مستند.
alter table public.patient_files add column if not exists issued_at date;

-- ============================================================
--  ٢٦) تقرير الاستخدام: سجل جلسات الدخول + سجل الأنشطة المهمة (٢٠٢٦-٠٨-٣٠)
-- ============================================================
-- جلسة استخدام واحدة = من فتح/تحميل الداشبورد (bootAfterAuth في app.js)
-- لحد الخروج الصريح (زرار خروج) أو آخر "نبضة" (heartbeat كل دقيقتين) لو
-- المستخدم قفل التاب من غير ما يعمل خروج — عشان كده last_seen_at منفصل عن
-- logout_at، والمدة بتتحسب في الواجهة: logout_at لو موجود، وإلا last_seen_at.
create table if not exists public.login_sessions (
  id           uuid primary key default gen_random_uuid(),
  admin_id     uuid not null references public.admins(id) on delete cascade,
  login_at     timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  logout_at    timestamptz
);
create index if not exists login_sessions_admin_idx on public.login_sessions (admin_id);
create index if not exists login_sessions_login_idx on public.login_sessions (login_at desc);

alter table public.login_sessions enable row level security;
drop policy if exists "own insert session" on public.login_sessions;
drop policy if exists "own update session" on public.login_sessions;
drop policy if exists "super reads sessions" on public.login_sessions;

create policy "own insert session"
  on public.login_sessions for insert to authenticated
  with check (admin_id = public.my_admin_id());

create policy "own update session"
  on public.login_sessions for update to authenticated
  using (admin_id = public.my_admin_id())
  with check (admin_id = public.my_admin_id());

create policy "super reads sessions"
  on public.login_sessions for select to authenticated
  using (public.is_super() or public.can_manage_all_content());

-- سجل الأنشطة المهمة: كل عملية "رفع/إنشاء" ليها اسم تقرير/ملف واضح —
-- استيراد مؤشرات أسبوعية، تقرير حملات إعلانات، رفع تصميم، إنشاء مادة
-- محتوى، رفع مستند مريض، رفع إكسيل ليدز جماعي، رفع فاتورة حجز.
create table if not exists public.usage_activity_log (
  id           uuid primary key default gen_random_uuid(),
  admin_id     uuid not null references public.admins(id) on delete cascade,
  action_type  text not null,
  report_name  text,
  created_at   timestamptz not null default now()
);
create index if not exists usage_activity_admin_idx on public.usage_activity_log (admin_id);
create index if not exists usage_activity_created_idx on public.usage_activity_log (created_at desc);

alter table public.usage_activity_log enable row level security;
drop policy if exists "own insert activity" on public.usage_activity_log;
drop policy if exists "super reads activity" on public.usage_activity_log;

create policy "own insert activity"
  on public.usage_activity_log for insert to authenticated
  with check (admin_id = public.my_admin_id());

create policy "super reads activity"
  on public.usage_activity_log for select to authenticated
  using (public.is_super() or public.can_manage_all_content());

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

-- ============================================================
-- إضافة: قائمة المصممين تشمل الرول الإضافي + إعدادات SLA قابلة للتعديل
-- (٢٠٢٦-٠٨-٣١)
-- ============================================================

-- list_designers_all(): id/name لكل موظف نشط عنده رول "designer" أساسي
-- أو إضافي — بديل لفلترة admins.role='designer' المباشرة اللي كانت بتفوت
-- المصمم لو الرول ده إضافي مش أساسي (فجوة معروفة موثّقة من دفعة تعدد
-- الأدوار v19).
create or replace function public.list_designers_all()
returns table(id uuid, name text)
language sql security definer stable set search_path = public as $$
  select distinct a.id, a.name
  from public.admins a
  left join public.admin_extra_roles e on e.admin_id = a.id
  where a.active = true and (a.role = 'designer' or e.role = 'designer')
  order by a.name;
$$;
revoke all on function public.list_designers_all() from public;
grant execute on function public.list_designers_all() to authenticated;

-- app_settings: صف واحد بس (id=1) لإعدادات عامة قابلة للتعديل من لوحة
-- الأدمن — حالياً حدود SLA للتنبيهات (مواد اعتماد متأخرة / ليدز من غير
-- رد) بدل ما تكون أرقام ثابتة في كود الواجهة.
create table if not exists public.app_settings (
  id int primary key default 1,
  content_sla_hours int not null default 48,
  leads_sla_hours int not null default 24,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.admins(id)
);
insert into public.app_settings (id) values (1) on conflict (id) do nothing;
alter table public.app_settings enable row level security;
drop policy if exists "app_settings read" on public.app_settings;
create policy "app_settings read" on public.app_settings for select
  using (public.my_admin_id() is not null);
drop policy if exists "app_settings write" on public.app_settings;
create policy "app_settings write" on public.app_settings for update
  using (public.is_super() or public.can_manage_all_content())
  with check (public.is_super() or public.can_manage_all_content());

-- ============================================================
-- إضافة: مركز إشعارات للأدمن/الإدارة (بجانب اسم المستخدم في الهيدر)
-- (٢٠٢٦-٠٨-٣١)
-- ============================================================
-- بيعيد استخدام activity_log (أحداث المحتوى) وusage_activity_log
-- (رفع مستندات/ملفات) الموجودين بالفعل — مفيش تسجيل أحداث جديد، بس
-- جدول صغير لتخزين "آخر وقت اطّلاع" لكل مستخدم عشان نحسب منه إيه اللي
-- جديد (نفس نمط comment_reads بالظبط).
create table if not exists public.notification_reads (
  admin_id     uuid primary key references public.admins(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);
alter table public.notification_reads enable row level security;
drop policy if exists "own notification reads" on public.notification_reads;
create policy "own notification reads" on public.notification_reads
  for all to authenticated
  using (admin_id = public.my_admin_id())
  with check (admin_id = public.my_admin_id());

-- تعديل: دورية "مسح" الإشعارات (فعلياً: حد عرض) قابلة لكل مستخدم يحددها
-- بنفسه — إما بالعدد أو بعدد الأيام (٢٠٢٦-٠٨-٣١)
alter table public.notification_reads
  add column if not exists clear_mode  text not null default 'count',
  add column if not exists clear_value int  not null default 50;
alter table public.notification_reads drop constraint if exists notification_reads_clear_mode_check;
alter table public.notification_reads
  add constraint notification_reads_clear_mode_check check (clear_mode in ('count', 'days'));

-- ============================================================
-- إضافة: لوحة شكر (Kudos) — تقدير علني لإنجاز موظف، ظاهرة لايف لكل الناس
-- (٢٠٢٦-٠٩-٠١)
-- ============================================================
-- الإرسال مقصور على المدير العام/السوبر أدمن. القراءة متاحة لأي مستخدم
-- مسجّل دخول (اللوحة المفروض تبان للكل). التحديث عن طريق Realtime
-- الموجود بالفعل (subscribeTable) — مفيش داعي لجدول قراءة/تتبع منفصل.
create table if not exists public.kudos (
  id         uuid primary key default gen_random_uuid(),
  given_by   uuid not null references public.admins(id) on delete cascade,
  given_to   uuid not null references public.admins(id) on delete cascade,
  message    text not null,
  created_at timestamptz not null default now()
);
alter table public.kudos enable row level security;
drop policy if exists "kudos read" on public.kudos;
create policy "kudos read" on public.kudos for select
  using (public.my_admin_id() is not null);
drop policy if exists "kudos insert" on public.kudos;
create policy "kudos insert" on public.kudos for insert to authenticated
  with check (
    given_by = public.my_admin_id()
    and public.can_manage_all_content()
  );

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname='public' and tablename='kudos'
  ) then
    alter publication supabase_realtime add table public.kudos;
  end if;
end $$;

-- ============================================================
--  22) تقارير مُنشأة من داخل الداشبورد: تقرير طبي + Echocardiography
--      (٢٠٢٦-٠٩-٠١)
-- ============================================================
-- طلب الفريق: بدل ما يطبعوا التقرير الطبي يدوي على الوورد ويرفعوه سكان،
-- عايزين يكتبوا التفاصيل جوه الداشبورد ويطلعلهم فورم قابل للطباعة بنفس
-- شكل الفورم الرسمي بتاعهم (هيدر/فوتر عيادات سونو). جدولين منفصلين لأن
-- شكل كل تقرير مختلف تمامًا عن التاني (تقرير طبي = نص حر، Echo = جدول
-- قياسات + ملخص + خلاصة).

create table if not exists public.patient_medical_reports (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references public.patients(id) on delete cascade,
  report_date date not null default current_date,
  body_text   text not null default '',
  doctor_name text not null default 'د.دينا حسني',
  created_by  uuid references public.admins(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists patient_medical_reports_patient_idx
  on public.patient_medical_reports (patient_id, report_date desc);

create table if not exists public.patient_echo_reports (
  id              uuid primary key default gen_random_uuid(),
  patient_id      uuid not null references public.patients(id) on delete cascade,
  report_date     date not null default current_date,
  patient_label   text, -- الاسم زي ما بيتطبع (ممكن يتسبق بـ Mr./Mrs.)
  referred_by     text,
  -- {lvedd, lvesd, lv_swt, lv_pwt, ef, left_atrium, ao_root, ao_excursion, rt_ventricle, fs}
  -- المدى الطبيعي لكل قيمة ثابت ومكتوب في الفورم نفسه، مش متخزن هنا
  dimensions      jsonb not null default '{}'::jsonb,
  summary_text    text not null default '',
  conclusion_text text not null default '',
  doctor_name     text not null default 'Dr. Haytham Shaaban (MSc)',
  created_by      uuid references public.admins(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists patient_echo_reports_patient_idx
  on public.patient_echo_reports (patient_id, report_date desc);

alter table public.patient_medical_reports enable row level security;
alter table public.patient_echo_reports enable row level security;

-- قراءة: نفس دائرة قراءة patient_medical_profile بالظبط
drop policy if exists "medical reports read" on public.patient_medical_reports;
create policy "medical reports read" on public.patient_medical_reports
  for select using (
    public.has_archive_access() or public.has_archive_review_access() or public.can_access_leads()
    or public.is_assigned_doctor_for_patient(patient_id)
  );
drop policy if exists "echo reports read" on public.patient_echo_reports;
create policy "echo reports read" on public.patient_echo_reports
  for select using (
    public.has_archive_access() or public.has_archive_review_access() or public.can_access_leads()
    or public.is_assigned_doctor_for_patient(patient_id)
  );

-- كتابة: أرشيف/سوبر أدمن بس — نفس دائرة كتابة patient_medical_profile/patient_visits
drop policy if exists "medical reports write" on public.patient_medical_reports;
create policy "medical reports write" on public.patient_medical_reports
  for insert with check (public.has_archive_access() or public.can_manage_all_content());
drop policy if exists "medical reports update" on public.patient_medical_reports;
create policy "medical reports update" on public.patient_medical_reports
  for update using (public.has_archive_access() or public.can_manage_all_content());
drop policy if exists "medical reports delete" on public.patient_medical_reports;
create policy "medical reports delete" on public.patient_medical_reports
  for delete using (public.has_archive_access() or public.can_manage_all_content());

drop policy if exists "echo reports write" on public.patient_echo_reports;
create policy "echo reports write" on public.patient_echo_reports
  for insert with check (public.has_archive_access() or public.can_manage_all_content());
drop policy if exists "echo reports update" on public.patient_echo_reports;
create policy "echo reports update" on public.patient_echo_reports
  for update using (public.has_archive_access() or public.can_manage_all_content());
drop policy if exists "echo reports delete" on public.patient_echo_reports;
create policy "echo reports delete" on public.patient_echo_reports
  for delete using (public.has_archive_access() or public.can_manage_all_content());

-- ============================================================
--  23) صور مرفقة بتقرير Echo (أشعة القلب) — عدد غير محدود لكل تقرير
--      (٢٠٢٦-٠٩-٠٢)
-- ============================================================
-- مجرد جدول ربط: الملف الفعلي بيترفع ويتخزن زي أي ملف مريض عادي (نفس
-- patient-files-upload Edge Function، فئة "radiology")، والصف هنا بس بيربط
-- الملف بتقرير Echo معيّن بدل ما يفضل عائم على مستوى المريض ككل. حذف الملف
-- (عبر patient-files-delete الموجودة بالفعل) بيمسح صف الربط ده تلقائي
-- (on delete cascade) — مفيش داعي endpoint حذف منفصل.
create table if not exists public.patient_echo_report_images (
  id              uuid primary key default gen_random_uuid(),
  echo_report_id  uuid not null references public.patient_echo_reports(id) on delete cascade,
  patient_file_id uuid not null references public.patient_files(id) on delete cascade,
  created_at      timestamptz not null default now()
);
create index if not exists patient_echo_report_images_report_idx
  on public.patient_echo_report_images (echo_report_id);
create unique index if not exists patient_echo_report_images_unique
  on public.patient_echo_report_images (echo_report_id, patient_file_id);

alter table public.patient_echo_report_images enable row level security;

drop policy if exists "echo report images read" on public.patient_echo_report_images;
create policy "echo report images read" on public.patient_echo_report_images
  for select using (
    exists (
      select 1 from public.patient_echo_reports er
      where er.id = echo_report_id
        and (
          public.has_archive_access() or public.has_archive_review_access() or public.can_access_leads()
          or public.is_assigned_doctor_for_patient(er.patient_id)
        )
    )
  );

drop policy if exists "echo report images write" on public.patient_echo_report_images;
create policy "echo report images write" on public.patient_echo_report_images
  for insert with check (public.has_archive_access() or public.can_manage_all_content());
drop policy if exists "echo report images delete" on public.patient_echo_report_images;
create policy "echo report images delete" on public.patient_echo_report_images
  for delete using (public.has_archive_access() or public.can_manage_all_content());

-- ============================================================
--  27) تقريرين جدد قابلين للطباعة: أسنان + علاج طبيعي، بنفس نمط
--      patient_medical_reports/patient_echo_reports (٢٠٢٦-٠٩-٠٢)
-- ============================================================
-- طلب الفريق: نموذجين ورقيين (أسنان + علاج طبيعي) بعتهم المستخدم فيهم
-- خلايا Word معقدة/مكررة — تم تبسيطهم لخانات حرة + جدول جلسات غير محدود
-- (بدل جداول ثابتة العدد زي الأصل)، بموافقة المستخدم على التبسيط.

create table if not exists public.patient_dental_reports (
  id                 uuid primary key default gen_random_uuid(),
  patient_id         uuid not null references public.patients(id) on delete cascade,
  report_date        date not null default current_date,
  doctor_name        text not null default '',
  chief_complaint    text not null default '',
  chronic_condition  text not null default '',
  previous_treatment text not null default '',
  treatment_plan     text not null default '',
  prosthesis_type    text not null default '',
  chronic_illnesses  text not null default '',
  -- [{date, tooth, service, notes}, ...] جدول جلسات غير محدود
  sessions           jsonb not null default '[]'::jsonb,
  created_by         uuid references public.admins(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists patient_dental_reports_patient_idx
  on public.patient_dental_reports (patient_id, report_date desc);

create table if not exists public.patient_physio_reports (
  id               uuid primary key default gen_random_uuid(),
  patient_id       uuid not null references public.patients(id) on delete cascade,
  visit_date       date not null default current_date,
  specialty        text not null default 'علاج طبيعي',
  doctor_name      text not null default '',
  visit_reason     text not null default '',
  -- {weight, blood_pressure, blood_sugar, pulse}
  vitals           jsonb not null default '{}'::jsonb,
  chronic_diseases text not null default '',
  surgeries        text not null default '',
  family_history   text not null default '',
  -- نقاط الألم على الرسم التوضيحي — [{x, y, side, note}, ...] (x/y نسبة مئوية)
  pain_points      jsonb not null default '[]'::jsonb,
  -- [{date, treatments:["Cryo",...], duration, notes}, ...] جدول جلسات غير محدود
  sessions         jsonb not null default '[]'::jsonb,
  created_by       uuid references public.admins(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists patient_physio_reports_patient_idx
  on public.patient_physio_reports (patient_id, visit_date desc);

alter table public.patient_dental_reports enable row level security;
alter table public.patient_physio_reports enable row level security;

drop policy if exists "dental reports read" on public.patient_dental_reports;
create policy "dental reports read" on public.patient_dental_reports
  for select using (
    public.has_archive_access() or public.has_archive_review_access() or public.can_access_leads()
    or public.is_assigned_doctor_for_patient(patient_id)
  );
drop policy if exists "dental reports write" on public.patient_dental_reports;
create policy "dental reports write" on public.patient_dental_reports
  for insert with check (public.has_archive_access() or public.can_manage_all_content());
drop policy if exists "dental reports update" on public.patient_dental_reports;
create policy "dental reports update" on public.patient_dental_reports
  for update using (public.has_archive_access() or public.can_manage_all_content());
drop policy if exists "dental reports delete" on public.patient_dental_reports;
create policy "dental reports delete" on public.patient_dental_reports
  for delete using (public.has_archive_access() or public.can_manage_all_content());

drop policy if exists "physio reports read" on public.patient_physio_reports;
create policy "physio reports read" on public.patient_physio_reports
  for select using (
    public.has_archive_access() or public.has_archive_review_access() or public.can_access_leads()
    or public.is_assigned_doctor_for_patient(patient_id)
  );
drop policy if exists "physio reports write" on public.patient_physio_reports;
create policy "physio reports write" on public.patient_physio_reports
  for insert with check (public.has_archive_access() or public.can_manage_all_content());
drop policy if exists "physio reports update" on public.patient_physio_reports;
create policy "physio reports update" on public.patient_physio_reports
  for update using (public.has_archive_access() or public.can_manage_all_content());
drop policy if exists "physio reports delete" on public.patient_physio_reports;
create policy "physio reports delete" on public.patient_physio_reports
  for delete using (public.has_archive_access() or public.can_manage_all_content());

-- ============================================================
--  28) تخصص لتقرير طبي (تمييز أكتر من تقرير لنفس المريض) + نقاط تحديد
--      على رسم الأسنان لتقرير الأسنان (٢٠٢٦-٠٩-٠٣)
-- ============================================================
alter table public.patient_medical_reports add column if not exists specialty text not null default '';
alter table public.patient_dental_reports add column if not exists tooth_marks jsonb not null default '[]'::jsonb; -- [{x, y, note}]

-- ============================================================
--  29) صور أشعة أسنان مرفقة بتقرير الأسنان — نفس نمط صور Echo
--      (٢٠٢٦-٠٩-٠٢)
-- ============================================================
create table if not exists public.patient_dental_report_images (
  id               uuid primary key default gen_random_uuid(),
  dental_report_id uuid not null references public.patient_dental_reports(id) on delete cascade,
  patient_file_id  uuid not null references public.patient_files(id) on delete cascade,
  created_at       timestamptz not null default now()
);
create index if not exists patient_dental_report_images_report_idx
  on public.patient_dental_report_images (dental_report_id);
create unique index if not exists patient_dental_report_images_unique
  on public.patient_dental_report_images (dental_report_id, patient_file_id);

alter table public.patient_dental_report_images enable row level security;

drop policy if exists "dental report images read" on public.patient_dental_report_images;
create policy "dental report images read" on public.patient_dental_report_images
  for select using (
    exists (
      select 1 from public.patient_dental_reports dr
      where dr.id = dental_report_id
        and (
          public.has_archive_access() or public.has_archive_review_access() or public.can_access_leads()
          or public.is_assigned_doctor_for_patient(dr.patient_id)
        )
    )
  );

drop policy if exists "dental report images write" on public.patient_dental_report_images;
create policy "dental report images write" on public.patient_dental_report_images
  for insert with check (public.has_archive_access() or public.can_manage_all_content());
drop policy if exists "dental report images delete" on public.patient_dental_report_images;
create policy "dental report images delete" on public.patient_dental_report_images
  for delete using (public.has_archive_access() or public.can_manage_all_content());

-- ============================================================
--  30) صور أشعة/فحوصات مرفقة بتقرير العلاج الطبيعي — نفس نمط صور
--      Echo/الأسنان بالظبط (٢٠٢٦-٠٩-٠٢)
-- ============================================================
create table if not exists public.patient_physio_report_images (
  id               uuid primary key default gen_random_uuid(),
  physio_report_id uuid not null references public.patient_physio_reports(id) on delete cascade,
  patient_file_id  uuid not null references public.patient_files(id) on delete cascade,
  created_at       timestamptz not null default now()
);
create index if not exists patient_physio_report_images_report_idx
  on public.patient_physio_report_images (physio_report_id);
create unique index if not exists patient_physio_report_images_unique
  on public.patient_physio_report_images (physio_report_id, patient_file_id);

alter table public.patient_physio_report_images enable row level security;

drop policy if exists "physio report images read" on public.patient_physio_report_images;
create policy "physio report images read" on public.patient_physio_report_images
  for select using (
    exists (
      select 1 from public.patient_physio_reports pr
      where pr.id = physio_report_id
        and (
          public.has_archive_access() or public.has_archive_review_access() or public.can_access_leads()
          or public.is_assigned_doctor_for_patient(pr.patient_id)
        )
    )
  );

drop policy if exists "physio report images write" on public.patient_physio_report_images;
create policy "physio report images write" on public.patient_physio_report_images
  for insert with check (public.has_archive_access() or public.can_manage_all_content());
drop policy if exists "physio report images delete" on public.patient_physio_report_images;
create policy "physio report images delete" on public.patient_physio_report_images
  for delete using (public.has_archive_access() or public.can_manage_all_content());

-- ============================================================
--  31) روشتة (Prescription) قابلة للطباعة — نفس نمط patient_medical_reports
--      بالظبط (٢٠٢٦-٠٩-٠٣)
-- ============================================================
create table if not exists public.patient_prescriptions (
  id           uuid primary key default gen_random_uuid(),
  patient_id   uuid not null references public.patients(id) on delete cascade,
  report_date  date not null default current_date,
  doctor_name  text not null default '',
  specialty    text not null default '',
  diagnosis    text not null default '',
  rx_text      text not null default '',
  created_by   uuid references public.admins(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists patient_prescriptions_patient_idx
  on public.patient_prescriptions (patient_id, report_date desc);

alter table public.patient_prescriptions enable row level security;

drop policy if exists "prescriptions read" on public.patient_prescriptions;
create policy "prescriptions read" on public.patient_prescriptions
  for select using (
    public.has_archive_access() or public.has_archive_review_access() or public.can_access_leads()
    or public.is_assigned_doctor_for_patient(patient_id)
  );

drop policy if exists "prescriptions write" on public.patient_prescriptions;
create policy "prescriptions write" on public.patient_prescriptions
  for insert with check (public.has_archive_access() or public.can_manage_all_content());
drop policy if exists "prescriptions update" on public.patient_prescriptions;
create policy "prescriptions update" on public.patient_prescriptions
  for update using (public.has_archive_access() or public.can_manage_all_content());
drop policy if exists "prescriptions delete" on public.patient_prescriptions;
create policy "prescriptions delete" on public.patient_prescriptions
  for delete using (public.has_archive_access() or public.can_manage_all_content());

-- ============================================================
--  32) فورم طلب تحاليل (Lab Request) — تشيك ليست قابلة للطباعة
--      (٢٠٢٦-٠٩-٠٣)
-- ============================================================
create table if not exists public.patient_lab_requests (
  id           uuid primary key default gen_random_uuid(),
  patient_id   uuid not null references public.patients(id) on delete cascade,
  report_date  date not null default current_date,
  doctor_name  text not null default '',
  diagnosis    text not null default '',
  tests        jsonb not null default '[]'::jsonb, -- array of selected test labels
  others_text  text not null default '',
  created_by   uuid references public.admins(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists patient_lab_requests_patient_idx
  on public.patient_lab_requests (patient_id, report_date desc);

alter table public.patient_lab_requests enable row level security;

drop policy if exists "lab requests read" on public.patient_lab_requests;
create policy "lab requests read" on public.patient_lab_requests
  for select using (
    public.has_archive_access() or public.has_archive_review_access() or public.can_access_leads()
    or public.is_assigned_doctor_for_patient(patient_id)
  );

drop policy if exists "lab requests write" on public.patient_lab_requests;
create policy "lab requests write" on public.patient_lab_requests
  for insert with check (public.has_archive_access() or public.can_manage_all_content());
drop policy if exists "lab requests update" on public.patient_lab_requests;
create policy "lab requests update" on public.patient_lab_requests
  for update using (public.has_archive_access() or public.can_manage_all_content());
drop policy if exists "lab requests delete" on public.patient_lab_requests;
create policy "lab requests delete" on public.patient_lab_requests
  for delete using (public.has_archive_access() or public.can_manage_all_content());

-- ============================================================
--  33) فورم طلب أشعة (Radiology/Imaging Request) — تشيك ليست قابلة للطباعة
--      (٢٠٢٦-٠٩-٠٣)
-- ============================================================
create table if not exists public.patient_radiology_requests (
  id           uuid primary key default gen_random_uuid(),
  patient_id   uuid not null references public.patients(id) on delete cascade,
  report_date  date not null default current_date,
  doctor_name  text not null default '',
  diagnosis    text not null default '',
  items        jsonb not null default '[]'::jsonb, -- array of selected item labels (L/R items suffixed " - L"/" - R")
  others_text  text not null default '',
  created_by   uuid references public.admins(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists patient_radiology_requests_patient_idx
  on public.patient_radiology_requests (patient_id, report_date desc);

alter table public.patient_radiology_requests enable row level security;

drop policy if exists "radiology requests read" on public.patient_radiology_requests;
create policy "radiology requests read" on public.patient_radiology_requests
  for select using (
    public.has_archive_access() or public.has_archive_review_access() or public.can_access_leads()
    or public.is_assigned_doctor_for_patient(patient_id)
  );

drop policy if exists "radiology requests write" on public.patient_radiology_requests;
create policy "radiology requests write" on public.patient_radiology_requests
  for insert with check (public.has_archive_access() or public.can_manage_all_content());
drop policy if exists "radiology requests update" on public.patient_radiology_requests;
create policy "radiology requests update" on public.patient_radiology_requests
  for update using (public.has_archive_access() or public.can_manage_all_content());
drop policy if exists "radiology requests delete" on public.patient_radiology_requests;
create policy "radiology requests delete" on public.patient_radiology_requests
  for delete using (public.has_archive_access() or public.can_manage_all_content());

-- ============================================================
--  34) تقييم تجربة المريض (Patient Experience Rating) — تكراري لكل زيارة
--      + بحث آمن عن المرضى لخدمة العملاء (٢٠٢٦-٠٩-٠٣)
-- ============================================================
create table if not exists public.patient_experience_ratings (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references public.patients(id) on delete cascade,
  visit_date  date not null default current_date,
  ratings     jsonb not null default '[]'::jsonb, -- array of 6 ints (1-5), نفس ترتيب أسئلة الاستبيان الرسمي
  comment     text not null default '',
  created_by  uuid references public.admins(id),
  created_at  timestamptz not null default now()
);
create index if not exists patient_experience_ratings_patient_idx
  on public.patient_experience_ratings (patient_id, visit_date desc);
create index if not exists patient_experience_ratings_created_idx
  on public.patient_experience_ratings (created_at desc);

alter table public.patient_experience_ratings enable row level security;

drop policy if exists "experience ratings read" on public.patient_experience_ratings;
create policy "experience ratings read" on public.patient_experience_ratings
  for select using (
    public.has_archive_access() or public.has_archive_review_access() or public.can_access_leads()
    or public.is_assigned_doctor_for_patient(patient_id)
  );

drop policy if exists "experience ratings write" on public.patient_experience_ratings;
create policy "experience ratings write" on public.patient_experience_ratings
  for insert with check (public.has_archive_access() or public.can_access_leads() or public.can_manage_all_content());
drop policy if exists "experience ratings update" on public.patient_experience_ratings;
create policy "experience ratings update" on public.patient_experience_ratings
  for update using (public.has_archive_access() or public.can_access_leads() or public.can_manage_all_content());
drop policy if exists "experience ratings delete" on public.patient_experience_ratings;
create policy "experience ratings delete" on public.patient_experience_ratings
  for delete using (public.has_archive_access() or public.can_manage_all_content());

-- بحث آمن ومحدود عن المرضى (اسم/هاتف/كود بس، من غير بيانات طبية) — عشان خدمة
-- العملاء تقدر تدوّر على مريض تربط بيه تقييم تجربة من تاب "تقييمات العملاء"
-- من غير ما نديها وصول لـpatient-files-list الكامل (بيانات أرشيف طبية)
create or replace function public.search_patients_basic(p_term text)
returns table(id uuid, full_name text, phone text, patient_code text)
language plpgsql security definer stable set search_path = public as $$
begin
  if not (public.has_archive_access() or public.has_archive_review_access() or public.can_access_leads() or public.has_role('nursing')) then
    raise exception 'not allowed';
  end if;
  return query
    select p.id, p.full_name, p.phone, p.patient_code
    from public.patients p
    where p.full_name ilike '%'||p_term||'%' or p.phone ilike '%'||p_term||'%' or p.patient_code ilike '%'||p_term||'%'
    order by p.full_name
    limit 20;
end;
$$;
revoke all on function public.search_patients_basic(text) from public;
grant execute on function public.search_patients_basic(text) to authenticated;

-- ============================================================
--  ٣٥) جداول Meta Ads المُطبّعة (Backfill من مشروع منفصل) + Views
--  لوحة "طبيب سونو" — لا تمس ad_campaigns القديم ولا سلوك الليدز/المرضى
--  الحالي. جداول جديدة بالكامل + أعمدة nullable اختيارية على leads.
-- ============================================================

create table if not exists public.meta_campaigns (
  id                  uuid primary key default gen_random_uuid(),
  platform_campaign_id text not null unique,
  campaign_name       text,
  account_id          text,
  account_name        text,
  objective           text,
  start_date          date,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists public.meta_adsets (
  id                 uuid primary key default gen_random_uuid(),
  platform_adset_id  text not null unique,
  campaign_id        uuid references public.meta_campaigns(id) on delete set null,
  adset_name         text,
  account_id         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists public.meta_creatives (
  id                          uuid primary key default gen_random_uuid(),
  platform_creative_id        text not null unique,
  effective_object_story_id   text,
  page_id                     text,
  page_name                   text,
  post_id                     text,
  body                        text,
  title                       text,
  description                 text,
  cta                         text,
  cta_raw                     text,
  link_url                    text,
  whatsapp_dest               text,
  format                      text,
  video_id                    text,
  image_id                    text,
  preview_url                 text,
  creative_type               text,
  cta_type                    text,
  creative_group_id           text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create table if not exists public.meta_ads (
  id                          uuid primary key default gen_random_uuid(),
  platform_ad_id              text not null unique,
  adset_id                    uuid references public.meta_adsets(id) on delete set null,
  campaign_id                 uuid references public.meta_campaigns(id) on delete set null,
  creative_id                 uuid references public.meta_creatives(id) on delete set null,
  ad_name                     text,
  effective_object_story_id   text,
  page_id                     text,
  post_id                     text,
  specialty                   text,
  content_angle                text,
  hook_type                   text,
  creative_type               text,
  cta_type                    text,
  objective                   text,
  status                      text,
  start_date                  date,
  end_date                    date,
  creative_group_id           text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create table if not exists public.meta_ad_performance_lifetime (
  id                  uuid primary key default gen_random_uuid(),
  ad_id               uuid not null unique references public.meta_ads(id) on delete cascade,
  spend               numeric,
  reach               numeric,
  impressions         numeric,
  frequency           numeric,
  clicks              numeric,
  link_clicks         numeric,
  ctr                 numeric,
  cpc                 numeric,
  cpm                 numeric,
  post_engagements    numeric,
  reactions           numeric,
  comments            numeric,
  shares              numeric,
  video_views         numeric,
  video_3s_views      numeric,
  thruplay            numeric,
  msg_conv            numeric,
  cost_per_msg_conv   numeric,
  leads               numeric,
  cost_per_lead       numeric,
  calls               numeric,
  landing_page_views  numeric,
  cost_per_result     numeric,
  results             numeric,
  confidence          text,
  notes               text,
  updated_at          timestamptz not null default now()
);

-- فهارس لسرعة استعلامات اللوحة
create index if not exists meta_campaigns_platform_id_idx on public.meta_campaigns (platform_campaign_id);
create index if not exists meta_adsets_platform_id_idx on public.meta_adsets (platform_adset_id);
create index if not exists meta_adsets_campaign_id_idx on public.meta_adsets (campaign_id);
create index if not exists meta_ads_platform_id_idx on public.meta_ads (platform_ad_id);
create index if not exists meta_ads_campaign_id_idx on public.meta_ads (campaign_id);
create index if not exists meta_ads_adset_id_idx on public.meta_ads (adset_id);
create index if not exists meta_ads_creative_id_idx on public.meta_ads (creative_id);
create index if not exists meta_ads_specialty_idx on public.meta_ads (specialty);
create index if not exists meta_ads_objective_idx on public.meta_ads (objective);
create index if not exists meta_ads_start_date_idx on public.meta_ads (start_date);
create index if not exists meta_ads_creative_group_id_idx on public.meta_ads (creative_group_id);
create index if not exists meta_creatives_platform_id_idx on public.meta_creatives (platform_creative_id);
create index if not exists meta_creatives_group_id_idx on public.meta_creatives (creative_group_id);
create index if not exists meta_ad_performance_lifetime_ad_id_idx on public.meta_ad_performance_lifetime (ad_id);

-- RLS: نفس نمط ad_campaigns الحالي — أي أدمن نشط يقرأ، والكتابة/الاستيراد لأصحاب صلاحية التسويق فقط
alter table public.meta_campaigns enable row level security;
alter table public.meta_adsets enable row level security;
alter table public.meta_creatives enable row level security;
alter table public.meta_ads enable row level security;
alter table public.meta_ad_performance_lifetime enable row level security;

drop policy if exists "active admins read meta_campaigns" on public.meta_campaigns;
create policy "active admins read meta_campaigns" on public.meta_campaigns for select to authenticated using (public.my_admin_id() is not null);
drop policy if exists "approver writes meta_campaigns" on public.meta_campaigns;
create policy "approver writes meta_campaigns" on public.meta_campaigns for all to authenticated
  using (public.my_role() in ('approver','general_manager','super_admin')) with check (public.my_role() in ('approver','general_manager','super_admin'));

drop policy if exists "active admins read meta_adsets" on public.meta_adsets;
create policy "active admins read meta_adsets" on public.meta_adsets for select to authenticated using (public.my_admin_id() is not null);
drop policy if exists "approver writes meta_adsets" on public.meta_adsets;
create policy "approver writes meta_adsets" on public.meta_adsets for all to authenticated
  using (public.my_role() in ('approver','general_manager','super_admin')) with check (public.my_role() in ('approver','general_manager','super_admin'));

drop policy if exists "active admins read meta_creatives" on public.meta_creatives;
create policy "active admins read meta_creatives" on public.meta_creatives for select to authenticated using (public.my_admin_id() is not null);
drop policy if exists "approver writes meta_creatives" on public.meta_creatives;
create policy "approver writes meta_creatives" on public.meta_creatives for all to authenticated
  using (public.my_role() in ('approver','general_manager','super_admin')) with check (public.my_role() in ('approver','general_manager','super_admin'));

drop policy if exists "active admins read meta_ads" on public.meta_ads;
create policy "active admins read meta_ads" on public.meta_ads for select to authenticated using (public.my_admin_id() is not null);
drop policy if exists "approver writes meta_ads" on public.meta_ads;
create policy "approver writes meta_ads" on public.meta_ads for all to authenticated
  using (public.my_role() in ('approver','general_manager','super_admin')) with check (public.my_role() in ('approver','general_manager','super_admin'));

drop policy if exists "active admins read meta_ad_performance_lifetime" on public.meta_ad_performance_lifetime;
create policy "active admins read meta_ad_performance_lifetime" on public.meta_ad_performance_lifetime for select to authenticated using (public.my_admin_id() is not null);
drop policy if exists "approver writes meta_ad_performance_lifetime" on public.meta_ad_performance_lifetime;
create policy "approver writes meta_ad_performance_lifetime" on public.meta_ad_performance_lifetime for all to authenticated
  using (public.my_role() in ('approver','general_manager','super_admin')) with check (public.my_role() in ('approver','general_manager','super_admin'));

-- إسناد الليدز لإعلانات Meta — أعمدة nullable فقط، بدون أي تعديل على سلوك الليدز الحالي
alter table public.leads add column if not exists meta_campaign_id text;
alter table public.leads add column if not exists meta_adset_id text;
alter table public.leads add column if not exists meta_ad_id text;
alter table public.leads add column if not exists meta_creative_id text;
alter table public.leads add column if not exists utm_source text;
alter table public.leads add column if not exists utm_medium text;
alter table public.leads add column if not exists utm_campaign text;
alter table public.leads add column if not exists utm_content text;
create index if not exists leads_meta_ad_id_idx on public.leads (meta_ad_id);
create index if not exists leads_meta_campaign_id_idx on public.leads (meta_campaign_id);

-- ============================================================
--  Views للقراءة السريعة في اللوحة
-- ============================================================

create or replace view public.vw_meta_ad_performance as
select
  a.id as ad_id, a.platform_ad_id, a.ad_name, a.specialty, a.content_angle, a.hook_type,
  a.creative_type, a.cta_type, a.objective, a.status, a.start_date, a.end_date, a.creative_group_id,
  ads_.id as adset_id, ads_.platform_adset_id, ads_.adset_name,
  c.id as campaign_id, c.platform_campaign_id, c.campaign_name, c.account_id, c.account_name,
  cr.id as creative_id, cr.platform_creative_id, cr.title as creative_title, cr.body as creative_body,
  cr.preview_url, cr.format as creative_format,
  p.spend, p.reach, p.impressions, p.frequency, p.clicks, p.link_clicks, p.ctr, p.cpc, p.cpm,
  p.post_engagements, p.reactions, p.comments, p.shares, p.video_views, p.thruplay,
  p.msg_conv, p.cost_per_msg_conv, p.leads, p.cost_per_lead, p.calls, p.landing_page_views,
  p.cost_per_result, p.results, p.confidence, p.notes
from public.meta_ads a
left join public.meta_adsets ads_ on ads_.id = a.adset_id
left join public.meta_campaigns c on c.id = a.campaign_id
left join public.meta_creatives cr on cr.id = a.creative_id
left join public.meta_ad_performance_lifetime p on p.ad_id = a.id;

create or replace view public.vw_meta_specialty_performance as
select
  a.specialty, a.objective,
  count(distinct a.id) as ads,
  sum(p.spend) as spend,
  sum(p.reach) as reach,
  sum(p.impressions) as impressions,
  sum(p.clicks) as clicks,
  sum(p.msg_conv) as msg_conv,
  sum(p.leads) as leads,
  case when sum(p.msg_conv) > 0 then round((sum(p.spend) / sum(p.msg_conv))::numeric, 2) else null end as weighted_cost_per_msg_conv,
  case when sum(p.leads) > 0 then round((sum(p.spend) / sum(p.leads))::numeric, 2) else null end as weighted_cost_per_lead,
  case when sum(p.impressions) > 0 then round((sum(p.clicks)::numeric / sum(p.impressions) * 100), 2) else null end as ctr_pct,
  case when sum(p.clicks) > 0 then round((sum(p.spend) / sum(p.clicks))::numeric, 2) else null end as cpc,
  case when sum(p.impressions) > 0 then round((sum(p.spend) / sum(p.impressions) * 1000)::numeric, 2) else null end as cpm
from public.meta_ads a
left join public.meta_ad_performance_lifetime p on p.ad_id = a.id
group by a.specialty, a.objective;

create or replace view public.vw_meta_creative_performance as
select
  a.creative_group_id,
  max(a.specialty) as specialty,
  max(a.hook_type) as hook_type,
  max(a.content_angle) as content_angle,
  max(a.creative_type) as creative_type,
  count(distinct a.id) as runs,
  sum(p.spend) as spend,
  sum(p.results) as results,
  sum(p.msg_conv) as msg_conv,
  sum(p.leads) as leads,
  case when sum(p.results) > 0 then round((sum(p.spend) / sum(p.results))::numeric, 2) else null end as weighted_cost_per_result,
  case when sum(p.leads) > 0 then round((sum(p.spend) / sum(p.leads))::numeric, 2) else null end as weighted_cost_per_lead
from public.meta_ads a
left join public.meta_ad_performance_lifetime p on p.ad_id = a.id
where a.creative_group_id is not null
group by a.creative_group_id;

create or replace view public.vw_lead_meta_attribution as
select
  l.id as lead_id, l.customer_name, l.phone_normalized, l.source, l.current_status, l.received_at,
  l.meta_ad_id, l.meta_campaign_id, l.utm_source, l.utm_medium, l.utm_campaign, l.utm_content,
  a.id as matched_meta_ad_id, a.ad_name as matched_ad_name, a.specialty as matched_specialty,
  c.campaign_name as matched_campaign_name
from public.leads l
left join public.meta_ads a on a.platform_ad_id = l.meta_ad_id
left join public.meta_campaigns c on c.id = a.campaign_id;

-- ============================================================
--  ٣٦) content_meta_links — ربط اختياري بين المحتوى وإعلانات Meta
--  إضافي بالكامل: مفيش أي تعديل على content_items/comments/activity_log
--  ولا على جداول meta_* الحالية. الربط يدوي دايمًا (مفيش auto-match).
-- ============================================================

create table if not exists public.content_meta_links (
  id                uuid primary key default gen_random_uuid(),
  content_id        uuid not null references public.content_items(id) on delete cascade,
  meta_ad_id        uuid references public.meta_ads(id) on delete cascade,
  creative_group_id text,
  linked_by         uuid references public.admins(id) on delete set null,
  confidence        text not null default 'manual_confirmed',
  notes             text,
  linked_at         timestamptz not null default now(),
  constraint content_meta_links_target_chk check (meta_ad_id is not null or creative_group_id is not null)
);

-- منع تكرار نفس رابط المحتوى↔الإعلان، ونفس رابط المحتوى↔مجموعة الكرييتف
create unique index if not exists content_meta_links_content_ad_uniq
  on public.content_meta_links (content_id, meta_ad_id) where meta_ad_id is not null;
create unique index if not exists content_meta_links_content_group_uniq
  on public.content_meta_links (content_id, creative_group_id) where meta_ad_id is null and creative_group_id is not null;

create index if not exists content_meta_links_content_id_idx on public.content_meta_links (content_id);
create index if not exists content_meta_links_meta_ad_id_idx on public.content_meta_links (meta_ad_id);
create index if not exists content_meta_links_group_id_idx on public.content_meta_links (creative_group_id);

alter table public.content_meta_links enable row level security;

-- القراءة: نفس نمط content_items — أي أدمن نشط
drop policy if exists "active admins read content_meta_links" on public.content_meta_links;
create policy "active admins read content_meta_links"
  on public.content_meta_links for select to authenticated
  using (public.my_admin_id() is not null);

-- الكتابة (ربط/فك ربط): نفس أصحاب صلاحية إدارة المحتوى الحاليين
-- (page_manager بيدير الإنتاج، approver بيراجع، أو can_manage_all_content
-- زي باقي سياسات content_items) — مفيش صلاحية أوسع من موديول إنتاج المحتوى الحالي
drop policy if exists "content managers write content_meta_links" on public.content_meta_links;
create policy "content managers write content_meta_links"
  on public.content_meta_links for all to authenticated
  using (public.has_role('page_manager') or public.has_role('approver') or public.can_manage_all_content())
  with check (public.has_role('page_manager') or public.has_role('approver') or public.can_manage_all_content());

-- ============================================================
--  View: أداء الإعلانات المرتبطة بالمحتوى — security_invoker عشان تحترم
--  RLS بتاعة المستخدم الفعلي اللي بيستعلم، مش صاحب الـview
-- ============================================================
create or replace view public.vw_content_meta_performance
with (security_invoker = true) as
select
  ci.id as content_id, ci.title as content_title, ci.brand as content_brand, ci.specialty as content_specialty,
  a.id as meta_ad_id, a.platform_ad_id, a.ad_name,
  a.campaign_id, c.campaign_name,
  coalesce(cml.creative_group_id, a.creative_group_id) as creative_group_id,
  a.specialty as meta_specialty, a.hook_type, a.content_angle, a.creative_type, a.objective, a.status,
  p.spend, p.reach, p.impressions, p.clicks, p.ctr, p.cpc, p.cpm, p.msg_conv, p.cost_per_msg_conv,
  p.leads, p.cost_per_lead, p.results,
  cml.id as link_id, cml.linked_at, cml.linked_by, cml.confidence, cml.notes
from public.content_meta_links cml
join public.content_items ci on ci.id = cml.content_id
left join public.meta_ads a
  on a.id = cml.meta_ad_id
  or (cml.meta_ad_id is null and cml.creative_group_id is not null and a.creative_group_id = cml.creative_group_id)
left join public.meta_campaigns c on c.id = a.campaign_id
left join public.meta_ad_performance_lifetime p on p.ad_id = a.id;

-- ============================================================
--  ٣٧) Content Intelligence: mapping تخصصات متحكَّم فيه + أنماط أداء
--  تاريخية من Meta Ads — إضافي بالكامل. مفيش تعديل على content_items/
--  meta_*/content_meta_links الموجودين. الهدف: مصدر بيانات لبانل
--  "ذكاء المحتوى" الاستشاري وقت إنشاء محتوى جديد، مش تغيير في سلوك
--  الإنشاء الحالي.
-- ============================================================

-- (أ) mapping مُتحكَّم فيه بين specialty الكود الداخلي لـcontent_items
-- ومفردات meta_ads.specialty النصية — مفيش fuzzy matching، إدخال يدوي
-- بس للحالات الواضحة بدون لبس (راجع CLAUDE.md لتفسير كل قرار).
create table if not exists public.content_meta_specialty_map (
  content_specialty_key text primary key,
  meta_specialty_label   text not null,
  active                 boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

alter table public.content_meta_specialty_map enable row level security;

drop policy if exists "active admins read specialty map" on public.content_meta_specialty_map;
create policy "active admins read specialty map"
  on public.content_meta_specialty_map for select to authenticated
  using (public.my_admin_id() is not null);

drop policy if exists "content managers write specialty map" on public.content_meta_specialty_map;
create policy "content managers write specialty map"
  on public.content_meta_specialty_map for all to authenticated
  using (public.has_role('page_manager') or public.has_role('approver') or public.can_manage_all_content())
  with check (public.has_role('page_manager') or public.has_role('approver') or public.can_manage_all_content());

-- تعبئة أولية — مطابقات واضحة بدون لبس فقط (مقارنة بين مفاتيح
-- SPECIALTIES في workflow.js ومفردات meta_ads.specialty الفعلية).
-- تخصصات content_items اللي مالهاش نظير واضح في Meta (orthopedics,
-- surgery, ent, psychiatry, pediatrics, oncology, cardiology, vascular,
-- radiology, nursing_services, internal_services, internal) اتسابت
-- عمدًا من غير mapping — أفضل من تخمين غلط.
insert into public.content_meta_specialty_map (content_specialty_key, meta_specialty_label) values
  ('neurology',       'Neurology'),
  ('dermatology',     'Dermatology & Cosmetics'),
  ('cosmetic_laser',  'Dermatology & Cosmetics'),
  ('obgyn',           'OBGYN / Women''s Health'),
  ('dental',          'Dental'),
  ('physio_nutrition','Physiotherapy & Rehabilitation'),
  ('lab',             'Laboratory'),
  ('emergency',       'Emergency / General Medicine')
on conflict (content_specialty_key) do nothing;

-- (ب) أنماط أداء تاريخية من Meta Ads — مجمّعة حسب specialty+objective+
-- hook_type+content_angle+creative_type+cta_type، عشان الـobjectives
-- المختلفة (رسائل مقابل ليدز مقابل وعي) ميتخلطوش في نفس الصف. مصدرها
-- meta_ads + meta_ad_performance_lifetime بس (زي ما طلب المستخدم).
create or replace view public.vw_content_intelligence_patterns
with (security_invoker = true) as
select
  a.specialty, a.objective, a.hook_type, a.content_angle, a.creative_type, a.cta_type,
  count(distinct a.id)                       as ads_count,
  sum(coalesce(p.spend, 0))                  as total_spend,
  sum(coalesce(p.impressions, 0))            as total_impressions,
  sum(coalesce(p.clicks, 0))                 as total_clicks,
  sum(coalesce(p.msg_conv, 0))               as total_messages,
  sum(coalesce(p.leads, 0))                  as total_leads,
  -- تكاليف موزونة من الإجمالي (مش متوسط بسيط) — nullif يمنع القسمة على صفر
  round(sum(coalesce(p.spend,0)) / nullif(sum(coalesce(p.msg_conv,0)), 0), 2)  as weighted_cost_per_message,
  round(sum(coalesce(p.spend,0)) / nullif(sum(coalesce(p.leads,0)), 0), 2)    as weighted_cost_per_lead,
  round(sum(coalesce(p.clicks,0))::numeric * 100 / nullif(sum(coalesce(p.impressions,0)), 0), 2) as weighted_ctr,
  round(sum(coalesce(p.spend,0)) / nullif(sum(coalesce(p.clicks,0)), 0), 2)   as weighted_cpc,
  round(sum(coalesce(p.spend,0)) * 1000 / nullif(sum(coalesce(p.impressions,0)), 0), 2) as weighted_cpm,
  min(a.start_date) as first_run_date,
  max(a.start_date) as last_run_date,
  -- عتبات ثقة صريحة ومحافظة (موثّقة هنا عشان أي تعديل مستقبلي يبقى واعي):
  --   HIGH:   ≥5 إعلانات منفصلة و(≥2000 جنيه إنفاق أو ≥20 نتيجة رسائل/ليدز)
  --   MEDIUM: ≥2 إعلان و(≥300 جنيه إنفاق أو ≥5 نتائج) — مش HIGH
  --   LOW:    أي حاجة أقل من كده — عينة صغيرة جدًا يُعتمد عليها كتجربة بس
  case
    when count(distinct a.id) >= 5
      and (sum(coalesce(p.spend,0)) >= 2000 or sum(coalesce(p.msg_conv,0)) + sum(coalesce(p.leads,0)) >= 20)
      then 'high'
    when count(distinct a.id) >= 2
      and (sum(coalesce(p.spend,0)) >= 300 or sum(coalesce(p.msg_conv,0)) + sum(coalesce(p.leads,0)) >= 5)
      then 'medium'
    else 'low'
  end as confidence
from public.meta_ads a
left join public.meta_ad_performance_lifetime p on p.ad_id = a.id
where a.specialty is not null and a.specialty <> 'UNKNOWN'
group by a.specialty, a.objective, a.hook_type, a.content_angle, a.creative_type, a.cta_type;

-- (ج) رابط وكيل إنشاء المحتوى الخارجي (Custom GPT) — يتبع نمط الإعداد
-- العام الموجود بالفعل في app_settings (صف واحد id=1)، مش جدول
-- key/value منفصل، لأن app_settings أصلاً بنفس النمط ده (أعمدة ثابتة
-- قابلة للتعديل من لوحة الأدمن).
alter table public.app_settings add column if not exists content_agent_gpt_url text;
update public.app_settings
  set content_agent_gpt_url = 'https://chatgpt.com/g/g-6a7e56daf7f08191b02d1164cd120136-mnshy-mhtw-ydt-swnw'
  where id = 1 and (content_agent_gpt_url is null or content_agent_gpt_url = '');

-- ============================================================
--  ٣٨) Media Buyer Control Center — طبقة تحكم واعتماد بشري (Phase 1)
--  اللوحة/Supabase هنا هي control plane وconsumer للبيانات بس. مشروع
--  Meta/Claude منفصل هيبقى لاحقًا execution/data-producer agent. الباتش
--  دي إضافية بالكامل — مفيش أي لمس لـmeta_*/ad_campaigns/leads/
--  content_meta_links الحاليين، ومفيش أي اتصال بـMeta API ولا تخزين
--  أي secret (Meta access token/Supabase service role) في الجداول دي.
-- ============================================================

create table if not exists public.media_buyer_plans (
  id                   uuid primary key default gen_random_uuid(),
  title                text not null,
  brand                text,
  specialty            text,
  objective            text not null,
  content_item_id      uuid references public.content_items(id) on delete set null,
  creative_group_id    text,
  daily_budget         numeric,
  total_budget         numeric,
  currency             text not null default 'EGP',
  start_date           date,
  end_date             date,
  targeting_summary    text,
  strategy_summary     text,
  rationale            text,
  agent_confidence     text,
  status               text not null default 'draft',
  proposed_by          text not null default 'claude_media_buyer',
  created_by           uuid references public.admins(id) on delete set null,
  approved_by          uuid references public.admins(id) on delete set null,
  approved_at          timestamptz,
  rejected_by          uuid references public.admins(id) on delete set null,
  rejected_at          timestamptz,
  rejection_reason     text,
  platform_campaign_id text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint media_buyer_plans_status_chk check (status in (
    'draft','pending_approval','approved','rejected','executing','live',
    'paused','completed','failed'
  ))
);

create index if not exists media_buyer_plans_status_idx on public.media_buyer_plans (status);
create index if not exists media_buyer_plans_content_item_idx on public.media_buyer_plans (content_item_id);
create index if not exists media_buyer_plans_creative_group_idx on public.media_buyer_plans (creative_group_id);

create table if not exists public.media_buyer_actions (
  id                 uuid primary key default gen_random_uuid(),
  plan_id            uuid references public.media_buyer_plans(id) on delete cascade,
  action_type        text not null,
  target_type        text,
  target_platform_id text,
  proposed_payload   jsonb,
  reason             text,
  metrics_snapshot   jsonb,
  status             text not null default 'proposed',
  proposed_by        text not null default 'claude_media_buyer',
  approved_by        uuid references public.admins(id) on delete set null,
  approved_at        timestamptz,
  executed_at        timestamptz,
  execution_result   jsonb,
  error_message      text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint media_buyer_actions_action_type_chk check (action_type in (
    'create_campaign','create_adset','create_ad',
    'increase_budget','decrease_budget',
    'pause_campaign','pause_adset','pause_ad',
    'resume_campaign','resume_adset','resume_ad'
  )),
  constraint media_buyer_actions_target_type_chk check (target_type is null or target_type in ('campaign','adset','ad')),
  constraint media_buyer_actions_status_chk check (status in (
    'proposed','approved','rejected','executing','executed','failed','cancelled'
  ))
);

create index if not exists media_buyer_actions_plan_idx on public.media_buyer_actions (plan_id);
create index if not exists media_buyer_actions_status_idx on public.media_buyer_actions (status);

-- RLS: القراءة لأي أدمن نشط (نفس نمط meta_*/content_items) — الاعتماد/الرفض
-- (فعليًا أي كتابة على الجدولين دول في V1) مقصور على general_manager/
-- super_admin بس — مفيش تنفيذ فعلي على Meta هنا خالص، القرار البشري هو
-- بوابة الاعتماد الوحيدة.
alter table public.media_buyer_plans enable row level security;
alter table public.media_buyer_actions enable row level security;

drop policy if exists "active admins read media_buyer_plans" on public.media_buyer_plans;
create policy "active admins read media_buyer_plans" on public.media_buyer_plans
  for select to authenticated using (public.my_admin_id() is not null);

-- (تصحيح أمني) "managers write ..." القديمة كانت FOR ALL — بتسمح بالـDELETE
-- ضمنيًا، وده يتعارض مع مطلب إن سجل الاعتماد يفضل auditable من غير حذف من
-- الداشبورد. اتقسمت لسياستين صريحتين (INSERT/UPDATE) من غير أي سياسة DELETE
-- خالص — الحذف مش متاح لمستخدم الداشبورد نهائيًا على الجدولين دول، لا
-- general_manager ولا super_admin. الـexecution backend المستقبلي هيستخدم
-- service_role (بيتخطى RLS بالكامل) لو احتاج يحدّث نتيجة التنفيذ.
drop policy if exists "managers write media_buyer_plans" on public.media_buyer_plans;
drop policy if exists "managers insert media_buyer_plans" on public.media_buyer_plans;
create policy "managers insert media_buyer_plans" on public.media_buyer_plans
  for insert to authenticated
  with check (public.has_role('general_manager') or public.has_role('super_admin'));
drop policy if exists "managers update media_buyer_plans" on public.media_buyer_plans;
create policy "managers update media_buyer_plans" on public.media_buyer_plans
  for update to authenticated
  using (public.has_role('general_manager') or public.has_role('super_admin'))
  with check (public.has_role('general_manager') or public.has_role('super_admin'));

drop policy if exists "active admins read media_buyer_actions" on public.media_buyer_actions;
create policy "active admins read media_buyer_actions" on public.media_buyer_actions
  for select to authenticated using (public.my_admin_id() is not null);

drop policy if exists "managers write media_buyer_actions" on public.media_buyer_actions;
drop policy if exists "managers insert media_buyer_actions" on public.media_buyer_actions;
create policy "managers insert media_buyer_actions" on public.media_buyer_actions
  for insert to authenticated
  with check (public.has_role('general_manager') or public.has_role('super_admin'));
drop policy if exists "managers update media_buyer_actions" on public.media_buyer_actions;
create policy "managers update media_buyer_actions" on public.media_buyer_actions
  for update to authenticated
  using (public.has_role('general_manager') or public.has_role('super_admin'))
  with check (public.has_role('general_manager') or public.has_role('super_admin'));

-- ⚠️ عقد التنفيذ المستقبلي (Future Execution Contract) — توثيق بس، مفيش
-- worker بيتنفّذ هنا خالص:
-- الـexecution backend المستقبلي (خارج هذا المشروع) المفروض بس:
--   1) يقرا الصفوف اللي status='approved' في media_buyer_actions
--      (أو media_buyer_plans لإنشاء حملة جديدة كاملة)
--   2) بعد التنفيذ الفعلي على Meta Marketing API، يحدّث بمفتاح service_role:
--        status ('executing'→'executed' أو 'failed')
--        execution_result (jsonb — رد Meta الخام أو ملخصه)
--        platform_campaign_id/platform_adset_id/platform_ad_id (على media_buyer_plans/الجدول المناسب)
--        error_message (لو فشل)
--        executed_at
--   مفيش أي CREATE/BUDGET CHANGE/PAUSE/RESUME يتنفذ من غير status='approved'
--   أولًا. DELETE **معطّل تمامًا** في V1 — مفيش action_type اسمه delete
--   أصلاً في الـcheck constraint فوق. مفتاح Meta وmفتاح service_role
--   Supabase بيتخزنوا server-side بس (Edge Function secret) — الداشبورد/
--   العميل (frontend) ميحملش أي منهم أبدًا، زي نفس نمط Google Service
--   Account المستخدم فعلاً في موديولي أرشيف المرضى/الليدز.
