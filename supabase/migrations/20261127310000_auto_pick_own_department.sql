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
begin;
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
declare v uuid; vn text; n int; dept text; ids uuid[]; k text := clinic_reception.service_name_key(p_needed); nk text := clinic_reception.consult_kind(p_needed);
begin
  select department into dept from clinic_reception.providers where id = p_provider and workspace_id = p_workspace;
  if dept is null then return null; end if;
  -- the doctor's OWN services, computed once: a cheap membership filter first (home / extra department / scope row), then the
  -- restriction rule (serves_service) only on those few rows
  ids := array(select s.id from clinic_reception.services s
                where s.workspace_id = p_workspace and s.active and not coalesce(s.placeholder, false) and not s.is_home
                  and (s.department = dept
                       or s.department in (select d.department from clinic_reception.provider_departments d where d.provider_id = p_provider)
                       or s.code in (select sc.service_code from clinic_reception.provider_service_scopes sc where sc.provider_id = p_provider))
                  and clinic_reception.serves_service(p_provider, s.department, s.code));
  -- 1) the service the source NAMES (as v4): unique exact match; a non-consult one only when the text is not a consult
  if k <> '' then
    select min(s.id::text)::uuid, min(s.name) into v, vn from clinic_reception.services s
     where s.id = any(ids) and clinic_reception.service_name_key(s.name) = k having count(*) = 1;
    if v is not null and (clinic_reception.consult_pickable(vn) or nk is null) then return v; end if;
    v := null;
    if length(k) >= 3 then
      select min(s.id::text)::uuid, min(s.name) into v, vn from clinic_reception.services s
       where s.id = any(ids) and clinic_reception.service_name_key(s.name) like k || '%' having count(*) = 1;
      if v is not null and clinic_reception.consult_pickable(vn) then return v; end if;
    end if;
  end if;
  -- 2) the doctor's SAVED service = a staff choice («اختار الخدمة»): only a consultation of his own services
  v := clinic_reception.auto_book_service(p_workspace, p_provider);
  if v is not null and v = any(ids) and exists (select 1 from clinic_reception.services x where x.id = v and clinic_reception.consult_pickable(x.name)) then return v; end if;
  -- 3) the ONLY consultation the doctor serves (exactly one); more than one or none → NULL = staff choose
  select min(s.id::text)::uuid, count(*) into v, n from clinic_reception.services s where s.id = any(ids) and clinic_reception.consult_pickable(s.name);
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
commit;
