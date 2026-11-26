-- Rollback of 20261126150000_hr_external_mission. Refuses while mission requests exist (cancel/reject them, or delete them
-- deliberately, first). Reverses the three reader patches fragment by fragment, restores attendance_eval, drops the rest.
begin;
do $$ begin
  if to_regprocedure('clinic_people.attendance_eval_before_missions(date,timestamp with time zone)') is null then
    raise exception '20261126150000 مش متطبق'; end if;
  if exists (select 1 from clinic_people.requests where kind = 'mission') then
    raise exception 'فيه % طلب مهمة خارجية؛ لا يمكن الرجوع قبل التعامل معها', (select count(*) from clinic_people.requests where kind = 'mission'); end if;
end $$;
create function pg_temp.mission_unpatch(p_fn regprocedure, p_pairs text[]) returns void language plpgsql as $p$
declare def text := pg_get_functiondef(p_fn); i int; n int;
begin
  for i in 1 .. array_length(p_pairs, 1) / 2 loop
    n := (length(def) - length(replace(def, p_pairs[2*i-1], ''))) / length(p_pairs[2*i-1]);
    if n <> 1 then raise exception 'مقطع % من % موجود % مرة', i, p_fn, n; end if;
    def := replace(def, p_pairs[2*i-1], p_pairs[2*i]);
  end loop;
  execute def;
end $p$;
select pg_temp.mission_unpatch('public.hr_attendance_from_punches(date)', array[
  $a$where not x.has_row and x.status in ('on_time', 'late', 'absent', 'mission')$a$,
  $a$where not x.has_row and x.status in ('on_time', 'late', 'absent')$a$,
  $a$case when x.status = 'mission' then least(coalesce(x.first_in, x.exp_start), x.exp_start) when x.status = 'late' and x.excused then x.exp_start else x.first_in end as a_start$a$,
  $a$case when x.status = 'late' and x.excused then x.exp_start else x.first_in end as a_start$a$,
  $a$and (x.status in ('absent', 'mission') or x.last_out is not null or x.exp_end + interval '10 hours' <= now()))$a$,
  $a$and (x.status = 'absent' or x.last_out is not null or x.exp_end + interval '10 hours' <= now()))$a$,
  $a$'actual_end', case when t.status = 'mission' then greatest(t.exp_end, coalesce(t.last_out, t.exp_end)) when t.a_start is null then null$a$,
  $a$'actual_end', case when t.a_start is null then null$a$,
  $a$'note', 'بصمة' || case when t.status = 'mission' then ' — مهمة خارجية' when t.status = 'absent' and t.sick_wait is false$a$,
  $a$'note', 'بصمة' || case when t.status = 'absent' and t.sick_wait is false$a$,
  $a$|| case when t.excused and t.status <> 'mission' then ' — إذن معتمد' else '' end)$a$,
  $a$|| case when t.excused then ' — إذن معتمد' else '' end)$a$]);
select pg_temp.mission_unpatch('public.hr_attendance_today(date)', array[
  $a$'excused', e.excused, 'mission', clinic_people.mission_on(e.person_id, d), 'late_week'$a$,
  $a$'excused', e.excused, 'late_week'$a$]);
select pg_temp.mission_unpatch('public.hr_attendance_range(date,date)', array[
  $a$'day', x.day, 'person_id', x.person_id, 'status', x.status, 'late_min', x.late_min, 'excused', x.excused, 'mission', case when x.status = 'mission' then clinic_people.mission_on(x.person_id, x.day) end,$a$,
  $a$'day', x.day, 'person_id', x.person_id, 'status', x.status, 'late_min', x.late_min, 'excused', x.excused,$a$,
  $a$'early_leave_min', case when x.status = 'mission' then 0 when x.last_out is not null and x.last_out < x.exp_end$a$,
  $a$'early_leave_min', case when x.last_out is not null and x.last_out < x.exp_end$a$]);
drop function public.hr_mission(text, jsonb);
drop function clinic_people.mission_json(clinic_people.requests, uuid);
drop function clinic_people.attendance_eval(date, timestamptz);
alter function clinic_people.attendance_eval_before_missions(date, timestamptz) rename to attendance_eval;
revoke all on function clinic_people.attendance_eval(date, timestamptz) from public, anon, authenticated;
drop function clinic_people.mission_on(uuid, date);
drop trigger requests_mission_rules on clinic_people.requests;
drop function clinic_people.mission_rules();
drop index clinic_people.requests_mission_person_day;
alter table clinic_people.requests drop constraint requests_mission_fields, drop constraint requests_mission_window, drop constraint requests_mission_travel;
alter table clinic_people.requests drop constraint requests_kind_check;
alter table clinic_people.requests add constraint requests_kind_check
  check (kind in ('leave','permission','training','advance','overtime','leave_credit','holiday_comp'));
alter table clinic_people.requests drop column from_time, drop column to_time, drop column place, drop column travel_minutes,
  drop column travel_note, drop column travel_status, drop column travel_reviewed_by, drop column travel_reviewed_at;
commit;
