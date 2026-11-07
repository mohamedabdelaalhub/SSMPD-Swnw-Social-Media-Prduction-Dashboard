-- LIVE CAPTURE (2026-11-07): definitions read from production with pg_get_functiondef (read-only).
-- Reference snapshot of objects that had no CREATE under supabase/. NOT a migration: do not apply blindly.
-- Grants, owners and triggers are not included. Vault secret NAMES only; no secret values.

CREATE OR REPLACE FUNCTION legacy_dashboard.branch_block_legacy()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'legacy_dashboard', 'pg_temp'
AS $function$
begin
 if new.payload->>'kind'='branch-study' then
  raise exception 'use branch study functions';
 end if;

 return new;
end
$function$;

CREATE OR REPLACE FUNCTION legacy_dashboard.branch_change_allowed(old_doc jsonb, new_doc jsonb, p text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'legacy_dashboard', 'pg_temp'
AS $function$
declare
 s jsonb;
 ns jsonb;
 r jsonb;
 nr jsonb;
begin
 if p in ('owner','full') then return true; end if;
 if p not in ('add','edit') or p is null then return false; end if;

 if old_doc->>'id' is distinct from new_doc->>'id' then
  return false;
 end if;

 if p='add'
 and old_doc->>'name' is distinct from new_doc->>'name'
 then
  return false;
 end if;

 if p='edit'
 and jsonb_array_length(old_doc->'sections')
 <>jsonb_array_length(new_doc->'sections')
 then
  return false;
 end if;

 for s in select value from jsonb_array_elements(old_doc->'sections') loop
  select value into ns
  from jsonb_array_elements(new_doc->'sections')
  where value->>'id'=s->>'id';

  if ns is null then return false; end if;

  if p='add' and s->>'name' is distinct from ns->>'name' then
   return false;
  end if;

  if p='edit'
  and jsonb_array_length(s->'items')<>jsonb_array_length(ns->'items')
  then
   return false;
  end if;

  for r in select value from jsonb_array_elements(s->'items') loop
   select value into nr
   from jsonb_array_elements(ns->'items')
   where value->>'id'=r->>'id';

   if nr is null then return false; end if;

   if p='add' and (
    r->>'name' is distinct from nr->>'name'
    or r->'qty' is distinct from nr->'qty'
    or r->'unit' is distinct from nr->'unit'
   ) then
    return false;
   end if;
  end loop;
 end loop;

 return true;
end
$function$;

CREATE OR REPLACE FUNCTION legacy_dashboard.branch_permission(sid uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'legacy_dashboard', 'pg_temp'
AS $function$
declare p text;
begin
 if not exists(
  select 1 from admins
  where user_id=auth.uid() and active is not false
 ) then
  return null;
 end if;

 if legacy_dashboard.is_super() then return 'owner'; end if;

 if exists(
  select 1 from branch_studies
  where id=sid and owner_id=auth.uid()
 ) then
  return 'owner';
 end if;

 select permission into p
 from branch_study_members
 where study_id=sid and user_id=auth.uid();

 return p;
end
$function$;

CREATE OR REPLACE FUNCTION legacy_dashboard.branch_studies_list()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'legacy_dashboard', 'pg_temp'
AS $function$
 select coalesce(
  jsonb_agg(
   to_jsonb(b)||jsonb_build_object('permission',branch_permission(b.id))
   order by b.updated_at desc
  ),
  '[]'::jsonb
 )
 from branch_studies b
 where branch_permission(b.id) is not null
$function$;

CREATE OR REPLACE FUNCTION legacy_dashboard.branch_study_delete(sid uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'legacy_dashboard', 'pg_temp'
AS $function$
begin
 if branch_permission(sid) is distinct from 'owner' then
  raise exception 'permission denied';
 end if;

 delete from branch_studies where id=sid;
 return found;
end
$function$;

CREATE OR REPLACE FUNCTION legacy_dashboard.branch_study_save(sid uuid, doc jsonb, expected_version bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'legacy_dashboard', 'pg_temp'
AS $function$
declare
 b branch_studies;
 p text;
 clean jsonb;
 cost numeric;
 profile admins;
begin
 select * into profile
 from admins
 where user_id=auth.uid() and active is not false;

 if profile is null then raise exception 'permission denied'; end if;
 if not branch_study_valid(doc) then raise exception 'invalid study'; end if;

 clean=jsonb_build_object(
  'id',doc->>'id',
  'name',trim(doc->>'name'),
  'sections',doc->'sections'
 );

 select coalesce(sum((r->>'qty')::numeric*(r->>'unit')::numeric),0)
 into cost
 from jsonb_array_elements(clean->'sections') s
 cross join lateral jsonb_array_elements(s->'items') r;

 if sid is null then
  if not legacy_dashboard.is_super() and profile.role not in ('مدير','محاسب') then
   raise exception 'permission denied';
  end if;

  insert into branch_studies(owner_id,owner_name,study,total)
  values(
   auth.uid(),
   coalesce(profile.name,profile.email,''),
   clean,
   cost
  )
  returning * into b;
 else
  select * into b from branch_studies where id=sid for update;

  if not found then raise exception 'study unavailable'; end if;

  p=branch_permission(sid);

  if not branch_change_allowed(b.study,clean,p) then
   raise exception 'permission denied';
  end if;

  if expected_version is null or expected_version<>b.version then
   raise exception 'version conflict';
  end if;

  update branch_studies
  set study=clean,total=cost,version=version+1,updated_at=now()
  where id=sid
  returning * into b;
 end if;

 return to_jsonb(b)
 ||jsonb_build_object('permission',branch_permission(b.id));
end
$function$;

CREATE OR REPLACE FUNCTION legacy_dashboard.branch_study_share(sid uuid, uid uuid, p text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'legacy_dashboard', 'pg_temp'
AS $function$
begin
 if branch_permission(sid) is distinct from 'owner' then
  raise exception 'permission denied';
 end if;

 if not exists(
  select 1 from admins where user_id=uid and active is not false
 ) then
  raise exception 'user unavailable';
 end if;

 if p is null then
  delete from branch_study_members
  where study_id=sid and user_id=uid;
 else
  if p not in ('view','add','edit','full') then
   raise exception 'invalid permission';
  end if;

  insert into branch_study_members(study_id,user_id,permission)
  values(sid,uid,p)
  on conflict(study_id,user_id)
  do update set permission=excluded.permission;
 end if;

 return true;
end
$function$;

CREATE OR REPLACE FUNCTION legacy_dashboard.branch_study_users(sid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'legacy_dashboard', 'pg_temp'
AS $function$
begin
 if branch_permission(sid) is distinct from 'owner' then
  raise exception 'permission denied';
 end if;

 return (
  select coalesce(
   jsonb_agg(
    jsonb_build_object(
     'user_id',a.user_id,
     'name',a.name,
     'email',a.email,
     'permission',m.permission
    )
    order by a.name
   ),
   '[]'::jsonb
  )
  from admins a
  left join branch_study_members m
  on m.user_id=a.user_id and m.study_id=sid
  where a.active is not false
  and a.user_id is not null
  and a.user_id<>(select owner_id from branch_studies where id=sid)
 );
end
$function$;

CREATE OR REPLACE FUNCTION legacy_dashboard.branch_study_valid(doc jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'legacy_dashboard', 'pg_temp'
AS $function$
declare
 s jsonb;
 r jsonb;
 ids text[]='{}';
 rids text[];
begin
 if jsonb_typeof(doc) is distinct from 'object'
 or jsonb_typeof(doc->'id') is distinct from 'string'
 or coalesce(doc->>'id','')=''
 or jsonb_typeof(doc->'name') is distinct from 'string'
 or length(trim(doc->>'name'))=0
 or length(doc->>'name')>160
 or jsonb_typeof(doc->'sections') is distinct from 'array'
 then
  return false;
 end if;

 for s in select value from jsonb_array_elements(doc->'sections') loop
  if jsonb_typeof(s->'id') is distinct from 'string'
  or coalesce(s->>'id','')=''
  or s->>'id'=any(ids)
  or jsonb_typeof(s->'name') is distinct from 'string'
  or jsonb_typeof(s->'items') is distinct from 'array'
  then
   return false;
  end if;

  ids=array_append(ids,s->>'id');
  rids='{}';

  for r in select value from jsonb_array_elements(s->'items') loop
   if jsonb_typeof(r->'id') is distinct from 'string'
   or coalesce(r->>'id','')=''
   or r->>'id'=any(rids)
   or jsonb_typeof(r->'name') is distinct from 'string'
   or jsonb_typeof(r->'qty') is distinct from 'number'
   or jsonb_typeof(r->'unit') is distinct from 'number'
   then
    return false;
   end if;

   if (r->>'qty')::numeric<0 or (r->>'unit')::numeric<0 then
    return false;
   end if;

   rids=array_append(rids,r->>'id');
  end loop;
 end loop;

 return true;
exception when others then
 return false;
end
$function$;

CREATE OR REPLACE FUNCTION legacy_dashboard.can_access_amida()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'legacy_dashboard', 'pg_temp'
AS $function$
  select legacy_dashboard.is_super() or exists (
    select 1 from legacy_dashboard.admins a
    join legacy_dashboard.tab_access ta on ta.admin_id = a.id
    where a.user_id = auth.uid() and 'amida' = any(ta.tabs)
  );
$function$;

CREATE OR REPLACE FUNCTION legacy_dashboard.consume_ai_request(uid uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE used integer;
BEGIN
INSERT INTO legacy_dashboard.ai_request_limits(user_id,bucket) VALUES(uid,date_trunc('minute',now()))
ON CONFLICT(user_id,bucket) DO UPDATE SET count=ai_request_limits.count+1 RETURNING count INTO used;
DELETE FROM legacy_dashboard.ai_request_limits WHERE bucket<now()-interval '1 day';
RETURN used<=5;
END $function$;

CREATE OR REPLACE FUNCTION legacy_dashboard.dashboard_ai_server_key()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='legacy_dashboard_ai_api_key'
$function$;

CREATE OR REPLACE FUNCTION legacy_dashboard.get_ai_key()
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'legacy_dashboard'
AS $function$
declare k text; shared boolean; mine boolean; ok boolean;
begin
  select active, coalesce(ai_enabled, false)
    into ok, mine
    from legacy_dashboard.admins
   where user_id = auth.uid();

  if not coalesce(ok, false) then return null; end if;

  if not legacy_dashboard.is_super() then
    select coalesce(enable_for_admins, false) into shared
      from legacy_dashboard.app_settings where id = 1;
    if not (coalesce(mine, false) or coalesce(shared, false)) then
      return null;
    end if;
  end if;

  select decrypted_secret into k from vault.decrypted_secrets where name = 'legacy_dashboard_ai_api_key';
  return k;
end $function$;

CREATE OR REPLACE FUNCTION legacy_dashboard.guard_admin_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'legacy_dashboard'
AS $function$
begin
  if legacy_dashboard.is_super() then return new; end if;
  if new.role       is distinct from old.role
  or new.active     is distinct from old.active
  or new.ai_enabled is distinct from old.ai_enabled then
    raise exception 'غير مسموح بتغيير الدور أو الحالة أو صلاحية التحليل الذكي';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION legacy_dashboard.is_super()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'legacy_dashboard'
AS $function$
  select exists (
    select 1 from legacy_dashboard.admins
    where user_id = auth.uid()
      and active
      and role in ('سوبر أدمن', 'سوبر ادمن', 'مالك')
  );
$function$;

CREATE OR REPLACE FUNCTION legacy_dashboard.operations_delivery_claim(p_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF legacy_dashboard.operations_outbox
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'legacy_dashboard'
AS $function$
 update legacy_dashboard.operations_outbox set lease_until=now()+interval '2 minutes',lease_token=gen_random_uuid(),attempts=attempts+1
 where id in (select id from legacy_dashboard.operations_outbox where delivered_at is null and next_attempt_at<=now()
 and (lease_until is null or lease_until<now()) and (p_id is null or id=p_id) order by approved_at limit 10 for update skip locked) returning *;
$function$;

CREATE OR REPLACE FUNCTION legacy_dashboard.operations_delivery_finish(p_id uuid, p_lease uuid, p_ok boolean)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'legacy_dashboard'
AS $function$
 update legacy_dashboard.operations_outbox set delivered_at=case when p_ok then now() else null end,
 last_error=case when p_ok then null else 'تعذر التسليم؛ ستعاد المحاولة' end,
 next_attempt_at=now()+make_interval(secs=>least(3600,30*power(2,least(attempts,7)))::integer),lease_until=null,lease_token=null
 where id=p_id and lease_token=p_lease;
$function$;

CREATE OR REPLACE FUNCTION legacy_dashboard.operations_enqueue(p_report_id uuid, p_branch text, p_scope text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'legacy_dashboard'
AS $function$
declare r legacy_dashboard.reports%rowtype; s jsonb; core jsonb; fp text; result legacy_dashboard.operations_outbox%rowtype;
begin
 if not legacy_dashboard.is_super() and not exists(select 1 from legacy_dashboard.admins where user_id=auth.uid() and active and role='مدير') then raise exception 'اعتماد الإرسال متاح للإدارة فقط'; end if;
 if length(trim(p_branch)) not between 2 and 120 or length(trim(p_scope)) not between 2 and 120 then raise exception 'حدد الفرع ونطاق التقرير'; end if;
 select * into r from legacy_dashboard.reports where id=p_report_id;
 if not found or r.period_from is null or r.period_to is null or r.period_to<r.period_from or coalesce(r.payload->>'kind','') in ('branch-study','comparison') then raise exception 'اختر تحليل فترة محددة'; end if;
 -- No rows, filenames, patients, identities, diagnoses or contact details enter the bridge.
 select jsonb_build_object('schema_version',1,'branch',trim(p_branch),'scope',trim(p_scope),
  'period_from',r.period_from,'period_to',r.period_to,
  'coverage',(select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(coalesce(r.payload->'coverage','{}')) where jsonb_typeof(value)='boolean'),
  'coverage_notice',left(coalesce(r.payload->>'coverageNotice','تغطية البيانات غير مسجلة في هذا التقرير'),1000),
  'kpis',(select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(r.payload->'kpi') where jsonb_typeof(value)='number'),
  'risks',legacy_dashboard.operations_export_items(r.payload#>'{evaluation,risks}','risks'),
  'recommendations',legacy_dashboard.operations_export_items(r.payload#>'{evaluation,recos}','recommendations'),
  'plan',legacy_dashboard.operations_export_items(r.payload#>'{evaluation,plan}','plan')) into core;
 if jsonb_array_length(core->'risks')>200 or jsonb_array_length(core->'plan')>300 or length(core::text)>300000 then raise exception 'التقرير يتجاوز حد الإرسال'; end if;
 fp:=encode(extensions.digest(core::text,'sha256'),'hex');
 s:=core||jsonb_build_object('fingerprint',fp,'title',left(r.title,160));
 insert into legacy_dashboard.operations_outbox(fingerprint,report_id,snapshot,approved_by) values(fp,r.id,s,auth.uid()) on conflict(fingerprint) do nothing;
 select * into result from legacy_dashboard.operations_outbox where fingerprint=fp;
 return jsonb_build_object('id',result.id,'delivered',result.delivered_at is not null,'fingerprint',fp);
end $function$;

CREATE OR REPLACE FUNCTION legacy_dashboard.operations_export_items(p_items jsonb, p_kind text)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'legacy_dashboard'
AS $function$
 select coalesce(jsonb_agg(item),'[]') from (
 select coalesce(jsonb_object_agg(k,v),'{}') item from jsonb_array_elements(coalesce(p_items,'[]')) with ordinality a(value,ord)
 cross join lateral jsonb_each(a.value) b(k,v)
 where k=any(case p_kind when 'risks' then array['id','title','area','sev','finding','metric','value','target','impact']
 when 'recommendations' then array['riskId','title','area','steps'] else array['t','own','wk','kpi','tgt','pr','area','riskId','sev','why','risk','metric','value','target','impact','steps'] end)
 and (jsonb_typeof(v) in ('string','number','null') or (k='steps' and jsonb_typeof(v)='array' and not exists(select 1 from jsonb_array_elements(v) x where jsonb_typeof(x)<>'string')))
 group by ord order by ord) items;
$function$;

CREATE OR REPLACE FUNCTION legacy_dashboard.operations_server_secrets()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select pg_catalog.jsonb_build_object(
  'bridge',(select decrypted_secret from vault.decrypted_secrets where name='legacy_dashboard_operations_bridge_secret' limit 1),
  'cron',(select decrypted_secret from vault.decrypted_secrets where name='legacy_dashboard_operations_cron_secret' limit 1));
$function$;

CREATE OR REPLACE FUNCTION legacy_dashboard.protect_owner_admin()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'legacy_dashboard', 'pg_temp'
AS $function$
begin
  if old.email = 'mohamadmh32@gmail.com' and (new.role <> 'سوبر أدمن' or new.active = false) then
    raise exception 'هذا الحساب سوبر أدمن دائم — لا يمكن تغيير دوره أو إيقافه.';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION legacy_dashboard.protect_owner_admin_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'legacy_dashboard', 'pg_temp'
AS $function$
begin
  if old.email = 'mohamadmh32@gmail.com' then
    raise exception 'هذا الحساب سوبر أدمن دائم — لا يمكن حذفه.';
  end if;
  return old;
end;
$function$;

CREATE OR REPLACE FUNCTION legacy_dashboard.set_ai_key(new_key text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE k text := nullif(trim(new_key),''); sid uuid;
BEGIN
IF NOT legacy_dashboard.is_super() THEN RAISE EXCEPTION 'permission denied'; END IF;
SELECT id INTO sid FROM vault.secrets WHERE name='legacy_dashboard_ai_api_key';
IF k IS NULL THEN
 DELETE FROM vault.secrets WHERE name='legacy_dashboard_ai_api_key';
ELSIF sid IS NULL THEN
 PERFORM vault.create_secret(k,'legacy_dashboard_ai_api_key','AI key for isolated legacy dashboard');
ELSE
 PERFORM vault.update_secret(sid,k);
END IF;
UPDATE legacy_dashboard.app_settings SET has_key=(k IS NOT NULL), updated_at=now() WHERE id=1;
RETURN true;
END $function$;
