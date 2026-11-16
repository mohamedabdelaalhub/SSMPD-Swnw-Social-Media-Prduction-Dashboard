-- Rollback for 20261117050000_tiktok_inbox_drafts.sql (send to TikTok as a draft).
-- Draft rows (pending or sent) are deleted, because they have no privacy_level
-- and privacy_level goes back to NOT NULL. Direct-post rows are untouched.
begin;
drop function if exists public.queue_tiktok_inbox_draft(uuid);
delete from public.tiktok_publish_jobs where mode = 'inbox';
drop policy if exists "publish roles insert TikTok jobs" on public.tiktok_publish_jobs;
create policy "publish roles insert TikTok jobs" on public.tiktok_publish_jobs
 for insert to authenticated with check (
  (public.has_role('page_manager') or public.has_role('approver') or public.can_manage_all_content())
  and status='pending' and created_by=public.my_admin_id() and music_confirmation
 );
drop index if exists public.tiktok_publish_jobs_one_inbox_draft;
alter table public.tiktok_publish_jobs drop constraint if exists tiktok_publish_jobs_direct_has_privacy;
alter table public.tiktok_publish_jobs alter column privacy_level set not null;
alter table public.tiktok_publish_jobs drop constraint if exists tiktok_publish_jobs_mode_known;
alter table public.tiktok_publish_jobs drop column if exists mode;
commit;
