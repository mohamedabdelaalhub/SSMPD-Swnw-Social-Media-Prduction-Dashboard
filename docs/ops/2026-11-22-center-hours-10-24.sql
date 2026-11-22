-- Center hours 10:00 → 24:00 + the two staff sheets (owner 2026-11-22: «دي الجداول الجديده لمواعيد عمل الفرق في المركز من 10 ص
-- الي 12 منتصف الليل و 2 تمريض في كل شيفت، عايزين نعدل كل المواعيد لان مواعيد المركز هتبقي كدة كلها»). English digits.
-- PART R = read-only report (run alone first). PART A = apply; it ends in ROLLBACK (dry-run). Change the last line to COMMIT to apply.
-- «24» / «12 ص» = midnight → 23:59 in reception weekly_slots (its format allows 00:00-23:59 only), 00:00 in HR shift templates
-- (an HR end <= start means the shift ends after midnight).
-- Postgres dow: 0 Sun · 1 Mon · 2 Tue · 3 Wed · 4 Thu · 5 Fri · 6 Sat.
-- Sheet 1 (nursing → reception weekly_slots for the 3 home nurses AND their HR shifts):
--   وضاحة EMP-000001: Sat 10-24 · Sun off · Mon 10-18 · Tue 10-16 · Wed 10-24 · Thu 10-16 · Fri 10-24
--   شهد   EMP-000003: Sat 10-24 · Sun 10-24 · Mon 16-24 · Tue 16-24 · Wed off · Thu 10-24 · Fri 16-24
--   أحمد علاء EMP-000011: Sat off · Sun-Thu 10-24 · Fri off
-- Clinic provider «التمريض» (capacity 2): every day 10:00-23:59, capacity stays 2.
-- Sheet 2 (front staff → HR shifts only; they are not booking providers):
--   مازن: Sat 10-18 · Sun off · Mon 16-24 · Tue 16-24 · Wed 10-18 · Thu 16-24 · Fri 10-24
--   مريم: Sat-Thu 16-24 · Fri off
--   زينة: Sat 12-20 · Sun 12-20 · Mon off · Tue 16-24 · Wed 12-20 · Thu 16-24 · Fri 12-20
--   منار: Sat 16-24 · Sun 10-24 · Mon 10-18 · Tue 10-18 · Wed 16-24 · Thu 10-18 · Fri off
-- The reception 'save' and HR 'schedule_save' RPCs need a signed-in manager (my_admin_id), so PART A runs their exact bodies
-- (20261117120000 clinic_reception_weekly 'save'; 20261113100000 hr_shifts_command 'schedule_save') with the live workspace
-- owner as the audit actor. Existing bookings are never moved or cancelled.

-- ============================== PART R — read-only report ==============================
-- R1 nurse providers in the sheet + the clinic «التمريض» provider, with their current week
select p.doctor_key, p.name, p.department, p.capacity, p.active,
       (select string_agg(w.dow || ' ' || to_char(w.starts, 'HH24:MI') || '-' || to_char(w.ends, 'HH24:MI'), ' · ' order by w.dow, w.starts)
          from clinic_reception.weekly_slots w where w.provider_id = p.id) week
  from clinic_reception.providers p join clinic_reception.workspaces ws on ws.id = p.workspace_id and ws.mode = 'live'
 where p.doctor_key in ('EMP-000001','EMP-000003','EMP-000011') or p.name = 'التمريض'
 order by p.name;

-- R2 the 3 home nurses NOT in the sheet (owner to decide)
select p.doctor_key, p.name, p.department, p.active,
       (select string_agg(w.dow || ' ' || to_char(w.starts, 'HH24:MI') || '-' || to_char(w.ends, 'HH24:MI'), ' · ' order by w.dow, w.starts)
          from clinic_reception.weekly_slots w where w.provider_id = p.id) week,
       (select count(*) from clinic_reception.appointments a where a.provider_id = p.id and a.starts_at > now() and a.status not in ('cancelled','no_show')) future_bookings
  from clinic_reception.providers p join clinic_reception.workspaces ws on ws.id = p.workspace_id and ws.mode = 'live'
 where p.doctor_key in ('EMP-000005','EMP-000007','EMP-000008') order by p.doctor_key;

