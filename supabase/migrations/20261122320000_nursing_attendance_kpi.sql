-- Nursing attendance KPI penalty (owner 2026-11-23 «تفضل», phase 2 of nursing presence; needs 20261122310000 first).
-- Owner: a section nurse (physio / dental) who is late or absent while patients of his section arrive puts pressure on colleagues,
-- so he loses more points than one who is late while nobody is waiting.
-- Per day and per section nurse, clinic_reception.nursing_day_kpi keeps:
--   late_min      — HR's late minutes (shift start → first check-in); when he never clocked in: shift start → min(now, shift end)
--   cases_rerouted — his section's cases (live workspace, not cancelled) starting in [shift start, first check-in) → seen by general nursing
--   cases_returned / cases_kept — of those, returned to him on clock-in / kept by general nursing because it had started them
--   absorbed_by   — which colleagues started the kept cases ([{admin_id, name, cases}])
--   points        — ceil(late_min / 15) × per_15min + cases_rerouted × per_case (defaults 1 and 3); 0 when HR marks the day excused
--                   (approved permission). Approved leave / day off / no fingerprint link / no HR record → no row.
-- A cron job recomputes today and yesterday every 30 minutes (yesterday is final once his shift ended).
-- «أداء الفريق»: new KPI nursing_attendance_penalty (direction lower, unit نقطة, scales per 30 days), target 4 points / 30 days for the
-- nursing role (editable from the KPI screen), summed into public.staff_kpis by one patched line. No parallel score.
-- Rollback: supabase/rollbacks/20261122320000_nursing_attendance_kpi.rollback.sql
begin;

do $$ begin
  if to_regclass('clinic_reception.nursing_day_kpi') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
  if to_regprocedure('clinic_reception.nurse_presence(uuid,date)') is null or to_regprocedure('clinic_reception.taken_by_general(uuid,text)') is null then
    raise exception 'طبّق 20261122310000 أولاً'; end if;
  if to_regprocedure('public.staff_kpis(timestamptz,timestamptz)') is null or to_regclass('public.kpi_defs') is null then raise exception 'مؤشرات الأداء غير موجودة'; end if;
end $$;

create table clinic_reception.nursing_kpi_weights(
  id boolean primary key default true check (id),
  per_15min numeric not null default 1 check (per_15min between 0 and 100),
  per_case numeric not null default 3 check (per_case between 0 and 100),
  updated_at timestamptz not null default now()
);
insert into clinic_reception.nursing_kpi_weights(id) values (true);

create table clinic_reception.nursing_day_kpi(
  admin_id uuid not null references public.admins(id) on delete cascade,
  day date not null,
  section text not null check (section in ('physio', 'dental')),
  state text not null,
  shift_start timestamptz, first_in timestamptz,
  late_min integer not null default 0 check (late_min >= 0),
  excused boolean not null default false,
  cases_rerouted integer not null default 0, cases_returned integer not null default 0, cases_kept integer not null default 0,
  absorbed_by jsonb not null default '[]'::jsonb,
  points numeric not null default 0,
  computed_at timestamptz not null default now(),
  primary key (admin_id, day)
);
alter table clinic_reception.nursing_day_kpi enable row level security;
alter table clinic_reception.nursing_kpi_weights enable row level security;
revoke all on clinic_reception.nursing_day_kpi, clinic_reception.nursing_kpi_weights from public, anon, authenticated;

create function clinic_reception.nursing_kpi_compute(p_day date)
returns integer language plpgsql security definer set search_path = pg_catalog, public as $$
declare r record; pr jsonb; st text; pid uuid; ex boolean; s timestamptz; fin timestamptz; wend timestamptz; late int;
  w clinic_reception.nursing_kpi_weights; n int := 0; rer int; kept int; who jsonb;
