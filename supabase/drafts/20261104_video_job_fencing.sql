-- DRAFT, NOT APPLIED, NOT in supabase/migrations on purpose (2026-11-04). Review and test before anyone moves it.
-- Goal: fencing for video job state changes. The current claim_next_video_job (migration 20261006) already recovers stale jobs
-- (30 min without update and no worker heartbeat for 2 min) and stops after 3 attempts, but nothing stops a "zombie" worker from writing to a job
-- that was already reclaimed and handed to another worker. This draft adds a per-claim token and a fenced update RPC.
-- Rollback: drop function public.video_job_update_fenced(uuid,uuid,jsonb); alter table public.video_jobs drop column claim_token;
--           restore the previous claim_next_video_job body from migration 20261006 (kept untouched).
alter table public.video_jobs add column if not exists claim_token uuid;

-- The claim function is NOT redefined here (no behaviour change to live claiming in this draft). Instead the token is issued by a thin wrapper
-- so the existing function and its tests stay intact:
create or replace function public.claim_next_video_job_fenced(p_worker_id text, p_max_input_schema_version integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed jsonb;
  job_id uuid;
  token uuid := gen_random_uuid();
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service_role required';
  end if;
  claimed := public.claim_next_video_job(p_worker_id, p_max_input_schema_version);
  if claimed is null then
    return null;
  end if;
  job_id := (claimed ->> 'id')::uuid;
  update public.video_jobs set claim_token = token where id = job_id;
  return claimed || jsonb_build_object('claim_token', token);
end;
$$;

-- Fenced update: only the CURRENT token holder may change a job, only whitelisted columns, and only while the job is in a working state.
create or replace function public.video_job_update_fenced(p_job_id uuid, p_claim_token uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed text[] := array['status','progress_percent','progress_stage','error_message','output_video_url','cover_url','voiceover_url','subtitles_url','render_finished_at'];
  bad text;
  updated public.video_jobs%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service_role required';
  end if;
  if p_claim_token is null then
    raise exception 'claim token required';
  end if;
  select k into bad from jsonb_object_keys(p_patch) k where k <> all(allowed) limit 1;
  if bad is not null then
    raise exception 'column not allowed: %', bad;
  end if;
  update public.video_jobs v
  set status = coalesce(p_patch ->> 'status', v.status),
      progress_percent = coalesce((p_patch ->> 'progress_percent')::integer, v.progress_percent),
      progress_stage = coalesce(p_patch ->> 'progress_stage', v.progress_stage),
      error_message = case when p_patch ? 'error_message' then p_patch ->> 'error_message' else v.error_message end,
      output_video_url = coalesce(p_patch ->> 'output_video_url', v.output_video_url),
      cover_url = coalesce(p_patch ->> 'cover_url', v.cover_url),
      voiceover_url = coalesce(p_patch ->> 'voiceover_url', v.voiceover_url),
      subtitles_url = coalesce(p_patch ->> 'subtitles_url', v.subtitles_url),
      render_finished_at = coalesce((p_patch ->> 'render_finished_at')::timestamptz, v.render_finished_at)
  where v.id = p_job_id
    and v.claim_token = p_claim_token
    and v.status in ('preparing','rendering','uploading')
  returning * into updated;
  if not found then
    raise exception 'stale claim: the job was reclaimed, finished or the token is wrong';
  end if;
  return to_jsonb(updated);
end;
$$;

revoke all on function public.claim_next_video_job_fenced(text,integer) from public, anon, authenticated;
revoke all on function public.video_job_update_fenced(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.claim_next_video_job_fenced(text,integer) to service_role;
grant execute on function public.video_job_update_fenced(uuid,uuid,jsonb) to service_role;
