-- YouTube auto-publishing (owner: «موافق تبني النشر الآلي على يوتيوب», 2026-11-11).
-- Two channels (sono, dr_dina), each connected once with its own Google account.
-- The Google OAuth app (client id/secret) is saved from the dashboard by a super admin into youtube_app_config:
-- nobody types it in chat, and it is never readable by dashboard users (service role only).
-- Upload runs on our server (youtube-worker.ts): resumable upload whose session URL is saved before any byte is sent,
-- so a retry asks YouTube for that same upload's status instead of uploading a second copy.

create table if not exists public.youtube_app_config (
  id smallint primary key default 1 check (id = 1),
  client_id text not null,
  client_secret text not null,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.youtube_app_config enable row level security;
revoke all on public.youtube_app_config from anon, authenticated;
grant all on public.youtube_app_config to service_role;

create table if not exists public.youtube_accounts (
  id uuid primary key default gen_random_uuid(),
  brand text not null unique check (brand in ('sono','dr_dina')),
  channel_id text not null,
  channel_title text,
  thumbnail_url text,
  refresh_token text not null,
  access_token text,
  access_token_expires_at timestamptz,
  scopes text[] not null default '{}',
  connected_by uuid,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.youtube_accounts enable row level security;
revoke all on public.youtube_accounts from anon, authenticated;
grant all on public.youtube_accounts to service_role;

create table if not exists public.youtube_oauth_states (
  state text primary key,
  brand text not null check (brand in ('sono','dr_dina')),
  admin_user_id uuid not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.youtube_oauth_states enable row level security;
revoke all on public.youtube_oauth_states from anon, authenticated;
grant all on public.youtube_oauth_states to service_role;

create table if not exists public.youtube_publish_jobs (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.content_items(id) on delete cascade,
  brand text not null check (brand in ('sono','dr_dina')),
  scheduled_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','processing','published','failed','cancelled')),
  title text not null check (char_length(title) between 1 and 100),
  privacy_status text not null default 'public' check (privacy_status in ('public','unlisted','private')),
  is_short boolean not null default true,
  upload_url text,
  video_id text,
  video_url text,
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  published_at timestamptz,
  error_message text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists youtube_publish_jobs_due_idx on public.youtube_publish_jobs(scheduled_at) where status = 'pending';
create index if not exists youtube_publish_jobs_content_idx on public.youtube_publish_jobs(content_id);
alter table public.youtube_publish_jobs enable row level security;
revoke all on public.youtube_publish_jobs from anon, authenticated;
grant select, insert on public.youtube_publish_jobs to authenticated;
grant update (status) on public.youtube_publish_jobs to authenticated;
grant all on public.youtube_publish_jobs to service_role;

drop policy if exists "publish roles read YouTube jobs" on public.youtube_publish_jobs;
create policy "publish roles read YouTube jobs" on public.youtube_publish_jobs
 for select to authenticated using (
  public.has_role('page_manager') or public.has_role('approver') or public.can_manage_all_content()
 );
drop policy if exists "publish roles insert YouTube jobs" on public.youtube_publish_jobs;
create policy "publish roles insert YouTube jobs" on public.youtube_publish_jobs
 for insert to authenticated with check (
  (public.has_role('page_manager') or public.has_role('approver') or public.can_manage_all_content())
  and status = 'pending' and created_by = public.my_admin_id()
  and upload_url is null and video_id is null and video_url is null and attempts = 0
 );
drop policy if exists "publish roles cancel YouTube jobs" on public.youtube_publish_jobs;
create policy "publish roles cancel YouTube jobs" on public.youtube_publish_jobs
 for update to authenticated using (
  status = 'pending' and upload_url is null
  and (public.has_role('page_manager') or public.has_role('approver') or public.can_manage_all_content())
 ) with check (status = 'cancelled');

-- Claim due jobs. A run that died mid-way ('processing' for 30+ min) is picked up again: safe, because the saved
-- upload_url lets the worker ask YouTube whether that upload already finished.
create or replace function public.claim_due_youtube_publish_jobs(p_limit integer default 2)
returns setof public.youtube_publish_jobs
language plpgsql security definer set search_path = public
as $$
begin
  return query
  update public.youtube_publish_jobs j
     set status = 'processing', attempts = j.attempts + 1, last_attempt_at = now(), updated_at = now()
   where j.id in (
     select id from public.youtube_publish_jobs
      where (status = 'pending' and scheduled_at <= now())
         or (status = 'processing' and last_attempt_at < now() - interval '30 minutes' and attempts < 6)
      order by scheduled_at asc
      limit p_limit for update skip locked)
  returning j.*;
end $$;
revoke all on function public.claim_due_youtube_publish_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_due_youtube_publish_jobs(integer) to service_role;

-- Rescheduling moves YouTube jobs too.
create or replace function public.reschedule_content_publish(p_id uuid, p_when timestamp with time zone)
returns jsonb
language plpgsql security definer set search_path = public
as $function$
declare item public.content_items%rowtype; me uuid := public.my_admin_id(); moved int:=0; changed int;
begin
 if me is null then raise exception 'سجّل الدخول الأول'; end if;
 if p_when is null or p_when < now() - interval '1 minute' then raise exception 'اختار ميعاد في المستقبل'; end if;
 select * into item from public.content_items where id=p_id for update;
 if not found or item.stage <> 'scheduled' then raise exception 'المادة دي مش مجدولة'; end if;
 if not (public.can_manage_all_content() or public.has_role('approver')
   or (public.has_role('page_manager') and item.created_by=me)) then
  raise exception 'غير مسموح لك بتعديل ميعاد النشر للمادة دي';
 end if;
 perform 1 from public.meta_publish_jobs where content_id=p_id for update;
 perform 1 from public.tiktok_publish_jobs where content_id=p_id for update;
 perform 1 from public.youtube_publish_jobs where content_id=p_id for update;
 if exists(select 1 from public.meta_publish_jobs where content_id=p_id and status='processing')
    or exists(select 1 from public.tiktok_publish_jobs where content_id=p_id and status='processing')
    or exists(select 1 from public.youtube_publish_jobs where content_id=p_id and status='processing') then
  raise exception 'النشر التلقائي بدأ بالفعل، مينفعش تغيّر الميعاد دلوقتي';
 end if;
 update public.meta_publish_jobs set scheduled_at=p_when where content_id=p_id and status='pending';
 get diagnostics moved = row_count;
 update public.tiktok_publish_jobs set scheduled_at=p_when,updated_at=now() where content_id=p_id and status='pending';
 get diagnostics changed = row_count; moved:=moved+changed;
 update public.youtube_publish_jobs set scheduled_at=p_when,updated_at=now() where content_id=p_id and status='pending';
 get diagnostics changed = row_count; moved:=moved+changed;
 update public.content_items set scheduled_publish_at=p_when, scheduled_by=me where id=p_id returning * into item;
 insert into public.activity_log(content_id,actor_id,action,from_stage,to_stage)
 values(p_id,me,'تعديل ميعاد النشر إلى '||to_char(p_when at time zone 'Africa/Cairo','YYYY-MM-DD HH24:MI')||' (توقيت القاهرة)','scheduled','scheduled');
 return jsonb_build_object('item',to_jsonb(item),'jobs_moved',moved);
end $function$;

-- A revision comment cancels pending YouTube jobs too (same rule as Meta/TikTok); an upload already started blocks it.
create or replace function public.comment_auto_revision()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  claude constant uuid := 'a0fbdfee-d147-4282-b988-186a9ae3e88c';
  ci public.content_items%rowtype;
  v_author uuid := new.author_id;
  v_reviewer boolean;
  v_style text;
  v_web text;
begin
  if coalesce(new.status, 'pending') <> 'pending' or v_author is null or v_author = claude then return null; end if;
  select * into ci from public.content_items where id = new.content_id for update;
  if not found or ci.stage in ('published', 'idea_selection', 'in_design') then return null; end if;
  if ci.assigned_designer is not null and v_author = ci.assigned_designer then return null; end if;
  v_reviewer := public.can_manage_all_content() or public.has_role('approver');
  if not (v_reviewer or (ci.created_by = v_author and ci.stage <> 'initial_approval')) then return null; end if;

  if ci.stage in ('initial_approval', 'final_approval', 'ready_to_publish', 'scheduled') then
    perform 1 from public.meta_publish_jobs where content_id = ci.id for update;
    if exists(select 1 from public.meta_publish_jobs where content_id = ci.id and status in ('processing','published','partial')) then return null; end if;
    if to_regclass('public.website_publications') is not null then
      execute 'select website_publish_status from public.website_publications where content_id=$1 for update' into v_web using ci.id;
      if v_web = 'processing' then return null; end if;
    end if;
    if to_regclass('public.tiktok_publish_jobs') is not null then
      perform 1 from public.tiktok_publish_jobs where content_id = ci.id for update;
      if exists(select 1 from public.tiktok_publish_jobs where content_id = ci.id and status in ('processing','published','partial')) then return null; end if;
      update public.tiktok_publish_jobs set status = 'cancelled', updated_at = now() where content_id = ci.id and status = 'pending';
    end if;
    if to_regclass('public.youtube_publish_jobs') is not null then
      perform 1 from public.youtube_publish_jobs where content_id = ci.id for update;
      if exists(select 1 from public.youtube_publish_jobs where content_id = ci.id and (status in ('processing','published') or upload_url is not null)) then return null; end if;
      update public.youtube_publish_jobs set status = 'cancelled', updated_at = now() where content_id = ci.id and status = 'pending';
    end if;
    update public.meta_publish_jobs set status = 'cancelled' where content_id = ci.id and status = 'pending';
    perform set_config('ssmpd.comment_revision', ci.id::text, true);
    update public.content_items set stage = 'needs_revision', scheduled_publish_at = null, scheduled_by = null
      where id = ci.id;
    perform set_config('ssmpd.comment_revision', '', true);
    insert into public.activity_log(content_id, actor_id, action, from_stage, to_stage)
      values (ci.id, v_author, 'طلب تعديل (تعليق)', ci.stage, 'needs_revision');
  elsif ci.stage = 'needs_revision' then
    perform set_config('ssmpd.comment_revision', ci.id::text, true);
    update public.content_items set stage = 'needs_revision' where id = ci.id;
    perform set_config('ssmpd.comment_revision', '', true);
  else
    return null;
  end if;

  if ci.assigned_designer = claude and to_regclass('public.claude_design_requests') is not null then
    select style into v_style from public.claude_design_requests where content_id = ci.id order by created_at desc limit 1;
    insert into public.claude_design_requests(content_id, style, requested_by, status, note)
      values (ci.id, coalesce(v_style, 'photo'), v_author, 'pending', 'تعديل تلقائي من تعليق جديد')
      on conflict (content_id) where status in ('pending','working') do nothing;
  end if;
  return null;
end $function$;

-- Realtime for the publish tab (same as the other job tables)
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'youtube_publish_jobs') then
    execute 'alter publication supabase_realtime add table public.youtube_publish_jobs';
  end if;
end $$;
