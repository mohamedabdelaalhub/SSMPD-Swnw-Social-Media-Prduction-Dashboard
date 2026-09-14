begin;

-- العامل المحلي يحدّث هذه النبضة مرة كل دقيقة.
create table if not exists public.video_worker_heartbeats (
  worker_id text primary key,
  status text not null default 'idle'
    check (status in ('idle','working','error')),
  current_job_id uuid null,
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists video_worker_heartbeats_last_seen_idx
  on public.video_worker_heartbeats (last_seen_at desc);

alter table public.video_worker_heartbeats enable row level security;

drop policy if exists "active admins read video worker heartbeats" on public.video_worker_heartbeats;
create policy "active admins read video worker heartbeats"
  on public.video_worker_heartbeats for select to authenticated
  using (public.my_admin_id() is not null);

grant select on public.video_worker_heartbeats to authenticated;

create or replace function public.video_worker_heartbeat(
  p_worker_id text,
  p_status text default 'idle',
  p_current_job_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  saved public.video_worker_heartbeats%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service_role required';
  end if;

  if p_status not in ('idle','working','error') then
    raise exception 'invalid worker status';
  end if;

  if nullif(btrim(p_worker_id), '') is null then
    raise exception 'worker id required';
  end if;

  insert into public.video_worker_heartbeats (
    worker_id, status, current_job_id, last_seen_at, updated_at
  ) values (
    btrim(p_worker_id), p_status, p_current_job_id, now(), now()
  )
  on conflict (worker_id) do update set
    status = excluded.status,
    current_job_id = excluded.current_job_id,
    last_seen_at = excluded.last_seen_at,
    updated_at = excluded.updated_at
  returning * into saved;

  return to_jsonb(saved);
end;
$$;

revoke all on function public.video_worker_heartbeat(text,text,uuid) from public;
revoke all on function public.video_worker_heartbeat(text,text,uuid) from anon;
revoke all on function public.video_worker_heartbeat(text,text,uuid) from authenticated;
grant execute on function public.video_worker_heartbeat(text,text,uuid) to service_role;

-- لا نعيد محاولة الوظيفة إذا كان العامل الذي يملكها ما زال يرسل نبضة.
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

  -- الوظائف التي تجاوزت ثلاث محاولات تحتاج مراجعة من الداشبورد.
  update public.video_jobs v
  set status = 'failed',
      error_message = 'تم إيقاف المحاولات بعد 3 محاولات غير مكتملة.',
      render_finished_at = now(),
      worker_id = null
  where v.status in ('preparing','rendering','uploading')
    and v.updated_at < now() - interval '30 minutes'
    and v.attempt_count >= 3
    and not exists (
      select 1 from public.video_worker_heartbeats h
      where h.current_job_id = v.id
        and h.last_seen_at >= now() - interval '2 minutes'
    );

  -- استرجاع الوظائف المتوقفة فقط بعد انقطاع العامل عنها.
  update public.video_jobs v
  set status = 'pending',
      worker_id = null,
      error_message = 'استرجع النظام الوظيفة بعد توقف العامل.',
      render_started_at = null
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
      render_started_at = now()
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
