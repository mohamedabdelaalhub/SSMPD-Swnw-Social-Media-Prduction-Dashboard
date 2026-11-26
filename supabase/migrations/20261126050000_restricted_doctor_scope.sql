-- «طبيب مقيّد بخدمات محددة» (owner rule 2026-11-25, Dr Dalia Saeed EMP-000036: «بتشتغل في الاسنان تقويم فقط وفي الجلدية ليزر فقط»).
-- Live before this file: a provider serves a department's services when the department is his own (providers.department), an
-- extra one (clinic_reception.provider_departments) or through a scope row (clinic_reception.provider_service_scopes + contract).
-- Membership opened EVERY service of the department, so a doctor scoped to the laser codes could still be booked on any
-- dermatology service, and on every dental service through her extra department.
--
-- RULE (one helper: clinic_reception.provider_serves_code(provider, department, code, day)):
--   * Basic services (clinic_reception.is_basic_service: «خدمات الكشف», names starting كشف / استشارة / متابعة) stay open to
--     every active doctor — the owner's earlier rule «الكشف والمتابعة والاستشارة… متاحة لكل الأطباء بلا استثناء».
--   * EXPLICIT opt-in: a department D is RESTRICTED for a provider only when management lists (provider, D) in the new table
--     clinic_reception.provider_restricted_departments_set (note + who + when; no client access). Nothing is inferred from
--     scope rows or the contract autofill log (a live dry-run showed inference would also restrict 6 home nurses of
--     «التمريض المنزلي», whose one scope row is the visit fee set on purpose). In a restricted department the provider serves
--     ONLY its scope rows there (+ basics + the «الخدمة تتحدد عند الحضور» placeholder of D). No contract is needed for a
--     scoped code of a restricted department (the fee contract is still checked at execution, unchanged).
--   * Every other department: unchanged — membership (home / provider_departments), or a scope row with a valid contract
--     (the previous has_provider_service_scope). On apply the table is empty, so nobody changes until ops rows are added
--     (Dr Dalia: supabase/ops/20261126050000_dalia_ortho_scopes.sql).
-- ROUTED THROUGH THE HELPER (signatures kept):
--   clinic_reception.has_provider_service_scope(uuid,text,date)  wrapped by rename (→ has_provider_service_scope_before_restricted)
--   clinic_reception.serves_service(uuid,text,text)              auto-book candidates (auto_time_service v4) — body replaced
--   clinic_reception.workspace_command   booking gate (book / walk_in / reschedule, live)       — in-place anchor
--   clinic_reception.service_operation   order_add gate + execution gate                         — in-place anchors
--   the «الخدمة تتحدد عند الحضور» arrival check (20261122060000, wherever it now lives)          — in-place anchor
--   public.clinic_reception_snapshot     provider_service_scopes cleaned + provider_restricted map — wrapped by rename
--   public.clinic_reception_booking_readiness  own_services counts only served codes + restricted  — wrapped by rename
-- The three refusals say why when the doctor is restricted (the old text stays first, so the Masa re-queue match still works).
-- Old bodies are saved in clinic_reception.restricted_scope_saved_defs.
-- Rollback: supabase/rollbacks/20261126050000_restricted_doctor_scope.rollback.sql
do $$ begin
  if to_regclass('clinic_reception.restricted_scope_saved_defs') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

begin;

do $$ begin
  if to_regclass('clinic_reception.provider_service_scopes') is null or to_regclass('clinic_reception.provider_departments') is null
     or to_regprocedure('clinic_reception.has_provider_service_scope(uuid,text,date)') is null
     or to_regprocedure('clinic_reception.serves_service(uuid,text,text)') is null
     or to_regprocedure('clinic_reception.is_basic_service(text,text)') is null
     or to_regprocedure('clinic_reception.provider_serves(uuid,text)') is null
     or to_regprocedure('clinic_reception.workspace_command(uuid,text,jsonb,uuid)') is null
     or to_regprocedure('clinic_reception.service_operation(uuid,text,jsonb,uuid)') is null
     or to_regprocedure('public.clinic_reception_snapshot(uuid,date,date)') is null
     or to_regprocedure('public.clinic_reception_booking_readiness(uuid)') is null then
    raise exception 'مكونات نطاق الأطباء / الحجز ناقصة — طبّق 20261124210000 الأول';
  end if;
  if to_regprocedure('clinic_reception.has_provider_service_scope_before_restricted(uuid,text,date)') is not null then
    raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create table clinic_reception.restricted_scope_saved_defs (sig text primary key, def text not null, saved_at timestamptz not null default now());
alter table clinic_reception.restricted_scope_saved_defs enable row level security;
revoke all on clinic_reception.restricted_scope_saved_defs from public, anon, authenticated;

