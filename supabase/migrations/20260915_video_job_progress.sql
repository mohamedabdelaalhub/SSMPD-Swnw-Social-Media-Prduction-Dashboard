begin;

alter table public.video_jobs
  add column if not exists progress_percent integer not null default 0
  check (progress_percent between 0 and 100),
  add column if not exists progress_stage text not null default 'في الانتظار';

update public.video_jobs
set progress_percent = case status
      when 'preparing' then 15
      when 'rendering' then 55
      when 'uploading' then 85
      when 'ready' then 100
      else 0
    end,
    progress_stage = case status
      when 'preparing' then 'تجهيز الملفات'
      when 'rendering' then 'إنتاج الفيديو والصوت'
      when 'uploading' then 'حفظ الفيديو والأغلفة'
      when 'ready' then 'اكتمل'
      when 'failed' then 'تحتاج مراجعة'
      else 'في الانتظار'
    end
where progress_percent = 0
  and progress_stage = 'في الانتظار';

create or replace function public.claim_next_video_job(p_worker_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.video_jobs%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service_role required';
  end if;

  update public.video_jobs v
  set status = 'failed',
      error_message = 'تم إيقاف المحاولات بعد 3 محاولات غير مكتملة.',
      render_finished_at = now(),
      worker_id = null,
      progress_percent = 0,
      progress_stage = 'تحتاج مراجعة'
  where v.status in ('preparing','rendering','uploading')
    and v.updated_at < now() - interval '30 minutes'
    and v.attempt_count >= 3
    and not exists (
      select 1 from public.video_worker_heartbeats h
      where h.current_job_id = v.id
        and h.last_seen_at >= now() - interval '2 minutes'
    );

  update public.video_jobs v
  set status = 'pending',
      worker_id = null,
      error_message = 'استرجع النظام الوظيفة بعد توقف العامل.',
      render_started_at = null,
      progress_percent = 0,
      progress_stage = 'في الانتظار'
  where v.status in ('preparing','rendering','uploading')
    and v.updated_at < now() - interval '30 minutes'
    and v.attempt_count < 3
    and not exists (
      select 1 from public.video_worker_heartbeats h
      where h.current_job_id = v.id
        and h.last_seen_at >= now() - interval '2 minutes'
    );

  with next_job as (
    select id
    from public.video_jobs
    where status = 'pending'
    order by created_at asc
    for update skip locked
    limit 1
  )
  update public.video_jobs v
  set status = 'preparing',
      worker_id = nullif(btrim(p_worker_id), ''),
      attempt_count = v.attempt_count + 1,
      error_message = null,
      render_started_at = now(),
      progress_percent = 15,
      progress_stage = 'تجهيز الملفات'
  from next_job
  where v.id = next_job.id
  returning v.* into claimed;

  if not found then
    return null;
  end if;

  return to_jsonb(claimed);
end;
$$;

revoke all on function public.claim_next_video_job(text) from public;
revoke all on function public.claim_next_video_job(text) from anon;
revoke all on function public.claim_next_video_job(text) from authenticated;
grant execute on function public.claim_next_video_job(text) to service_role;

commit;
