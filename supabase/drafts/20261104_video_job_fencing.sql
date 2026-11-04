-- DRAFT v2, NOT APPLIED, NOT in supabase/migrations on purpose (2026-11-04). Review and test before anyone moves it.
-- Goal: fencing for video job state changes. The current claim_next_video_job (migration 20261006) already recovers stale jobs
-- (30 min without update and no worker heartbeat for 2 min) and stops after 3 attempts, but nothing stops a "zombie" worker from writing to a job
-- that was already reclaimed and handed to another worker. This draft adds a per-claim token, a fenced update RPC, and a transition guard
-- trigger that also stops OLD (unfenced) workers from overwriting a job that is held under a token.
-- v2 changes vs v1 (found by comparing with video-worker/worker.py update_job): the whitelist now covers every column the worker really writes
-- (generation_state, archive_status, archive_error, drive_video_url/id, drive_folder_url, archived_at) and patch semantics match PostgREST PATCH
-- (explicit null clears a column, absent key keeps it).
-- ROLLBACK LADDER (review #104: never drop claim/guard columns while a fenced worker is active; prefer reversible steps; keep committed references):
--   L0 reversible, no SQL: stop the fenced worker (or restart it WITHOUT SSMPD_FENCED_CLAIMS / SSMPD_ATTEMPT_ARCHIVE); the old worker keeps using the old claim and old Drive action.
--   L1 reversible, no drops: alter table public.video_jobs disable trigger video_jobs_fence_guard;   (re-enable with: enable trigger ...)
--   L2 only after L0 and a drain (query below returns 0): drop trigger video_jobs_fence_guard on public.video_jobs; drop function public.video_jobs_fence_guard();
--      drop function public.video_job_commit_fenced(uuid,uuid,integer,jsonb); drop function public.video_job_update_fenced(uuid,uuid,jsonb);
--      drop function public.claim_next_video_job_fenced(text,integer);   -- KEEPS the columns claim_token / committed_attempt and all drive_* values
--   L3 optional, much later, only when no fenced worker exists and the drain query is 0: alter table public.video_jobs drop column claim_token; ... drop column committed_attempt;
-- Drain query (must return 0 before L2/L3): select count(*) from public.video_jobs where claim_token is not null and status in ('preparing','rendering','uploading');
-- The previous claim_next_video_job body from migration 20261006 is never touched. committed output references live in the plain columns drive_video_url/drive_video_id/drive_folder_url/cover_url and are never dropped.
alter table public.video_jobs add column if not exists claim_token uuid;
alter table public.video_jobs add column if not exists committed_attempt integer;   -- v4: which attempt's archive was committed (NULL for legacy jobs)

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

-- Transition guard v3 (created DISABLED, see the end of this block). It applies ONLY when the statement runs as the database role service_role, i.e. a worker writing through PostgREST with a
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
-- INITIAL STATE = DISABLED (review #106): the guard is created but NOT active. Enabling it is a separate, later step that needs an independent security review:
--   alter table public.video_jobs enable trigger video_jobs_fence_guard;
alter table public.video_jobs disable trigger video_jobs_fence_guard;

revoke all on function public.claim_next_video_job_fenced(text,integer) from public, anon, authenticated;
revoke all on function public.video_job_update_fenced(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.claim_next_video_job_fenced(text,integer) to service_role;
grant execute on function public.video_job_update_fenced(uuid,uuid,jsonb) to service_role;

-- v4: attempt-scoped archive COMMIT. Drive holds one folder per attempt; the DATABASE decides which attempt wins. Only the current token holder can
-- commit, exactly once; a zombie's staged files stay in its own attempt folder and are never referenced. Idempotent for the winner (a lost response
-- can be retried safely).
create or replace function public.video_job_commit_fenced(p_job_id uuid, p_claim_token uuid, p_attempt integer, p_result jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cur public.video_jobs%rowtype;
  updated public.video_jobs%rowtype;
  cand jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service_role required';
  end if;
  if p_claim_token is null or p_attempt is null or p_attempt < 1 then
    raise exception 'claim token and attempt required';
  end if;
  if coalesce(p_result ->> 'drive_video_url', '') = '' or coalesce(p_result ->> 'drive_video_id', '') = '' then
    raise exception 'drive_video_url and drive_video_id required';
  end if;
  select * into cur from public.video_jobs where id = p_job_id for update;
  if found and cur.claim_token = p_claim_token and cur.committed_attempt = p_attempt and cur.status = 'ready' then
    -- idempotent retry of the winning commit; it also RESTORES the cover-candidate rows (reconciliation after an unknown outcome), winner only
    for cand in select * from jsonb_array_elements(coalesce(p_result -> 'cover_candidates', '[]'::jsonb)) loop
      insert into public.video_cover_candidates (id, job_id, candidate_index, timestamp_seconds, storage_path, drive_url)
      values (coalesce((cand ->> 'id')::uuid, gen_random_uuid()), p_job_id, (cand ->> 'candidate_index')::integer, (cand ->> 'timestamp_seconds')::numeric, cand ->> 'storage_path', cand ->> 'drive_url')
      on conflict (job_id, candidate_index) do update set timestamp_seconds = excluded.timestamp_seconds, storage_path = excluded.storage_path, drive_url = excluded.drive_url;
    end loop;
    return to_jsonb(cur);
  end if;
  if not found or cur.claim_token is distinct from p_claim_token or cur.status not in ('preparing','rendering','uploading') then
    raise exception 'stale claim: the job was reclaimed, finished or the token is wrong';
  end if;
  update public.video_jobs v
  set status = 'ready', archive_status = 'archived', archive_error = null, error_message = null, committed_attempt = p_attempt,
      drive_video_url = p_result ->> 'drive_video_url', drive_video_id = p_result ->> 'drive_video_id',
      drive_folder_url = p_result ->> 'drive_folder_url', cover_url = coalesce(p_result ->> 'cover_url', v.cover_url),
      output_video_url = coalesce(p_result ->> 'output_video_url', v.output_video_url),
      archived_at = now(), render_finished_at = now(), progress_percent = 100, progress_stage = 'اكتمل'
  where v.id = p_job_id
  returning v.* into updated;
  -- same transaction: either the job becomes ready WITH its candidate rows or nothing changes (a bad candidate rolls the whole commit back)
  for cand in select * from jsonb_array_elements(coalesce(p_result -> 'cover_candidates', '[]'::jsonb)) loop
    insert into public.video_cover_candidates (id, job_id, candidate_index, timestamp_seconds, storage_path, drive_url)
    values (coalesce((cand ->> 'id')::uuid, gen_random_uuid()), p_job_id, (cand ->> 'candidate_index')::integer, (cand ->> 'timestamp_seconds')::numeric, cand ->> 'storage_path', cand ->> 'drive_url')
    on conflict (job_id, candidate_index) do update set timestamp_seconds = excluded.timestamp_seconds, storage_path = excluded.storage_path, drive_url = excluded.drive_url;
  end loop;
  return to_jsonb(updated);
end;
$$;
revoke all on function public.video_job_commit_fenced(uuid,uuid,integer,jsonb) from public, anon, authenticated;
grant execute on function public.video_job_commit_fenced(uuid,uuid,integer,jsonb) to service_role;
