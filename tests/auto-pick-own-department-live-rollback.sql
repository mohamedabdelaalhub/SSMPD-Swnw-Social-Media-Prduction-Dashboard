-- Live rollback check for 20261127310000_auto_pick_own_department.sql. ONE transaction ending in ROLLBACK, run as postgres.
-- Nothing is kept: no function change, no booking, no message. Appointments are only READ. Output is COUNTS ONLY (no patient data).
-- (a) READ-ONLY before the body: the REPORT — Masa auto-booked appointments since 2026-11-26 whose service is outside the
--     doctor's own departments (home / provider_departments / scope row), split past (done / collected) vs upcoming, and today's
--     pick for «كشف جديد» of every active live doctor; then the masa-auto-service-check on the state BEFORE the fix (shows the bug).
-- (b) the migration body (between the markers, without begin / commit).
-- (c) after: no doctor's pick is outside his departments; Dr Ahmed Mostafa's pick; how many picks changed / became NULL
--     (= staff choose); the owner's flow as Mazen (booked as «الخدمة تتحدد عند الحضور», «وصل» refused without a service,
--     accepted with one); the masa-auto-service-check again (expected 0). Summary tables LAST.
begin;
savepoint apod_live_guard;
select set_config('apod_live.in_txn', 'yes', true);
do $$ begin
  if current_setting('apod_live.in_txn', true) is distinct from 'yes' then
    raise exception 'NOT inside begin … rollback — nothing done; run the whole file as one transaction'; end if;
end $$;
create temp table apod_live(n serial, step text, expected text, actual text, ok boolean);
create function pg_temp.apod_member(p_provider uuid, p_department text, p_code text) returns boolean language sql stable as $f$
  select exists (select 1 from clinic_reception.providers p where p.id = p_provider and p.department = p_department)
      or exists (select 1 from clinic_reception.provider_departments d where d.provider_id = p_provider and d.department = p_department)
      or exists (select 1 from clinic_reception.provider_service_scopes sc where sc.provider_id = p_provider and sc.service_code = p_code)
$f$;
create temp table apod_wrong as
  select a.id appointment_id, a.status, a.starts_at, a.provider_id, s.name service,
         exists (select 1 from clinic_reception.visits v where v.appointment_id = a.id) has_visit
    from clinic_reception.external_bookings e
    join clinic_reception.appointments a on a.id = e.appointment_id
    join clinic_reception.services s on s.id = a.service_id
   where e.source = 'masa' and e.created_at >= '2026-11-26' and not pg_temp.apod_member(a.provider_id, s.department, s.code);
-- REPORT (counts only)
create temp table apod_report as
  select case when status = 'cancelled' then '4 اتلغى'
              when status = 'no_show' then '3 ماضي — محضرش'
              when status = 'completed' then '1 ماضي — اتنفّذ / اتحصّل'
              when status = 'arrived' or has_visit then '2 وصل — الزيارة مفتوحة (تتصلح بـ«تغيير الخدمة»)'
              when starts_at < now() then '3 ماضي — لسه «محجوز» ومتعملّوش وصول'
              else '5 جاي — يتصلح قبل ما المريض يوصل' end bucket,
         count(*) n, count(distinct provider_id) doctors
    from apod_wrong group by 1;
create temp table apod_by_service as select service, count(*) n from apod_wrong group by 1;
insert into apod_live(step, expected, actual, ok)
select '(a) REPORT: Masa auto-booked since 11-26 with another department''s service', 'info (the bug)',
       count(*) || ' booking(s), ' || count(distinct provider_id) || ' doctor(s)', true from apod_wrong;
create temp table apod_before as
  select p.id provider_id, p.name, p.department, clinic_reception.auto_time_service(p.workspace_id, p.id, 'كشف جديد') svc
    from clinic_reception.providers p join clinic_reception.workspaces w on w.id = p.workspace_id and w.mode = 'live' where p.active;
