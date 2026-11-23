-- Nursing presence from HR attendance (owner 2026-11-23 «طبقه», mockup docs/ui-references/mockups/nursing-attendance-routing-*).
-- Until now a nurse was "absent" only when a manager ticked «غايبة النهارده». Now presence comes from the fingerprint device + shift
-- schedule (clinic_people.attendance_eval, the same evaluation HR's live board / reports / payroll use):
--   present  = clocked in today for her shift (on_time / late) and no check-out punch after the last check-in
--   absent   = her shift started and she has not clocked in — NO grace period (owner: «يفضل غايب لغاية اما يبصم حضور»)
--   upcoming = her shift has not started yet · leave = approved leave / swap day off · off = not on today's schedule
--   out      = clocked out · unmapped = no device number linked · no_hr = no HR record for this login
-- Routing: a physio / dental section is "covered" only while one of its nurses is present. Otherwise general nursing sees that
-- section (my_nursing_sections, unchanged) and gets its notices (notify_nursing, unchanged). When the section nurse clocks in, the
-- section is covered again, so its cases go back to her — except cases general nursing already STARTED (opened the file, prep item,
-- or triage): those stay visible to general nursing (clinic_reception.taken_by_general) and are marked on the section nurse's list.
-- Lateness is HR's own late_min (shift start → first check-in); it is not stored or counted again here.
-- nurse_absent (used for "who receives notices") treats unmapped / no_hr as NOT absent, so a nurse whose fingerprint is not linked
-- keeps receiving her notices as before; her section is still not "covered", so general nursing sees it too.
-- The manual «غايبة النهارده» flag is no longer read or written (nursing_assignments.absent_on is kept, unused). The section override
-- stays for managers / head nursing only.
-- New RPC action: clinic_reception_nursing('staff_today') → each nurse's section + presence, coverage, cases returned / kept.
-- Existing bodies are patched in place (each anchor must match exactly once); old bodies saved in
-- clinic_reception.nursing_presence_saved_defs for the rollback: supabase/rollbacks/20261122310000_nursing_attendance_routing.rollback.sql
begin;

do $$ begin
  if to_regprocedure('clinic_reception.nurse_presence(uuid,date)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
  if to_regprocedure('public.clinic_reception_nursing(uuid,text,jsonb)') is null or to_regprocedure('clinic_reception.nurse_absent(uuid,date)') is null then
    raise exception 'طبّق تشغيل اليوم للتمريض أولاً'; end if;
  if to_regprocedure('clinic_people.attendance_eval(date,timestamptz)') is null or to_regclass('clinic_people.device_punches') is null then
    raise exception 'جدول الورديات والبصمة غير موجود'; end if;
end $$;

create table clinic_reception.nursing_presence_saved_defs(name text primary key, def text not null);
alter table clinic_reception.nursing_presence_saved_defs enable row level security;
revoke all on clinic_reception.nursing_presence_saved_defs from public, anon, authenticated;
insert into clinic_reception.nursing_presence_saved_defs values
  ('nurse_absent', pg_get_functiondef('clinic_reception.nurse_absent(uuid,date)'::regprocedure)),
  ('section_covered', pg_get_functiondef('clinic_reception.section_covered(text,date)'::regprocedure)),
  ('clinic_reception_nursing', pg_get_functiondef('public.clinic_reception_nursing(uuid,text,jsonb)'::regprocedure));

create function clinic_reception.nurse_presence(p_admin uuid, p_day date)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare pid uuid; e record; lin timestamptz; lout timestamptz; st text;
begin
  select pe.id into pid from clinic_people.people pe where pe.admin_id = p_admin and pe.status <> 'ended' order by pe.id limit 1;
  if pid is null then return jsonb_build_object('state', 'no_hr'); end if;
  select * into e from clinic_people.attendance_eval(p_day, now()) x where x.person_id = pid limit 1;
  if not found then return jsonb_build_object('state', 'off'); end if;
  if e.status = 'leave' then st := 'leave';
  elsif e.status = 'unmapped' then st := 'unmapped';
  elsif e.status in ('on_time', 'late') then
    select max(d.ts) filter (where d.punch in (0, 3, 4)), max(d.ts) filter (where d.punch in (1, 5)) into lin, lout
      from clinic_people.device_punches d
      join clinic_people.device_user_map m on m.device_id = d.device_id and m.device_user_id = d.device_user_id
     where m.person_id = pid and d.ts >= e.first_in and d.ts <= least(now(), e.exp_end + interval '6 hours');
    st := case when lout is not null and lout > coalesce(lin, e.first_in) then 'out' else 'present' end;
  elsif e.status = 'upcoming' then st := 'upcoming';
  else st := 'absent'; end if;
  return jsonb_build_object('state', st, 'first_in', e.first_in, 'last_out', case when st = 'out' then lout end,
    'exp_start', e.exp_start, 'exp_end', e.exp_end, 'shift', e.template_name, 'late_min', coalesce(e.late_min, 0));
end $$;

-- who receives notices: unknown presence (no fingerprint link / no HR record) keeps the old behaviour (not absent)
create or replace function clinic_reception.nurse_absent(p_admin uuid, p_day date)
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select clinic_reception.nurse_presence(p_admin, p_day)->>'state' not in ('present', 'unmapped', 'no_hr')
$$;

-- a section is covered only while one of its nurses has actually clocked in
create or replace function clinic_reception.section_covered(p_section text, p_day date)
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select exists(select 1 from public.admins a where clinic_reception.is_nurse(a.id)
    and clinic_reception.nurse_section(a.id) = p_section and clinic_reception.nurse_presence(a.id, p_day)->>'state' = 'present')
$$;

-- the first nurse from ANOTHER section (not head nursing) who started this case: file opened, prep item, or triage
create function clinic_reception.taken_by_general(p_appointment uuid, p_section text)
returns uuid language sql stable security definer set search_path = pg_catalog, public as $$
  select x.admin_id from (
      select t.nurse_id as admin_id, t.updated_at as at from clinic_reception.visit_triage t where t.appointment_id = p_appointment
      union all select np.done_by, np.done_at from clinic_reception.nursing_prep np where np.appointment_id = p_appointment
      union all select fo.admin_id, fo.opened_at from public.patient_file_opens fo where fo.appointment_id = p_appointment) x
   where p_section in ('physio', 'dental') and x.admin_id is not null and clinic_reception.is_nurse(x.admin_id)
     and not exists (select 1 from public.admins h where h.id = x.admin_id and (h.role = 'head_nursing'
                     or exists (select 1 from public.admin_extra_roles r where r.admin_id = h.id and r.role = 'head_nursing')))
     and clinic_reception.nurse_section(x.admin_id) <> p_section
   order by x.at limit 1
$$;

do $$ declare d text := pg_get_functiondef('public.clinic_reception_nursing(uuid,text,jsonb)'::regprocedure); i int := 1; edits text[] := array[
  -- day list: who from general nursing took the case
  $a$'ticket_no', x.ticket_no, 'triage', x.triage,$a$,
  $a$'ticket_no', x.ticket_no, 'triage', x.triage,
              'taken_by', case when x.sec <> 'general' then (select coalesce(nullif(ta.name, ''), ta.email) from public.admins ta where ta.id = clinic_reception.taken_by_general(x.id, x.sec)) end,$a$,
  -- day list: general nursing keeps the cases it started after the section nurse clocks in
  $a$else x.sec = any(secs) end) y)$a$,
  $a$else x.sec = any(secs) or (nrs and x.sec <> 'general' and clinic_reception.nurse_section(me) = 'general' and clinic_reception.taken_by_general(x.id, x.sec) is not null) end) y)$a$,
  -- the manual «غايبة النهارده» flag is gone
  $a$case when coalesce((p->>'absent_today')::boolean, false) then clinic_reception.today() end, me, now())$a$,
  $a$null, me, now())$a$,
  -- presence board
  $a$  elsif p_action = 'settings_save' then$a$,
  $a$  elsif p_action = 'staff_today' then
    if not (nrs or mgr or public.has_role('head_nursing')) then raise exception 'للتمريض بس'; end if;
    return (with ns as (
        select a5.id, coalesce(nullif(a5.name, ''), a5.email) as nm, clinic_reception.nurse_section(a5.id) as sec,
               clinic_reception.nurse_presence(a5.id, day) as pr
          from public.admins a5 where clinic_reception.is_nurse(a5.id)),
      ap as (
        select a6.id, clinic_reception.appointment_section(a6.provider_id) as sec, a6.starts_at
          from clinic_reception.appointments a6
         where a6.workspace_id = p_workspace and (a6.starts_at at time zone 'Africa/Cairo')::date = day and a6.status not in ('cancelled'))
      select jsonb_build_object('date', day, 'now', now(), 'can_manage', mgr or public.has_role('head_nursing'),
        'covered', jsonb_build_object('physio', clinic_reception.section_covered('physio', day), 'dental', clinic_reception.section_covered('dental', day)),
        'nurses', coalesce((select jsonb_agg(jsonb_build_object('admin_id', ns.id, 'name', ns.nm, 'section', ns.sec, 'state', ns.pr->>'state',
            'first_in', ns.pr->'first_in', 'last_out', ns.pr->'last_out', 'exp_start', ns.pr->'exp_start', 'exp_end', ns.pr->'exp_end',
            'late_min', case when mgr or public.has_role('head_nursing') or ns.id = me then (ns.pr->>'late_min')::int end,
            'returned', case when ns.sec <> 'general' and ns.pr->>'first_in' is not null then
              (select count(*) from ap where ap.sec = ns.sec and ap.starts_at < (ns.pr->>'first_in')::timestamptz and clinic_reception.taken_by_general(ap.id, ap.sec) is null) end,
            'kept', case when ns.sec <> 'general' and ns.pr->>'first_in' is not null then
              (select count(*) from ap where ap.sec = ns.sec and ap.starts_at < (ns.pr->>'first_in')::timestamptz and clinic_reception.taken_by_general(ap.id, ap.sec) is not null) end)
            order by case ns.sec when 'physio' then 0 when 'dental' then 1 else 2 end, ns.nm) from ns), '[]'::jsonb)));

  elsif p_action = 'settings_save' then$a$];
begin
  while i < array_length(edits, 1) loop
    if (length(d) - length(replace(d, edits[i], ''))) <> length(edits[i]) then raise exception 'nursing patch % does not match exactly once', (i + 1) / 2; end if;
    d := replace(d, edits[i], edits[i + 1]);
    i := i + 2;
  end loop;
  execute d;
end $$;

revoke all on function clinic_reception.nurse_presence(uuid, date), clinic_reception.taken_by_general(uuid, text),
  clinic_reception.nurse_absent(uuid, date), clinic_reception.section_covered(text, date) from public, anon, authenticated;
revoke all on function public.clinic_reception_nursing(uuid, text, jsonb) from public, anon;
grant execute on function public.clinic_reception_nursing(uuid, text, jsonb) to authenticated;

commit;
