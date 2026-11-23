-- Follow-up to 20261122330000 (owner «طبق حل الحجوزات», 2026-11-23): the doctor's gap between bookings (20261117200000,
-- 5 minutes) was ignored by clinic_reception.free_starts, so the automatic placement offered starts the booking rules
-- refused («لازم 5 دقايق بين كل حجز واللي بعده عند نفس الدكتور»; live, a row of 2026-11-24). free_starts now keeps the gap
-- on both sides of every booking of the doctor (same rule as day_capacity). Old body saved in auto_time_saved_defs
-- ('free_starts'); waiting 'slot' rows with that reason are re-queued once.
-- Rollback: supabase/rollbacks/20261122360000_free_starts_gap.rollback.sql
begin;

do $$ begin
  if to_regprocedure('clinic_reception.free_starts(uuid,date,int,int)') is null then raise exception 'طبّق 20261122330000 أولاً'; end if;
  if exists (select 1 from clinic_reception.auto_time_saved_defs where name = 'free_starts') then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;
insert into clinic_reception.auto_time_saved_defs values ('free_starts', pg_get_functiondef('clinic_reception.free_starts(uuid,date,int,int)'::regprocedure));

create or replace function clinic_reception.free_starts(p_provider uuid, p_day date, p_minutes int, p_limit int default 60)
returns setof timestamptz language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare gap interval := interval '0'; m interval := make_interval(mins => greatest(p_minutes, 5));
begin
  if to_regprocedure('clinic_reception.provider_gap(uuid)') is not null then
    execute 'select clinic_reception.provider_gap($1)' into gap using p_provider;
  end if;
  gap := coalesce(gap, interval '0');
  return query
  select s.t from (
    select distinct g.t from clinic_reception.availability a,
      lateral generate_series(a.starts_at, a.ends_at - m, interval '5 minutes') g(t)
     where a.provider_id = p_provider and (a.starts_at at time zone 'Africa/Cairo')::date = p_day) s
   where s.t >= now() + interval '5 minutes'
     and not exists (select 1 from clinic_reception.appointments x where x.provider_id = p_provider
                      and x.status not in ('cancelled', 'no_show') and not coalesce(x.overbook, false)
                      and x.starts_at < s.t + m + gap and x.ends_at + gap > s.t)
   order by s.t limit greatest(p_limit, 1);
end $$;
revoke all on function clinic_reception.free_starts(uuid, date, int, int) from public, anon, authenticated;

-- rows parked by that refusal get one more try
update clinic_reception.external_bookings set state = 'pending', review_kind = null, reason = null, attempts = 0, updated_at = now()
 where state = 'review' and review_kind = 'slot' and reason like '%دقايق بين كل حجز%' and day >= clinic_reception.cairo_day(now());

commit;
