-- DRAFT v2, NOT APPLIED, NOT in supabase/migrations on purpose (2026-11-04). Review and test before anyone moves it.
-- Goal: fencing for video job state changes. The current claim_next_video_job (migration 20261006) already recovers stale jobs
-- (30 min without update and no worker heartbeat for 2 min) and stops after 3 attempts, but nothing stops a "zombie" worker from writing to a job
-- that was already reclaimed and handed to another worker. This draft adds a per-claim token, a fenced update RPC, and a transition guard
-- trigger that also stops OLD (unfenced) workers from overwriting a job that is held under a token.
-- v2 changes vs v1 (found by comparing with video-worker/worker.py update_job): the whitelist now covers every column the worker really writes
-- (generation_state, archive_status, archive_error, drive_video_url/id, drive_folder_url, archived_at) and patch semantics match PostgREST PATCH
-- (explicit null clears a column, absent key keeps it).
-- Rollback (in this order): drop trigger video_jobs_fence_guard on public.video_jobs; drop function public.video_jobs_fence_guard();
--   drop function public.video_job_update_fenced(uuid,uuid,jsonb); drop function public.claim_next_video_job_fenced(text,integer);
--   alter table public.video_jobs drop column claim_token; the previous claim_next_video_job body from migration 20261006 is never touched.
alter table public.video_jobs add column if not exists claim_token uuid;

-- Thin wrapper: the existing claim function and its tests stay intact; the token is issued here.
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
  allowed text[] := array['status','progress_percent','progress_stage','error_message','output_video_url','cover_url','voiceover_url','subtitles_url',
                          'render_finished_at','generation_state','archive_status','archive_error','drive_video_url','drive_video_id','drive_folder_url','archived_at'];
  bad text;
  updated public.video_jobs%rowtype;
  cur public.video_jobs%rowtype;
  r public.video_jobs%rowtype;
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
  select * into cur from public.video_jobs where id = p_job_id for update;
  if not found or cur.claim_token is distinct from p_claim_token or cur.status not in ('preparing','rendering','uploading') then
    raise exception 'stale claim: the job was reclaimed, finished or the token is wrong';
  end if;
  r := jsonb_populate_record(cur, p_patch);     -- keys absent from the patch keep their current value; explicit null clears (PostgREST PATCH semantics)
  update public.video_jobs v
  set status = r.status, progress_percent = r.progress_percent, progress_stage = r.progress_stage, error_message = r.error_message,
      output_video_url = r.output_video_url, cover_url = r.cover_url, voiceover_url = r.voiceover_url, subtitles_url = r.subtitles_url,
      render_finished_at = r.render_finished_at, generation_state = r.generation_state, archive_status = r.archive_status,
      archive_error = r.archive_error, drive_video_url = r.drive_video_url, drive_video_id = r.drive_video_id,
      drive_folder_url = r.drive_folder_url, archived_at = r.archived_at
  where v.id = p_job_id
  returning v.* into updated;
  return to_jsonb(updated);
end;
$$;

-- Transition guard v3. It applies ONLY when the statement runs as the database role service_role, i.e. a worker writing through PostgREST with a
-- service_role key (an OLD worker, or a zombie). It is keyed on current_user (a real role switch made by PostgREST from the verified JWT), NOT on
-- JWT claims or a settable GUC, so nothing a client can send makes a statement exempt.
-- Exempt by construction: the SECURITY DEFINER functions (they run as their owner, not as service_role): claim_next_video_job and its stale
-- recovery, claim_next_video_job_fenced, video_job_update_fenced, and the dashboard RPCs (create/cancel/retry/select cover). anon/authenticated have
-- no UPDATE privilege on video_jobs at all (only SELECT through RLS), so they never reach this trigger directly.
-- A (re)claim of a pending row clears any previous token for everyone; the fenced wrapper sets the new token in a later statement.
create or replace function public.video_jobs_fence_guard()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'pending' and new.status = 'preparing' then
    new.claim_token := null;
    return new;
  end if;
  if current_user = 'service_role' and old.claim_token is not null and old.status in ('preparing','rendering','uploading') then
    raise exception 'job is held under a claim token: use video_job_update_fenced' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists video_jobs_fence_guard on public.video_jobs;
create trigger video_jobs_fence_guard before update on public.video_jobs
  for each row execute function public.video_jobs_fence_guard();

revoke all on function public.claim_next_video_job_fenced(text,integer) from public, anon, authenticated;
revoke all on function public.video_job_update_fenced(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.claim_next_video_job_fenced(text,integer) to service_role;
grant execute on function public.video_job_update_fenced(uuid,uuid,jsonb) to service_role;