insert into apod_live(step, expected, actual, ok)
select '(a) before: doctors whose «كشف جديد» pick is outside their departments', 'info (the bug)',
       count(*) || ' of ' || (select count(*) from apod_before), true
  from apod_before b join clinic_reception.services s on s.id = b.svc where not pg_temp.apod_member(b.provider_id, s.department, s.code);
-- >>> BEGIN masa-auto-service-check (same text in tests/masa-auto-service-live-check.sql; CI: tests/masa-auto-service-guard.cjs) <<<
-- Re-runs the auto picker on the REAL Masa bookings of the last 7 days and compares the department of the picked service with
-- the doctor's own departments (home / provider_departments / scope row). Expected: 0 outside. Reads only.
create function pg_temp.masa_chk_member(p_provider uuid, p_department text, p_code text) returns boolean language sql stable as $f$
  select exists (select 1 from clinic_reception.providers p where p.id = p_provider and p.department = p_department)
      or exists (select 1 from clinic_reception.provider_departments d where d.provider_id = p_provider and d.department = p_department)
      or exists (select 1 from clinic_reception.provider_service_scopes sc where sc.provider_id = p_provider and sc.service_code = p_code)
$f$;
create temp table masa_chk as
  select e.id, e.provider_id, s.department svc_dept, s.code, s.name svc_name, s.is_home, s.placeholder
    from clinic_reception.external_bookings e
    join clinic_reception.providers p on p.id = e.provider_id
    left join clinic_reception.services s on s.id = clinic_reception.auto_time_service(p.workspace_id, e.provider_id, e.needed_service)
   where e.source = 'masa' and e.created_at >= now() - interval '7 days';
create temp table masa_chk_result(n serial, step text, expected text, actual text, ok boolean);
insert into masa_chk_result(step, expected, actual, ok)
select 'masa check: Masa bookings of the last 7 days re-picked', '> 0 (info)',
       count(*) || ' (' || count(*) filter (where code is null) || ' → staff review)', true from masa_chk;
insert into masa_chk_result(step, expected, actual, ok)
select 'masa check: picked service outside the doctor''s departments', '0', count(*)::text, count(*) = 0
  from masa_chk where code is not null and not pg_temp.masa_chk_member(provider_id, svc_dept, code);
insert into masa_chk_result(step, expected, actual, ok)
select 'masa check: picked a home / placeholder / non-consult service for a consult text', '0', count(*)::text, count(*) = 0
  from masa_chk c join clinic_reception.external_bookings e on e.id = c.id
 where c.code is not null and clinic_reception.consult_kind(e.needed_service) is not null
   and (c.is_home or coalesce(c.placeholder, false) or not clinic_reception.consult_pickable(c.svc_name));