begin
  select * into w from clinic_reception.nursing_kpi_weights where id;
  for r in select a.id, clinic_reception.nurse_section(a.id) as sec from public.admins a
            where clinic_reception.is_nurse(a.id)
              and not (a.role = 'head_nursing' or exists (select 1 from public.admin_extra_roles x where x.admin_id = a.id and x.role = 'head_nursing'))
  loop
    if r.sec not in ('physio', 'dental') then delete from clinic_reception.nursing_day_kpi where admin_id = r.id and day = p_day; continue; end if;
    pr := clinic_reception.nurse_presence(r.id, p_day); st := pr->>'state';
    if st not in ('present', 'out', 'absent') then delete from clinic_reception.nursing_day_kpi where admin_id = r.id and day = p_day; continue; end if;
    s := (pr->>'exp_start')::timestamptz; fin := (pr->>'first_in')::timestamptz;
    select pe.id into pid from clinic_people.people pe where pe.admin_id = r.id and pe.status <> 'ended' order by pe.id limit 1;
    select coalesce(e.excused, false) into ex from clinic_people.attendance_eval(p_day, now()) e where e.person_id = pid limit 1;
    if fin is not null then
      late := coalesce((pr->>'late_min')::int, 0); wend := fin;
    else
      wend := least(now(), (pr->>'exp_end')::timestamptz);
      late := greatest(0, floor(extract(epoch from (wend - s)) / 60)::int);
    end if;
    with c as (
      select ap.id, clinic_reception.taken_by_general(ap.id, r.sec) as tb
        from clinic_reception.appointments ap join clinic_reception.workspaces ws on ws.id = ap.workspace_id and ws.mode = 'live'
       where clinic_reception.appointment_section(ap.provider_id) = r.sec and ap.status not in ('cancelled')
         and ap.starts_at >= s and ap.starts_at < wend)
    select count(*), count(*) filter (where tb is not null),
           coalesce((select jsonb_agg(jsonb_build_object('admin_id', g.tb, 'name', (select coalesce(nullif(x.name, ''), x.email) from public.admins x where x.id = g.tb), 'cases', g.n) order by g.n desc)
                       from (select tb, count(*) as n from c where tb is not null group by tb) g), '[]'::jsonb)
      into rer, kept, who from c;
    insert into clinic_reception.nursing_day_kpi(admin_id, day, section, state, shift_start, first_in, late_min, excused,
        cases_rerouted, cases_returned, cases_kept, absorbed_by, points, computed_at)
      values (r.id, p_day, r.sec, st, s, fin, late, coalesce(ex, false), rer, rer - kept, kept, who,
        case when coalesce(ex, false) then 0 else ceil(late / 15.0) * w.per_15min + rer * w.per_case end, now())
    on conflict (admin_id, day) do update set section = excluded.section, state = excluded.state, shift_start = excluded.shift_start,
      first_in = excluded.first_in, late_min = excluded.late_min, excused = excluded.excused, cases_rerouted = excluded.cases_rerouted,
      cases_returned = excluded.cases_returned, cases_kept = excluded.cases_kept, absorbed_by = excluded.absorbed_by,
      points = excluded.points, computed_at = now();
    n := n + 1;
  end loop;
  return n;
end $$;

create function clinic_reception.nursing_kpi_run() returns integer language plpgsql security definer set search_path = pg_catalog, public as $$
declare d date := (now() at time zone 'Africa/Cairo')::date;
begin
  return clinic_reception.nursing_kpi_compute(d - 1) + clinic_reception.nursing_kpi_compute(d);
end $$;
revoke all on function clinic_reception.nursing_kpi_compute(date), clinic_reception.nursing_kpi_run() from public, anon, authenticated;

insert into public.kpi_defs(kpi, label_ar, unit, direction, scales, min_sample, sort_order, hint_ar)
values ('nursing_attendance_penalty', 'نقاط التأخير والغياب — التمريض', 'نقطة', 'lower', true, 0, 900,
  'نقطة لكل ربع ساعة تأخير أو غياب من أول الوردية لحد بصمة الحضور، و3 نقط لكل حالة من قسمه اتحولت للتمريض العام وهو مش موجود. الإذن المعتمد مش بيتحسب، والإجازة ويوم الإجازة مش بيتحسبوا.')
on conflict (kpi) do nothing;
insert into public.kpi_targets(role, kpi, target, weight) values ('nursing', 'nursing_attendance_penalty', 4, 1) on conflict (role, kpi) do nothing;

create table clinic_reception.nursing_kpi_saved_defs(name text primary key, def text not null);
alter table clinic_reception.nursing_kpi_saved_defs enable row level security;
revoke all on clinic_reception.nursing_kpi_saved_defs from public, anon, authenticated;
do $$ declare d text := pg_get_functiondef('public.staff_kpis(timestamptz,timestamptz)'::regprocedure);
  a text := $a$and assignee_id is not null group by assignee_id
  )$a$;
begin
  insert into clinic_reception.nursing_kpi_saved_defs values ('staff_kpis', d);
  if (length(d) - length(replace(d, a, ''))) <> length(a) then raise exception 'staff_kpis anchor does not match exactly once'; end if;
  execute replace(d, a, $b$and assignee_id is not null group by assignee_id
    union all select k.admin_id, 'nursing_attendance_penalty', sum(k.points), count(*)::int from clinic_reception.nursing_day_kpi k where k.day >= (p_from at time zone 'Africa/Cairo')::date and k.day <= (p_to at time zone 'Africa/Cairo')::date group by k.admin_id
  )$b$);
end $$;

do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('nursing-kpi-30m', '7,37 * * * *', 'select clinic_reception.nursing_kpi_run()');
  end if;
end $$;

commit;
