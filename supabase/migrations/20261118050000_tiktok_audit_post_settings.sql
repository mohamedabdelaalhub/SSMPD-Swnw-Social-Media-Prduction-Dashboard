-- TikTok Content Posting API audit: the caption the user edited in the post screen, the AI-generated
-- content flag, and database guards for the Content Sharing Guidelines rules the screen already enforces.
-- Constraints are NOT VALID so old rows are untouched; every new or updated row must satisfy them.
alter table public.tiktok_publish_jobs
  add column if not exists title text,
  add column if not exists is_aigc boolean not null default false;

alter table public.tiktok_publish_jobs drop constraint if exists tiktok_publish_jobs_title_len;
alter table public.tiktok_publish_jobs add constraint tiktok_publish_jobs_title_len
  check (title is null or char_length(title) <= 2200) not valid;

alter table public.tiktok_publish_jobs drop constraint if exists tiktok_publish_jobs_privacy_level_known;
alter table public.tiktok_publish_jobs add constraint tiktok_publish_jobs_privacy_level_known
  check (privacy_level in ('PUBLIC_TO_EVERYONE','MUTUAL_FOLLOW_FRIENDS','FOLLOWER_OF_CREATOR','SELF_ONLY')) not valid;

-- Branded content (paid partnership) can never be private.
alter table public.tiktok_publish_jobs drop constraint if exists tiktok_publish_jobs_branded_not_private;
alter table public.tiktok_publish_jobs add constraint tiktok_publish_jobs_branded_not_private
  check (not (branded_content and privacy_level = 'SELF_ONLY')) not valid;

-- Commercial disclosure on means the user picked "your brand", "branded content" or both.
alter table public.tiktok_publish_jobs drop constraint if exists tiktok_publish_jobs_commercial_choice;
alter table public.tiktok_publish_jobs add constraint tiktok_publish_jobs_commercial_choice
  check (not commercial_content or your_brand or branded_content) not valid;

-- A job the dashboard creates must carry the user's consent to TikTok's Music Usage Confirmation.
drop policy if exists "publish roles insert TikTok jobs" on public.tiktok_publish_jobs;
create policy "publish roles insert TikTok jobs" on public.tiktok_publish_jobs
 for insert to authenticated with check (
  (public.has_role('page_manager') or public.has_role('approver') or public.can_manage_all_content())
  and status='pending' and created_by=public.my_admin_id() and music_confirmation
 );