-- R3 every active provider whose week starts before 10:00 or runs past midnight (doctors: report only, owner decides)
select p.name, p.department, p.doctor_key, w.dow, to_char(w.starts, 'HH24:MI') starts, to_char(w.ends, 'HH24:MI') ends,
       case when w.starts < time '10:00' then 'starts before 10:00' else 'ends after midnight' end why
  from clinic_reception.weekly_slots w join clinic_reception.providers p on p.id = w.provider_id and p.active
  join clinic_reception.workspaces ws on ws.id = p.workspace_id and ws.mode = 'live'
 where w.starts < time '10:00' or w.ends <= w.starts
 order by p.department, p.name, w.dow;

-- R4 future availability that starts before 10:00 Cairo (any provider, any source)
select p.name, p.department, a.source, count(*) windows, min(a.starts_at at time zone 'Africa/Cairo') first_local
  from clinic_reception.availability a join clinic_reception.providers p on p.id = a.provider_id and p.active
  join clinic_reception.workspaces ws on ws.id = a.workspace_id and ws.mode = 'live'
 where a.starts_at > now() and (a.starts_at at time zone 'Africa/Cairo')::time < time '10:00'
 group by 1, 2, 3 order by 2, 1, 3;

-- R5 future bookings before 10:00 Cairo (would sit outside the new center hours; not moved)
select p.name, p.department, a.id, to_char(a.starts_at at time zone 'Africa/Cairo', 'YYYY-MM-DD HH24:MI') local_start, a.status
  from clinic_reception.appointments a join clinic_reception.providers p on p.id = a.provider_id
  join clinic_reception.workspaces ws on ws.id = a.workspace_id and ws.mode = 'live'
 where a.starts_at > now() and a.status not in ('cancelled','no_show') and (a.starts_at at time zone 'Africa/Cairo')::time < time '10:00'
 order by a.starts_at;

-- R6 agent / website «مواعيد العمل» rows (clinic-knowledge reads them; edited in «بيانات المركز» → «مواعيد العمل»)
select department, days, to_char(open_time, 'HH24:MI') open_time, to_char(close_time, 'HH24:MI') close_time, closed, notes from public.clinic_hours order by sort, department;

-- R7 HR people for both sheets + their current weekly HR shifts
select pp.code, pp.full_name, pp.kind, pp.department, pp.job_title, pp.status,
       (select string_agg(s.dow || ' ' || coalesce(to_char(t.start_time, 'HH24:MI') || '-' || to_char(t.end_time, 'HH24:MI'), 'off'), ' · ' order by s.dow)
          from clinic_people.person_shifts s left join clinic_people.shift_templates t on t.id = s.template_id
         where s.person_id = pp.id and s.valid_from <= (now() at time zone 'Africa/Cairo')::date
           and (s.valid_to is null or s.valid_to >= (now() at time zone 'Africa/Cairo')::date)) current_week
  from clinic_people.people pp
 where pp.status <> 'ended' and (pp.code in ('EMP-000001','EMP-000003','EMP-000011')
    or pp.full_name ~ '^(مازن|مريم|زين[ةه]|منار)( |$)')
 order by pp.full_name;

-- R8 existing HR shift templates
select name, to_char(start_time, 'HH24:MI') st, to_char(end_time, 'HH24:MI') en, grace_minutes, active from clinic_people.shift_templates order by start_time, end_time;

-- ============================== PART A — apply (dry-run: ends in ROLLBACK) ==============================
begin;
do $$
declare ws uuid; actor uuid; prov uuid; k text; n int; g int; pid uuid; tid uuid; d int; cell text; st time; en time;
  from_d date := greatest((now() at time zone 'Africa/Cairo')::date + 1, date '2026-11-23');
  -- 7 cells per person, index = dow (0 Sun … 6 Sat); 'off' = day off
  nurse jsonb := jsonb_build_object(
    'EMP-000001', jsonb_build_array('off',  '10-18','10-16','10-24','10-16','10-24','10-24'),
    'EMP-000003', jsonb_build_array('10-24','16-24','16-24','off',  '10-24','16-24','10-24'),
    'EMP-000011', jsonb_build_array('10-24','10-24','10-24','10-24','10-24','off',  'off'));
  front jsonb := jsonb_build_object(
    '^مازن( |$)',      jsonb_build_array('off',  '16-24','16-24','10-18','16-24','10-24','10-18'),
    '^مريم( |$)',      jsonb_build_array('16-24','16-24','16-24','16-24','16-24','off',  '16-24'),
    '^زين[ةه]( |$)',   jsonb_build_array('12-20','off',  '16-24','12-20','16-24','12-20','12-20'),
    '^منار( |$)',      jsonb_build_array('10-24','10-18','10-18','16-24','10-18','off',  '16-24'));
  slots jsonb; days jsonb; tpl jsonb := '{}'::jsonb; outside int;
