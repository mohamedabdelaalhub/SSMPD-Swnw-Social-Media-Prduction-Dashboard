-- Expand the connected pilot to authorized staff, without declaring full cutover,
-- stopping legacy writers, enabling messages, or copying real patients to training.
create or replace function clinic_reception.is_pilot_participant() returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select public.my_admin_id() is not null and exists(select 1 from public.admins where id=public.my_admin_id() and active)
 and (public.can_access_leads() or public.has_role('nursing') or public.has_role('sono_doctor') or clinic_finance.allowed('view')
 or exists(select 1 from clinic_reception.members m join clinic_reception.workspaces w on w.id=m.workspace_id where m.admin_id=public.my_admin_id() and w.mode='live' and cardinality(m.capabilities)>0));
$$;
create or replace function clinic_reception.access(p_workspace uuid,p_action text) returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$begin
 if (select pilot_only from clinic_reception.settings where id) then
  if not clinic_reception.is_pilot_participant() then raise exception 'اطلب صلاحية الاستقبال والخدمات من الإدارة' using errcode='42501';end if;
  if not exists(select 1 from clinic_reception.workspaces where id=p_workspace and mode='live') then raise exception 'استخدم مساحة الحجز المتصلة بملفات المرضى';end if;
 end if;
 if p_action='view' and (public.has_role('nursing') or public.has_role('sono_doctor')) and exists(select 1 from clinic_reception.workspaces where id=p_workspace and mode='live') and (select live_enabled from clinic_reception.settings where id) then return public.my_admin_id();end if;
 return clinic_reception.access_before_management_pilot(p_workspace,p_action);
end $$;
create or replace function public.clinic_reception_workspaces() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$begin
 if public.my_admin_id() is null then raise exception 'سجل الدخول' using errcode='42501';end if;
 if (select pilot_only from clinic_reception.settings where id) then
  if not clinic_reception.is_pilot_participant() then return '[]'::jsonb;end if;
  return(select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'name','الاستقبال والخدمات','mode',w.mode,'is_owner',w.owner_id=public.my_admin_id(),'employee_pilot',true)),'[]') from clinic_reception.workspaces w where w.mode='live' and (select live_enabled from clinic_reception.settings where id));
 end if;
 return clinic_reception.workspaces_before_management_pilot();
end $$;
create or replace function public.clinic_reception_bootstrap() returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$declare w uuid;begin
 if (select pilot_only from clinic_reception.settings where id) then
  if not clinic_reception.is_pilot_participant() then raise exception 'اطلب صلاحية الاستقبال والخدمات من الإدارة' using errcode='42501';end if;
  select id into w from clinic_reception.workspaces where mode='live' and (select live_enabled from clinic_reception.settings where id);
  if w is null then raise exception 'مساحة الحجز المتصلة غير متاحة؛ راجع الإدارة';end if;
  perform clinic_reception.access(w,'view');return w;
 end if;
 return clinic_reception.bootstrap_before_management_pilot();
end $$;

