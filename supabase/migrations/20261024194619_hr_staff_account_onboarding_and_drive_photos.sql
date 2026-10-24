-- Atomic personnel/account reservation. No Auth credentials or invitation links are stored here.
create table public.hr_account_jobs(
 id uuid primary key,person_id uuid not null unique references clinic_people.people(id),admin_id uuid not null unique references public.admins(id),
 created_by uuid not null references public.admins(id),email text not null,name text not null,role text not null,
 auth_user_id uuid,status text not null default 'pending' check(status in('pending','sending','sent','failed','delivery_unknown')),
 lease_until timestamptz,mail_id text,created_at timestamptz not null default now(),sent_at timestamptz
);
alter table public.hr_account_jobs enable row level security;
revoke all on public.hr_account_jobs from anon,authenticated;
grant all on public.hr_account_jobs to service_role;
create table public.staff_profile_photos(admin_id uuid primary key references public.admins(id),drive_file_id text not null check(drive_file_id ~ '^[A-Za-z0-9_-]{10,200}$'),mime_type text not null check(mime_type='image/jpeg'),updated_at timestamptz not null default now());
alter table public.staff_profile_photos enable row level security;
revoke all on public.staff_profile_photos from anon,authenticated;
grant all on public.staff_profile_photos to service_role;
create or replace function public.hr_save_employee(p_payload jsonb,p_mode text default 'existing',p_role text default null,p_request_id uuid default gen_random_uuid()) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=public.my_admin_id();aid uuid;pid uuid;em text:=lower(trim(p_payload->>'email'));j public.hr_account_jobs%rowtype;
begin
 if me is null or not clinic_people.manage() then raise exception 'تحتاج إدارة الموارد البشرية';end if;
 if p_mode not in('none','existing','new') then raise exception 'اختر طريقة ربط الحساب';end if;
 if p_mode='new' then
  select * into j from public.hr_account_jobs where id=p_request_id;
  if found then
   if j.created_by<>me or j.email<>em or j.role<>p_role or j.name<>trim(p_payload->>'full_name') then raise exception 'طلب مختلف بنفس المرجع';end if;
   return jsonb_build_object('person_id',j.person_id,'job_id',j.id,'status',j.status);
  end if;
  if em is null or length(em)>254 or em !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(trim(coalesce(p_payload->>'phone','')))<7 then raise exception 'أدخل بريدًا صحيحًا ورقم هاتف لإنشاء الحساب';end if;
  if p_role is null or p_role not in('page_manager','designer','approver','general_manager','super_admin','reception','customer_service','nursing','head_nursing','sono_doctor','psychology_specialist','contract_manager','accountant','financial_manager') then raise exception 'اختر الدور الوظيفي';end if;
  if p_role in('super_admin','general_manager','financial_manager') and not public.has_role('super_admin') then raise exception 'الأدوار الإدارية الحساسة يحددها السوبر أدمن';end if;
  perform pg_advisory_xact_lock(hashtextextended('hr-account:'||em,0));
  if exists(select 1 from public.admins where lower(trim(email))=em) then raise exception 'البريد له حساب بالفعل؛ اختر ربط حساب موجود';end if;
  if nullif(p_payload->>'id','') is not null and exists(select 1 from clinic_people.people where id=(p_payload->>'id')::uuid and admin_id is not null) then raise exception 'الملف مرتبط بحساب بالفعل';end if;
  insert into public.admins(name,email,role,active) values(trim(p_payload->>'full_name'),em,p_role,true) returning id into aid;
 elsif p_mode='existing' then
  aid:=nullif(p_payload->>'admin_id','')::uuid;
  if aid is null or not exists(select 1 from public.admins where id=aid and active) then raise exception 'اختر حسابًا فعالًا';end if;
 else aid:=null;end if;
 pid:=public.hr_command('person',p_payload||jsonb_build_object('admin_id',aid));
 if p_mode='new' then insert into public.hr_account_jobs(id,person_id,admin_id,created_by,email,name,role) values(p_request_id,pid,aid,me,em,trim(p_payload->>'full_name'),p_role);end if;
 return jsonb_build_object('person_id',pid,'job_id',case when p_mode='new' then p_request_id end,'status',case when p_mode='new' then 'pending' else 'linked' end);
end $$;
create or replace function public.hr_account_status(p_person_id uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
 if not clinic_people.visible(p_person_id) then raise exception 'الملف غير متاح';end if;
 return (select jsonb_build_object('job_id',id,'status',status,'sent_at',sent_at) from public.hr_account_jobs where person_id=p_person_id);
end $$;
-- The worker lease prevents concurrent sends. Unknown delivery is never resent automatically.
create or replace function public.hr_claim_account_job(p_id uuid,p_actor uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.hr_account_jobs%rowtype;
begin
 if not exists(select 1 from public.admins a where a.id=p_actor and a.active and (a.has_hr_access or a.role in('super_admin','general_manager') or exists(select 1 from public.admin_extra_roles r where r.admin_id=a.id and r.role in('super_admin','general_manager')))) then raise exception 'تحتاج إدارة الموارد البشرية';end if;
 select * into j from public.hr_account_jobs where id=p_id for update;
 if not found then raise exception 'الدعوة غير متاحة';end if;
 if j.status='sending' and j.lease_until<now() then update public.hr_account_jobs set status='delivery_unknown' where id=p_id;return jsonb_build_object('status','delivery_unknown');end if;
 if j.status in('sent','sending','delivery_unknown') then return jsonb_build_object('status',j.status);end if;
 if not exists(select 1 from clinic_people.people where id=j.person_id and admin_id=j.admin_id and lower(trim(email))=j.email) then raise exception 'ربط الموظف أو بريده تغير؛ راجع الملف';end if;
 if not exists(select 1 from public.admins where id=j.admin_id and active and role=j.role and lower(trim(email))=j.email and (user_id is null or user_id=j.auth_user_id)) then raise exception 'الحساب تغير؛ راجع المستخدمين';end if;
 update public.hr_account_jobs set status='sending',lease_until=now()+interval '3 minutes' where id=p_id;
 return to_jsonb(j)||jsonb_build_object('status','claimed');
end $$;
revoke all on function public.hr_save_employee(jsonb,text,text,uuid),public.hr_account_status(uuid),public.hr_claim_account_job(uuid,uuid) from public,anon;
grant execute on function public.hr_save_employee(jsonb,text,text,uuid),public.hr_account_status(uuid) to authenticated;
revoke all on function public.hr_claim_account_job(uuid,uuid) from authenticated;
grant execute on function public.hr_claim_account_job(uuid,uuid) to service_role;
create or replace function public.staff_photo_allowed(p_admin_id uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$select public.my_admin_id() is not null and (p_admin_id=public.my_admin_id() or clinic_people.manage())$$;
revoke all on function public.staff_photo_allowed(uuid) from public,anon;
grant execute on function public.staff_photo_allowed(uuid) to authenticated;