begin
  select id, owner_id into ws, actor from clinic_reception.workspaces where mode = 'live';
  if ws is null or actor is null then raise exception 'live workspace / owner not found'; end if;

  -- A1 reception weekly_slots (body of clinic_reception_weekly 'save') for the 3 nurses
  for k in select jsonb_object_keys(nurse) loop
    select count(*) into n from clinic_reception.providers where workspace_id = ws and active and doctor_key = k;
    if n <> 1 then raise exception 'expected 1 active provider with doctor_key %, found %', k, n; end if;
    select id into prov from clinic_reception.providers where workspace_id = ws and active and doctor_key = k;
    delete from clinic_reception.weekly_slots where provider_id = prov;
    for d in 0..6 loop
      cell := nurse->k->>d;
      if cell <> 'off' then
        st := (split_part(cell, '-', 1) || ':00')::time;
        en := case when split_part(cell, '-', 2) = '24' then time '23:59' else (split_part(cell, '-', 2) || ':00')::time end;
        insert into clinic_reception.weekly_slots(workspace_id, provider_id, dow, starts, ends, created_by) values (ws, prov, d, st, en, actor);
      end if;
    end loop;
    delete from clinic_reception.availability a where a.provider_id = prov and a.source = 'weekly' and a.starts_at > now()
      and not exists (select 1 from clinic_reception.appointments ap where ap.provider_id = prov and ap.status not in ('cancelled','no_show')
                        and ap.starts_at < a.ends_at and ap.ends_at > a.starts_at);
    g := clinic_reception.weekly_generate(ws, prov, 28);
    insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id) values (ws, actor, 'weekly_save', prov);
    raise notice 'nurse % → % windows generated', k, g;
  end loop;

  -- A2 clinic «التمريض»: every day 10:00-23:59, capacity unchanged (2)
  select count(*) into n from clinic_reception.providers where workspace_id = ws and active and name = 'التمريض';
  if n <> 1 then raise exception 'expected 1 active provider «التمريض», found %', n; end if;
  select id into prov from clinic_reception.providers where workspace_id = ws and active and name = 'التمريض';
  if (select capacity from clinic_reception.providers where id = prov) is distinct from 2 then raise exception '«التمريض» capacity is not 2 — check first'; end if;
  delete from clinic_reception.weekly_slots where provider_id = prov;
  insert into clinic_reception.weekly_slots(workspace_id, provider_id, dow, starts, ends, created_by)
    select ws, prov, d0, time '10:00', time '23:59', actor from generate_series(0, 6) d0;
  delete from clinic_reception.availability a where a.provider_id = prov and a.source = 'weekly' and a.starts_at > now()
    and not exists (select 1 from clinic_reception.appointments ap where ap.provider_id = prov and ap.status not in ('cancelled','no_show')
                      and ap.starts_at < a.ends_at and ap.ends_at > a.starts_at);
  g := clinic_reception.weekly_generate(ws, prov, 28);
  insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id) values (ws, actor, 'weekly_save', prov);
  raise notice '«التمريض» → % windows generated', g;

  -- A3 HR shift templates: reuse an active one with the same times, else create «HH-HH»
  for cell in select unnest(array['10-24','10-18','10-16','16-24','12-20']) loop
    st := (split_part(cell, '-', 1) || ':00')::time;
    en := case when split_part(cell, '-', 2) = '24' then time '00:00' else (split_part(cell, '-', 2) || ':00')::time end;
    select id into tid from clinic_people.shift_templates where active and start_time = st and end_time = en order by created_at limit 1;
    if tid is null then
      insert into clinic_people.shift_templates(name, start_time, end_time, created_by)
        values ('وردية ' || to_char(st, 'HH24:MI') || '-' || case when en = time '00:00' then '24:00' else to_char(en, 'HH24:MI') end, st, en, actor)
        returning id into tid;
      raise notice 'HR template created for %', cell;
    end if;
    tpl := tpl || jsonb_build_object(cell, tid);
  end loop;

  -- A4 HR weekly shifts (body of hr_shifts_command 'schedule_save') for the 3 nurses + 4 front staff, from from_d
  for k in select jsonb_object_keys(nurse) union all select jsonb_object_keys(front) loop
    if k like 'EMP-%' then
      select count(*) into n from clinic_people.people where code = k and status <> 'ended' and kind <> 'doctor';
      select id into pid from clinic_people.people where code = k and status <> 'ended' and kind <> 'doctor';
      slots := nurse->k;
    else
      select count(*) into n from clinic_people.people where full_name ~ k and status <> 'ended' and kind <> 'doctor';
      select id into pid from clinic_people.people where full_name ~ k and status <> 'ended' and kind <> 'doctor';
      slots := front->k;
    end if;
    if n <> 1 then raise exception 'HR person % : expected 1 active non-doctor, found % (see R7)', k, n; end if;
    days := '{}'::jsonb;
    for d in 0..6 loop days := days || jsonb_build_object(d::text, case when slots->>d = 'off' then '' else tpl->>(slots->>d) end); end loop;
    update clinic_people.person_shifts set valid_to = from_d - 1 where person_id = pid and valid_from < from_d and (valid_to is null or valid_to >= from_d);
    delete from clinic_people.person_shifts where person_id = pid and valid_from >= from_d;
    for d in 0..6 loop
      insert into clinic_people.person_shifts(person_id, dow, template_id, valid_from, created_by)
        values (pid, d, nullif(days->>d::text, '')::uuid, from_d, actor);
    end loop;
    insert into clinic_people.audit(actor_id, action, record_id, after_data)
      values (actor, 'shift_schedule', pid, jsonb_build_object('person_id', pid, 'valid_from', from_d, 'days', days, 'source', 'owner sheet 2026-11-22'));
  end loop;

  -- A5 checks
  select count(*) into n from clinic_reception.weekly_slots w join clinic_reception.providers p on p.id = w.provider_id
   where p.workspace_id = ws and p.active and (p.doctor_key in ('EMP-000001','EMP-000003','EMP-000011') or p.name = 'التمريض');
  if n <> 6 + 6 + 5 + 7 then raise exception 'expected 24 weekly rows (6+6+5+7), found %', n; end if;
  select count(*) into n from clinic_people.person_shifts where valid_from = from_d and created_by = actor
     and person_id in (select id from clinic_people.people where status <> 'ended' and (code in ('EMP-000001','EMP-000003','EMP-000011') or full_name ~ '^(مازن|مريم|زين[ةه]|منار)( |$)'));
  if n <> 49 then raise exception 'expected 49 HR shift rows (7 people × 7 days), found %', n; end if;
  raise notice 'OK: reception weeks set for 3 nurses + «التمريض»; HR shifts from % for 7 people', from_d;
