-- «المواعيد الاحتياطية قديمة» alerts close themselves once both Masa syncs (schedule + bookings) are fresh again
-- (< 60 min). Main chat 2026-11-19: 3 stale_sync alerts were left open from before the Masa mirror was enabled.
-- Open system alerts are deleted (not marked resolved) so a later stale period in the same hour can alert again.
-- The next sync after deploy clears the 3 open ones.
begin;
create or replace function clinic_reception.fallback_mark_sync(p_key text, p_generated timestamptz default null) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  insert into clinic_reception.fallback_sync_state(key, synced_at, source_generated_at) values (p_key, now(), p_generated)
  on conflict (key) do update set synced_at = excluded.synced_at,
    source_generated_at = coalesce(excluded.source_generated_at, clinic_reception.fallback_sync_state.source_generated_at);
  if (select count(*) from clinic_reception.fallback_sync_state where synced_at > now() - interval '60 minutes') = 2 then
    delete from clinic_reception.fallback_alerts where kind = 'stale_sync' and resolved_at is null;
  end if;
end $$;
revoke all on function clinic_reception.fallback_mark_sync(text, timestamptz) from public, anon, authenticated;
commit;