-- >>> END masa-auto-service-check <<<
insert into apod_live(step, expected, actual, ok)
select '(a) BEFORE fix — ' || step, 'info (the bug)', actual, true from masa_chk_result order by n;
-- >>> BEGIN migration body: supabase/migrations/20261127310000_auto_pick_own_department.sql (without begin / commit) <<<
-- Masa auto booking puts «كشف أخصائي أمراض الدم والمناعة» on consults of OTHER doctors (owner bug 2026-11-27, relayed by main
-- chat 7 from Mazen: «اي حالة بتتسجل كشف من علي ماسا بيتحول لي الداش نفس نوع الكشف دا اخصائي المناعه و الدم», booking of
-- د.أحمد مصطفى).
-- Cause: 20261126050000_restricted_doctor_scope redefined clinic_reception.serves_service as provider_serves_code, which
-- returns TRUE for every BASIC service (كشف / استشارة / متابعة) of ANY department — right for manual booking (owner rule:
-- basics open to every doctor) but wrong for the AUTO picker: clinic_reception.auto_time_service v4 (20261126040000) step 4
-- takes «the department's consultation» from every service the doctor serves, ordered by consult_rank first, so the
-- shortest / alphabetically first «كشف أخصائي…» of the WHOLE clinic won for every doctor without an exact name match; and
-- step 3 (the doctor's most used consultation) then kept repeating it from those bookings.
-- Fix: serves_service (used ONLY by the auto picker) = membership (home department, provider_departments, or a scope row
-- for the code — its definition before 20261126050000) AND provider_serves_code (so a RESTRICTED department still offers only
-- its scoped codes + basics). Manual booking, the snapshot and every gate keep provider_serves_code unchanged.
-- OWNER DECISION 2026-11-27 (relayed by main chat 7): «لو مفيش خدمة مطابقة ينتظر لما الموظف يقوم باختيار خدمة».
-- clinic_reception.auto_time_service v5 picks ONLY: (1) the service the Masa text NAMES (unique exact / unique prefix match among
-- the doctor's own services, as in v4), (2) the doctor's SAVED service (a staff choice made in «اختار الخدمة», consult, own
-- departments), (3) the ONLY consultation the doctor serves (exactly one). No «most used», no «department's best consult».
-- Nothing clear → NULL, and the Masa booking is still BOOKED (so it shows in «المواعيد» / «تشغيل اليوم») with the doctor's
-- department placeholder «الخدمة تتحدد عند الحضور» (20261122060000, service_later): no order, price or invoice exists, and
-- «وصل» refuses until staff choose the real service — so nothing can be collected before that. clinic_reception.auto_book_pick
-- = auto_time_service, else that placeholder; auto_book_one (timed) and auto_book_place_day_only call it (one exact anchor each,
-- old bodies saved). A department without a placeholder keeps the old review «اختار الخدمة». Open review 'service' rows from
-- today on are re-queued once (they become «الخدمة تتحدد عند الحضور» bookings).
-- Existing appointments are NOT touched: tests/auto-pick-own-department-live-rollback.sql lists the open ones whose
-- auto-picked service is outside the doctor's departments, for reception to fix with «تغيير الخدمة».
-- Rollback: supabase/rollbacks/20261127310000_auto_pick_own_department.rollback.sql
do $$ begin
  if to_regclass('clinic_reception.auto_pick_saved_defs') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
  if to_regprocedure('clinic_reception.provider_serves_code(uuid,text,text,date)') is null
     or to_regprocedure('clinic_reception.serves_service(uuid,text,text)') is null then raise exception 'طبّق 20261126050000 أولاً'; end if;
  if pg_get_functiondef('clinic_reception.serves_service(uuid,text,text)'::regprocedure) not like '%provider_serves_code%' then
    raise exception 'serves_service مش النسخة المتوقعة (20261126050000) — راجع التعريف الحي'; end if;
end $$;
create table clinic_reception.auto_pick_saved_defs(sig text primary key, def text not null, saved_at timestamptz not null default now());
alter table clinic_reception.auto_pick_saved_defs enable row level security;
revoke all on clinic_reception.auto_pick_saved_defs from public, anon, authenticated;
insert into clinic_reception.auto_pick_saved_defs(sig, def)
  values ('clinic_reception.serves_service(uuid,text,text)', pg_get_functiondef('clinic_reception.serves_service(uuid,text,text)'::regprocedure));

-- the auto picker's candidates: the doctor's OWN departments (or an explicit scope row), still under the restriction rule
create or replace function clinic_reception.serves_service(p_provider uuid, p_department text, p_code text) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select (exists (select 1 from clinic_reception.providers p where p.id = p_provider and p.department = p_department)
       or exists (select 1 from clinic_reception.provider_departments d where d.provider_id = p_provider and d.department = p_department)
       or exists (select 1 from clinic_reception.provider_service_scopes sc where sc.provider_id = p_provider and sc.service_code = p_code))
     and clinic_reception.provider_serves_code(p_provider, p_department, p_code, null)
$$;
revoke all on function clinic_reception.serves_service(uuid, text, text) from public, anon, authenticated;

-- v5 picker (owner 2026-11-27): name match → saved staff choice → the ONLY consultation; otherwise NULL (staff choose)
insert into clinic_reception.auto_pick_saved_defs(sig, def)
  values ('clinic_reception.auto_time_service(uuid,uuid,text)', pg_get_functiondef('clinic_reception.auto_time_service(uuid,uuid,text)'::regprocedure));
create or replace function clinic_reception.auto_time_service(p_workspace uuid, p_provider uuid, p_needed text) returns uuid
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v uuid; vn text; n int; dept text; k text := clinic_reception.service_name_key(p_needed); nk text := clinic_reception.consult_kind(p_needed);
begin
  select department into dept from clinic_reception.providers where id = p_provider and workspace_id = p_workspace;
  if dept is null then return null; end if;
  -- 1) the service the source NAMES (unchanged from v4): unique exact match; a non-consult one only when the text is not a consult
  if k <> '' then
    select min(s.id::text)::uuid, min(s.name) into v, vn from clinic_reception.services s
     where s.workspace_id = p_workspace and s.active and not coalesce(s.placeholder, false) and not s.is_home
       and clinic_reception.serves_service(p_provider, s.department, s.code) and clinic_reception.service_name_key(s.name) = k
    having count(*) = 1;
    if v is not null and (clinic_reception.consult_pickable(vn) or nk is null) then return v; end if;
    v := null;
    if length(k) >= 3 then
      select min(s.id::text)::uuid, min(s.name) into v, vn from clinic_reception.services s
       where s.workspace_id = p_workspace and s.active and not coalesce(s.placeholder, false) and not s.is_home
         and clinic_reception.serves_service(p_provider, s.department, s.code) and clinic_reception.service_name_key(s.name) like k || '%'
      having count(*) = 1;
      if v is not null and clinic_reception.consult_pickable(vn) then return v; end if;
    end if;
  end if;
  -- 2) the doctor's SAVED service = a staff choice («اختار الخدمة»): only a consultation of his own services, never home
  v := clinic_reception.auto_book_service(p_workspace, p_provider);
  if v is not null and exists (select 1 from clinic_reception.services x where x.id = v and x.active and not coalesce(x.placeholder, false)
       and not x.is_home and clinic_reception.consult_pickable(x.name) and clinic_reception.serves_service(p_provider, x.department, x.code)) then return v; end if;
  -- 3) the ONLY consultation the doctor serves (exactly one); more than one or none → NULL = staff choose
  select min(s.id::text)::uuid, count(*) into v, n from clinic_reception.services s
   where s.workspace_id = p_workspace and s.active and not coalesce(s.placeholder, false) and not s.is_home
     and clinic_reception.serves_service(p_provider, s.department, s.code) and clinic_reception.consult_pickable(s.name);
  if n = 1 then return v; end if;
  return null;
