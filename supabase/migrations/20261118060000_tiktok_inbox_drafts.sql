-- "Send to TikTok as a draft": the Content Posting API Upload flow (video.upload) puts the video in the creator's
-- TikTok inbox; the owner adds caption/cover and taps Post in the TikTok app. Works before the Direct Post audit.
-- Only a super admin can queue it, only through queue_tiktok_inbox_draft(), and a reel can't be sent twice by accident
-- (a failed or cancelled send can be retried). The same tiktok-publish-process worker uploads it.
alter table public.tiktok_publish_jobs
  add column if not exists mode text not null default 'direct';
alter table public.tiktok_publish_jobs drop constraint if exists tiktok_publish_jobs_mode_known;
alter table public.tiktok_publish_jobs add constraint tiktok_publish_jobs_mode_known check (mode in ('direct','inbox'));
-- Inbox drafts carry no privacy (the owner picks it in the TikTok app); direct posts still must.
alter table public.tiktok_publish_jobs alter column privacy_level drop not null;
alter table public.tiktok_publish_jobs drop constraint if exists tiktok_publish_jobs_direct_has_privacy;
alter table public.tiktok_publish_jobs add constraint tiktok_publish_jobs_direct_has_privacy
  check (mode = 'inbox' or privacy_level is not null) not valid;

create unique index if not exists tiktok_publish_jobs_one_inbox_draft
  on public.tiktok_publish_jobs (content_id)
  where mode = 'inbox' and status not in ('failed','cancelled');

-- The dashboard's own insert policy only creates direct posts; drafts go through the function below.
drop policy if exists "publish roles insert TikTok jobs" on public.tiktok_publish_jobs;
create policy "publish roles insert TikTok jobs" on public.tiktok_publish_jobs
 for insert to authenticated with check (
  (public.has_role('page_manager') or public.has_role('approver') or public.can_manage_all_content())
  and status='pending' and created_by=public.my_admin_id() and music_confirmation and mode='direct'
 );

create or replace function public.queue_tiktok_inbox_draft(p_content_id uuid)
returns public.tiktok_publish_jobs
language plpgsql security definer set search_path = public
as $$
declare ci public.content_items%rowtype; acct record; job public.tiktok_publish_jobs%rowtype; me uuid := public.my_admin_id();
begin
  if me is null or not public.is_super() then raise exception 'إرسال مسودة TikTok للسوبر أدمن بس'; end if;
  select * into ci from public.content_items where id = p_content_id for update;
  if not found then raise exception 'المادة مش موجودة'; end if;
  if ci.content_format is distinct from 'video' or coalesce(ci.design_file_url,'') = '' then raise exception 'مسودة TikTok للفيديوهات اللي ليها ملف بس'; end if;
  if ci.brand is distinct from 'sono' and ci.brand is distinct from 'dr_dina' then raise exception 'حدد صفحة المادة (سونو أو د.دينا) الأول'; end if;
  select scopes into acct from public.tiktok_accounts where brand = ci.brand;
  if not found then raise exception 'حساب TikTok للصفحة دي مش مربوط'; end if;
  if not ('video.upload' = any(acct.scopes)) then raise exception 'أعد ربط حساب TikTok من الداشبورد عشان صلاحية المسودات (video.upload)'; end if;
  if exists (select 1 from public.tiktok_publish_jobs where content_id = p_content_id and mode = 'inbox' and status not in ('failed','cancelled')) then
    raise exception 'الفيديو ده اتبعت لـTikTok كمسودة قبل كده';
  end if;
  insert into public.tiktok_publish_jobs(content_id, brand, scheduled_at, status, mode, privacy_level, music_confirmation, created_by)
  values (p_content_id, ci.brand, now(), 'pending', 'inbox', null, false, me)
  returning * into job;
  insert into public.activity_log(content_id, actor_id, action, from_stage, to_stage)
  values (p_content_id, me, 'إرسال الفيديو لـTikTok كمسودة', ci.stage, ci.stage);
  return job;
end $$;
revoke all on function public.queue_tiktok_inbox_draft(uuid) from public, anon;
grant execute on function public.queue_tiktok_inbox_draft(uuid) to authenticated;
