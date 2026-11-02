create or replace function public.hr_save_employee(p_payload jsonb, p_mode text default 'existing'::text, p_role text default null::text, p_request_id uuid default gen_random_uuid())
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $function$
declare
  me uuid:=public.my_admin_id();
  aid uuid;
  pid uuid;
  em text:=lower(trim(p_payload->>'email'));
  j public.hr_account_jobs%rowtype;
  linked clinic_people.people%rowtype;
  work_payload jsonb:=p_payload;
  current_pid uuid:=nullif(p_payload->>'id','')::uuid;
  adopted boolean:=false;
begin
  if me is null or not clinic_people.manage() then raise exception 'تحتاج إدارة الموارد البشرية'; end if;
  if p_mode not in('none','existing','new') then raise exception 'اختر طريقة ربط الحساب'; end if;

  if p_mode='new' then
    select * into j from public.hr_account_jobs where id=p_request_id;
    if found then
      if j.created_by<>me or j.email<>em or j.role<>p_role or j.name<>trim(p_payload->>'full_name') then raise exception 'طلب مختلف بنفس المرجع'; end if;
      return jsonb_build_object('person_id',j.person_id,'job_id',j.id,'status',j.status);
    end if;
    if em is null or length(em)>254 or em !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(trim(coalesce(p_payload->>'phone','')))<7 then raise exception 'أدخل بريدًا صحيحًا ورقم هاتف لإنشاء الحساب'; end if;
    if p_role is null or p_role not in('page_manager','designer','approver','general_manager','super_admin','reception','customer_service','nursing','head_nursing','sono_doctor','psychology_specialist','contract_manager','accountant','financial_manager') then raise exception 'اختر الدور الوظيفي'; end if;
    if p_role in('super_admin','general_manager','financial_manager') and not public.has_role('super_admin') then raise exception 'الأدوار الإدارية الحساسة يحددها السوبر أدمن'; end if;
    perform pg_advisory_xact_lock(hashtextextended('hr-account:'||em,0));
    if exists(select 1 from public.admins where lower(trim(email))=em) then raise exception 'البريد له حساب بالفعل؛ اختر ربط حساب موجود'; end if;
    if current_pid is not null and exists(select 1 from clinic_people.people where id=current_pid and admin_id is not null) then raise exception 'الملف مرتبط بحساب بالفعل'; end if;
    insert into public.admins(name,email,role,active) values(trim(p_payload->>'full_name'),em,p_role,true) returning id into aid;

  elsif p_mode='existing' then
    aid:=nullif(p_payload->>'admin_id','')::uuid;
    if aid is null or not exists(select 1 from public.admins where id=aid and active) then raise exception 'اختر حسابًا فعالًا'; end if;

    select * into linked from clinic_people.people where admin_id=aid for update;
    if found and linked.id is distinct from current_pid then
      if current_pid is null and linked.status='needs_setup' and linked.kind='unclassified' then
        work_payload:=work_payload||jsonb_build_object('id',linked.id,'revision',linked.revision);
        adopted:=true;
      else
        raise exception 'الحساب مرتبط بالفعل بملف %', linked.full_name;
      end if;
    end if;
  else
    aid:=null;
  end if;

  pid:=public.hr_command('person',work_payload||jsonb_build_object('admin_id',aid));
  if p_mode='new' then
    insert into public.hr_account_jobs(id,person_id,admin_id,created_by,email,name,role) values(p_request_id,pid,aid,me,em,trim(p_payload->>'full_name'),p_role);
  end if;
  return jsonb_build_object(
    'person_id',pid,
    'job_id',case when p_mode='new' then p_request_id end,
    'status',case when p_mode='new' then 'pending' else 'linked' end,
    'adopted_preliminary',adopted
  );
end
$function$;
