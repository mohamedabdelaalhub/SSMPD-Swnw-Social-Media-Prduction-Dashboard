-- Instinct voice-over jobs for the daily reel task (owner 2026-11-22, via main chat 4: «عايزين نظبط الدايرة دي مع كلود
-- اللي بيعمل المحتوى»). The reel task asks for a narrator take through the gateway (claude-automation ?op=vo_submit /
-- ?op=vo_fetch); the voice-over worker on swnw-vps (ops/vo-worker/vo.py) takes the job through the vo-worker edge
-- function, e-mails the script to Instinct, and hands back the MP3. ElevenLabs op=tts stays the automatic fallback.
-- * ops_private.vo_jobs: one row per take. Scripts only — the submit function refuses anything that looks like a phone
--   number or national ID (8+ digits in a row, the center's own two numbers excepted). Never patient data.
-- * Every function is SECURITY DEFINER, EXECUTE for service_role only (the two edge functions); no table access for
--   anon/authenticated. Nothing here is visible in the dashboard.
-- * A job not done 15 minutes after it was asked for becomes «timeout» (the reel task has already fallen back by then).
--   Audio older than 7 days is dropped.
-- Rollback: supabase/rollbacks/20261122100000_vo_jobs.rollback.sql
begin;

create schema if not exists ops_private;
revoke all on schema ops_private from public, anon, authenticated;

create table if not exists ops_private.vo_jobs (
  id uuid primary key default gen_random_uuid(),
  script text not null check (char_length(script) between 1 and 2500),
  voice_requested text not null default 'auto' check (voice_requested in ('auto', 'female', 'male')),
  voice text check (voice in ('female', 'male')),
  energy text not null default 'moderate' check (energy in ('calm', 'moderate', 'energetic')),
  notes text check (notes is null or char_length(notes) <= 300),
  status text not null default 'queued' check (status in ('queued', 'leased', 'sent', 'done', 'timeout', 'failed')),
  attempts int not null default 0,
  worker text,
  message_id text,
  audio bytea,
  audio_bytes int,
  error text,
  created_at timestamptz not null default now(),
  leased_at timestamptz,
  sent_at timestamptz,
  done_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists vo_jobs_status_idx on ops_private.vo_jobs (status, created_at);
revoke all on ops_private.vo_jobs from public, anon, authenticated;

-- 8+ digits in a row (Arabic-Indic digits too, spaces/dashes/dots between digits ignored) = looks like a phone/ID.
create or replace function ops_private.vo_looks_personal(p text) returns boolean
language sql immutable set search_path = pg_catalog as $$
  select regexp_replace(
           replace(replace(translate(coalesce(p, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'),
                           '01010686264', ''), '0236230005', ''),  -- the center's own landline and mobile are fine in a CTA
           '([0-9])[[:space:].-]+(?=[0-9])', '\1', 'g') ~ '[0-9]{8,}'
$$;

-- Lazy clean-up, run by every call below: 15-minute timeout, stale leases back to the queue, old audio dropped.
create or replace function ops_private.vo_sweep() returns void
language plpgsql security definer set search_path = pg_catalog, ops_private as $$
begin
  update ops_private.vo_jobs set status = 'timeout', error = coalesce(error, 'no voice within 15 minutes'), updated_at = now()
   where status in ('queued', 'leased', 'sent') and created_at < now() - interval '15 minutes';
  update ops_private.vo_jobs set status = case when attempts >= 3 then 'failed' else 'queued' end,
         error = case when attempts >= 3 then 'worker lease expired 3 times' else error end, worker = null, updated_at = now()
   where status = 'leased' and leased_at < now() - interval '5 minutes';
  update ops_private.vo_jobs set audio = null, updated_at = now()
   where audio is not null and created_at < now() - interval '7 days';
end $$;

-- Gateway (claude-automation ?op=vo_submit): returns the new job id.
create or replace function public.vo_job_submit(p_script text, p_voice text default 'auto', p_energy text default 'moderate', p_notes text default null)
returns uuid language plpgsql security definer set search_path = pg_catalog, ops_private as $$
declare v_script text := btrim(coalesce(p_script, '')); v_notes text := nullif(btrim(coalesce(p_notes, '')), ''); v_id uuid;
begin
  perform ops_private.vo_sweep();
  if char_length(v_script) not between 1 and 2500 then raise exception 'vo: script 1..2500 chars' using errcode = '22023'; end if;
  if coalesce(p_voice, 'auto') not in ('auto', 'female', 'male') then raise exception 'vo: voice auto|female|male' using errcode = '22023'; end if;
  if coalesce(p_energy, 'moderate') not in ('calm', 'moderate', 'energetic') then raise exception 'vo: energy calm|moderate|energetic' using errcode = '22023'; end if;
  if v_notes is not null and char_length(v_notes) > 300 then raise exception 'vo: notes up to 300 chars' using errcode = '22023'; end if;
  if ops_private.vo_looks_personal(v_script) or ops_private.vo_looks_personal(v_notes) then
    raise exception 'vo: looks like a phone number or ID — scripts only, never patient data' using errcode = '22023';
  end if;
  if (select count(*) from ops_private.vo_jobs where created_at > now() - interval '1 hour') >= 20 then
    raise exception 'vo: rate limit (20 per hour)' using errcode = '54000';
  end if;
  if (select count(*) from ops_private.vo_jobs where status in ('queued', 'leased', 'sent')) >= 6 then
    raise exception 'vo: too many open jobs (6)' using errcode = '54000';
  end if;
  insert into ops_private.vo_jobs (script, voice_requested, energy, notes)
  values (v_script, coalesce(p_voice, 'auto'), coalesce(p_energy, 'moderate'), v_notes) returning id into v_id;
  return v_id;
end $$;

-- Gateway (?op=vo_fetch): status, plus the audio (base64) once done.
create or replace function public.vo_job_get(p_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, ops_private as $$
declare j ops_private.vo_jobs;
begin
  perform ops_private.vo_sweep();
  select * into j from ops_private.vo_jobs where id = p_id;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  return jsonb_strip_nulls(jsonb_build_object('status', j.status, 'voice', j.voice, 'energy', j.energy, 'error', j.error,
    'audio_base64', case when j.status = 'done' and j.audio is not null then encode(j.audio, 'base64') end));
end $$;

-- Worker (vo-worker edge function): lease | sent | done | fail.
create or replace function public.vo_worker_api(p_action text, p_payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, ops_private as $$
declare v_id uuid; v_audio bytea; v_n int; v_out jsonb;
begin
  perform ops_private.vo_sweep();
  if p_action = 'lease' then
    with picked as (
      select id from ops_private.vo_jobs where status = 'queued' order by created_at
       limit least(greatest(coalesce((p_payload->>'limit')::int, 3), 1), 6) for update skip locked),
    upd as (
      update ops_private.vo_jobs j set status = 'leased', leased_at = now(), attempts = attempts + 1,
             worker = left(coalesce(p_payload->>'worker', 'vo-worker'), 60), updated_at = now()
        from picked where j.id = picked.id
      returning j.id, j.script, j.voice_requested, j.energy, j.notes, j.created_at)
    select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', id, 'script', script, 'voice', voice_requested,
             'energy', energy, 'notes', notes)) order by created_at), '[]'::jsonb)
      into v_out from upd;
    return jsonb_build_object('ok', true, 'jobs', v_out);
  end if;

  begin v_id := (p_payload->>'id')::uuid; exception when others then v_id := null; end;
  if v_id is null then return jsonb_build_object('ok', false, 'reason', 'id'); end if;

  if p_action = 'sent' then
    if coalesce(p_payload->>'voice', '') not in ('female', 'male') then return jsonb_build_object('ok', false, 'reason', 'voice'); end if;
    update ops_private.vo_jobs set status = 'sent', voice = p_payload->>'voice', message_id = left(p_payload->>'message_id', 300),
           sent_at = now(), updated_at = now()
     where id = v_id and status in ('leased', 'queued');
  elsif p_action = 'done' then
    begin v_audio := decode(p_payload->>'audio_base64', 'base64'); exception when others then v_audio := null; end;
    if v_audio is null or length(v_audio) < 1000 or length(v_audio) > 10000000 then
      return jsonb_build_object('ok', false, 'reason', 'audio size');
    end if;
    -- MP3: an ID3 tag or an MPEG frame sync.
    if not (substring(v_audio from 1 for 3) = '\x494433'::bytea or (get_byte(v_audio, 0) = 255 and get_byte(v_audio, 1) >= 224)) then
      return jsonb_build_object('ok', false, 'reason', 'not mp3');
    end if;
    update ops_private.vo_jobs set status = 'done', audio = v_audio, audio_bytes = length(v_audio), error = null,
           done_at = now(), updated_at = now()
     where id = v_id and status in ('leased', 'sent');
  elsif p_action = 'fail' then
    update ops_private.vo_jobs set status = case when p_payload->>'reason' = 'timeout' then 'timeout' else 'failed' end,
           error = left(coalesce(p_payload->>'error', 'worker error'), 400), updated_at = now()
     where id = v_id and status in ('queued', 'leased', 'sent');
  else
    return jsonb_build_object('ok', false, 'reason', 'action');
  end if;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', v_n = 1, 'reason', case when v_n = 1 then null else 'not active' end);
end $$;

revoke all on function ops_private.vo_looks_personal(text), ops_private.vo_sweep() from public, anon, authenticated;
revoke all on function public.vo_job_submit(text, text, text, text), public.vo_job_get(uuid), public.vo_worker_api(text, jsonb)
  from public, anon, authenticated;
grant usage on schema ops_private to service_role;
grant execute on function public.vo_job_submit(text, text, text, text), public.vo_job_get(uuid), public.vo_worker_api(text, jsonb)
  to service_role;

commit;