end $$;

-- A6 after-state: future bookings of the 4 providers that are outside the new week (NOT moved — list for reception)
select p.name, a.id, to_char(a.starts_at at time zone 'Africa/Cairo', 'YYYY-MM-DD Dy HH24:MI') local_start,
       to_char(a.ends_at at time zone 'Africa/Cairo', 'HH24:MI') local_end, a.status
  from clinic_reception.appointments a join clinic_reception.providers p on p.id = a.provider_id
  join clinic_reception.workspaces ws on ws.id = a.workspace_id and ws.mode = 'live'
 where (p.doctor_key in ('EMP-000001','EMP-000003','EMP-000011') or p.name = 'التمريض') and p.active
   and a.starts_at > now() and a.status not in ('cancelled','no_show')
   and not exists (select 1 from clinic_reception.weekly_slots w where w.provider_id = p.id
                    and w.dow = extract(dow from a.starts_at at time zone 'Africa/Cairo')
                    and (a.starts_at at time zone 'Africa/Cairo')::time >= w.starts
                    and ((a.ends_at at time zone 'Africa/Cairo')::time <= w.ends or (w.ends = time '23:59' and (a.ends_at at time zone 'Africa/Cairo')::time = time '00:00')))
 order by a.starts_at;

-- A7 after-state: old weekly windows kept because a booking sits inside them (they keep the OLD hours on that day)
select p.name, to_char(v.starts_at at time zone 'Africa/Cairo', 'YYYY-MM-DD Dy HH24:MI') from_local, to_char(v.ends_at at time zone 'Africa/Cairo', 'HH24:MI') to_local, v.source
  from clinic_reception.availability v join clinic_reception.providers p on p.id = v.provider_id
  join clinic_reception.workspaces ws on ws.id = v.workspace_id and ws.mode = 'live'
 where (p.doctor_key in ('EMP-000001','EMP-000003','EMP-000011') or p.name = 'التمريض') and p.active and v.starts_at > now()
   and not exists (select 1 from clinic_reception.weekly_slots w where w.provider_id = p.id
                    and w.dow = extract(dow from v.starts_at at time zone 'Africa/Cairo')
                    and (v.starts_at at time zone 'Africa/Cairo')::time = w.starts)
 order by p.name, v.starts_at;

rollback;
