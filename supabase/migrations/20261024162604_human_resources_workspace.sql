begin;
create schema clinic_people;
revoke all on schema clinic_people from public,anon,authenticated;
alter table public.admins add column has_hr_access boolean not null default false,add column has_price_lists_access boolean not null default false;
create function public.guard_people_price_grants() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$begin
 if not public.is_super() then
  if tg_op='INSERT' then
   if new.has_hr_access or new.has_price_lists_access then raise exception 'الصلاحيات للسوبر أدمن';end if;
  elsif new.has_hr_access is distinct from old.has_hr_access or new.has_price_lists_access is distinct from old.has_price_lists_access then raise exception 'الصلاحيات للسوبر أدمن';end if;
 end if;return new;end $$;
revoke all on function public.guard_people_price_grants() from public,anon,authenticated;
create trigger guard_people_price_grants before insert or update on public.admins for each row execute function public.guard_people_price_grants();
create sequence clinic_people.person_code;
create table clinic_people.people(
 id uuid primary key default gen_random_uuid(),code text not null unique default 'EMP-'||lpad(nextval('clinic_people.person_code')::text,6,'0'),
 admin_id uuid unique references public.admins(id),full_name text not null check(length(trim(full_name)) between 3 and 200),phone text not null default '',email text not null default '',
 kind text not null default 'employee' check(kind in ('employee','doctor','both')),doctor_key text unique,finance_subject text unique,
 department text not null default '',job_title text not null default '',branch text not null default '',manager_id uuid references clinic_people.people(id),
 start_date date,end_date date,birth_date date,emergency_name text not null default '',emergency_phone text not null default '',
 status text not null default 'active' check(status in ('active','on_leave','ended')),notes text not null default '',
 revision integer not null default 1,created_by uuid not null references public.admins(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(end_date is null or start_date is null or end_date>=start_date),check(manager_id is distinct from id));
create table clinic_people.documents(id uuid primary key default gen_random_uuid(),person_id uuid not null references clinic_people.people(id),title text not null,document_url text not null check(document_url ~ '^https://'),expires_on date,created_by uuid not null references public.admins(id),created_at timestamptz not null default now());
create table clinic_people.requests(id uuid primary key default gen_random_uuid(),person_id uuid not null references clinic_people.people(id),kind text not null check(kind in ('leave','permission','training','advance','overtime','leave_credit')),from_date date not null,to_date date not null,units numeric(10,2) not null check(units>0 and units<100000),note text not null check(length(trim(note))>=3),status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled')),created_by uuid not null references public.admins(id),reviewed_by uuid references public.admins(id),review_note text,created_at timestamptz not null default now(),check(to_date>=from_date));
create table clinic_people.attendance(id uuid primary key default gen_random_uuid(),person_id uuid not null references clinic_people.people(id),day date not null,scheduled_start timestamptz not null,scheduled_end timestamptz not null,actual_start timestamptz,actual_end timestamptz,note text not null default '',status text not null default 'pending' check(status in ('pending','approved','rejected')),created_by uuid not null references public.admins(id),reviewed_by uuid references public.admins(id),review_note text,unique(person_id,day),check(scheduled_end>scheduled_start),check(actual_end is null or actual_start is not null and actual_end>actual_start));
create table clinic_people.audit(id bigint generated always as identity primary key,actor_id uuid not null references public.admins(id),action text not null,record_id uuid not null,before_data jsonb,after_data jsonb,created_at timestamptz not null default now());
create index people_admin on clinic_people.people(admin_id);
create index people_requests_person on clinic_people.requests(person_id,from_date);
create index people_attendance_day on clinic_people.attendance(day,person_id);
alter table clinic_people.people enable row level security;
alter table clinic_people.documents enable row level security;
alter table clinic_people.requests enable row level security;
alter table clinic_people.attendance enable row level security;
alter table clinic_people.audit enable row level security;
create function clinic_people.manage() returns boolean language sql stable security definer set search_path=pg_catalog,public as $$select exists(select 1 from public.admins where id=public.my_admin_id() and active and (has_hr_access or public.has_role('super_admin') or public.has_role('general_manager')))$$;
create function clinic_people.visible(p_person uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$select public.my_admin_id() is not null and exists(select 1 from clinic_people.people where id=p_person and (clinic_people.manage() or admin_id=public.my_admin_id()))$$;
create function public.hr_workspace(p_month date default current_date) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare me uuid:=public.my_admin_id();m boolean:=clinic_people.manage();dt date:=date_trunc('month',p_month)::date;begin
 if me is null then raise exception 'سجل الدخول';end if;
 return jsonb_build_object('can_manage',m,'month',dt,
 'people',(select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('leave_balance',coalesce((select sum(case when r.kind='leave_credit' then r.units when r.kind='leave' then -r.units else 0 end) from clinic_people.requests r where r.person_id=p.id and r.status='approved' and r.from_date>=date_trunc('year',p_month)::date and r.from_date<(date_trunc('year',p_month)+interval '1 year')::date),0)) order by p.full_name),'[]') from clinic_people.people p where m or p.admin_id=me),
 'documents',(select coalesce(jsonb_agg(d order by d.expires_on nulls last),'[]') from clinic_people.documents d where clinic_people.visible(d.person_id)),
 'requests',(select coalesce(jsonb_agg(r order by r.created_at desc),'[]') from clinic_people.requests r where clinic_people.visible(r.person_id) and (r.status='pending' or r.from_date between dt and (dt+interval '1 month' - interval '1 day')::date)),
 'attendance',(select coalesce(jsonb_agg(a order by a.day desc),'[]') from clinic_people.attendance a where clinic_people.visible(a.person_id) and a.day between dt and (dt+interval '1 month' - interval '1 day')::date),
 'accounts',case when m then (select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',coalesce(nullif(name,''),email)) order by name),'[]') from public.admins) else '[]'::jsonb end,
 'doctor_keys',case when m then (select coalesce(jsonb_agg(x),'[]') from(select doctor_key,max(doctor_name) name from clinic_finance.doctor_contracts group by doctor_key)x) else '[]'::jsonb end,
 'employee_keys',case when m then(select coalesce(jsonb_agg(x),'[]') from(select distinct subject,payload->>'employee_name' name from clinic_finance.business_requests where kind='employment' and status='approved')x) else '[]'::jsonb end);
end $$;
create function public.hr_command(p_action text,p_payload jsonb) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=public.my_admin_id();m boolean:=clinic_people.manage();pid uuid:=nullif(p_payload->>'person_id','')::uuid;v uuid;oldp clinic_people.people%rowtype;r clinic_people.requests%rowtype;a clinic_people.attendance%rowtype;prior jsonb;afterj jsonb;balance numeric;begin
 if me is null then raise exception 'سجل الدخول';end if;
 if p_action='person' then
  if not m then raise exception 'لا تملك إدارة الموارد البشرية';end if;
  v:=nullif(p_payload->>'id','')::uuid;
  if v is not null then select * into oldp from clinic_people.people where id=v for update;if not found or oldp.revision<>coalesce((p_payload->>'revision')::int,0) then raise exception 'الملف تغير؛ أعد تحميله قبل الحفظ';end if;prior:=to_jsonb(oldp);end if;
  if length(trim(coalesce(p_payload->>'full_name','')))<3 or trim(p_payload->>'full_name') !~ '[[:space:]]' then raise exception 'اكتب الاسم الثنائي على الأقل';end if;
  if nullif(p_payload->>'doctor_key','') is not null and not exists(select 1 from clinic_finance.doctor_contracts where doctor_key=p_payload->>'doctor_key') then raise exception 'اختر كود الطبيب الموجود في الحسابات';end if;
  if nullif(p_payload->>'finance_subject','') is not null and not exists(select 1 from clinic_finance.business_requests where kind='employment' and status='approved' and subject=p_payload->>'finance_subject') then raise exception 'اختر معرف الموظف من عقد الحسابات المعتمد';end if;
  if nullif(p_payload->>'manager_id','') is not null then
   if exists(with recursive chain as(select id,manager_id from clinic_people.people where id=(p_payload->>'manager_id')::uuid union select p.id,p.manager_id from clinic_people.people p join chain c on p.id=c.manager_id) select 1 from chain where id=v) then raise exception 'التبعية الإدارية دائرية';end if;
  end if;
  if v is null then insert into clinic_people.people(full_name,created_by) values(trim(p_payload->>'full_name'),me) returning id into v;end if;
  update clinic_people.people set full_name=trim(p_payload->>'full_name'),admin_id=nullif(p_payload->>'admin_id','')::uuid,phone=coalesce(p_payload->>'phone',''),email=coalesce(p_payload->>'email',''),kind=coalesce(p_payload->>'kind','employee'),doctor_key=nullif(p_payload->>'doctor_key',''),finance_subject=nullif(p_payload->>'finance_subject',''),department=coalesce(p_payload->>'department',''),job_title=coalesce(p_payload->>'job_title',''),branch=coalesce(p_payload->>'branch',''),manager_id=nullif(p_payload->>'manager_id','')::uuid,start_date=nullif(p_payload->>'start_date','')::date,end_date=nullif(p_payload->>'end_date','')::date,birth_date=nullif(p_payload->>'birth_date','')::date,emergency_name=coalesce(p_payload->>'emergency_name',''),emergency_phone=coalesce(p_payload->>'emergency_phone',''),status=coalesce(p_payload->>'status','active'),notes=coalesce(p_payload->>'notes',''),revision=revision+1,updated_at=now() where id=v returning to_jsonb(clinic_people.people.*) into afterj;
 elsif p_action='document' then
  if not m then raise exception 'إضافة المستندات لإدارة الموارد البشرية';end if;
  insert into clinic_people.documents(person_id,title,document_url,expires_on,created_by) values(pid,p_payload->>'title',p_payload->>'document_url',nullif(p_payload->>'expires_on','')::date,me) returning id,to_jsonb(clinic_people.documents.*) into v,afterj;
 elsif p_action='request' then
  if not clinic_people.visible(pid) or not exists(select 1 from clinic_people.people where id=pid and status<>'ended') then raise exception 'ملف الموظف غير متاح';end if;
  if p_payload->>'kind'='leave_credit' and not m then raise exception 'إضافة رصيد الإجازات للموارد البشرية';end if;
  if p_payload->>'kind' in ('leave','leave_credit') and ((p_payload->>'units')::numeric>1+(p_payload->>'to_date')::date-(p_payload->>'from_date')::date or extract(year from (p_payload->>'from_date')::date)<>extract(year from (p_payload->>'to_date')::date)) then raise exception 'راجع عدد أيام الإجازة وسنة الرصيد';end if;
  insert into clinic_people.requests(person_id,kind,from_date,to_date,units,note,created_by) values(pid,p_payload->>'kind',(p_payload->>'from_date')::date,(p_payload->>'to_date')::date,(p_payload->>'units')::numeric,p_payload->>'note',me) returning id,to_jsonb(clinic_people.requests.*) into v,afterj;
 elsif p_action='request_review' then
  if not m then raise exception 'المراجعة للموارد البشرية';end if;
  select * into r from clinic_people.requests where id=(p_payload->>'id')::uuid for update;
  if not found or r.status<>'pending' or r.created_by=me or length(trim(coalesce(p_payload->>'review_note','')))<3 or p_payload->>'decision' not in ('approved','rejected') then raise exception 'الطلب يحتاج مراجعًا آخر وسبب القرار';end if;
  perform 1 from clinic_people.people where id=r.person_id for update;
  if p_payload->>'decision'='approved' and r.kind='leave' then
   select coalesce(sum(case when kind='leave_credit' then units when kind='leave' then -units else 0 end),0) into balance from clinic_people.requests where person_id=r.person_id and status='approved' and extract(year from from_date)=extract(year from r.from_date);
   if balance<r.units then raise exception 'رصيد الإجازات لا يكفي؛ راجع الرصيد المعتمد';end if;
   if exists(select 1 from clinic_people.requests where person_id=r.person_id and kind='leave' and status='approved' and daterange(from_date,to_date,'[]')&&daterange(r.from_date,r.to_date,'[]')) then raise exception 'توجد إجازة متداخلة';end if;
  end if;
  prior:=to_jsonb(r);update clinic_people.requests set status=p_payload->>'decision',reviewed_by=me,review_note=p_payload->>'review_note' where id=r.id returning id,to_jsonb(clinic_people.requests.*) into v,afterj;
 elsif p_action='attendance' then
  if not m then raise exception 'تسجيل الحضور للموارد البشرية';end if;
  insert into clinic_people.attendance(person_id,day,scheduled_start,scheduled_end,actual_start,actual_end,note,created_by) values(pid,(p_payload->>'day')::date,(p_payload->>'scheduled_start')::timestamptz,(p_payload->>'scheduled_end')::timestamptz,nullif(p_payload->>'actual_start','')::timestamptz,nullif(p_payload->>'actual_end','')::timestamptz,coalesce(p_payload->>'note',''),me) returning id,to_jsonb(clinic_people.attendance.*) into v,afterj;
 elsif p_action='attendance_review' then
  if not m then raise exception 'المراجعة للموارد البشرية';end if;
  select * into a from clinic_people.attendance where id=(p_payload->>'id')::uuid for update;
  if not found or a.status<>'pending' or a.created_by=me or length(trim(coalesce(p_payload->>'review_note','')))<3 or p_payload->>'decision' not in ('approved','rejected') then raise exception 'الحضور يحتاج مراجعًا آخر وسبب القرار';end if;
  prior:=to_jsonb(a);update clinic_people.attendance set status=p_payload->>'decision',reviewed_by=me,review_note=p_payload->>'review_note' where id=a.id returning id,to_jsonb(clinic_people.attendance.*) into v,afterj;
 else raise exception 'إجراء غير متاح';end if;
 insert into clinic_people.audit(actor_id,action,record_id,before_data,after_data) values(me,p_action,v,prior,afterj);return v;
end $$;
revoke all on all tables in schema clinic_people from public,anon,authenticated;
revoke all on all functions in schema clinic_people from public,anon,authenticated;
revoke all on function public.hr_workspace(date),public.hr_command(text,jsonb) from public,anon;
grant execute on function public.hr_workspace(date),public.hr_command(text,jsonb) to authenticated;
commit;
