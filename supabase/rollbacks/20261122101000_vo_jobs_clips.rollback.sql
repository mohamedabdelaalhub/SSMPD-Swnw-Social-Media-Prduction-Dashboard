-- Rollback of 20261122101000_vo_jobs_clips.sql: the two functions as in 20261122100000, then the clips column and helper go.
-- Deploy the claude-automation / vo.py of 20261122100000 first (they must not send clips any more).
begin;

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

revoke all on function public.vo_job_get(uuid), public.vo_worker_api(text, jsonb) from public, anon, authenticated;
grant execute on function public.vo_job_get(uuid), public.vo_worker_api(text, jsonb) to service_role;
drop function if exists ops_private.vo_clean_clips(jsonb, jsonb);
alter table ops_private.vo_jobs drop column if exists clips;

commit;
