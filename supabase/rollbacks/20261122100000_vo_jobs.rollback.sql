-- Rollback of 20261122100000_vo_jobs.sql: removes the Instinct voice-over job queue. The reel task then uses ElevenLabs
-- op=tts only (its fallback). Deploy the previous claude-automation first, and stop/undeploy vo-worker.
begin;
drop function if exists public.vo_worker_api(text, jsonb);
drop function if exists public.vo_job_get(uuid);
drop function if exists public.vo_job_submit(text, text, text, text);
drop function if exists ops_private.vo_sweep();
drop function if exists ops_private.vo_looks_personal(text);
drop table if exists ops_private.vo_jobs;
-- ops_private is kept (it may hold other objects later); drop it by hand if empty.
commit;