-- Resolve archive identity under the lead lock. Retrying reuses the same file.
-- Only missing basic details may be completed, never overwrite existing demographics.
create function public.clinic_reception_prepare_lead(p_lead uuid,p_details jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=public.my_admin_id();l public.leads%rowtype;p public.patients%rowtype;w uuid;n text;ph text;a integer;created boolean:=false;linked jsonb;matches integer;chosen uuid;
begin
 if me is null or not public.can_access_leads() then raise exception 'لا توجد صلاحية حجز من الليدز' using errcode='42501';end if;
 if jsonb_typeof(p_details) is distinct from 'object' or octet_length(p_details::text)>4000 then raise exception 'بيانات غير صالحة';end if;
 select * into l from public.leads where id=p_lead for update;
 if not found or not(public.has_role('super_admin') or public.has_role('general_manager') or public.has_role('reception') or public.has_role('customer_service') and l.assigned_to=me) then raise exception 'الليد خارج صلاحيتك' using errcode='42501';end if;
 select id into w from clinic_reception.workspaces where mode='live' and (select live_enabled from clinic_reception.settings where id);
 if w is null then raise exception 'مساحة الحجز المتصلة غير متاحة؛ راجع الإدارة';end if;
 perform clinic_reception.access(w,'book');
 chosen:=coalesce(l.patient_id,nullif(p_details->>'patient_id','')::uuid);
 if chosen is not null then
  select * into p from public.patients where id=chosen and status='active' for update;
  if not found then raise exception 'ملف المريض غير متاح؛ راجع الأرشيف';end if;
 end if;
 n:=case when trim(coalesce(p.full_name,'')) ~ '[[:alpha:]]+[[:space:]]+[[:alpha:]]+' then p.full_name else coalesce(nullif(trim(p_details->>'full_name'),''),nullif(trim(p.full_name),''),l.customer_name) end;
 ph:=case when psychcare.phone(p.phone) ~ '^[0-9]{8,15}$' then p.phone else coalesce(nullif(trim(p_details->>'phone'),''),nullif(trim(p.phone),''),l.phone_raw,l.phone_normalized) end;
 a:=coalesce(p.age,nullif(p_details->>'age','')::integer);
 if p.id is null then
  perform pg_advisory_xact_lock(hashtextextended(psychcare.phone(ph),781));
  select count(*) into matches from public.patients x where psychcare.phone(x.phone)=psychcare.phone(ph) and psychcare.name(x.full_name)=psychcare.name(n);
  if matches>1 then raise exception 'يوجد أكثر من ملف مطابق؛ اختر رقم الملف من البحث';end if;
  if matches=1 then
   select * into p from public.patients x where psychcare.phone(x.phone)=psychcare.phone(ph) and psychcare.name(x.full_name)=psychcare.name(n) for update;
   if p.status<>'active' then raise exception 'الملف المطابق غير نشط؛ راجع الأرشيف';end if;
   n:=p.full_name;ph:=p.phone;a:=coalesce(p.age,a);
  end if;
 end if;
 if p_details='{}'::jsonb then
  if p.id is null or a is null or trim(coalesce(n,'')) !~ '[[:alpha:]]+[[:space:]]+[[:alpha:]]+' or psychcare.phone(ph)!~'^[0-9]{8,15}$' then
   return jsonb_build_object('needs_details',true,'workspace',w,'full_name',n,'phone',ph,'age',a,'patient_id',p.id);
  end if;
 end if;
 perform psychcare.check_basics(n,ph,a);
 if p.id is null then
  insert into public.patients(full_name,phone,phone_normalized,age,created_by) values(n,ph,'+'||psychcare.phone(ph),a,me) returning * into p;created:=true;
 elsif (p.full_name,p.phone,p.age) is distinct from (n,ph,a) then
  update public.patients set full_name=n,phone=ph,phone_normalized='+'||psychcare.phone(ph),age=a where id=p.id returning * into p;
 end if;
 update public.leads set patient_id=p.id,patient_type=coalesce(patient_type,case when created then 'new' else 'existing' end) where id=l.id;
 linked:=public.clinic_reception_command(w,'patient_attach',jsonb_build_object('patient_id',p.id),gen_random_uuid());
 insert into clinic_reception.audit(workspace_id,actor_id,action,entity_id,detail) values(w,me,'lead_patient_prepared',p.id,jsonb_build_object('lead_id',l.id,'created',created));
 return jsonb_build_object('needs_details',false,'workspace',w,'patient_id',p.id,'reception_patient_id',linked->>'id','patient_code',p.patient_code,'created',created);
end $$;
revoke all on function clinic_reception.is_pilot_participant(),clinic_reception.access(uuid,text) from public,anon,authenticated;
revoke all on function public.clinic_reception_prepare_lead(uuid,jsonb),public.clinic_reception_bootstrap(),public.clinic_reception_workspaces() from public,anon,authenticated;
grant execute on function public.clinic_reception_prepare_lead(uuid,jsonb),public.clinic_reception_bootstrap(),public.clinic_reception_workspaces() to authenticated;
