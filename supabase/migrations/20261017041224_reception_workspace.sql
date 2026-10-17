begin;
create schema if not exists clinic_reception;
revoke all on schema clinic_reception from public,anon,authenticated;
create table clinic_reception.workspaces(id uuid primary key default gen_random_uuid(),name text not null,mode text not null default 'trial' check(mode in ('trial','live')),owner_id uuid not null references public.admins(id),created_at timestamptz not null default now(),unique(owner_id,mode));
create table clinic_reception.members(workspace_id uuid references clinic_reception.workspaces(id),admin_id uuid references public.admins(id),capabilities text[] not null,primary key(workspace_id,admin_id));
create table clinic_reception.settings(id boolean primary key default true check(id),live_enabled boolean not null default false,cutover_at timestamptz,check(not live_enabled or cutover_at is not null));
insert into clinic_reception.settings(id) values(true);
create table clinic_reception.patients(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references clinic_reception.workspaces(id),patient_id uuid references public.patients(id),file_no text not null,name text not null,phone text not null default '',birth_date date,gender text check(gender in ('male','female')),created_by uuid not null references public.admins(id),created_at timestamptz not null default now(),unique(workspace_id,file_no),unique(workspace_id,patient_id));
create index on clinic_reception.patients(workspace_id,phone);
create table clinic_reception.providers(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references clinic_reception.workspaces(id),name text not null,doctor_key text,department text not null,branch text not null,active boolean not null default true,unique(workspace_id,name));
create table clinic_reception.services(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references clinic_reception.workspaces(id),code text not null,name text not null,version integer not null default 1,department text not null,price numeric(14,2) not null check(price>=0 and price::text not in ('NaN','Infinity','-Infinity')),minutes integer not null check(minutes between 5 and 480),requires_device boolean not null default false,bom jsonb not null default '[]',active boolean not null default true,created_at timestamptz not null default now(),unique(workspace_id,code,version));
create unique index on clinic_reception.services(workspace_id,code) where active;
create table clinic_reception.availability(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references clinic_reception.workspaces(id),provider_id uuid not null references clinic_reception.providers(id),starts_at timestamptz not null,ends_at timestamptz not null,check(ends_at>starts_at),unique(provider_id,starts_at));
create table clinic_reception.appointments(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references clinic_reception.workspaces(id),patient_id uuid not null references clinic_reception.patients(id),provider_id uuid not null references clinic_reception.providers(id),service_id uuid not null references clinic_reception.services(id),starts_at timestamptz not null,ends_at timestamptz not null,status text not null default 'booked' check(status in ('booked','arrived','completed','cancelled','no_show')),source text not null default 'unknown',source_evidence text not null default 'unknown' check(source_evidence in ('unknown','patient','tracked')),attribution jsonb not null default '{}',created_by uuid not null references public.admins(id),created_at timestamptz not null default now(),arrived_at timestamptz,cancel_reason text,check(ends_at>starts_at));
create index on clinic_reception.appointments(workspace_id,provider_id,starts_at,ends_at) where status not in ('cancelled','no_show');
create index on clinic_reception.appointments(patient_id,starts_at);
create table clinic_reception.visits(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references clinic_reception.workspaces(id),appointment_id uuid not null unique references clinic_reception.appointments(id),patient_id uuid not null references clinic_reception.patients(id),visit_no bigint generated always as identity,status text not null default 'open' check(status in ('open','completed')),opened_by uuid not null references public.admins(id),opened_at timestamptz not null default now(),closed_at timestamptz);
create index on clinic_reception.visits(workspace_id,patient_id);
create table clinic_reception.orders(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references clinic_reception.workspaces(id),visit_id uuid not null references clinic_reception.visits(id),service_id uuid not null references clinic_reception.services(id),provider_id uuid not null references clinic_reception.providers(id),quantity numeric(14,3) not null default 1 check(quantity>0),price numeric(14,2) not null,discount numeric(5,2) not null default 0 check(discount between 0 and 100),snapshot jsonb not null,status text not null default 'ordered' check(status in ('ordered','completed','cancelled')),created_by uuid not null references public.admins(id),created_at timestamptz not null default now(),completed_at timestamptz);
create index on clinic_reception.orders(workspace_id,visit_id);
create table clinic_reception.audit(id bigint generated always as identity primary key,workspace_id uuid not null references clinic_reception.workspaces(id),actor_id uuid not null references public.admins(id),action text not null,entity_id uuid,created_at timestamptz not null default now(),detail jsonb not null default '{}');
create index on clinic_reception.audit(workspace_id,created_at);
create table clinic_reception.commands(workspace_id uuid not null references clinic_reception.workspaces(id),actor_id uuid not null references public.admins(id),token uuid not null,action text not null,payload jsonb not null,response jsonb not null,primary key(workspace_id,actor_id,token));
create or replace function clinic_reception.access(p_workspace uuid,p_action text) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=public.my_admin_id();w clinic_reception.workspaces%rowtype;
begin
 if me is null or not exists(select 1 from public.admins where id=me and active) then raise exception 'سجل الدخول' using errcode='42501';end if;
 select * into w from clinic_reception.workspaces where id=p_workspace;
 if not found or not(w.owner_id=me and (public.has_role('super_admin') or public.has_role('general_manager')) or exists(select 1 from clinic_reception.members where workspace_id=p_workspace and admin_id=me and (p_action=any(capabilities) or 'manage'=any(capabilities)))) then raise exception 'ليس لديك صلاحية هذه المساحة' using errcode='42501';end if;
 if w.mode='live' and not (select live_enabled from clinic_reception.settings where id) then raise exception 'التشغيل الفعلي لم يفعل؛ استخدم مساحة التجربة';end if;
 return me;
