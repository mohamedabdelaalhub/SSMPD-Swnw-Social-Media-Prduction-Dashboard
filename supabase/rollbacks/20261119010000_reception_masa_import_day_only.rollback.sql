-- Rollback for 20261119010000_reception_masa_import_day_only.sql: reverse text patches, then drop the column.
begin;
do $$
declare src text; n int;
  b1 text := 'from clinic_reception.masa_bookings m where m.provider_id = p_provider and m.status = ''active''';
  a1 text := 'from clinic_reception.masa_bookings m where m.provider_id = p_provider and m.status = ''active'' and not m.day_only';
  b2 text := '''appointment_time'', to_char(m.starts_at at time zone ''Africa/Cairo'', ''HH24:MI'')) order by m.starts_at)';
  a2 text := '''appointment_time'', case when m.day_only then null else to_char(m.starts_at at time zone ''Africa/Cairo'', ''HH24:MI'') end, ''day_only'', m.day_only) order by m.starts_at)';
  b3 text := 'and m.starts_at > now() - interval ''2 hours'' and m.starts_at < now() + interval ''3 days''';
  a3 text := 'and (m.starts_at at time zone ''Africa/Cairo'')::date between (now() at time zone ''Africa/Cairo'')::date and (now() at time zone ''Africa/Cairo'')::date + 2 and (m.day_only or m.starts_at > now() - interval ''2 hours'')';
begin
  src := pg_get_functiondef('clinic_reception.slot_busy(uuid,timestamptz,timestamptz,uuid)'::regprocedure);
  n := (length(src) - length(replace(src, a1, ''))) / length(a1);
  if n <> 1 then raise exception 'slot_busy anchor found % times', n; end if;
  execute replace(src, a1, b1);
  src := pg_get_functiondef('public.clinic_reception_fallback(uuid,text,jsonb)'::regprocedure);
  n := (length(src) - length(replace(src, a2, ''))) / length(a2);
  if n <> 1 then raise exception 'list anchor 2 found % times', n; end if;
  n := (length(src) - length(replace(src, a3, ''))) / length(a3);
  if n <> 1 then raise exception 'list anchor 3 found % times', n; end if;
  execute replace(replace(src, a2, b2), a3, b3);
end $$;
revoke all on function clinic_reception.slot_busy(uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.clinic_reception_fallback(uuid, text, jsonb) from public, anon;
grant execute on function public.clinic_reception_fallback(uuid, text, jsonb) to authenticated;
drop trigger if exists masa_bookings_day_only on clinic_reception.masa_bookings;
drop function if exists clinic_reception.masa_bookings_day_only();
alter table clinic_reception.masa_bookings drop column if exists day_only;
commit;
