-- Opt-in training uses existing trial workspaces and existing journey commands.
-- Live access and all live booking/financial behaviour remain delegated unchanged.
do $backup$ begin
 execute replace(pg_get_functiondef('clinic_reception.access(uuid,text)'::regprocedure),
 'FUNCTION clinic_reception.access(', 'FUNCTION clinic_reception.access_before_journey_sandbox(');
end $backup$;
revoke all on function clinic_reception.access_before_journey_sandbox(uuid,text) from public,anon,authenticated;

create function clinic_reception.sandbox_access(p_workspace uuid) returns uuid
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare me uuid:=public.my_admin_id();
begin
 if me is null or not exists(select 1 from public.admins where id=me and active)
 or not(public.has_role('super_admin') or public.has_role('general_manager'))
 or not exists(select 1 from clinic_reception.workspaces where id=p_workspace and mode='trial' and owner_id=me)
 then raise exception 'مساحة التجربة متاحة للإدارة المالكة لها فقط' using errcode='42501';end if;
 if exists(select 1 from clinic_reception.patients where workspace_id=p_workspace and patient_id is not null)
 then raise exception 'مساحة التجربة تحتوي ملفًا متصلًا؛ راجع الإدارة';end if;
 return me;
end $$;
revoke all on function clinic_reception.sandbox_access(uuid) from public,anon,authenticated;

create or replace function clinic_reception.access(p_workspace uuid,p_action text) returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if current_setting('clinic_reception.sandbox_workspace',true)=p_workspace::text then
  perform clinic_reception.sandbox_access(p_workspace);
  return clinic_reception.workspace_access(p_workspace,p_action);
 end if;
 return clinic_reception.access_before_journey_sandbox(p_workspace,p_action);
end $$;
revoke all on function clinic_reception.access(uuid,text) from public,anon,authenticated;

create function public.clinic_reception_sandbox_snapshot(p_workspace uuid,p_day date default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare previous text:=current_setting('clinic_reception.sandbox_workspace',true);result jsonb;d date:=coalesce(p_day,clinic_reception.today());
begin
 perform clinic_reception.sandbox_access(p_workspace);
 perform set_config('clinic_reception.sandbox_workspace',p_workspace::text,true);
 result:=jsonb_build_object('mode','trial','workspace',p_workspace,
 'catalog',clinic_reception.workspace_snapshot(p_workspace,d,d),
 'journey',public.clinic_reception_journey_snapshot(p_workspace,d));
 -- Preview bodies and simulation receipts only for this owner's trial space.
 result:=jsonb_set(result,'{journey,outbox}',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc)
 from(select o.id,o.appointment_id,o.kind,o.body,o.created_at,o.status,
 o.payload->>'sandbox_simulated_at' simulated_at from clinic_reception.outbox o
 join clinic_reception.appointments a on a.id=o.appointment_id
 where o.workspace_id=p_workspace and (a.starts_at at time zone 'Africa/Cairo')::date=d)x),'[]'::jsonb));
 perform set_config('clinic_reception.sandbox_workspace',coalesce(previous,''),true);
 return result;
exception when others then
 perform set_config('clinic_reception.sandbox_workspace',coalesce(previous,''),true);raise;
end $$;

