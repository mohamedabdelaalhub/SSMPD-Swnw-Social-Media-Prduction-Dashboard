-- Rollback for 20261119030000_reception_fallback_stale_autoresolve.sql (the 20261118180000 version).
begin;
drop function if exists clinic_reception.fallback_mark_sync(text, timestamptz);
create function clinic_reception.fallback_mark_sync(p_key text, p_generated timestamptz default null) returns void
language sql security definer set search_path = pg_catalog, public as $$
  insert into clinic_reception.fallback_sync_state(key, synced_at, source_generated_at) values (p_key, now(), p_generated)
  on conflict (key) do update set synced_at = excluded.synced_at, source_generated_at = coalesce(excluded.source_generated_at, clinic_reception.fallback_sync_state.source_generated_at)
$$;
revoke all on function clinic_reception.fallback_mark_sync(text, timestamptz) from public, anon, authenticated;
commit;
