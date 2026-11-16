-- Rollback for 20261117040000_tiktok_audit_post_settings.sql (TikTok audit post settings).
-- Drops the edited caption and AI flag (the worker falls back to the content caption) and restores the old insert policy.
begin;
drop policy if exists "publish roles insert TikTok jobs" on public.tiktok_publish_jobs;
create policy "publish roles insert TikTok jobs" on public.tiktok_publish_jobs
 for insert to authenticated with check (
  (public.has_role('page_manager') or public.has_role('approver') or public.can_manage_all_content())
  and status='pending' and created_by=public.my_admin_id()
 );
alter table public.tiktok_publish_jobs drop constraint if exists tiktok_publish_jobs_commercial_choice;
alter table public.tiktok_publish_jobs drop constraint if exists tiktok_publish_jobs_branded_not_private;
alter table public.tiktok_publish_jobs drop constraint if exists tiktok_publish_jobs_privacy_level_known;
alter table public.tiktok_publish_jobs drop constraint if exists tiktok_publish_jobs_title_len;
alter table public.tiktok_publish_jobs drop column if exists is_aigc;
alter table public.tiktok_publish_jobs drop column if exists title;
commit;
