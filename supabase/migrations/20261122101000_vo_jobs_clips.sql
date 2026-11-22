-- Instinct suggested shots (owner 2026-11-22): with each voice-over Instinct also sends links to shots that fit the
-- script — optional suggestions for the reel task (Egyptian-looking people, fewer repeats), never required.
-- Delta on 20261122100000_vo_jobs.sql (already live):
-- * ops_private.vo_jobs.clips jsonb (https links only, ≤500 chars, deduped, at most 20 — ops_private.vo_clean_clips).
-- * vo_job_get returns clips; vo_worker_api 'done' also takes clips, new action 'clips' (any job up to 1 day old: links
--   can come before, with or after the mp3).
-- Rollback: supabase/rollbacks/20261122101000_vo_jobs_clips.rollback.sql
begin;

alter table ops_private.vo_jobs add column if not exists clips jsonb not null default '[]'::jsonb;

-- Suggested shot links from Instinct: keep https strings only, ≤500 chars, no duplicates, at most 20 (old ones first).
create or replace function ops_private.vo_clean_clips(p_old jsonb, p_new jsonb) returns jsonb
language sql immutable set search_path = pg_catalog as $$
  select coalesce(jsonb_agg(u order by o), '[]'::jsonb) from (
    select u, min(o) o from (
      select e.value #>> '{}' u, e.ordinality o
        from jsonb_array_elements(case when jsonb_typeof(p_old) = 'array' then p_old else '[]' end) with ordinality e
      union all
      select e.value #>> '{}', 1000 + e.ordinality
        from jsonb_array_elements(case when jsonb_typeof(p_new) = 'array' then p_new else '[]' end) with ordinality e
    ) x where u ~ '^https://[^[:space:]<>"'']+$' and char_length(u) <= 500 group by u order by min(o) limit 20) y
$$;

-- Gateway (?op=vo_fetch): status, plus the audio (base64) once done.
create or replace function public.vo_job_get(p_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, ops_private as $$
declare j ops_private.vo_jobs;
begin
  perform ops_private.vo_sweep();
  select * into j from ops_private.vo_jobs where id = p_id;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  return jsonb_strip_nulls(jsonb_build_object('status', j.status, 'voice', j.voice, 'energy', j.energy, 'error', j.error, 'clips', j.clips,
    'audio_base64', case when j.status = 'done' and j.audio is not null then encode(j.audio, 'base64') end));
end $$;

-- Worker (vo-worker edge function): lease | sent | done | fail | clips.
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
           clips = ops_private.vo_clean_clips(clips, p_payload->'clips'),
           done_at = now(), updated_at = now()
     where id = v_id and status in ('leased', 'sent');
  elsif p_action = 'fail' then
    update ops_private.vo_jobs set status = case when p_payload->>'reason' = 'timeout' then 'timeout' else 'failed' end,
           error = left(coalesce(p_payload->>'error', 'worker error'), 400), updated_at = now()
     where id = v_id and status in ('queued', 'leased', 'sent');
  elsif p_action = 'clips' then  -- links can come before, with or after the mp3 (also after a timeout: still useful)
    update ops_private.vo_jobs set clips = ops_private.vo_clean_clips(clips, p_payload->'clips'), updated_at = now()
     where id = v_id and created_at > now() - interval '1 day';
  else
    return jsonb_build_object('ok', false, 'reason', 'action');
  end if;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', v_n = 1, 'reason', case when v_n = 1 then null else 'not active' end);
end $$;

revoke all on function ops_private.vo_clean_clips(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.vo_job_get(uuid), public.vo_worker_api(text, jsonb) from public, anon, authenticated;
grant execute on function public.vo_job_get(uuid), public.vo_worker_api(text, jsonb) to service_role;

commit;