end $$;
revoke all on function clinic_reception.auto_time_service(uuid, uuid, text) from public, anon, authenticated;

-- the auto-book service: the picker, else the department placeholder «الخدمة تتحدد عند الحضور» (booked, staff choose at «وصل»)
create function clinic_reception.auto_book_pick(p_workspace uuid, p_provider uuid, p_needed text) returns uuid
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v uuid := clinic_reception.auto_time_service(p_workspace, p_provider, p_needed);
begin
  if v is not null then return v; end if;
  select s.id into v from clinic_reception.services s join clinic_reception.providers p on p.id = p_provider and p.workspace_id = p_workspace
   where s.workspace_id = p_workspace and coalesce(s.placeholder, false) and s.department = p.department
   order by s.version desc limit 1;
  return v;
end $$;
revoke all on function clinic_reception.auto_book_pick(uuid, uuid, text) from public, anon, authenticated;

-- the two auto-book paths call auto_book_pick (exact anchors, once each; old bodies saved)
do $$ declare r record; d text; begin
  for r in select * from (values
      ('clinic_reception.auto_book_one(uuid)', 'clinic_reception.auto_time_service(ws, b.provider_id, b.needed_service)',
       'clinic_reception.auto_book_pick(ws, b.provider_id, b.needed_service)'),
      ('clinic_reception.auto_book_place_day_only(uuid,uuid)', 'clinic_reception.auto_time_service(p_workspace, b.provider_id, b.needed_service)',
       'clinic_reception.auto_book_pick(p_workspace, b.provider_id, b.needed_service)')) x(sig, a, b) loop
    d := pg_get_functiondef(r.sig::regprocedure);
    if (length(d) - length(replace(d, r.a, ''))) <> length(r.a) then raise exception '% : service anchor not found once — check the live definition', r.sig; end if;
    insert into clinic_reception.auto_pick_saved_defs(sig, def) values (r.sig, d);
    execute replace(d, r.a, r.b);
  end loop;
