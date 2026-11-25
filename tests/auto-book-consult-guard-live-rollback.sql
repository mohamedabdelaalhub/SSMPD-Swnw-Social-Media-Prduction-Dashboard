-- Live rollback check for 20261126040000_auto_book_consult_guard.sql. ONE transaction ending in ROLLBACK, run as postgres.
-- Nothing is kept: no saved default is deleted, no audit row stays, no function changes, no booking is touched.
-- (a) READ-ONLY, before the body: the saved auto-book defaults that the ops clear would delete (expect 4: د.يحي زكريا
--     «جلسة علاج طبيعي», د. أحمد سمير «تركيبة ستانلس ستيل أطفال», د.شريف إبراهيم «غرز جراحية عادية…», د.محمد قدري
--     «أخذ عينة من الأذن»).
-- (b) The migration body (pasted between the markers, without its own begin / commit) runs inside this transaction; then:
--     cleared + audited, Dr Sherif «كشف» / «كشف جديد» replay → a consultation, set_service as Mazen refuses «غرز», the
--     list Mazen sees has no procedure / home service, sync_catalog carries is_home. Summary table LAST.
begin;
-- transaction guard: SAVEPOINT fails outside an explicit begin … rollback block, and then nothing in this file runs
savepoint abg_live_guard;
select set_config('abg_live.in_txn', 'yes', true);
create temp table abg_live(n serial, step text, expected text, actual text, ok boolean);
create temp table abg_clear as
  select d.provider_id, p.name provider, d.service_code, s.name service, s.is_home, a.name set_by, d.set_at
    from clinic_reception.auto_book_services d join clinic_reception.providers p on p.id = d.provider_id
    cross join lateral (select s1.name, s1.is_home from clinic_reception.services s1 where s1.workspace_id = p.workspace_id and s1.code = d.service_code
                         order by s1.active desc, s1.version desc limit 1) s
    left join public.admins a on a.id = d.set_by
   where s.is_home or not clinic_reception.consult_pickable(s.name);
create temp table abg_before as
  select p.id provider_id, p.name, clinic_reception.auto_time_service(p.workspace_id, p.id, 'كشف جديد') svc
    from clinic_reception.providers p join clinic_reception.workspaces w on w.id = p.workspace_id and w.mode = 'live' where p.active;
do $$ begin
  if current_setting('abg_live.in_txn', true) is distinct from 'yes' then
    raise exception 'NOT inside begin … rollback — nothing done; run the whole file as one transaction'; end if;
end $$;
-- >>> BEGIN migration body: supabase/migrations/20261126040000_auto_book_consult_guard.sql (without begin / commit) <<<
do $$ begin
  if to_regprocedure('clinic_reception.consult_pickable(text)') is null then raise exception 'طبّق 20261124210000 أولاً'; end if;
  if exists (select 1 from clinic_reception.auto_time_saved_defs where name = 'auto_time_service_before_consult_guard') then
    raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;


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
-- >>> END migration body <<<
do $$ declare n int; m int; sher uuid; sher_ws uuid; v uuid; vn text; mazen uuid := 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb';
  bk uuid; ghorz uuid; err text; lst jsonb;
