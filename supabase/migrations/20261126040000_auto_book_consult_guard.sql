-- Auto booking must never turn a Masa «كشف…» into a procedure because of a wrong SAVED default (owner bug 2026-11-25:
-- a Masa booking «كشف…» for د.شريف إبراهيم was auto-booked as «غرز جراحية عادية…», code 0000147, the doctor's saved
-- default since 2026-11-22). Cause, in clinic_reception.auto_time_service v3 (20261124210000): step 1 called
-- clinic_reception.auto_book_service_for (20261121100000), which falls back to clinic_reception.auto_book_service = the
-- doctor's saved default of ANY kind; the consult-only filter (consult_pickable) only covered steps 3–4. Saved defaults
-- come from the staff review action set_service, whose picker listed every active service.
-- Picker order now (v4):
--   1) the service the source NAMES — name match only (no saved-default fallback inside it), among the active, non-home,
--      non-placeholder services the doctor serves: a unique exact normalised name match, else a unique prefix match.
--      A consult-pickable match is used. A NON-consult match is used only when it is EXACT and the Masa text itself is
--      not consult-type (consult_kind(needed) is null, e.g. «جلسة علاج طبيعي»); otherwise it is ignored.
--   2) the doctor's saved default (clinic_reception.auto_book_service) — only when consult_pickable(name) and not is_home.
--   3) the doctor's most used consultation, 4) the department's consultation (كشف → استشارة → متابعة) — now also never
--      is_home («كشف منزلي» and other home services are never auto-picked). None → NULL → staff review 'service'.
-- set_service (public.clinic_reception_auto_book) refuses a non-consult or home service, and its picker list only offers
-- consult-pickable, non-home services. Ops clear: every saved default whose service is not consult-pickable (or is home)
-- is written to clinic_reception.audit ('auto_book_default_cleared') and deleted (clinic_reception.auto_book_clear_bad_defaults,
-- idempotent). sync_catalog: a re-versioned service keeps is_home (it used to drop it). Existing appointments are untouched.
-- In-place patches use exact anchors (each must occur once); old bodies saved in clinic_reception.auto_time_saved_defs.
-- Rollback: supabase/rollbacks/20261126040000_auto_book_consult_guard.rollback.sql
do $$ begin
  if to_regprocedure('clinic_reception.consult_pickable(text)') is null then raise exception 'طبّق 20261124210000 أولاً'; end if;
  if exists (select 1 from clinic_reception.auto_time_saved_defs where name = 'auto_time_service_before_consult_guard') then
    raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

begin;

do $$ begin
  if to_regprocedure('clinic_reception.service_name_key(text)') is null or to_regprocedure('clinic_reception.auto_book_service(uuid,uuid)') is null
     or to_regprocedure('clinic_reception.serves_service(uuid,text,text)') is null
     or to_regprocedure('public.clinic_reception_auto_book(uuid,text,jsonb)') is null
     or to_regprocedure('clinic_reception.sync_catalog(uuid)') is null then raise exception 'الحجز التلقائي / الكتالوج ناقص — راجع الترتيب'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'clinic_reception' and table_name = 'services' and column_name = 'is_home') then
    raise exception 'طبّق 20261120020000 الأول (services.is_home)'; end if;
  if exists (select 1 from clinic_reception.auto_time_saved_defs where name = 'auto_time_service_before_consult_guard') then
    raise exception 'تم تطبيق هذا الملف من قبل'; end if;
  insert into clinic_reception.auto_time_saved_defs values
    ('auto_time_service_before_consult_guard', pg_get_functiondef('clinic_reception.auto_time_service(uuid,uuid,text)'::regprocedure)),
    ('clinic_reception_auto_book_before_consult_guard', pg_get_functiondef('public.clinic_reception_auto_book(uuid,text,jsonb)'::regprocedure)),
    ('sync_catalog_before_consult_guard', pg_get_functiondef('clinic_reception.sync_catalog(uuid)'::regprocedure));
end $$;

create or replace function clinic_reception.auto_time_service(p_workspace uuid, p_provider uuid, p_needed text) returns uuid
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v uuid; vn text; dept text; k text := clinic_reception.service_name_key(p_needed); nk text := clinic_reception.consult_kind(p_needed);
begin
  select department into dept from clinic_reception.providers where id = p_provider and workspace_id = p_workspace;
  if dept is null then return null; end if;
  -- 1) the service the source NAMES: name match only. Non-consult only when exact AND the source text is not a consultation.
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
  -- 2) the doctor's saved service — only a consultation, never a home service
  v := clinic_reception.auto_book_service(p_workspace, p_provider);
  if v is not null and exists (select 1 from clinic_reception.services x where x.id = v and x.active and not coalesce(x.placeholder, false)
       and not x.is_home and clinic_reception.consult_pickable(x.name) and clinic_reception.serves_service(p_provider, x.department, x.code)) then return v; end if;
  -- 3) the doctor's most used CONSULTATION service (never home)
  select x.service_id into v from clinic_reception.appointments x join clinic_reception.services s on s.id = x.service_id
   where x.provider_id = p_provider and s.active and not coalesce(s.placeholder, false) and not s.is_home and x.status not in ('cancelled')
     and clinic_reception.serves_service(p_provider, s.department, s.code) and clinic_reception.consult_pickable(s.name)
   group by x.service_id order by min(clinic_reception.consult_rank(s.name, p_needed)), count(*) desc limit 1;
  if v is not null then return v; end if;
  -- 4) the department's consultation service (كشف, then استشارة, then متابعة; never home); none → NULL = staff picks it once
  select s.id into v from clinic_reception.services s where s.workspace_id = p_workspace and s.active and not coalesce(s.placeholder, false)
     and not s.is_home and clinic_reception.serves_service(p_provider, s.department, s.code) and clinic_reception.consult_pickable(s.name)
   order by clinic_reception.consult_rank(s.name, p_needed), (s.department = dept) desc, s.minutes, s.name limit 1;
  return v;