end $$;

-- bookings parked for «اختار الخدمة» get one more try: they are booked as «الخدمة تتحدد عند الحضور» (staff choose at «وصل»)
update clinic_reception.external_bookings set state = 'pending', review_kind = null, reason = null, attempts = 0, updated_at = now()
 where state = 'review' and review_kind = 'service' and day >= clinic_reception.cairo_day(now());
-- >>> END migration body <<<
create temp table apod_after as
  select b.provider_id, b.name, b.svc before_svc, clinic_reception.auto_time_service(p.workspace_id, p.id, 'كشف جديد') svc
    from apod_before b join clinic_reception.providers p on p.id = b.provider_id;
insert into apod_live(step, expected, actual, ok)
select '(c) after: picks outside the doctor''s departments', '0', count(*)::text, count(*) = 0
  from apod_after x join clinic_reception.services s on s.id = x.svc where not pg_temp.apod_member(x.provider_id, s.department, s.code);
insert into apod_live(step, expected, actual, ok)
select '(c) after: no pick is a procedure / home service', '0', count(*)::text, count(*) = 0
  from apod_after x join clinic_reception.services s on s.id = x.svc where s.is_home or not clinic_reception.consult_pickable(s.name);
insert into apod_live(step, expected, actual, ok)
select '(c) after: picks changed / now NULL (staff picks once)', 'info',
       count(*) filter (where svc is distinct from before_svc) || ' changed, ' || count(*) filter (where svc is null) || ' NULL of ' || count(*), true from apod_after;
insert into apod_live(step, expected, actual, ok)
select '(c) Dr Ahmed Mostafa: «كشف جديد» before → after', 'a consult of his own department',
       coalesce((select name from clinic_reception.services where id = x.before_svc), 'NULL') || ' → ' ||
       coalesce((select s.name || ' [' || s.department || ']' from clinic_reception.services s where s.id = x.svc), 'NULL → staff review'),
       x.svc is null or exists (select 1 from clinic_reception.services s where s.id = x.svc and pg_temp.apod_member(x.provider_id, s.department, s.code))
  from apod_after x where x.name like '%أحمد مصطفى%' or x.name like '%احمد مصطفى%';
insert into apod_live(step, expected, actual, ok)
select '(c) manual booking unchanged: basics of another department still open (provider_serves_code)', 'true',
       coalesce(bool_and(clinic_reception.provider_serves_code(x.provider_id, s.department, s.code, null))::text, 'no sample'), coalesce(bool_and(clinic_reception.provider_serves_code(x.provider_id, s.department, s.code, null)), true)
  from (select provider_id, before_svc from apod_after limit 50) x join clinic_reception.services s on s.id = x.before_svc;
-- (c) the owner's flow, rolled back: no clear service → booked as «الخدمة تتحدد عند الحضور»; «وصل» refused until staff choose
insert into apod_live(step, expected, actual, ok)
select '(c) auto_book_one + day-only path call auto_book_pick', '2 of 2',
       ((position('auto_book_pick' in pg_get_functiondef('clinic_reception.auto_book_one(uuid)'::regprocedure)) > 0)::int
      + (position('auto_book_pick' in pg_get_functiondef('clinic_reception.auto_book_place_day_only(uuid,uuid)'::regprocedure)) > 0)::int) || ' of 2',
       position('auto_book_pick' in pg_get_functiondef('clinic_reception.auto_book_one(uuid)'::regprocedure)) > 0
   and position('auto_book_pick' in pg_get_functiondef('clinic_reception.auto_book_place_day_only(uuid,uuid)'::regprocedure)) > 0;
