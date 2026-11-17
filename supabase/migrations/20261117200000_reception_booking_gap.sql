-- Owner 2026-11-17 (main chat): «خلي الوقت بين كل حجز واللي بعده ٥ دقايق فقط».
-- A workspace-level gap (default 5 min) is kept free after every appointment for the same doctor, before the next one starts.
--   * clinic_reception.workspaces.booking_gap_minutes (0..60, default 5) + clinic_reception.provider_gap(provider) → interval.
--   * Trigger appointments_respect_gap: insert / reschedule / provider change / reactivation cannot start or end within the gap
--     of another active appointment of that doctor (every path: book, reschedule, walk-in, employee booking, journey).
--     Existing appointments are untouched (the trigger only checks rows that change time/provider/status).
--   * slot_busy (WhatsApp/site fallback) counts the gap; fallback_api 'slots' steps by minutes + gap.
--   * Walk-in (public.clinic_reception_command) and journey reschedule slots search with the gap.
-- In-place patches use exact text anchors (each must occur exactly once); md5 of each old body is printed.
-- Rollback: supabase/rollbacks/20261117200000_reception_booking_gap.rollback.sql
begin;

alter table clinic_reception.workspaces add column if not exists booking_gap_minutes integer not null default 5
  check (booking_gap_minutes between 0 and 60);

create or replace function clinic_reception.provider_gap(p_provider uuid) returns interval
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce((select make_interval(mins => w.booking_gap_minutes) from clinic_reception.providers p
                    join clinic_reception.workspaces w on w.id = p.workspace_id where p.id = p_provider), interval '0')
$$;
revoke all on function clinic_reception.provider_gap(uuid) from public, anon, authenticated;

create or replace function clinic_reception.appointments_respect_gap() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare g interval; o record;
begin
  if new.status in ('cancelled','no_show') then return new; end if;
  if tg_op = 'UPDATE' and old.provider_id = new.provider_id and old.starts_at = new.starts_at and old.ends_at = new.ends_at
     and old.status not in ('cancelled','no_show') then return new; end if;
  g := clinic_reception.provider_gap(new.provider_id);
  if g = interval '0' then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('rx-slot:' || new.provider_id::text, 0));
  select a.starts_at, a.ends_at into o from clinic_reception.appointments a
   where a.provider_id = new.provider_id and a.id is distinct from new.id and a.status not in ('cancelled','no_show')
     and a.starts_at < new.ends_at + g and a.ends_at + g > new.starts_at
   order by a.starts_at limit 1;
  if found then
    raise exception 'لازم % دقايق بين كل حجز واللي بعده عند نفس الدكتور — فيه حجز من % لـ %؛ اختار وقت تاني',
      extract(epoch from g)::int / 60,
      to_char(o.starts_at at time zone 'Africa/Cairo', 'HH24:MI'), to_char(o.ends_at at time zone 'Africa/Cairo', 'HH24:MI');
  end if;
  return new;
end $$;
revoke all on function clinic_reception.appointments_respect_gap() from public, anon, authenticated;
drop trigger if exists appointments_respect_gap on clinic_reception.appointments;
create trigger appointments_respect_gap before insert or update of provider_id, starts_at, ends_at, status on clinic_reception.appointments
  for each row execute function clinic_reception.appointments_respect_gap();

do $mig$
declare
  f text; n int; i int;
  targets text[] := array[
    'clinic_reception.slot_busy(uuid,timestamptz,timestamptz,uuid)',
    'clinic_reception.slot_busy(uuid,timestamptz,timestamptz,uuid)',
    'clinic_reception.fallback_api(text,jsonb)',
    'public.clinic_reception_command(uuid,text,jsonb,uuid)',
    'public.clinic_reception_journey_reschedule_slots(uuid,uuid,date)',
    'public.clinic_reception_journey_reschedule_slots(uuid,uuid,date)'];
  anchors text[] := array[
    'a.starts_at < p_end and a.ends_at > p_start',
    'f.starts_at < p_end and f.ends_at > p_start',
    't := e;',
    'a.starts_at<t+make_interval(mins=>mins) and a.ends_at>t',
    'make_interval(mins=>mins)
    ) gs',
    'other.starts_at<s.ends_at and other.ends_at>s.starts_at'];
  repl text[] := array[
    'a.starts_at < p_end + clinic_reception.provider_gap(p_provider) and a.ends_at + clinic_reception.provider_gap(p_provider) > p_start',
    'f.starts_at < p_end + clinic_reception.provider_gap(p_provider) and f.ends_at + clinic_reception.provider_gap(p_provider) > p_start',
    't := e + clinic_reception.provider_gap(pr.id);',
    'a.starts_at<t+make_interval(mins=>mins)+clinic_reception.provider_gap(prov) and a.ends_at+clinic_reception.provider_gap(prov)>t',
    'make_interval(mins=>mins)+clinic_reception.provider_gap(a.provider_id)
    ) gs',
    'other.starts_at<s.ends_at+clinic_reception.provider_gap(a.provider_id) and other.ends_at+clinic_reception.provider_gap(a.provider_id)>s.starts_at'];
begin
  for i in 1 .. array_length(targets, 1) loop
    if to_regprocedure(targets[i]) is null then
      -- journey reschedule slots is a live-only function (not created by repo migrations); skip it where absent (tests).
      if targets[i] like 'public.clinic_reception_journey_reschedule_slots%' then raise notice '% absent — skipped', targets[i]; continue; end if;
      raise exception '% غير موجودة', targets[i];
    end if;
    f := pg_get_functiondef(targets[i]::regprocedure);
    if position(repl[i] in f) > 0 then raise exception 'تم تطبيق هذا الملف من قبل (%)', targets[i]; end if;
    n := (length(f) - length(replace(f, anchors[i], ''))) / length(anchors[i]);
    if n <> 1 then raise exception '% تغيّرت عن النص المتوقع (anchor % مرات: %)', targets[i], i, n; end if;
    raise notice '% md5 before patch %: %', targets[i], i, md5(f);
    execute replace(f, anchors[i], repl[i]);
  end loop;
end $mig$;
commit;
