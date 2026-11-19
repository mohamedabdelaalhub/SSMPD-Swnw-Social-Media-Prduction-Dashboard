-- Masa bookings without a time (WhatsApp-agent chat, 2026-11-19, before enabling the mirror): reception often books a
-- DAY in Masa with no appointment time, and Masa stores 00:00 (88 of 108 bookings 2026-11-18..12-03).
-- * masa_bookings.day_only (set by trigger when the Cairo time is 00:00): never blocks a fallback slot.
-- * Reception's «حجوزات اتعملت على ماسا مباشرة» list is now by Cairo day (today + 2) and shows day-only ones as
--   «بدون ميعاد» (before, a 00:00 booking vanished from today's list after 02:00).
-- In-place text patches (exact anchors, each must occur once) of slot_busy and public.clinic_reception_fallback.
begin;

alter table clinic_reception.masa_bookings add column if not exists day_only boolean not null default false;

create or replace function clinic_reception.masa_bookings_day_only() returns trigger language plpgsql as $$
begin
  new.day_only := (new.starts_at at time zone 'Africa/Cairo')::time = time '00:00';
  return new;
end $$;
drop trigger if exists masa_bookings_day_only on clinic_reception.masa_bookings;
create trigger masa_bookings_day_only before insert or update of starts_at on clinic_reception.masa_bookings
  for each row execute function clinic_reception.masa_bookings_day_only();
update clinic_reception.masa_bookings set day_only = (starts_at at time zone 'Africa/Cairo')::time = time '00:00';
revoke all on function clinic_reception.masa_bookings_day_only() from public, anon, authenticated;

do $$
declare src text; n int;
  a1 text := 'from clinic_reception.masa_bookings m where m.provider_id = p_provider and m.status = ''active''';
  b1 text := 'from clinic_reception.masa_bookings m where m.provider_id = p_provider and m.status = ''active'' and not m.day_only';
  a2 text := '''appointment_time'', to_char(m.starts_at at time zone ''Africa/Cairo'', ''HH24:MI'')) order by m.starts_at)';
  b2 text := '''appointment_time'', case when m.day_only then null else to_char(m.starts_at at time zone ''Africa/Cairo'', ''HH24:MI'') end, ''day_only'', m.day_only) order by m.starts_at)';
  a3 text := 'and m.starts_at > now() - interval ''2 hours'' and m.starts_at < now() + interval ''3 days''';
  b3 text := 'and (m.starts_at at time zone ''Africa/Cairo'')::date between (now() at time zone ''Africa/Cairo'')::date and (now() at time zone ''Africa/Cairo'')::date + 2 and (m.day_only or m.starts_at > now() - interval ''2 hours'')';
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

commit;