insert into apod_live(step, expected, actual, ok)
select '(c) open «اختار الخدمة» reviews re-queued (they get booked as «الخدمة تتحدد عند الحضور»)', '0 left',
       count(*) || ' left', count(*) = 0
  from clinic_reception.external_bookings where state = 'review' and review_kind = 'service' and day >= clinic_reception.cairo_day(now());
do $$ declare mazen uuid := 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb'; pr record; ph uuid; real_svc uuid; pat uuid; st timestamptz; r jsonb; ap record; err text; n int;
begin
  -- a live doctor whose «كشف جديد» is NOT clear (picker NULL) and whose department has the placeholder
  select p.id, p.workspace_id, p.name, p.department into pr from apod_after x join clinic_reception.providers p on p.id = x.provider_id
   where x.svc is null and clinic_reception.auto_book_pick(p.workspace_id, p.id, 'كشف جديد') is not null order by p.name limit 1;
  if pr.id is null then
    insert into apod_live(step, expected, actual, ok) values ('(c) flow: a doctor without a clear consult', 'info', 'none on live — every doctor has a clear one', true);
    return;
  end if;
  ph := clinic_reception.auto_book_pick(pr.workspace_id, pr.id, 'كشف جديد');
  insert into apod_live(step, expected, actual, ok) select '(c) flow: ' || pr.name || ' «كشف جديد» → auto_book_pick', 'الخدمة تتحدد عند الحضور',
    s.name || ' [' || s.department || ']', s.placeholder and s.department = pr.department from clinic_reception.services s where s.id = ph;
  select s.id into real_svc from clinic_reception.services s where s.workspace_id = pr.workspace_id and s.active and not coalesce(s.placeholder, false)
     and not s.is_home and clinic_reception.consult_pickable(s.name) and clinic_reception.serves_service(pr.id, s.department, s.code) order by s.name limit 1;
  select a.patient_id into pat from clinic_reception.appointments a where a.workspace_id = pr.workspace_id and a.patient_id is not null order by a.created_at desc limit 1;
  select f into st from generate_series(0, 6) g(dd), lateral clinic_reception.free_starts(pr.id, clinic_reception.cairo_day(now()) + g.dd, 30, 1) f where f > now() order by f limit 1;
  if st is null or pat is null then
    insert into apod_live(step, expected, actual, ok) values ('(c) flow: free slot / a patient', 'info', 'no free 30-minute slot in 7 days or no patient — flow not run', true);
    return;
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', mazen, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', mazen::text, true);
  begin
    r := public.clinic_reception_command(pr.workspace_id, 'book', jsonb_build_object('patient_id', pat, 'provider_id', pr.id, 'service_id', ph,
           'starts_at', st, 'source', 'unknown', 'source_evidence', 'unknown'), gen_random_uuid());
    select * into ap from clinic_reception.appointments where id = (r->>'id')::uuid;
    err := 'booked, service_later=' || coalesce(ap.service_later::text, 'null');
  exception when others then err := 'ERROR ' || sqlerrm;
  end;
  insert into apod_live(step, expected, actual, ok) values ('(c) flow: Mazen books with the placeholder (what auto-book does)', 'booked, service_later=true', err, err = 'booked, service_later=true');
  if ap.id is not null then
    select count(*) into n from clinic_reception.visits where appointment_id = ap.id;
    insert into apod_live(step, expected, actual, ok) values ('(c) flow: before «وصل» — no visit / order / invoice (nothing to collect)', '0', n::text, n = 0);
    begin
      perform public.clinic_reception_command(pr.workspace_id, 'arrive', jsonb_build_object('id', ap.id, 'encounter_type', 'checkup'), gen_random_uuid());
      err := 'ACCEPTED';
    exception when others then err := sqlerrm;
    end;
    insert into apod_live(step, expected, actual, ok) values ('(c) flow: «وصل» WITHOUT a service', 'refused: الحجز ده «الخدمة تتحدد عند الحضور»…', err, err like 'الحجز ده «الخدمة تتحدد عند الحضور»%');
    if real_svc is not null then
      begin
        perform public.clinic_reception_command(pr.workspace_id, 'arrive', jsonb_build_object('id', ap.id, 'encounter_type', 'checkup', 'service_id', real_svc), gen_random_uuid());
        select * into ap from clinic_reception.appointments where id = ap.id;
        err := 'arrived, service_later=' || ap.service_later::text;
      exception when others then err := 'refused (not the service rule): ' || sqlerrm;
      end;
      insert into apod_live(step, expected, actual, ok) values ('(c) flow: «وصل» WITH the service staff chose', 'arrived, service_later=false (or a date / shift rule)',
        err, err = 'arrived, service_later=false' or (err like 'refused (not the service rule)%' and err not like '%الخدمة تتحدد عند الحضور%'));
    end if;
  end if;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;