end $$;
create or replace function public.clinic_reception_bootstrap() returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=public.my_admin_id();w uuid;
begin
 if me is null or not exists(select 1 from public.admins where id=me and active) or not(public.has_role('super_admin') or public.has_role('general_manager')) then raise exception 'التجربة للإدارة فقط' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('reception-bootstrap-'||me::text,0));
 select id into w from clinic_reception.workspaces where owner_id=me and mode='trial';if found then return w;end if;
 insert into clinic_reception.workspaces(name,owner_id) values('تجربة الاستقبال والخدمات',me) returning id into w;
 insert into clinic_reception.patients(workspace_id,file_no,name,phone,created_by) values(w,'DEMO-001','مريض تجربة ١','',me),(w,'DEMO-002','مريض تجربة ٢','',me);
 insert into clinic_reception.providers(workspace_id,name,department,branch) values(w,'طبيب تجربة','عيادة تجربة','حدائق الأهرام');
 insert into clinic_reception.services(workspace_id,code,name,department,price,minutes) values(w,'CONSULT','كشف تجربة','عيادة تجربة',500,20),(w,'SESSION','جلسة تجربة','عيادة تجربة',300,30);
 insert into clinic_reception.audit(workspace_id,actor_id,action,entity_id) values(w,me,'workspace_created',w);
 return w;
end $$;
create or replace function public.clinic_reception_snapshot(p_workspace uuid,p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare me uuid:=clinic_reception.access(p_workspace,'view');v jsonb;
begin
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>92 then raise exception 'اختر فترة حتى ٩٣ يوما';end if;
 select jsonb_build_object('workspace',to_jsonb(w),'can_manage',w.owner_id=me or exists(select 1 from clinic_reception.members where workspace_id=w.id and admin_id=me and 'manage'=any(capabilities))) into v from clinic_reception.workspaces w where id=p_workspace;
 return v||jsonb_build_object('patients',(select coalesce(jsonb_agg(to_jsonb(x)-'patient_id'),'[]') from(select * from clinic_reception.patients where workspace_id=p_workspace order by created_at desc limit 200)x),
 'providers',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from clinic_reception.providers x where workspace_id=p_workspace and active),
 'services',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from clinic_reception.services x where workspace_id=p_workspace and active),
 'availability',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from clinic_reception.availability x where workspace_id=p_workspace and (starts_at at time zone 'Africa/Cairo')::date between p_from and p_to),
 'appointments',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from clinic_reception.appointments x where workspace_id=p_workspace and (starts_at at time zone 'Africa/Cairo')::date between p_from and p_to),
 'visits',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from clinic_reception.visits x where workspace_id=p_workspace and (opened_at at time zone 'Africa/Cairo')::date between p_from and p_to),
 'orders',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from clinic_reception.orders x where workspace_id=p_workspace and visit_id in(select id from clinic_reception.visits where workspace_id=p_workspace and (opened_at at time zone 'Africa/Cairo')::date between p_from and p_to)));