end $$;
revoke all on function clinic_reception.auto_time_service(uuid, uuid, text) from public, anon, authenticated;

-- set_service: refuse a non-consult / home service; the picker list offers only consult-pickable, non-home services
do $$ declare d text := pg_get_functiondef('public.clinic_reception_auto_book(uuid,text,jsonb)'::regprocedure); i int := 1; e text[] := array[
  $a$if not found then raise exception 'اختار الخدمة'; end if;$a$,
  $a$if not found then raise exception 'اختار الخدمة'; end if;
    if svc.is_home or coalesce(svc.placeholder, false) or not clinic_reception.consult_pickable(svc.name) then
      raise exception 'اختار خدمة كشف أو استشارة أو متابعة — الإجراءات والخدمات المنزلية ما بتتحفظش للحجز التلقائي'; end if;$a$,
  $a$from clinic_reception.services s where s.workspace_id = p_workspace and s.active), '[]'::jsonb));$a$,
  $a$from clinic_reception.services s where s.workspace_id = p_workspace and s.active and not s.is_home and not coalesce(s.placeholder, false)
          and clinic_reception.consult_pickable(s.name)), '[]'::jsonb));$a$];
begin
  while i < array_length(e, 1) loop
    if (length(d) - length(replace(d, e[i], ''))) <> length(e[i]) then raise exception 'clinic_reception_auto_book guard patch % not found once', (i + 1) / 2; end if;
    d := replace(d, e[i], e[i + 1]); i := i + 2;
  end loop;
  execute d;
end $$;
revoke all on function public.clinic_reception_auto_book(uuid, text, jsonb) from public, anon;
grant execute on function public.clinic_reception_auto_book(uuid, text, jsonb) to authenticated;

-- sync_catalog: a re-versioned service keeps «خدمة منزلية» (is_home) from its latest previous version
do $$ declare d text := pg_get_functiondef('clinic_reception.sync_catalog(uuid)'::regprocedure);
  a constant text := 'insert into clinic_reception.services(workspace_id,code,name,version,department,minutes,requires_device,price,bom,pricing_service_id,source_fingerprint,pricing_evidence) values(p_workspace,x.booking_code,x.name,version_no,x.booking_department,x.booking_minutes,x.booking_requires_device,price,bom,x.id,finger,price_evidence);';
  b constant text := 'insert into clinic_reception.services(workspace_id,code,name,version,department,minutes,requires_device,price,bom,pricing_service_id,source_fingerprint,pricing_evidence,is_home) values(p_workspace,x.booking_code,x.name,version_no,x.booking_department,x.booking_minutes,x.booking_requires_device,price,bom,x.id,finger,price_evidence,exists(select 1 from clinic_reception.services o where o.workspace_id=p_workspace and (o.code=x.booking_code or o.pricing_service_id=x.id) and o.is_home and o.version=(select max(o2.version) from clinic_reception.services o2 where o2.workspace_id=p_workspace and o2.code=o.code)));';
begin
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'sync_catalog anchor (services insert) not found once — check the live definition'; end if;
  execute replace(d, a, b);
end $$;

-- ops clear: saved defaults that are not a consultation (or are home) → audit + delete. Idempotent; returns the count.
create function clinic_reception.auto_book_clear_bad_defaults() returns int
language plpgsql security definer set search_path = pg_catalog, public as $$
declare r record; sys uuid; n int := 0;
begin
  select system_admin_id into sys from clinic_reception.auto_book_settings where id;
  for r in select d.provider_id, d.service_code, d.set_by, d.set_at, p.workspace_id, p.name provider_name, s.name service_name, s.is_home
             from clinic_reception.auto_book_services d join clinic_reception.providers p on p.id = d.provider_id
             cross join lateral (select s1.name, s1.is_home from clinic_reception.services s1
                                  where s1.workspace_id = p.workspace_id and s1.code = d.service_code
                                  order by s1.active desc, s1.version desc limit 1) s
            where s.is_home or not clinic_reception.consult_pickable(s.name)
            order by p.name loop
    if coalesce(sys, r.set_by) is null then continue; end if;   -- never delete without an audit row
    insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id, detail)
      values (r.workspace_id, coalesce(sys, r.set_by), 'auto_book_default_cleared', r.provider_id,
        jsonb_build_object('provider', r.provider_name, 'service_code', r.service_code, 'service_name', r.service_name,
          'is_home', r.is_home, 'set_by', r.set_by, 'set_at', r.set_at, 'migration', '20261126040000'));
    delete from clinic_reception.auto_book_services where provider_id = r.provider_id and service_code = r.service_code;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function clinic_reception.auto_book_clear_bad_defaults() from public, anon, authenticated;
select clinic_reception.auto_book_clear_bad_defaults();

notify pgrst, 'reload schema';
commit;