drop function pg_temp.masa_chk_member(uuid, text, text);
drop table masa_chk, masa_chk_result;
-- >>> BEGIN masa-auto-service-check (same text in tests/masa-auto-service-live-check.sql; CI: tests/masa-auto-service-guard.cjs) <<<
-- Re-runs the auto picker on the REAL Masa bookings of the last 7 days and compares the department of the picked service with
-- the doctor's own departments (home / provider_departments / scope row). Expected: 0 outside. Reads only.
create function pg_temp.masa_chk_member(p_provider uuid, p_department text, p_code text) returns boolean language sql stable as $f$
  select exists (select 1 from clinic_reception.providers p where p.id = p_provider and p.department = p_department)
      or exists (select 1 from clinic_reception.provider_departments d where d.provider_id = p_provider and d.department = p_department)
      or exists (select 1 from clinic_reception.provider_service_scopes sc where sc.provider_id = p_provider and sc.service_code = p_code)
$f$;
create temp table masa_chk as
  select e.id, e.provider_id, s.department svc_dept, s.code, s.name svc_name, s.is_home, s.placeholder
    from clinic_reception.external_bookings e
    join clinic_reception.providers p on p.id = e.provider_id
    left join clinic_reception.services s on s.id = clinic_reception.auto_time_service(p.workspace_id, e.provider_id, e.needed_service)
   where e.source = 'masa' and e.created_at >= now() - interval '7 days';
create temp table masa_chk_result(n serial, step text, expected text, actual text, ok boolean);
insert into masa_chk_result(step, expected, actual, ok)
select 'masa check: Masa bookings of the last 7 days re-picked', '> 0 (info)',
       count(*) || ' (' || count(*) filter (where code is null) || ' → staff review)', true from masa_chk;
insert into masa_chk_result(step, expected, actual, ok)
select 'masa check: picked service outside the doctor''s departments', '0', count(*)::text, count(*) = 0
  from masa_chk where code is not null and not pg_temp.masa_chk_member(provider_id, svc_dept, code);
insert into masa_chk_result(step, expected, actual, ok)
select 'masa check: picked a home / placeholder / non-consult service for a consult text', '0', count(*)::text, count(*) = 0
  from masa_chk c join clinic_reception.external_bookings e on e.id = c.id
 where c.code is not null and clinic_reception.consult_kind(e.needed_service) is not null
   and (c.is_home or coalesce(c.placeholder, false) or not clinic_reception.consult_pickable(c.svc_name));
-- >>> END masa-auto-service-check <<<
insert into apod_live(step, expected, actual, ok)
select '(c) AFTER fix — ' || step, expected, actual, ok from masa_chk_result order by n;
-- REPORT tables (counts only, no patient data)
select bucket, n bookings, doctors from apod_report order by bucket;
select service, n bookings from apod_by_service order by n desc;
select step, expected, actual, ok from apod_live order by n;
rollback;