-- the explicit list: which provider is restricted in which department (set by management, data only)
create table clinic_reception.provider_restricted_departments_set (
  provider_id uuid not null references clinic_reception.providers(id) on delete cascade,
  department text not null check (length(btrim(department)) >= 2),
  note text not null check (length(btrim(note)) >= 3),
  set_by uuid references public.admins(id),
  set_at timestamptz not null default now(),
  primary key (provider_id, department)
);
alter table clinic_reception.provider_restricted_departments_set enable row level security;
revoke all on clinic_reception.provider_restricted_departments_set from public, anon, authenticated;

-- departments where the provider is restricted: ONLY what the table lists (active providers)
create function clinic_reception.provider_restricted_departments(p_provider uuid) returns text[]
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(array_agg(r.department order by r.department), array[]::text[])
    from clinic_reception.provider_restricted_departments_set r
    join clinic_reception.providers p on p.id = r.provider_id and p.active
   where r.provider_id = p_provider
$$;

alter function clinic_reception.has_provider_service_scope(uuid, text, date) rename to has_provider_service_scope_before_restricted;

-- THE rule: does provider P serve service code C (of department D, default: the service's own) on day d
create function clinic_reception.provider_serves_code(p_provider uuid, p_department text, p_code text, p_day date default null)
returns boolean language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare pr record; sv record; d date := coalesce(p_day, clinic_reception.today()); dept text;
begin
  select p.id, p.workspace_id, p.department into pr from clinic_reception.providers p where p.id = p_provider and p.active;
  if not found or nullif(btrim(coalesce(p_code, '')), '') is null then return false; end if;
  select s.department, s.name, coalesce(s.placeholder, false) placeholder, s.active into sv
    from clinic_reception.services s where s.workspace_id = pr.workspace_id and s.code = p_code
   order by s.active desc, s.version desc limit 1;
  if not found then return clinic_reception.has_provider_service_scope_before_restricted(p_provider, p_code, d); end if;
  dept := coalesce(nullif(btrim(coalesce(p_department, '')), ''), sv.department);
  if sv.active and clinic_reception.is_basic_service(sv.department, sv.name) then return true; end if;
  if dept = any(clinic_reception.provider_restricted_departments(p_provider)) then
    return sv.placeholder
        or exists (select 1 from clinic_reception.provider_service_scopes sc where sc.provider_id = p_provider and sc.service_code = p_code);
  end if;
  return pr.department = dept
      or exists (select 1 from clinic_reception.provider_departments pd where pd.provider_id = p_provider and pd.department = dept)
      or clinic_reception.has_provider_service_scope_before_restricted(p_provider, p_code, d);
end $$;

-- the refusal text: the old message, plus why when the doctor is restricted in that department
create function clinic_reception.scope_refusal(p_provider uuid, p_department text, p_code text, p_default text)
returns text language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare pr record; dept text; n int;
begin
  select p.name, p.workspace_id into pr from clinic_reception.providers p where p.id = p_provider;
  if not found or p_code is null then return p_default; end if;
  select coalesce(nullif(btrim(coalesce(p_department, '')), ''), s.department) into dept
    from clinic_reception.services s where s.workspace_id = pr.workspace_id and s.code = p_code order by s.active desc, s.version desc limit 1;
  if dept is null or not (dept = any(clinic_reception.provider_restricted_departments(p_provider)))
     or clinic_reception.provider_serves_code(p_provider, dept, p_code, null) then return p_default; end if;
  select count(distinct s.code) into n from clinic_reception.provider_service_scopes sc
    join clinic_reception.services s on s.workspace_id = pr.workspace_id and s.code = sc.service_code and s.active and s.department = dept
   where sc.provider_id = p_provider;
  return p_default || ' — ' || pr.name || ' في قسم «' || dept || '» بيعمل خدمات محددة بس (' || n
      || ' خدمة)، والخدمة دي مش منهم. اختار خدمة من خدماته أو دكتور تاني';
end $$;

create function clinic_reception.has_provider_service_scope(p_provider uuid, p_code text, p_day date)
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select clinic_reception.provider_serves_code(p_provider, null, p_code, p_day)
$$;
revoke all on function clinic_reception.provider_restricted_departments(uuid), clinic_reception.provider_serves_code(uuid, text, text, date),
  clinic_reception.scope_refusal(uuid, text, text, text), clinic_reception.has_provider_service_scope(uuid, text, date),
  clinic_reception.has_provider_service_scope_before_restricted(uuid, text, date) from public, anon, authenticated;

-- auto-book candidates (auto_time_service v4 calls serves_service on every step)
insert into clinic_reception.restricted_scope_saved_defs(sig, def)
  values ('clinic_reception.serves_service(uuid,text,text)', pg_get_functiondef('clinic_reception.serves_service(uuid,text,text)'::regprocedure));
create or replace function clinic_reception.serves_service(p_provider uuid, p_department text, p_code text) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select clinic_reception.provider_serves_code(p_provider, p_department, p_code, null)
$$;
revoke all on function clinic_reception.serves_service(uuid, text, text) from public, anon, authenticated;

-- in-place gates: each anchor must occur exactly once
do $$
declare d text; r record; n int; sig text; i int; pairs text[];
begin
  -- 1) booking (book / walk_in / reschedule)
  sig := 'clinic_reception.workspace_command(uuid,text,jsonb,uuid)';
  d := pg_get_functiondef(sig::regprocedure);
  pairs := array[
    $a$else department=s.department or (w.mode='live' and clinic_reception.has_provider_service_scope(id,s.code,((p_payload->>'starts_at')::timestamptz at time zone 'Africa/Cairo')::date))$a$,
    $a$else case when w.mode='live' then clinic_reception.provider_serves_code(id,s.department,s.code,((p_payload->>'starts_at')::timestamptz at time zone 'Africa/Cairo')::date) else department=s.department end$a$,
    $a$if not found then raise exception 'الطبيب خارج تخصص الخدمة';end if;$a$,
    $a$if not found then raise exception '%', clinic_reception.scope_refusal(coalesce(nullif(p_payload->>'provider_id','')::uuid,a.provider_id),s.department,s.code,'الطبيب خارج تخصص الخدمة');end if;$a$];
  insert into clinic_reception.restricted_scope_saved_defs(sig, def) values (sig, d);
  i := 1;
  while i < array_length(pairs, 1) loop
    if (length(d) - length(replace(d, pairs[i], ''))) <> length(pairs[i]) then raise exception 'workspace_command: نقطة الربط % مش موجودة مرة واحدة', (i + 1) / 2; end if;
    d := replace(d, pairs[i], pairs[i + 1]); i := i + 2;
  end loop;
  execute d;

  -- 2) «+ إضافة خدمة» (order_add) and execution
  sig := 'clinic_reception.service_operation(uuid,text,jsonb,uuid)';
  d := pg_get_functiondef(sig::regprocedure);
  pairs := array[
    $a$active and (department=s.department or clinic_reception.has_provider_service_scope(id,s.code,clinic_reception.today()))) then raise exception 'راجع الخدمة وطبيبها';end if;$a$,
    $a$active and clinic_reception.provider_serves_code(id,s.department,s.code,clinic_reception.today())) then raise exception '%', case when s.id is null then 'راجع الخدمة وطبيبها' else clinic_reception.scope_refusal((p_payload->>'provider_id')::uuid,s.department,s.code,'راجع الخدمة وطبيبها') end;end if;$a$,
    $a$active and (department=o.snapshot->>'department' or clinic_reception.has_provider_service_scope(id,o.snapshot->>'code',clinic_reception.today()) or ($a$,
    $a$active and (clinic_reception.provider_serves_code(id,o.snapshot->>'department',o.snapshot->>'code',clinic_reception.today()) or ($a$,
    $a$then raise exception 'حدد الطبيب المنفذ من تخصص الخدمة';end if;$a$,
    $a$then raise exception '%', clinic_reception.scope_refusal(o.provider_id,o.snapshot->>'department',o.snapshot->>'code','حدد الطبيب المنفذ من تخصص الخدمة');end if;$a$];
  insert into clinic_reception.restricted_scope_saved_defs(sig, def) values (sig, d);
  i := 1;
  while i < array_length(pairs, 1) loop
    if (length(d) - length(replace(d, pairs[i], ''))) <> length(pairs[i]) then raise exception 'service_operation: نقطة الربط % مش موجودة مرة واحدة', (i + 1) / 2; end if;
    d := replace(d, pairs[i], pairs[i + 1]); i := i + 2;
  end loop;
  execute d;

  -- 3) arrival of a «الخدمة تتحدد عند الحضور» booking (20261122060000; the wrapper may have been renamed since)
  pairs := array[
    $a$if not (clinic_reception.provider_serves(ap.provider_id, s.department)
              or clinic_reception.has_provider_service_scope(ap.provider_id, s.code, (now() at time zone 'Africa/Cairo')::date)) then
        raise exception 'الخدمة دي مش من خدمات الدكتور ده — اختار خدمة من قسمه';$a$,
    $a$if not clinic_reception.provider_serves_code(ap.provider_id, s.department, s.code, (now() at time zone 'Africa/Cairo')::date) then
        raise exception '%', clinic_reception.scope_refusal(ap.provider_id, s.department, s.code, 'الخدمة دي مش من خدمات الدكتور ده — اختار خدمة من قسمه');$a$];
  n := 0;
  for r in select p.oid, p.oid::regprocedure::text s from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
            where ns.nspname in ('public', 'clinic_reception') and strpos(p.prosrc, pairs[1]) > 0 loop
    d := pg_get_functiondef(r.oid);
    if (length(d) - length(replace(d, pairs[1], ''))) <> length(pairs[1]) then raise exception 'arrival: نقطة الربط مش موجودة مرة واحدة في %', r.s; end if;
    insert into clinic_reception.restricted_scope_saved_defs(sig, def) values (r.s, d);
    execute replace(d, pairs[1], pairs[2]); n := n + 1;
  end loop;
  if n <> 1 then raise exception 'arrival: نقطة الربط موجودة في % دالة بدل ١', n; end if;
end $$;

-- snapshot: provider_service_scopes without the codes a restricted provider does not serve + provider_restricted map
-- {provider_id: {department: [codes]}} for the booking screen (live only)
alter function public.clinic_reception_snapshot(uuid, date, date) rename to snapshot_before_restricted_scope;
alter function public.snapshot_before_restricted_scope(uuid, date, date) set schema clinic_reception;
revoke all on function clinic_reception.snapshot_before_restricted_scope(uuid, date, date) from public, anon, authenticated;
create function public.clinic_reception_snapshot(p_workspace uuid, p_from date default current_date, p_to date default current_date)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare result jsonb; restr jsonb; cur jsonb; k text; v jsonb;
begin
  result := clinic_reception.snapshot_before_restricted_scope(p_workspace, p_from, p_to);
  if result#>>'{workspace,mode}' is distinct from 'live' then return result; end if;
  select coalesce(jsonb_object_agg(x.provider_id, x.depts), '{}'::jsonb) into restr from (
    select p.id provider_id, jsonb_object_agg(rd.dept, coalesce((
             select jsonb_agg(distinct sc.service_code) from clinic_reception.provider_service_scopes sc
               join clinic_reception.services s on s.workspace_id = p_workspace and s.code = sc.service_code and s.department = rd.dept
              where sc.provider_id = p.id), '[]'::jsonb)) depts
      from clinic_reception.providers p cross join lateral unnest(clinic_reception.provider_restricted_departments(p.id)) rd(dept)
     where p.workspace_id = p_workspace and p.active
     group by p.id) x;
  cur := coalesce(result->'provider_service_scopes', '{}'::jsonb);
  for k, v in select * from jsonb_each(restr) loop
    cur := jsonb_set(cur, array[k], coalesce((
      select jsonb_agg(c.code) from jsonb_array_elements_text(coalesce(cur->k, '[]'::jsonb)) c(code)
       where not exists (select 1 from clinic_reception.services s
                          where s.workspace_id = p_workspace and s.code = c.code and s.active and v ? s.department
                            and not clinic_reception.is_basic_service(s.department, s.name) and not ((v->s.department) ? c.code))), '[]'::jsonb));
  end loop;
  return result || jsonb_build_object('provider_service_scopes', cur, 'provider_restricted', restr);
end $$;
revoke all on function public.clinic_reception_snapshot(uuid, date, date) from public, anon;
grant execute on function public.clinic_reception_snapshot(uuid, date, date) to authenticated;

-- readiness: a restricted doctor's own_services = the services of his department he really serves; 'restricted' = departments
alter function public.clinic_reception_booking_readiness(uuid) rename to booking_readiness_before_restricted;
alter function public.booking_readiness_before_restricted(uuid) set schema clinic_reception;
revoke all on function clinic_reception.booking_readiness_before_restricted(uuid) from public, anon, authenticated;
create function public.clinic_reception_booking_readiness(p_workspace uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare r jsonb; d date := clinic_reception.today();
begin
  r := clinic_reception.booking_readiness_before_restricted(p_workspace);
  return r || jsonb_build_object('doctors', coalesce((
    select jsonb_agg(case when cardinality(x.rd) > 0 then x.doc || jsonb_build_object('restricted', to_jsonb(x.rd), 'own_services',
             (select count(*) from clinic_reception.services s where s.workspace_id = p_workspace and s.active and not coalesce(s.placeholder, false)
                 and s.department = x.doc->>'department' and not clinic_reception.is_basic_service(s.department, s.name)
                 and clinic_reception.provider_serves_code((x.doc->>'id')::uuid, s.department, s.code, d)))
           else x.doc end order by x.ord)
      from (select e.doc, e.ord, clinic_reception.provider_restricted_departments((e.doc->>'id')::uuid) rd
              from jsonb_array_elements(coalesce(r->'doctors', '[]'::jsonb)) with ordinality e(doc, ord)) x), '[]'::jsonb));
end $$;
revoke all on function public.clinic_reception_booking_readiness(uuid) from public, anon;
grant execute on function public.clinic_reception_booking_readiness(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
