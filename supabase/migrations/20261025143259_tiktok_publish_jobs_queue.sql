create table if not exists public.tiktok_publish_jobs (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references public.content_items(id) on delete cascade,
  brand text not null check (brand in ('sono','dr_dina')),
  scheduled_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','processing','published','partial','failed','cancelled')),
  privacy_level text not null,
  disable_comment boolean not null default true,
  disable_duet boolean not null default true,
  disable_stitch boolean not null default true,
  commercial_content boolean not null default false,
  your_brand boolean not null default false,
  branded_content boolean not null default false,
  music_confirmation boolean not null default false,
  publish_id text,
  publish_status text,
  share_url text,
  post_id text,
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  published_at timestamptz,
  error_message text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tiktok_publish_jobs_due_idx
  on public.tiktok_publish_jobs(scheduled_at)
  where status='pending';
alter table public.tiktok_publish_jobs enable row level security;
revoke all on public.tiktok_publish_jobs from anon, authenticated;
grant all on public.tiktok_publish_jobs to service_role;

create or replace function public.claim_due_tiktok_publish_jobs(p_limit integer default 5)
returns setof public.tiktok_publish_jobs
language plpgsql security definer set search_path=public
as $$
begin
 return query
 update public.tiktok_publish_jobs j
 set status='processing', attempts=j.attempts+1, last_attempt_at=now(), updated_at=now()
 where j.id in (
   select id from public.tiktok_publish_jobs
   where status='pending' and scheduled_at<=now()
   order by scheduled_at asc
   limit p_limit for update skip locked
 )
 returning j.*;
end $$;
revoke all on function public.claim_due_tiktok_publish_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_due_tiktok_publish_jobs(integer) to service_role;

create policy "publish roles read TikTok jobs" on public.tiktok_publish_jobs
 for select to authenticated using (
  public.has_role('page_manager') or public.has_role('approver') or public.can_manage_all_content()
 );
create policy "publish roles insert TikTok jobs" on public.tiktok_publish_jobs
 for insert to authenticated with check (
  (public.has_role('page_manager') or public.has_role('approver') or public.can_manage_all_content())
  and status='pending' and created_by=public.my_admin_id()
 );
create policy "publish roles cancel TikTok jobs" on public.tiktok_publish_jobs
 for update to authenticated using (
  status='pending' and (public.has_role('page_manager') or public.has_role('approver') or public.can_manage_all_content())
 ) with check (status='cancelled');