begin
  select count(*) into n from abg_clear;
  insert into abg_live(step, expected, actual, ok) values ('(a) saved defaults to clear (read-only, before)', '4 (يحي / أحمد سمير / شريف / قدري)',
    n || ': ' || coalesce((select string_agg(provider || ' → ' || service_code, ' | ' order by provider) from abg_clear), '-'),
    n = 4 and exists (select 1 from abg_clear where provider like '%يحي%') and exists (select 1 from abg_clear where provider like '%أحمد سمير%')
          and exists (select 1 from abg_clear where provider like '%شريف%') and exists (select 1 from abg_clear where provider like '%قدري%'));
  select count(*) into n from clinic_reception.audit where action = 'auto_book_default_cleared' and detail->>'migration' = '20261126040000';
  insert into abg_live(step, expected, actual, ok) values ('audit rows auto_book_default_cleared', (select count(*) from abg_clear)::text, n::text, n = (select count(*) from abg_clear));
  select count(*) into n from clinic_reception.auto_book_services d join clinic_reception.providers p on p.id = d.provider_id
    cross join lateral (select s1.name, s1.is_home from clinic_reception.services s1 where s1.workspace_id = p.workspace_id and s1.code = d.service_code
                         order by s1.active desc, s1.version desc limit 1) s
   where s.is_home or not clinic_reception.consult_pickable(s.name);
  insert into abg_live(step, expected, actual, ok) values ('non-consult / home saved defaults left', '0', n::text, n = 0);
  select count(*) into n from clinic_reception.auto_book_services;
  insert into abg_live(step, expected, actual, ok) values ('consult saved defaults kept', 'count (info)', n::text, true);
  select clinic_reception.auto_book_clear_bad_defaults() into n;
  insert into abg_live(step, expected, actual, ok) values ('ops clear second call', '0', n::text, n = 0);
  -- Dr Sherif replay
  select p.id, p.workspace_id into sher, sher_ws from clinic_reception.providers p join clinic_reception.workspaces w on w.id = p.workspace_id and w.mode = 'live'
   where p.name like '%شريف%' and p.active order by p.name limit 1;
  foreach vn in array array['كشف', 'كشف جديد'] loop
    v := clinic_reception.auto_time_service(sher_ws, sher, vn);
    insert into abg_live(step, expected, actual, ok) values ('Dr Sherif auto_time_service(«' || vn || '»)', 'a consultation (not غرز)',
      coalesce((select code || ' ' || name from clinic_reception.services where id = v), 'NULL → staff review'),
      v is null or exists (select 1 from clinic_reception.services where id = v and clinic_reception.consult_pickable(name) and not is_home));
  end loop;
  -- every live doctor with «كشف»: never a procedure / home service
  select count(*) into n from clinic_reception.providers p join clinic_reception.workspaces w on w.id = p.workspace_id and w.mode = 'live'
    cross join lateral (select clinic_reception.auto_time_service(p.workspace_id, p.id, 'كشف جديد') v) x
    join clinic_reception.services s on s.id = x.v where p.active and (s.is_home or not clinic_reception.consult_pickable(s.name));
  insert into abg_live(step, expected, actual, ok) values ('all live doctors, «كشف جديد» → procedure / home', '0', n::text, n = 0);
  select count(*) into m from abg_before b where b.svc is distinct from clinic_reception.auto_time_service((select workspace_id from clinic_reception.providers where id = b.provider_id), b.provider_id, 'كشف جديد');
  insert into abg_live(step, expected, actual, ok) values ('doctors whose «كشف جديد» pick changes', 'count (listed below)', m::text, true);
  -- sync_catalog carries is_home
  insert into abg_live(step, expected, actual, ok) values ('sync_catalog insert carries is_home', 'patched',
    case when position('pricing_evidence,is_home)' in pg_get_functiondef('clinic_reception.sync_catalog(uuid)'::regprocedure)) > 0 then 'patched' else 'NOT patched' end,
    position('pricing_evidence,is_home)' in pg_get_functiondef('clinic_reception.sync_catalog(uuid)'::regprocedure)) > 0);
  -- as Mazen (reception)
  select id into ghorz from clinic_reception.services where workspace_id = sher_ws and code = '0000147' and active order by version desc limit 1;
  select id into bk from clinic_reception.external_bookings where provider_id = sher order by created_at desc limit 1;
  if bk is null then select id into bk from clinic_reception.external_bookings where provider_id is not null order by created_at desc limit 1; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', mazen, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', mazen::text, true);
  begin
    perform public.clinic_reception_auto_book(sher_ws, 'set_service', jsonb_build_object('id', bk, 'service_id', ghorz));
    err := 'ACCEPTED';
  exception when others then err := sqlerrm;
  end;
  insert into abg_live(step, expected, actual, ok) values ('Mazen set_service «غرز» (0000147)', 'refused: اختار خدمة كشف أو استشارة أو متابعة…',
    coalesce(err, 'no booking / service found'), coalesce(err, '') like 'اختار خدمة كشف أو استشارة أو متابعة%');
  begin
    lst := public.clinic_reception_auto_book(sher_ws, 'list', '{}'::jsonb);
    select count(*), count(*) filter (where s.is_home or not clinic_reception.consult_pickable(s.name)) into m, n
      from jsonb_array_elements(coalesce(lst->'services', '[]'::jsonb)) j join clinic_reception.services s on s.id = (j->>'id')::uuid;
    err := n || ' of ' || m;
  exception when others then err := 'ERROR ' || sqlerrm; n := -1;
  end;
  insert into abg_live(step, expected, actual, ok) values ('Mazen list: picker services that are procedure / home', '0 of N', err, n = 0);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;
-- (a) the defaults the ops clear deletes (provider, code, service, who set it, when)
select provider, service_code, service, is_home, set_by, set_at from abg_clear order by provider;
-- doctors whose «كشف جديد» pick changes (old → new)
select b.name, so.code old_code, so.name old_service, sn.code new_code, sn.name new_service
  from abg_before b left join clinic_reception.services so on so.id = b.svc
  left join lateral (select clinic_reception.auto_time_service((select workspace_id from clinic_reception.providers where id = b.provider_id), b.provider_id, 'كشف جديد') v) x on true
  left join clinic_reception.services sn on sn.id = x.v
 where b.svc is distinct from x.v order by b.name;
-- summary LAST
select step, expected, actual, ok from abg_live order by n;
rollback;
