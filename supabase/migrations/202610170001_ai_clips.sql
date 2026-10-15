-- لقطات فيديو Gemini (Veo): إعدادات + أسعار + طلبات + ميزانية شهرية بالجنيه. مُطبَّق على القاعدة الحية.
-- الدالة: supabase/functions/ai-clip-process (cron كل دقيقة، بتشتغل بس لو فيه طلبات). الناتج على الدرايف (ماتيريال / لقطات Gemini) عبر apps-script action=material_library.

create table if not exists public.ai_clip_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  auto_enqueue boolean not null default true,
  monthly_budget_egp numeric not null default 500 check (monthly_budget_egp >= 0),
  usd_to_egp numeric not null default 52.5 check (usd_to_egp > 0),
  default_model text not null default 'veo-3.1-fast-generate-preview',
  clip_seconds integer not null default 8 check (clip_seconds in (4,6,8)),
  resolution text not null default '720p',
  aspect_ratio text not null default '9:16',
  updated_at timestamptz not null default now()
);
insert into public.ai_clip_settings(id) values (true) on conflict do nothing;

create table if not exists public.ai_clip_prices (
  model text primary key,
  usd_per_second numeric not null check (usd_per_second >= 0),
  note text not null default ''
);
insert into public.ai_clip_prices(model, usd_per_second, note) values
  ('veo-3.1-lite-generate-preview', 0.05, '720p'),
  ('veo-3.1-fast-generate-preview', 0.10, '720p'),
  ('veo-3.1-generate-preview', 0.40, '720p')
on conflict (model) do nothing;

create table if not exists public.ai_clip_jobs (
  id uuid primary key default gen_random_uuid(),
  content_id uuid references public.content_items(id) on delete set null,
  title text not null default '',
  source text not null default 'manual' check (source in ('auto','manual')),
  status text not null default 'queued' check (status in ('queued','submitted','done','failed','skipped_budget','cancelled')),
  prompt text, model text not null, seconds integer not null default 8,
  operation_name text, est_cost_usd numeric, usd_to_egp_at_submit numeric,
  attempts integer not null default 0, next_attempt_at timestamptz not null default now(),
  drive_file_id text, drive_url text, error text,
  requested_by uuid references public.admins(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), completed_at timestamptz
);
create index if not exists ai_clip_jobs_status_idx on public.ai_clip_jobs(status, next_attempt_at);
create index if not exists ai_clip_jobs_content_idx on public.ai_clip_jobs(content_id, created_at desc);
create unique index if not exists ai_clip_jobs_one_auto_per_item on public.ai_clip_jobs(content_id) where source = 'auto';

alter table public.ai_clip_settings enable row level security;
alter table public.ai_clip_prices enable row level security;
alter table public.ai_clip_jobs enable row level security;
create policy ai_clip_settings_read on public.ai_clip_settings for select to authenticated using (public.my_role() in ('super_admin','general_manager','designer','page_manager'));
create policy ai_clip_prices_read on public.ai_clip_prices for select to authenticated using (public.my_role() in ('super_admin','general_manager','designer','page_manager'));
create policy ai_clip_jobs_read on public.ai_clip_jobs for select to authenticated using (public.my_role() in ('super_admin','general_manager','designer','page_manager'));

-- المصروف الشهري بالجنيه (توقيت القاهرة): التقدير × سعر الصرف وقت الإرسال، لأي طلب اتبعت لجوجل.
create or replace function public.ai_clip_month_spent_egp() returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(est_cost_usd * coalesce(usd_to_egp_at_submit, (select usd_to_egp from public.ai_clip_settings))), 0)
    from public.ai_clip_jobs
   where operation_name is not null
     and created_at >= (date_trunc('month', now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo');
$$;
revoke all on function public.ai_clip_month_spent_egp() from public, anon;

-- ai_clip_overview / ai_clip_request / ai_clip_cancel / ai_clip_save_settings / ai_clip_auto_enqueue (+ trigger trg_ai_clip_auto_enqueue على content_items.stage)
-- مُطبَّقة في القاعدة الحية؛ انظر تعريفاتها بـ pg_get_functiondef. الـ trigger مغلّف بـ exception عشان ما يوقفش سير الاعتماد أبداً.
-- cron: 'ai-clip-process' كل دقيقة بس لو فيه طلبات queued/submitted.
