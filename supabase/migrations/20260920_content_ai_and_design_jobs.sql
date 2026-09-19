begin;

-- Content AI: three ideas at a time, saved idea bank, and the foundation for static-design jobs.
-- Does not change existing content, video, patient, or booking data.

create table if not exists public.content_idea_bank (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.admins(id),
  source_content_id uuid references public.content_items(id) on delete set null,
  brand text not null,
  specialty text,
  advertising_objective text,
  preferred_format text,
  title text not null,
  idea text,
  hook text,
  content_angle text,
  script_text text,
  caption_text text,
  cta_type text,
  cta_text text,
  duration_min_seconds integer,
  duration_max_seconds integer,
  video_template text,
  hypothesis_reason text,
  raw_output jsonb,
  status text not null default 'saved'
    check (status in ('saved','used','discarded')),
  used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists content_idea_bank_owner_status_idx
  on public.content_idea_bank (created_by, status, created_at desc);

alter table public.content_idea_bank enable row level security;
drop policy if exists "admins read idea bank" on public.content_idea_bank;
create policy "admins read idea bank" on public.content_idea_bank for select to authenticated
using (public.my_admin_id() is not null);
grant select on public.content_idea_bank to authenticated;

create or replace function public.save_content_idea(
  p_brand text, p_specialty text, p_advertising_objective text, p_preferred_format text,
  p_title text, p_idea text, p_hook text, p_content_angle text, p_script_text text,
  p_caption_text text, p_cta_type text, p_cta_text text, p_duration_min_seconds integer,
  p_duration_max_seconds integer, p_video_template text, p_hypothesis_reason text, p_raw_output jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid;
  saved public.content_idea_bank%rowtype;
begin
  me := public.my_admin_id();
  if me is null then raise exception 'غير مسموح: المستخدم غير مسجل كموظف نشط'; end if;
  if nullif(btrim(p_title), '') is null then raise exception 'عنوان الفكرة مطلوب'; end if;
  if nullif(btrim(p_brand), '') is null then raise exception 'الصفحة مطلوبة'; end if;
  insert into public.content_idea_bank (
    created_by, brand, specialty, advertising_objective, preferred_format, title, idea, hook,
    content_angle, script_text, caption_text, cta_type, cta_text, duration_min_seconds,
    duration_max_seconds, video_template, hypothesis_reason, raw_output
  ) values (
    me, p_brand, nullif(p_specialty,''), nullif(p_advertising_objective,''), nullif(p_preferred_format,''),
    p_title, nullif(p_idea,''), nullif(p_hook,''), nullif(p_content_angle,''), nullif(p_script_text,''),
    nullif(p_caption_text,''), nullif(p_cta_type,''), nullif(p_cta_text,''), p_duration_min_seconds,
    p_duration_max_seconds, nullif(p_video_template,''), nullif(p_hypothesis_reason,''), p_raw_output
  ) returning * into saved;
  return to_jsonb(saved);
end; $$;

create or replace function public.mark_content_idea_used(p_idea_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid;
  saved public.content_idea_bank%rowtype;
begin
  me := public.my_admin_id();
  if me is null then raise exception 'غير مسموح'; end if;
  update public.content_idea_bank
     set status = 'used', used_at = now(), updated_at = now()
   where id = p_idea_id and (created_by = me or public.can_manage_all_content())
   returning * into saved;
  if not found then raise exception 'الفكرة غير موجودة أو غير مسموح'; end if;
  return to_jsonb(saved);
end; $$;

create or replace function public.discard_content_idea(p_idea_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid; saved public.content_idea_bank%rowtype;
begin
  me := public.my_admin_id();
  if me is null then raise exception 'غير مسموح'; end if;
  update public.content_idea_bank set status = 'discarded', updated_at = now()
   where id = p_idea_id and (created_by = me or public.can_manage_all_content())
   returning * into saved;
  if not found then raise exception 'الفكرة غير موجودة أو غير مسموح'; end if;
  return to_jsonb(saved);
end; $$;

revoke all on function public.save_content_idea(text,text,text,text,text,text,text,text,text,text,text,text,text,integer,integer,text,text,jsonb) from public;
grant execute on function public.save_content_idea(text,text,text,text,text,text,text,text,text,text,text,text,text,integer,integer,text,text,jsonb) to authenticated;
revoke all on function public.mark_content_idea_used(uuid) from public;
grant execute on function public.mark_content_idea_used(uuid) to authenticated;
revoke all on function public.discard_content_idea(uuid) from public;
grant execute on function public.discard_content_idea(uuid) to authenticated;

-- Static social-post pipeline. The worker will render a generated scene into a fixed brand template.
create table if not exists public.design_templates (
  id uuid primary key default gen_random_uuid(),
  brand text not null,
  name text not null,
  template_key text not null unique,
  canvas_width integer not null default 1080,
  canvas_height integer not null default 1350,
  settings jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.design_jobs (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.content_items(id) on delete cascade,
  template_id uuid references public.design_templates(id) on delete set null,
  created_by uuid not null references public.admins(id),
  status text not null default 'pending'
    check (status in ('pending','generating_scene','scene_ready','rendering','ready','failed','cancelled')),
  scene_prompt text,
  image_model text,
  image_quality text,
  attempt_count integer not null default 0,
  estimated_cost_usd numeric(10,4),
  scene_storage_path text,
  output_storage_path text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists design_jobs_content_idx on public.design_jobs(content_id, created_at desc);
alter table public.design_templates enable row level security;
alter table public.design_jobs enable row level security;
drop policy if exists "admins read design templates" on public.design_templates;
create policy "admins read design templates" on public.design_templates for select to authenticated using (public.my_admin_id() is not null);
drop policy if exists "admins read design jobs" on public.design_jobs;
create policy "admins read design jobs" on public.design_jobs for select to authenticated using (public.my_admin_id() is not null);
grant select on public.design_templates, public.design_jobs to authenticated;

commit;