create function public.clinic_reception_sandbox_open(p_day date default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare w uuid;pr record;d date:=coalesce(p_day,clinic_reception.today());previous text:=current_setting('clinic_reception.sandbox_workspace',true);result jsonb;
begin
 w:=clinic_reception.bootstrap_before_management_pilot();
 perform clinic_reception.sandbox_access(w);
 perform set_config('clinic_reception.sandbox_workspace',w::text,true);
 -- Zero-fee training fixtures only. No finance contract, approval, or payout.
 insert into clinic_reception.doctor_agreements(workspace_id,provider_id,service_code,rate,valid_from,valid_to,reference,status,created_by)
 select w,p.id,s.code,0,date '2000-01-01',date '2100-01-01','DEMO sandbox fixture only; not a real approved contract','active',public.my_admin_id()
 from clinic_reception.providers p join clinic_reception.services s on s.workspace_id=p.workspace_id and s.department=p.department
 where p.workspace_id=w and p.name='طبيب تجربة' and s.code in ('CONSULT','SESSION') and s.pricing_service_id is null and s.active
 and not exists(select 1 from clinic_reception.doctor_agreements a where a.workspace_id=w and a.provider_id=p.id and a.service_code=s.code and a.status='active');
 for pr in select id from clinic_reception.providers where workspace_id=w and active loop
  if not exists(select 1 from clinic_reception.availability where workspace_id=w and provider_id=pr.id and (starts_at at time zone 'Africa/Cairo')::date=d) then
   perform public.clinic_reception_command(w,'availability',jsonb_build_object('provider_id',pr.id,
   'starts_at',(d+time '08:00') at time zone 'Africa/Cairo','ends_at',(d+time '23:00') at time zone 'Africa/Cairo'),gen_random_uuid());
  end if;
 end loop;
 result:=public.clinic_reception_sandbox_snapshot(w,d);
 perform set_config('clinic_reception.sandbox_workspace',coalesce(previous,''),true);
 return result;
exception when others then
 perform set_config('clinic_reception.sandbox_workspace',coalesce(previous,''),true);raise;
end $$;

create function public.clinic_reception_sandbox_command(p_workspace uuid,p_action text,p_payload jsonb,p_token uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid;previous text:=current_setting('clinic_reception.sandbox_workspace',true);old clinic_reception.commands%rowtype;
 result jsonb;subtoken uuid:=gen_random_uuid();a uuid;field_name text;target_table text;target uuid;n integer;
begin
 me:=clinic_reception.sandbox_access(p_workspace);
 if p_token is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>10000 then raise exception 'طلب تجربة غير صالح';end if;
 if p_action not in ('book','reschedule','cancel','no_show','on_the_way','arrive','call','consultation_start','hold','resume',
 'visit_complete','request_service','doctor_status','priority','resolve_help','execute','order_cancel','help_requested','feedback','simulate_messages')
 then raise exception 'هذا الإجراء غير متاح في وضع التجربة';end if;
 perform 1 from clinic_reception.workspaces where id=p_workspace for update;
 select * into old from clinic_reception.commands where workspace_id=p_workspace and actor_id=me and token=p_token;
 if found then
  if old.action<>'sandbox/'||p_action or old.payload is distinct from p_payload then raise exception 'مفتاح إعادة المحاولة مرتبط بطلب آخر';end if;
  return old.response;
 end if;
 -- Validate every referenced entity before delegating to existing commands.
 foreach field_name in array array['appointment_id','patient_id','provider_id','service_id','id'] loop
  if nullif(p_payload->>field_name,'') is not null then
   target:=(p_payload->>field_name)::uuid;
   target_table:=case field_name when 'appointment_id' then 'appointments' when 'patient_id' then 'patients'
    when 'provider_id' then 'providers' when 'service_id' then 'services'
    else case when p_action in ('execute','order_cancel') then 'orders' when p_action='resolve_help' then 'help_requests' else 'appointments' end end;
   execute format('select count(*) from clinic_reception.%I where workspace_id=$1 and id=$2',target_table) into n using p_workspace,target;
   if n<>1 then raise exception 'البيانات خارج مساحة التجربة' using errcode='42501';end if;
  end if;
 end loop;
 perform set_config('clinic_reception.sandbox_workspace',p_workspace::text,true);
 if p_action in ('book','reschedule','execute','order_cancel') then
  result:=public.clinic_reception_command(p_workspace,p_action,p_payload,subtoken);
 elsif p_action in ('help_requested','feedback') then
  a:=(p_payload->>'appointment_id')::uuid;
  if a is null then raise exception 'اختر حجز التجربة';end if;
  if p_action='feedback' then
   if not exists(select 1 from clinic_reception.outbox where workspace_id=p_workspace and appointment_id=a and kind='feedback_request')
   then raise exception 'لا يوجد طلب تقييم لهذه الزيارة';end if;
   if exists(select 1 from clinic_reception.journey_events where workspace_id=p_workspace and appointment_id=a and event_type='feedback.completed')
   then raise exception 'تم تسجيل تقييم هذه الزيارة بالفعل';end if;
  end if;
  result:=public.clinic_reception_agent_event(a,case p_action when 'feedback' then 'feedback.completed' else 'patient.help_requested' end,
    p_payload||jsonb_build_object('sandbox',true),'sandbox:'||p_workspace::text||':'||p_token::text);
 elsif p_action='simulate_messages' then
  update clinic_reception.outbox set payload=payload||jsonb_build_object('sandbox_simulated_at',now())
  where workspace_id=p_workspace and status='approved' and not(payload?'sandbox_simulated_at');
  get diagnostics n=row_count;result:=jsonb_build_object('simulated',n,'sent',0);
 else
  result:=public.clinic_reception_journey_command(p_workspace,p_action,p_payload,subtoken);
 end if;
 insert into clinic_reception.commands(workspace_id,actor_id,token,action,payload,response)
 values(p_workspace,me,p_token,'sandbox/'||p_action,p_payload,result);
 perform set_config('clinic_reception.sandbox_workspace',coalesce(previous,''),true);
 return result;
exception when others then
 perform set_config('clinic_reception.sandbox_workspace',coalesce(previous,''),true);raise;
end $$;

revoke all on function public.clinic_reception_sandbox_open(date),public.clinic_reception_sandbox_snapshot(uuid,date),
 public.clinic_reception_sandbox_command(uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.clinic_reception_sandbox_open(date),public.clinic_reception_sandbox_snapshot(uuid,date),
 public.clinic_reception_sandbox_command(uuid,text,jsonb,uuid) to authenticated;