end $$;
create or replace function public.clinic_reception_command(p_workspace uuid,p_action text,p_payload jsonb,p_token uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid;w clinic_reception.workspaces%rowtype;previous clinic_reception.commands%rowtype;v uuid;a clinic_reception.appointments%rowtype;s clinic_reception.services%rowtype;pr clinic_reception.providers%rowtype;t timestamptz;e timestamptz;patient uuid;outcome jsonb;v_code text;ver integer;
begin
 me:=clinic_reception.access(p_workspace,case when p_action in ('provider','service','availability') then 'manage' else 'book' end);
 if p_token is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>60000 then raise exception 'طلب غير صالح';end if;
 select * into w from clinic_reception.workspaces where id=p_workspace for update;
 select * into previous from clinic_reception.commands where workspace_id=p_workspace and actor_id=me and token=p_token;
 if found then if previous.action<>p_action or previous.payload is distinct from p_payload then raise exception 'مفتاح إعادة المحاولة مرتبط بطلب آخر';end if;return previous.response;end if;
 if p_action='patient' then
  if w.mode<>'trial' then raise exception 'سجل ملف المريض من مسار الأرشيف المعتمد';end if;
  if length(trim(coalesce(p_payload->>'name','')))<2 or length(trim(coalesce(p_payload->>'file_no','')))<2 then raise exception 'أدخل الاسم ورقم الملف التجريبي';end if;
  insert into clinic_reception.patients(workspace_id,file_no,name,phone,birth_date,gender,created_by) values(p_workspace,trim(p_payload->>'file_no'),trim(p_payload->>'name'),trim(coalesce(p_payload->>'phone','')),nullif(p_payload->>'birth_date','')::date,nullif(p_payload->>'gender',''),me) returning id into v;
 elsif p_action='provider' then
  if length(trim(coalesce(p_payload->>'name','')))<2 or length(trim(coalesce(p_payload->>'department','')))<2 or length(trim(coalesce(p_payload->>'branch','')))<2 then raise exception 'أكمل الطبيب والقسم والفرع';end if;
  insert into clinic_reception.providers(workspace_id,name,department,branch,doctor_key) values(p_workspace,trim(p_payload->>'name'),trim(p_payload->>'department'),trim(p_payload->>'branch'),nullif(p_payload->>'doctor_key','')) returning id into v;
 elsif p_action='service' then
  v_code:=trim(p_payload->>'code');if length(coalesce(v_code,''))<2 or length(trim(coalesce(p_payload->>'name','')))<2 then raise exception 'أكمل كود واسم الخدمة';end if;
  select coalesce(max(version),0)+1 into ver from clinic_reception.services where workspace_id=p_workspace and services.code=v_code;
  update clinic_reception.services set active=false where workspace_id=p_workspace and services.code=v_code and active;
  insert into clinic_reception.services(workspace_id,code,name,version,department,price,minutes,requires_device,bom) values(p_workspace,v_code,trim(p_payload->>'name'),ver,trim(p_payload->>'department'),(p_payload->>'price')::numeric,(p_payload->>'minutes')::integer,coalesce((p_payload->>'requires_device')::boolean,false),coalesce(p_payload->'bom','[]')) returning id into v;
 elsif p_action='availability' then
  if not exists(select 1 from clinic_reception.providers where id=(p_payload->>'provider_id')::uuid and workspace_id=p_workspace and active) then raise exception 'الطبيب غير متاح';end if;
  t:=(p_payload->>'starts_at')::timestamptz;e:=(p_payload->>'ends_at')::timestamptz;if t is null or e is null or e<=t or e>t+interval '24 hours' then raise exception 'راجع فترة تواجد الطبيب';end if;
  insert into clinic_reception.availability(workspace_id,provider_id,starts_at,ends_at) values(p_workspace,(p_payload->>'provider_id')::uuid,t,e) returning id into v;
 elsif p_action in ('book','reschedule') then
  if p_action='reschedule' then select * into a from clinic_reception.appointments where id=(p_payload->>'id')::uuid and workspace_id=p_workspace for update;if not found or a.status<>'booked' then raise exception 'الحجز غير متاح لإعادة الجدولة';end if;end if;
  select * into s from clinic_reception.services where id=coalesce(nullif(p_payload->>'service_id','')::uuid,a.service_id) and workspace_id=p_workspace and active;
  if not found then raise exception 'الخدمة غير متاحة';end if;
  select * into pr from clinic_reception.providers where id=coalesce(nullif(p_payload->>'provider_id','')::uuid,a.provider_id) and workspace_id=p_workspace and active and department=s.department;
  if not found then raise exception 'الطبيب خارج تخصص الخدمة';end if;
  patient:=coalesce(nullif(p_payload->>'patient_id','')::uuid,a.patient_id);
  if not exists(select 1 from clinic_reception.patients where id=patient and workspace_id=p_workspace) then raise exception 'المريض خارج المساحة';end if;
  t:=(p_payload->>'starts_at')::timestamptz;e:=t+make_interval(mins=>s.minutes);
  if t is null or not exists(select 1 from clinic_reception.availability where workspace_id=p_workspace and provider_id=pr.id and starts_at<=t and ends_at>=e) then raise exception 'الموعد خارج فترة تواجد الطبيب';end if;
  if exists(select 1 from clinic_reception.appointments where workspace_id=p_workspace and provider_id=pr.id and status not in ('cancelled','no_show') and starts_at<e and ends_at>t and id is distinct from a.id) then raise exception 'الموعد يتداخل مع حجز قائم';end if;
  if p_action='book' then
   insert into clinic_reception.appointments(workspace_id,patient_id,provider_id,service_id,starts_at,ends_at,source,source_evidence,attribution,created_by) values(p_workspace,patient,pr.id,s.id,t,e,coalesce(nullif(p_payload->>'source',''),'unknown'),coalesce(nullif(p_payload->>'source_evidence',''),'unknown'),coalesce(p_payload->'attribution','{}'),me) returning id into v;
  else update clinic_reception.appointments set starts_at=t,ends_at=e,provider_id=pr.id,service_id=s.id where id=a.id;v:=a.id;end if;
 elsif p_action='arrive' then
  select * into a from clinic_reception.appointments where workspace_id=p_workspace and id=(p_payload->>'id')::uuid for update;
  if not found or a.status not in ('booked','arrived') then raise exception 'الحجز غير متاح لتسجيل الحضور';end if;
  select id into v from clinic_reception.visits where appointment_id=a.id;
  if v is null then
   insert into clinic_reception.visits(workspace_id,appointment_id,patient_id,opened_by) values(p_workspace,a.id,a.patient_id,me) returning id into v;
   select * into s from clinic_reception.services where id=a.service_id;
   insert into clinic_reception.orders(workspace_id,visit_id,service_id,provider_id,price,snapshot,created_by) values(p_workspace,v,s.id,a.provider_id,s.price,to_jsonb(s),me);
   update clinic_reception.appointments set status='arrived',arrived_at=now() where id=a.id;
  end if;
 elsif p_action in ('cancel','no_show') then
  if length(trim(coalesce(p_payload->>'reason','')))<3 then raise exception 'أدخل سبب الإلغاء أو عدم الحضور';end if;
  update clinic_reception.appointments set status=case when p_action='cancel' then 'cancelled' else 'no_show' end,cancel_reason=p_payload->>'reason' where workspace_id=p_workspace and id=(p_payload->>'id')::uuid and status='booked' returning id into v;
  if v is null then raise exception 'الحجز غير متاح';end if;
 else raise exception 'إجراء غير معروف';end if;
 outcome:=jsonb_build_object('id',v);
 insert into clinic_reception.audit(workspace_id,actor_id,action,entity_id) values(p_workspace,me,p_action,v);
 insert into clinic_reception.commands values(p_workspace,me,p_token,p_action,p_payload,outcome);
 return outcome;
end $$;
do $$declare r record;begin
 for r in select tablename from pg_tables where schemaname='clinic_reception' loop execute format('alter table clinic_reception.%I enable row level security',r.tablename);execute format('revoke all on clinic_reception.%I from public,anon,authenticated',r.tablename);end loop;
 for r in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='clinic_reception' loop execute format('revoke all on function %s from public,anon,authenticated',r.sig);end loop;
end $$;
revoke all on function public.clinic_reception_bootstrap(),public.clinic_reception_snapshot(uuid,date,date),public.clinic_reception_command(uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.clinic_reception_bootstrap(),public.clinic_reception_snapshot(uuid,date,date),public.clinic_reception_command(uuid,text,jsonb,uuid) to authenticated;
commit;
