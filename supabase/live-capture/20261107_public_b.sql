-- LIVE CAPTURE (2026-11-07): definitions read from production with pg_get_functiondef (read-only).
-- Reference snapshot of objects that had no CREATE under supabase/. NOT a migration: do not apply blindly.
-- Grants, owners and triggers are not included.
-- public part B: clinic_reception_so_* .. insurance_quote

CREATE OR REPLACE FUNCTION public.clinic_reception_so_attach(p_workspace uuid, p_order uuid, p_ext jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare me uuid:=clinic_reception.access(p_workspace,'book');
 o clinic_reception.orders%rowtype; kind text; mode text; bp text; cat text;
 ref text; perf text; prov clinic_reception.external_providers%rowtype; cur clinic_reception.order_ext%rowtype;
 net numeric; rate numeric:=0; commission numeric:=0; payable numeric:=0; receivable numeric:=0; cost numeric; share numeric; priced jsonb;
begin
 select * into o from clinic_reception.orders where id=p_order and workspace_id=p_workspace;
 if not found then raise exception 'الطلب غير موجود';end if;
 kind:=coalesce(p_ext->>'kind','service');mode:=coalesce(p_ext->>'mode','internal');bp:=coalesce(p_ext->>'billing_party','center');
 if kind not in ('service','radiology','lab','medicine','supply') then raise exception 'نوع الطلب غير صحيح';end if;
 if mode not in ('internal','external') then raise exception 'نوع التنفيذ غير صحيح';end if;
 if bp not in ('center','provider') then raise exception 'جهة المحاسبة غير صحيحة';end if;
 if mode='internal' and bp='provider' then raise exception 'محاسبة المزوّد تتطلب تنفيذًا خارجيًا';end if;
 if mode='external' and kind not in ('lab','radiology') then raise exception 'التنفيذ الخارجي للمعمل والأشعة فقط';end if;
 select * into cur from clinic_reception.order_ext where order_id=p_order;
 if found and cur.status<>'referred' then raise exception 'لا يمكن تعديل طلب بعد جدولته';end if;
 ref:=nullif(trim(p_ext->>'referring_doctor_key'),'');perf:=nullif(trim(p_ext->>'performing_doctor_key'),'');
 if exists(select 1 from clinic_reception.service_performers where service_id=o.service_id)
    and not exists(select 1 from clinic_reception.service_performers where service_id=o.service_id and doctor_key=perf) then
   raise exception 'الطبيب غير مصرح له بتنفيذ هذه الخدمة';end if;
 cat:=case kind when 'radiology' then 'radiology' when 'lab' then 'lab' else coalesce(nullif(p_ext->>'category',''),'consult') end;
 if cat not in ('consult','followup','consultation','radiology','lab','procedure') then raise exception 'تصنيف الخدمة غير صحيح';end if;
 if mode='external' then
   select * into prov from clinic_reception.external_providers where id=nullif(p_ext->>'provider_id','')::uuid and workspace_id=p_workspace and active;
   if not found or prov.kind<>kind then raise exception 'مزوّد الخدمة غير صحيح';end if;
 end if;
 net:=round(o.quantity*o.price*(1-o.discount/100.0),2);
 if kind in ('service','radiology','lab') and ref is not null then
   select percent into rate from clinic_reception.referral_rates where workspace_id=p_workspace and doctor_key=ref and category=cat
     and valid_from<=current_date and (valid_to is null or valid_to>=current_date) order by valid_from desc limit 1;
   commission:=round(net*coalesce(rate,0)/100,2);
 end if;
 if mode='external' and kind='lab' then
   if bp='provider' then raise exception 'محاسبة المعمل عبر المزوّد غير مدعومة';end if;
   select c.cost into cost from clinic_reception.provider_cost_list c where provider_id=prov.id and service_id=o.service_id
     and year=extract(year from current_date)::int;
   if cost is null then raise exception 'سعر تكلفة المعمل غير مسجل لهذا العام';end if;
   payable:=round(cost*o.quantity,2);
 elsif mode='external' and kind='radiology' then
   if bp='center' then
     if prov.terms->>'providerSharePercent' is null then raise exception 'نسبة المزوّد غير مسجلة';end if;
     share:=(prov.terms->>'providerSharePercent')::numeric;
     if share<0 or share>100 then raise exception 'نسبة المزوّد غير صحيحة';end if;
     payable:=round(net*share/100,2);
   else
     if prov.terms->>'centerSharePercent' is null then raise exception 'نسبة المركز غير مسجلة';end if;
     share:=(prov.terms->>'centerSharePercent')::numeric;
     if share<0 or share>100 then raise exception 'نسبة المركز غير صحيحة';end if;
     receivable:=round(net*share/100,2);
   end if;
 end if;
 priced:=jsonb_build_object('net',net,'category',cat,'referral_rate',coalesce(rate,0),'referral_commission',commission,
   'provider_payable',payable,'center_receivable',receivable);
 insert into clinic_reception.order_ext(order_id,kind,mode,billing_party,referring_doctor_key,performing_doctor_key,external_provider_id,priced)
 values(p_order,kind,mode,bp,ref,perf,prov.id,priced)
 on conflict(order_id) do update set kind=excluded.kind,mode=excluded.mode,billing_party=excluded.billing_party,
   referring_doctor_key=excluded.referring_doctor_key,performing_doctor_key=excluded.performing_doctor_key,
   external_provider_id=excluded.external_provider_id,priced=excluded.priced;
 return jsonb_build_object('order_id',p_order,'priced',priced);
end $function$;

CREATE OR REPLACE FUNCTION public.clinic_reception_so_attach_report(p_workspace uuid, p_order uuid, p_file_ref text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare me uuid:=clinic_reception.access(p_workspace,'execute');
begin
 if p_file_ref is null or length(p_file_ref)>300 or p_file_ref like '/%' or p_file_ref like '%..%' or p_file_ref ~ '[\x00-\x1f]' then
   raise exception 'مرجع الملف غير صحيح';end if;
 update clinic_reception.order_ext x set report_file_ref=p_file_ref,status='report_uploaded'
  where x.order_id=p_order and x.status='done'
    and exists(select 1 from clinic_reception.orders o where o.id=x.order_id and o.workspace_id=p_workspace);
 if not found then raise exception 'التقرير يُرفع بعد اكتمال التنفيذ فقط';end if;
 return jsonb_build_object('order_id',p_order,'status','report_uploaded');
end $function$;

CREATE OR REPLACE FUNCTION public.clinic_reception_so_can_read_staff(p_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare ws uuid;
begin
 if not public.clinic_reception_so_path_ok(p_name) then return false;end if;
 ws:=split_part(p_name,'/',1)::uuid;
 begin perform clinic_reception.access(ws,'view'); return true; exception when others then return false; end;
end $function$;

CREATE OR REPLACE FUNCTION public.clinic_reception_so_can_upload(p_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare ws uuid; ord uuid; ok boolean:=false;
begin
 if not public.clinic_reception_so_path_ok(p_name) then return false;end if;
 ws:=split_part(p_name,'/',1)::uuid; ord:=split_part(p_name,'/',2)::uuid;
 begin perform clinic_reception.access(ws,'execute'); ok:=true; exception when others then return false; end;
 return exists(select 1 from clinic_reception.orders o join clinic_reception.order_ext x on x.order_id=o.id
   where o.id=ord and o.workspace_id=ws and x.status='done');
end $function$;

CREATE OR REPLACE FUNCTION public.clinic_reception_so_catalog(p_workspace uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare me uuid:=clinic_reception.access(p_workspace,'view');
begin
 return jsonb_build_object(
  'service_specialties',coalesce((select jsonb_agg(jsonb_build_object('service_id',s.service_id,'specialty_id',s.specialty_id))
     from clinic_reception.service_specialties s join clinic_reception.services v on v.id=s.service_id where v.workspace_id=p_workspace),'[]'::jsonb),
  'performers',coalesce((select jsonb_agg(jsonb_build_object('service_id',p.service_id,'doctor_key',p.doctor_key,'specialty_id',p.specialty_id))
     from clinic_reception.service_performers p join clinic_reception.services v on v.id=p.service_id where v.workspace_id=p_workspace),'[]'::jsonb),
  'referral_rates',coalesce((select jsonb_agg(jsonb_build_object('doctor_key',r.doctor_key,'category',r.category,'percent',r.percent))
     from clinic_reception.referral_rates r where r.workspace_id=p_workspace and r.valid_from<=current_date and (r.valid_to is null or r.valid_to>=current_date)),'[]'::jsonb),
  'providers',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',e.name,'kind',e.kind,'phone',e.phone))
     from clinic_reception.external_providers e where e.workspace_id=p_workspace and e.active),'[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.clinic_reception_so_notify_prepare(p_workspace uuid, p_order uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare me uuid:=clinic_reception.access(p_workspace,'execute');
 rep clinic_reception.order_reports%rowtype; n clinic_reception.report_notifications%rowtype; target text;
begin
 select r.* into rep from clinic_reception.order_reports r join clinic_reception.orders o on o.id=r.order_id
   where r.order_id=p_order and o.workspace_id=p_workspace and r.patient_visible order by r.uploaded_at desc limit 1;
 if not found then raise exception 'لا يوجد تقرير لهذا الطلب';end if;
 insert into clinic_reception.report_notifications(order_id,report_id) values(p_order,rep.id) on conflict(report_id,channel) do nothing;
 select * into n from clinic_reception.report_notifications where report_id=rep.id and channel='email' for update;
 if n.status='sent' then return jsonb_build_object('status','already_sent','id',n.id);end if;
 if n.status='sending' and n.updated_at>now()-interval '5 minutes' then return jsonb_build_object('status','in_progress','id',n.id);end if;
 if n.attempts>=3 then return jsonb_build_object('status','failed_final','id',n.id);end if;
 select pa.login_email into target
   from clinic_reception.orders o join clinic_reception.visits v on v.id=o.visit_id
   join clinic_reception.patients p on p.id=v.patient_id
   join public.patient_account_access a on a.patient_id=p.patient_id
   join public.patient_accounts pa on pa.id=a.account_id
  where o.id=p_order and pa.status='active' and pa.email_verified and pa.login_email is not null
    and a.verification_status='approved' and a.revoked_at is null and (a.expires_at is null or a.expires_at>now())
  order by a.is_primary desc nulls last, a.created_at limit 1;
 if target is null then
   update clinic_reception.report_notifications set status='skipped',skipped_reason='no_verified_portal_email',updated_at=now() where id=n.id;
   return jsonb_build_object('status','skipped','reason','no_verified_portal_email','id',n.id);
 end if;
 update clinic_reception.report_notifications set status='sending',attempts=attempts+1,updated_at=now() where id=n.id;
 return jsonb_build_object('status','ready','id',n.id,'to',target);
end $function$;

CREATE OR REPLACE FUNCTION public.clinic_reception_so_notify_result(p_id uuid, p_ok boolean, p_error text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare ws uuid; me uuid; n clinic_reception.report_notifications%rowtype;
begin
 select * into n from clinic_reception.report_notifications where id=p_id;
 if not found then raise exception 'الإشعار غير موجود';end if;
 select o.workspace_id into ws from clinic_reception.orders o where o.id=n.order_id;
 me:=clinic_reception.access(ws,'execute');
 if n.status<>'sending' then raise exception 'حالة الإشعار لا تسمح بالتحديث';end if;
 if p_ok then
   update clinic_reception.report_notifications set status='sent',sent_at=now(),updated_at=now(),last_error=null where id=p_id;
   update clinic_reception.order_ext set status='patient_notified' where order_id=n.order_id and status='report_uploaded';
 else
   update clinic_reception.report_notifications set status='failed',last_error=left(coalesce(p_error,'خطأ غير معروف'),300),updated_at=now() where id=p_id;
 end if;
 insert into clinic_reception.audit(workspace_id,actor_id,action,entity_id,detail)
   values(ws,me,case when p_ok then 'so_notify_sent' else 'so_notify_failed' end,n.order_id,jsonb_build_object('notification',p_id,'channel','email'));
 return jsonb_build_object('id',p_id,'status',case when p_ok then 'sent' else 'failed' end);
end $function$;

CREATE OR REPLACE FUNCTION public.clinic_reception_so_orders_list(p_workspace uuid, p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare me uuid:=clinic_reception.access(p_workspace,'view');
begin
 return coalesce((select jsonb_agg(r) from (
   select jsonb_build_object('order_id',x.order_id,'provider',coalesce(e.name,'داخل المركز'),'mode',x.mode,'kind',x.kind,'status',x.status,'status_at',x.status_at,
     'service',o.snapshot->>'name','patient_name',p.name,'phone',p.phone) r
   from clinic_reception.order_ext x
   join clinic_reception.orders o on o.id=x.order_id and o.workspace_id=p_workspace
   left join clinic_reception.external_providers e on e.id=x.external_provider_id
   join clinic_reception.visits v on v.id=o.visit_id
   join clinic_reception.patients p on p.id=v.patient_id
   order by x.status_at desc limit greatest(1,least(coalesce(p_limit,200),500))) q),'[]'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION public.clinic_reception_so_path_ok(p_name text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
 select p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9._-]{1,120}$' and p_name not like '%..%' $function$;

CREATE OR REPLACE FUNCTION public.clinic_reception_so_patient_can_read(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 select exists(
  select 1 from clinic_reception.order_reports r
  join clinic_reception.orders o on o.id=r.order_id
  join clinic_reception.visits v on v.id=o.visit_id
  join clinic_reception.patients p on p.id=v.patient_id
  join public.patient_account_access a on a.patient_id=p.patient_id
  join public.patient_accounts pa on pa.id=a.account_id
  where r.storage_path=p_name and r.patient_visible and pa.auth_user_id=auth.uid() and pa.status='active'
    and a.verification_status='approved' and a.revoked_at is null and (a.expires_at is null or a.expires_at>now())) $function$;

CREATE OR REPLACE FUNCTION public.clinic_reception_so_provider_board(p_workspace uuid, p_provider uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare me uuid:=clinic_reception.access(p_workspace,'view');
begin
 return coalesce((select jsonb_agg(jsonb_build_object('order_id',x.order_id,'provider',e.name,'status',x.status,'status_at',x.status_at,
     'service',o.snapshot->>'name','patient_name',p.name,'phone',p.phone) order by x.status_at desc)
   from clinic_reception.order_ext x
   join clinic_reception.orders o on o.id=x.order_id and o.workspace_id=p_workspace
   join clinic_reception.external_providers e on e.id=x.external_provider_id
   join clinic_reception.visits v on v.id=o.visit_id
   join clinic_reception.patients p on p.id=v.patient_id
   where x.mode='external' and (p_provider is null or x.external_provider_id=p_provider)),'[]'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION public.clinic_reception_so_register_report(p_workspace uuid, p_order uuid, p_path text, p_name text, p_mime text, p_size bigint, p_checksum text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare me uuid:=clinic_reception.access(p_workspace,'execute'); rid uuid;
begin
 if not public.clinic_reception_so_path_ok(p_path) or split_part(p_path,'/',1)<>p_workspace::text or split_part(p_path,'/',2)<>p_order::text then
   raise exception 'مسار الملف غير صحيح';end if;
 if not exists(select 1 from storage.objects where bucket_id='service-reports' and name=p_path) then raise exception 'الملف غير مرفوع';end if;
 if not exists(select 1 from clinic_reception.order_ext x join clinic_reception.orders o on o.id=x.order_id
     where x.order_id=p_order and o.workspace_id=p_workspace and x.status='done') then raise exception 'التقرير يُرفع بعد اكتمال التنفيذ فقط';end if;
 insert into clinic_reception.order_reports(order_id,storage_path,file_name,mime_type,file_size,checksum,uploaded_by)
   values(p_order,p_path,left(trim(p_name),200),p_mime,p_size,p_checksum,me) returning id into rid;
 update clinic_reception.order_ext set report_file_ref=p_path,status='report_uploaded' where order_id=p_order;
 insert into clinic_reception.audit(workspace_id,actor_id,action,entity_id,detail)
   values(p_workspace,me,'so_report_registered',p_order,jsonb_build_object('path',p_path,'size',p_size,'mime',p_mime));
 return jsonb_build_object('report_id',rid,'order_id',p_order,'status','report_uploaded');
end $function$;

CREATE OR REPLACE FUNCTION public.clinic_reception_so_reports(p_workspace uuid, p_order uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare me uuid:=clinic_reception.access(p_workspace,'view');
begin
 return coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'path',r.storage_path,'file_name',r.file_name,'mime',r.mime_type,'size',r.file_size,'uploaded_at',r.uploaded_at) order by r.uploaded_at desc)
   from clinic_reception.order_reports r join clinic_reception.orders o on o.id=r.order_id
   where r.order_id=p_order and o.workspace_id=p_workspace),'[]'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION public.clinic_reception_so_set_status(p_workspace uuid, p_order uuid, p_to text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare me uuid:=clinic_reception.access(p_workspace,'execute');
begin
 if p_to='report_uploaded' then raise exception 'استخدم رفع التقرير';end if;
 update clinic_reception.order_ext x set status=p_to
  where x.order_id=p_order and exists(select 1 from clinic_reception.orders o where o.id=x.order_id and o.workspace_id=p_workspace);
 if not found then raise exception 'الطلب غير موجود';end if;
 return jsonb_build_object('order_id',p_order,'status',p_to);
end $function$;

CREATE OR REPLACE FUNCTION public.clinic_reception_so_setup_load(p_workspace uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare me uuid:=clinic_reception.access(p_workspace,'manage');
begin
 return jsonb_build_object(
  'services',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'code',s.code,'department',s.department) order by s.name)
     from clinic_reception.services s where s.workspace_id=p_workspace and s.active),'[]'::jsonb),
  'doctors',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,'doctor_key',d.doctor_key) order by d.name)
     from clinic_reception.providers d where d.workspace_id=p_workspace and d.doctor_key is not null and d.active),'[]'::jsonb),
  'service_specialties',coalesce((select jsonb_agg(jsonb_build_object('service_id',x.service_id,'specialty_id',x.specialty_id))
     from clinic_reception.service_specialties x join clinic_reception.services s on s.id=x.service_id where s.workspace_id=p_workspace),'[]'::jsonb),
  'performers',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'service_id',x.service_id,'doctor_key',x.doctor_key,'specialty_id',x.specialty_id))
     from clinic_reception.service_performers x join clinic_reception.services s on s.id=x.service_id where s.workspace_id=p_workspace),'[]'::jsonb),
  'referral_rates',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'doctor_key',r.doctor_key,'category',r.category,'percent',r.percent,'valid_from',r.valid_from,'valid_to',r.valid_to) order by r.doctor_key,r.category,r.valid_from desc)
     from clinic_reception.referral_rates r where r.workspace_id=p_workspace),'[]'::jsonb),
  'providers',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',e.name,'kind',e.kind,'phone',e.phone,'terms',e.terms,'active',e.active) order by e.name)
     from clinic_reception.external_providers e where e.workspace_id=p_workspace),'[]'::jsonb),
  'costs',coalesce((select jsonb_agg(jsonb_build_object('provider_id',c.provider_id,'service_id',c.service_id,'year',c.year,'cost',c.cost))
     from clinic_reception.provider_cost_list c join clinic_reception.external_providers e on e.id=c.provider_id where e.workspace_id=p_workspace),'[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.clinic_reception_so_setup_save(p_workspace uuid, p_kind text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare me uuid:=clinic_reception.access(p_workspace,'manage');
 op text:=coalesce(p_payload->>'op','set'); sid uuid; pid uuid; rid uuid; pct numeric; spec text; dk text; vf date; terms jsonb; k text; yr int; cst numeric;
begin
 if op not in ('set','add','remove') then raise exception 'عملية غير صحيحة';end if;
 if p_kind='service_specialty' then
   sid:=(p_payload->>'service_id')::uuid; spec:=nullif(trim(p_payload->>'specialty_id'),'');
   if not exists(select 1 from clinic_reception.services where id=sid and workspace_id=p_workspace) then raise exception 'الخدمة غير موجودة';end if;
   if spec is null or length(spec)>80 then raise exception 'التخصص مطلوب';end if;
   if op='remove' then delete from clinic_reception.service_specialties where service_id=sid and specialty_id=spec;
   else insert into clinic_reception.service_specialties(service_id,specialty_id) values(sid,spec) on conflict do nothing;end if;
   rid:=sid;
 elsif p_kind='performer' then
   sid:=(p_payload->>'service_id')::uuid; dk:=nullif(trim(p_payload->>'doctor_key'),''); spec:=nullif(trim(p_payload->>'specialty_id'),'');
   if not exists(select 1 from clinic_reception.services where id=sid and workspace_id=p_workspace) then raise exception 'الخدمة غير موجودة';end if;
   if (dk is null)=(spec is null) then raise exception 'اختر طبيبًا أو تخصصًا (واحد فقط)';end if;
   if dk is not null and not exists(select 1 from clinic_reception.providers where workspace_id=p_workspace and doctor_key=dk) then raise exception 'الطبيب غير موجود';end if;
   if op='remove' then delete from clinic_reception.service_performers where service_id=sid and doctor_key is not distinct from dk and specialty_id is not distinct from spec;
   elsif not exists(select 1 from clinic_reception.service_performers where service_id=sid and doctor_key is not distinct from dk and specialty_id is not distinct from spec) then
     insert into clinic_reception.service_performers(service_id,doctor_key,specialty_id) values(sid,dk,spec);end if;
   rid:=sid;
 elsif p_kind='referral_rate' then
   if op='remove' then
     delete from clinic_reception.referral_rates where id=(p_payload->>'id')::uuid and workspace_id=p_workspace;
     if not found then raise exception 'النسبة غير موجودة';end if;
     rid:=(p_payload->>'id')::uuid;
   else
     dk:=nullif(trim(p_payload->>'doctor_key'),''); k:=p_payload->>'category'; pct:=(p_payload->>'percent')::numeric;
     vf:=coalesce(nullif(p_payload->>'valid_from','')::date,current_date);
     if not exists(select 1 from clinic_reception.providers where workspace_id=p_workspace and doctor_key=dk) then raise exception 'الطبيب غير موجود';end if;
     if k not in ('consult','followup','consultation','radiology','lab','procedure') then raise exception 'تصنيف غير صحيح';end if;
     if pct is null or pct<0 or pct>100 then raise exception 'النسبة بين 0 و100';end if;
     update clinic_reception.referral_rates set valid_to=vf-1 where workspace_id=p_workspace and doctor_key=dk and category=k and valid_to is null and valid_from<vf;
     insert into clinic_reception.referral_rates(workspace_id,doctor_key,category,percent,valid_from) values(p_workspace,dk,k,pct,vf)
       on conflict(workspace_id,doctor_key,category,valid_from) do update set percent=excluded.percent,valid_to=null returning id into rid;
   end if;
 elsif p_kind='provider' then
   k:=p_payload->>'kind'; terms:=coalesce(p_payload->'terms','{}'::jsonb);
   if k not in ('lab','radiology') then raise exception 'نوع المزوّد غير صحيح';end if;
   if nullif(trim(p_payload->>'name'),'') is null then raise exception 'اسم المزوّد مطلوب';end if;
   if jsonb_typeof(terms)<>'object' then raise exception 'الشروط غير صحيحة';end if;
   for spec in select jsonb_object_keys(terms) loop
     if spec not in ('providerSharePercent','centerSharePercent') then raise exception 'شرط غير معروف';end if;
     pct:=(terms->>spec)::numeric; if pct<0 or pct>100 then raise exception 'النسبة بين 0 و100';end if;
   end loop;
   if p_payload->>'id' is null then
     insert into clinic_reception.external_providers(workspace_id,name,kind,phone,terms,active)
       values(p_workspace,trim(p_payload->>'name'),k,nullif(trim(p_payload->>'phone'),''),terms,coalesce((p_payload->>'active')::boolean,true)) returning id into rid;
   else
     update clinic_reception.external_providers set name=trim(p_payload->>'name'),kind=k,phone=nullif(trim(p_payload->>'phone'),''),terms=terms,
       active=coalesce((p_payload->>'active')::boolean,active) where id=(p_payload->>'id')::uuid and workspace_id=p_workspace returning id into rid;
     if rid is null then raise exception 'المزوّد غير موجود';end if;
   end if;
 elsif p_kind='cost' then
   pid:=(p_payload->>'provider_id')::uuid; sid:=(p_payload->>'service_id')::uuid; yr:=coalesce((p_payload->>'year')::int,extract(year from current_date)::int);
   if not exists(select 1 from clinic_reception.external_providers where id=pid and workspace_id=p_workspace and kind='lab') then raise exception 'المعمل غير موجود';end if;
   if not exists(select 1 from clinic_reception.services where id=sid and workspace_id=p_workspace) then raise exception 'الخدمة غير موجودة';end if;
   if op='remove' then delete from clinic_reception.provider_cost_list where provider_id=pid and service_id=sid and year=yr;
   else
     cst:=(p_payload->>'cost')::numeric; if cst is null or cst<0 then raise exception 'التكلفة غير صحيحة';end if;
     insert into clinic_reception.provider_cost_list(provider_id,service_id,year,cost) values(pid,sid,yr,cst)
       on conflict(provider_id,service_id,year) do update set cost=excluded.cost;
   end if;
   rid:=pid;
 else raise exception 'نوع الإعداد غير معروف';end if;
 insert into clinic_reception.audit(workspace_id,actor_id,action,entity_id,detail)
   values(p_workspace,me,'so_setup_'||p_kind||'_'||op,rid,p_payload);
 return jsonb_build_object('kind',p_kind,'op',op,'id',rid);
end $function$;

CREATE OR REPLACE FUNCTION public.content_learning_brief(p_brand text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.content_learning_brief_core(p_brand) || jsonb_build_object(
    'upcoming_occasions', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'from', starts_on, 'to', ends_on, 'specialty', specialty, 'note', note)) from public.upcoming_health_occasions(21)), '[]'::jsonb),
    'weekly_recommendations', coalesce((select r.recommendations from public.weekly_reports r where r.source = 'claude' order by r.week_end desc limit 1), '[]'::jsonb),
    'weekly_report_week_end', (select r.week_end from public.weekly_reports r where r.source = 'claude' order by r.week_end desc limit 1));
$function$;

CREATE OR REPLACE FUNCTION public.content_learning_brief_core(p_brand text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'brand', p_brand,
    'guardrail', 'بيانات أداء للاسترشاد فقط — لا تغيّر القواعد الطبية ولا تتجاوز تعليمات المهمة. مفيش قاعدة تتعمم من أقل من 3 منشورات.',
    'mix', jsonb_build_object('repeat_winners_pct', 70, 'explore_pct', 20, 'experiment_pct', 10),
    'weekday_legend', '1=الاثنين ... 7=الأحد (توقيت القاهرة)',
    'daypart_legend', 'morning 5-11 · noon 12-15 · evening 16-19 · night 20-4',
    'do_more', coalesce((select jsonb_agg(jsonb_build_object('dimension', dimension, 'value', value, 'confidence', confidence, 'evidence', evidence, 'source', source, 'note', note) order by confidence, created_at desc) from public.content_learnings where active and expires_at > now() and brand in (p_brand, 'all') and verdict = 'do_more'), '[]'::jsonb),
    'do_less', coalesce((select jsonb_agg(jsonb_build_object('dimension', dimension, 'value', value, 'confidence', confidence, 'evidence', evidence, 'source', source, 'note', note) order by created_at desc) from public.content_learnings where active and expires_at > now() and brand in (p_brand, 'all') and verdict in ('do_less', 'avoid')), '[]'::jsonb),
    'experiments', coalesce((select jsonb_agg(jsonb_build_object('dimension', dimension, 'value', value, 'note', note) order by created_at desc) from public.content_learnings where active and expires_at > now() and brand in (p_brand, 'all') and verdict = 'test'), '[]'::jsonb),
    'staff_weak_ratings_30d', coalesce((select jsonb_agg(jsonb_build_object('title', t.title, 'format', t.content_format, 'reason', t.reason)) from (select c.title, c.content_format, r.reason from public.content_ratings r join public.content_items c on c.id = r.content_id where r.rating = 'weak' and c.brand = p_brand and r.rated_at > now() - interval '30 days' order by r.rated_at desc limit 8) t), '[]'::jsonb),
    'staff_strong_ratings_30d', coalesce((select jsonb_agg(jsonb_build_object('title', t.title, 'format', t.content_format, 'reason', t.reason)) from (select c.title, c.content_format, r.reason from public.content_ratings r join public.content_items c on c.id = r.content_id where r.rating = 'strong' and c.brand = p_brand and r.rated_at > now() - interval '30 days' order by r.rated_at desc limit 8) t), '[]'::jsonb),
    'recent_titles_45d', coalesce((select jsonb_agg(title) from (select title from public.content_items where brand = p_brand and created_at > now() - interval '45 days' order by created_at desc limit 40) x), '[]'::jsonb)
  );
$function$;

CREATE OR REPLACE FUNCTION public.content_learning_brief_staff(p_brand text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.my_admin_id() is null then raise exception 'Authentication required'; end if;
  if p_brand not in ('sono','dr_dina') then return '{}'::jsonb; end if;
  return public.content_learning_brief(p_brand);
end $function$;

CREATE OR REPLACE FUNCTION public.content_performance(p_days integer DEFAULT 60)
 RETURNS TABLE(content_id uuid, brand text, title text, content_format text, cta_type text, specialty text, made_by_claude boolean, published_at timestamp with time zone, daypart text, weekday text, reach bigint, engagement bigint, rating text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.id, c.brand, c.title, c.content_format, c.cta_type, c.specialty,
         (c.created_by = 'a0fbdfee-d147-4282-b988-186a9ae3e88c'::uuid),
         p.published_at,
         case when x.h between 5 and 11 then 'morning' when x.h between 12 and 15 then 'noon' when x.h between 16 and 19 then 'evening' else 'night' end,
         extract(isodow from p.published_at at time zone 'Africa/Cairo')::int::text,
         (coalesce(p.fb_reach,0) + coalesce(p.ig_reach,0))::bigint,
         (coalesce(p.fb_reactions,0) + 3*coalesce(p.fb_comments,0) + 5*coalesce(p.fb_shares,0)
          + coalesce(p.ig_likes,0) + 3*coalesce(p.ig_comments,0) + 5*coalesce(p.ig_saves,0) + 5*coalesce(p.ig_shares,0))::bigint,
         r.rating
    from public.post_insights p
    join public.content_items c on c.id = p.content_id
    left join public.content_ratings r on r.content_id = c.id
    cross join lateral (select extract(hour from p.published_at at time zone 'Africa/Cairo')::int as h) x
   where p.published_at > now() - make_interval(days => p_days)
     and p.published_at < now() - interval '3 days'
     and (coalesce(p.fb_reach,0) + coalesce(p.ig_reach,0)) > 0;
$function$;

CREATE OR REPLACE FUNCTION public.hub_admin_list()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'hub'
AS $function$
begin
  if not public.is_super() then raise exception 'إدارة مركز الوصول السريع للسوبر أدمن فقط'; end if;
  return jsonb_build_object(
    'cards',  (select coalesce(jsonb_agg(jsonb_build_object('card_key',card_key,'sort',sort_order) order by sort_order),'[]') from hub.cards),
    'access', (select coalesce(jsonb_agg(jsonb_build_object('card_key',card_key,'subject_type',subject_type,'subject_value',subject_value,'enabled',enabled,'updated_at',updated_at)),'[]') from hub.card_access),
    'roles',  (select coalesce(jsonb_agg(distinct role),'[]') from public.admins where active),
    'users',  (select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'role',role) order by name),'[]') from public.admins where active),
    'audit',  (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]') from (select * from hub.audit order by created_at desc limit 50) x));
end $function$;

CREATE OR REPLACE FUNCTION public.hub_admin_set(p_card text, p_type text, p_value text, p_enabled boolean, p_remove boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'hub'
AS $function$
declare me uuid := public.my_admin_id(); v text := coalesce(p_value,''); old boolean;
begin
  if not public.is_super() then raise exception 'إدارة مركز الوصول السريع للسوبر أدمن فقط'; end if;
  if not exists(select 1 from hub.cards where card_key=p_card) then raise exception 'بطاقة غير معروفة'; end if;
  if p_type not in ('public','authenticated','role','user') then raise exception 'نوع غير صالح'; end if;
  if p_type in ('public','authenticated') then v := ''; end if;
  if p_type='role' and not exists(select 1 from public.admins where role=v) then raise exception 'دور غير موجود'; end if;
  if p_type='user' and not exists(select 1 from public.admins where id::text=v and active) then raise exception 'مستخدم غير موجود'; end if;
  select enabled into old from hub.card_access where card_key=p_card and subject_type=p_type and subject_value=v;
  if p_remove then
    delete from hub.card_access where card_key=p_card and subject_type=p_type and subject_value=v;
  else
    insert into hub.card_access(card_key,subject_type,subject_value,enabled,updated_by,updated_at)
    values(p_card,p_type,v,coalesce(p_enabled,true),me,now())
    on conflict (card_key,subject_type,subject_value) do update set enabled=excluded.enabled, updated_by=me, updated_at=now();
  end if;
  insert into hub.audit(actor,action,card_key,subject_type,subject_value,old_enabled,new_enabled)
  values(me, case when p_remove then 'remove' else 'set' end, p_card, p_type, v, old, case when p_remove then null else coalesce(p_enabled,true) end);
  return jsonb_build_object('ok',true);
end $function$;

CREATE OR REPLACE FUNCTION public.hub_my_cards()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'hub'
AS $function$
declare me uuid := public.my_admin_id(); r text;
begin
  if me is null then return public.hub_public_cards(); end if;
  select role into r from public.admins where id=me and active;
  if r is null then return public.hub_public_cards(); end if;
  if public.is_super() then return (select coalesce(jsonb_agg(card_key order by sort_order),'[]'::jsonb) from hub.cards); end if;
  return (select coalesce(jsonb_agg(c.card_key order by c.sort_order),'[]'::jsonb) from hub.cards c
    where exists (select 1 from hub.card_access a where a.card_key=c.card_key and a.enabled and (
          a.subject_type in ('public','authenticated')
       or (a.subject_type='role' and a.subject_value=r)
       or (a.subject_type='user' and a.subject_value=me::text))));
end $function$;

CREATE OR REPLACE FUNCTION public.hub_public_cards()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'hub'
AS $function$
  select coalesce(jsonb_agg(c.card_key order by c.sort_order), '[]'::jsonb)
  from hub.cards c
  where exists (select 1 from hub.card_access a where a.card_key=c.card_key and a.subject_type='public' and a.enabled)
$function$;

CREATE OR REPLACE FUNCTION public.insurance_bill_visit(p_visit uuid, p_service uuid, p_invoice_reference text, p_payment_method text, p_payment_reference text, p_shift uuid, p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
 me uuid:=clinic_finance.require_access('create');
 v public.patient_visits%rowtype;p public.patients%rowtype;s public.pricing_services%rowtype;
 q jsonb; invoice_id uuid; claim_result jsonb; payment_id uuid;
 contracted numeric; copay numeric; insurer_net numeric; file_ref text; visit_ref text;
begin
 perform clinic_finance.lock_day();
 select * into v from public.patient_visits where id=p_visit for update;
 if not found or v.contract_id is null or v.insurance_plan_id is null then raise exception 'الزيارة ليست زيارة تأمين مكتملة البيانات';end if;
 select * into p from public.patients where id=v.patient_id;
 if not found then raise exception 'المريض غير موجود';end if;
 select * into s from public.pricing_services where id=p_service and active;
 if not found then raise exception 'الخدمة غير متاحة';end if;
 if length(trim(coalesce(p_invoice_reference,'')))<2 then raise exception 'مرجع الفاتورة مطلوب';end if;
 q:=public.insurance_quote(p_service,v.contract_id,v.insurance_plan_id,v.visit_date);
 contracted:=(q->>'contracted_price')::numeric;copay:=(q->>'patient_copay')::numeric;insurer_net:=(q->>'insurer_net')::numeric;
 if contracted<=0 or round(copay+insurer_net,2)<>round(contracted,2) then raise exception 'تقسيم قيمة التأمين غير متزن';end if;
 file_ref:=coalesce(nullif(trim(p.medical_record_no),''),nullif(trim(p.patient_code),''),p.id::text);
 visit_ref:=coalesce(nullif(trim(v.visit_number),''),v.id::text);
 invoice_id:=public.clinic_finance_invoice(trim(p_invoice_reference),file_ref,s.name||' — '||(q->>'insurer')||' — '||(q->>'plan_name'),contracted,p_token);
 update clinic_finance.invoices set visit_ref=visit_ref,bill_payload=coalesce(bill_payload,'{}'::jsonb)||jsonb_build_object('insurance',q,'patient_id',p.id,'visit_id',v.id,'service_id',s.id) where id=invoice_id;
 if insurer_net>0 then
   claim_result:=public.clinic_finance_insurance_claim_v2(invoice_id,v.contract_id,v.insurance_plan_id,p_service,trim(p_invoice_reference),p_token);
 end if;
 if copay>0 then
   if coalesce(p_payment_method,'') not in ('cash','pos','bank','wallet','instapay') then raise exception 'اختر طريقة تحصيل تحمل المريض';end if;
   if length(trim(coalesce(p_payment_reference,'')))<2 then raise exception 'مرجع تحصيل تحمل المريض مطلوب';end if;
   payment_id:=public.clinic_finance_collect_linked(invoice_id,p_shift,p_payment_method,copay,trim(p_payment_reference),p_token,file_ref,visit_ref);
 end if;
 insert into clinic_finance.audit(actor,action,entity_id) values(me,'insurance_visit_billed',invoice_id);
 return q||jsonb_build_object('invoice_id',invoice_id,'claim_id',claim_result->>'claim_id','payment_id',payment_id,'patient_file',file_ref,'visit_ref',visit_ref,'balance_check',round(contracted-copay-insurer_net,2));
end $function$;

CREATE OR REPLACE FUNCTION public.insurance_billable_visits(p_term text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare me uuid:=clinic_finance.require_access('view'); q text:=lower(trim(coalesce(p_term,'')));begin
 return (select coalesce(jsonb_agg(x order by x.visit_date desc,x.created_at desc),'[]'::jsonb) from (
   select jsonb_build_object(
     'visit_id',v.id,'visit_number',v.visit_number,'visit_date',v.visit_date,'patient_id',p.id,
     'patient_name',p.full_name,'patient_code',p.patient_code,'medical_record_no',p.medical_record_no,
     'contract_id',v.contract_id,'plan_id',v.insurance_plan_id,'plan_name',ip.name,'plan_code',ip.code,
     'insurer',e.name,'service_ids',c.booking_service_ids,'created_at',v.created_at
   ) x,v.visit_date,v.created_at
   from public.patient_visits v
   join public.patients p on p.id=v.patient_id
   join public.contracting_entity_contracts c on c.id=v.contract_id
   join public.contracting_entities e on e.id=c.entity_id
   join public.insurance_plans ip on ip.id=v.insurance_plan_id and ip.contract_id=v.contract_id
   where v.contract_id is not null and v.insurance_plan_id is not null
     and (q='' or lower(coalesce(p.full_name,'')) like '%'||q||'%' or lower(coalesce(p.patient_code,'')) like '%'||q||'%' or lower(coalesce(p.medical_record_no,'')) like '%'||q||'%' or lower(coalesce(v.visit_number,'')) like '%'||q||'%')
   order by v.visit_date desc,v.created_at desc limit 50
 ) s);
end $function$;

CREATE OR REPLACE FUNCTION public.insurance_claims_workspace(p_contract uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
 perform clinic_finance.require_access('view');
 return jsonb_build_object('claims',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'invoice_id',c.invoice_id,'reference',c.reference,'insurer',c.insurer,'amount',c.amount,'collected_amount',c.collected_amount,'remaining',c.amount-c.collected_amount,'status',c.status,'contract_id',c.contract_id,'insurance_plan_id',c.insurance_plan_id,'plan_name',p.name,'service_id',c.service_id,'service_name',s.name,'center_price',c.center_price,'contracted_price',c.contracted_price,'contractual_discount',c.contractual_discount,'patient_copay',c.patient_copay,'account_code',coalesce(c.receivable_account_code,'1121'),'created_at',c.created_at) order by c.created_at desc),'[]'::jsonb) from clinic_finance.insurance_claims c left join public.insurance_plans p on p.id=c.insurance_plan_id left join public.pricing_services s on s.id=c.service_id where c.status<>'cancelled' and (p_contract is null or c.contract_id=p_contract)));
end $function$;

CREATE OR REPLACE FUNCTION public.insurance_command(p_action text, p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare me uuid:=public.my_admin_id(); v uuid; c public.contracting_entity_contracts%rowtype; p public.insurance_plans%rowtype; account_code text;begin
 if me is null or (not public.can_manage_contracting_entities() and not clinic_prices.manage()) then raise exception 'لا تملك إدارة إعدادات التأمين';end if;
 if p_action='entity_account' then
  select * into c from public.contracting_entity_contracts where id=(p_payload->>'contract_id')::uuid;
  if not found then raise exception 'العقد غير موجود';end if;
  account_code:=coalesce(nullif(trim(p_payload->>'account_code'),''),'1121');
  if not exists(select 1 from clinic_finance.accounts a join clinic_finance.account_config ac on ac.code=a.code where a.code=account_code and a.kind='asset' and ac.active and not ac.archived and ac.is_postable) then raise exception 'حساب الذمم غير صالح';end if;
  update public.contracting_entities set receivable_account_code=account_code where id=c.entity_id returning id into v;
 elsif p_action='plan_save' then
  select * into c from public.contracting_entity_contracts where id=(p_payload->>'contract_id')::uuid;
  if not found or not exists(select 1 from public.contracting_entities e where e.id=c.entity_id and (e.category='insurance' or c.booking_billing_kind='insurer')) then raise exception 'اختر عقد تأمين صالح';end if;
  if coalesce(trim(p_payload->>'name'),'')='' or coalesce(trim(p_payload->>'code'),'')='' then raise exception 'اسم وكود فئة الكارنيه مطلوبان';end if;
  if coalesce(p_payload->>'copay_type','') not in ('none','percentage','fixed') then raise exception 'نوع التحمل غير صالح';end if;
  if coalesce((p_payload->>'copay_value')::numeric,0)<0 or (p_payload->>'copay_type')='percentage' and (p_payload->>'copay_value')::numeric>100 then raise exception 'قيمة التحمل غير صالحة';end if;
  if nullif(p_payload->>'price_list_id','') is not null and not exists(select 1 from clinic_prices.lists l where l.id=(p_payload->>'price_list_id')::uuid and l.contract_id=c.id and l.status='active') then raise exception 'لائحة الأسعار لا تخص هذا العقد أو غير معتمدة';end if;
  v:=nullif(p_payload->>'id','')::uuid;
  if v is null then
   insert into public.insurance_plans(contract_id,name,code,price_list_id,copay_type,copay_value,valid_from,valid_to,active,notes,created_by)
   values(c.id,trim(p_payload->>'name'),trim(p_payload->>'code'),nullif(p_payload->>'price_list_id','')::uuid,p_payload->>'copay_type',case when p_payload->>'copay_type'='none' then 0 else (p_payload->>'copay_value')::numeric end,coalesce((p_payload->>'valid_from')::date,current_date),nullif(p_payload->>'valid_to','')::date,coalesce((p_payload->>'active')::boolean,true),coalesce(p_payload->>'notes',''),me) returning id into v;
  else
   update public.insurance_plans set name=trim(p_payload->>'name'),code=trim(p_payload->>'code'),price_list_id=nullif(p_payload->>'price_list_id','')::uuid,copay_type=p_payload->>'copay_type',copay_value=case when p_payload->>'copay_type'='none' then 0 else (p_payload->>'copay_value')::numeric end,valid_from=coalesce((p_payload->>'valid_from')::date,valid_from),valid_to=nullif(p_payload->>'valid_to','')::date,active=coalesce((p_payload->>'active')::boolean,active),notes=coalesce(p_payload->>'notes',''),updated_at=now() where id=v and contract_id=c.id;
   if not found then raise exception 'فئة الكارنيه غير موجودة';end if;
  end if;
 elsif p_action='plan_toggle' then
  v:=(p_payload->>'id')::uuid;update public.insurance_plans set active=coalesce((p_payload->>'active')::boolean,false),updated_at=now() where id=v;if not found then raise exception 'الفئة غير موجودة';end if;
 elsif p_action='rule_save' then
  select * into p from public.insurance_plans where id=(p_payload->>'plan_id')::uuid;
  if not found then raise exception 'فئة الكارنيه غير موجودة';end if;
  if coalesce(p_payload->>'copay_type','') not in ('inherit','none','percentage','fixed') then raise exception 'نوع التحمل غير صالح';end if;
  if coalesce((p_payload->>'copay_value')::numeric,0)<0 or p_payload->>'copay_type'='percentage' and (p_payload->>'copay_value')::numeric>100 then raise exception 'قيمة التحمل غير صالحة';end if;
  insert into public.insurance_plan_service_rules(plan_id,service_id,copay_type,copay_value,notes,created_by)
  values(p.id,(p_payload->>'service_id')::uuid,p_payload->>'copay_type',case when p_payload->>'copay_type' in ('inherit','none') then 0 else (p_payload->>'copay_value')::numeric end,coalesce(p_payload->>'notes',''),me)
  on conflict(plan_id,service_id) do update set copay_type=excluded.copay_type,copay_value=excluded.copay_value,notes=excluded.notes,updated_at=now()
  returning id into v;
 elsif p_action='rule_delete' then
  v:=(p_payload->>'id')::uuid;delete from public.insurance_plan_service_rules where id=v;
 else raise exception 'إجراء غير متاح';end if;
 return v;
end $function$;

CREATE OR REPLACE FUNCTION public.insurance_contract_options(p_contract uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare me uuid:=public.my_admin_id();begin
 if me is null then raise exception 'غير مصرح';end if;
 if not exists(select 1 from public.contracting_entity_contracts c join public.contracting_entities e on e.id=c.entity_id where c.id=p_contract and c.status='active' and (e.category='insurance' or c.booking_billing_kind='insurer')) then
  return jsonb_build_object('is_insurance',false,'plans','[]'::jsonb);
 end if;
 return jsonb_build_object('is_insurance',true,'plans',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'code',p.code,'copay_type',p.copay_type,'copay_value',p.copay_value,'valid_from',p.valid_from,'valid_to',p.valid_to) order by p.name),'[]'::jsonb) from public.insurance_plans p where p.contract_id=p_contract and p.active and current_date between p.valid_from and coalesce(p.valid_to,'9999-12-31'::date)));
end $function$;

CREATE OR REPLACE FUNCTION public.insurance_open_shifts()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare me uuid:=clinic_finance.require_access('view');begin
 return (select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',r.name,'opened_at',s.opened_at,'is_main',s.is_main) order by s.opened_at desc),'[]'::jsonb) from clinic_finance.shifts s join clinic_finance.registers r on r.id=s.register_id where s.status='open' and (s.cashier_id=me or clinic_finance.allowed('review')));
end $function$;

CREATE OR REPLACE FUNCTION public.insurance_patient_context(p_patient uuid, p_contract uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare me uuid:=public.my_admin_id();begin
 if me is null then raise exception 'غير مصرح';end if;
 return jsonb_build_object(
  'link',(select to_jsonb(l) from public.contract_patient_links l where l.patient_id=p_patient and l.contract_id=p_contract and l.linked_from<=current_date and (l.linked_until is null or l.linked_until>=current_date) order by l.linked_from desc limit 1),
  'plans',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'code',p.code,'copay_type',p.copay_type,'copay_value',p.copay_value) order by p.name),'[]'::jsonb) from public.insurance_plans p where p.contract_id=p_contract and p.active and current_date between p.valid_from and coalesce(p.valid_to,'9999-12-31'::date))
 );
end $function$;

CREATE OR REPLACE FUNCTION public.insurance_patient_link_set(p_patient uuid, p_contract uuid, p_plan uuid, p_member_reference text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare me uuid:=public.my_admin_id(); v uuid; a public.admins%rowtype;begin
 select * into a from public.admins where id=me and active;
 if me is null or not found or not (coalesce(a.has_archive_access,false) or a.role in ('super_admin','general_manager') or public.can_manage_contracting_entities()) then raise exception 'لا تملك تعديل بيانات التأمين للمريض';end if;
 if not exists(select 1 from public.insurance_plans p where p.id=p_plan and p.contract_id=p_contract and p.active and current_date between p.valid_from and coalesce(p.valid_to,'9999-12-31'::date)) then raise exception 'فئة الكارنيه لا تخص العقد أو غير سارية';end if;
 select id into v from public.contract_patient_links where patient_id=p_patient and contract_id=p_contract and linked_from<=current_date and (linked_until is null or linked_until>=current_date) order by linked_from desc limit 1 for update;
 if v is null then
  insert into public.contract_patient_links(contract_id,patient_id,member_reference,insurance_plan_id,linked_from,linked_by) values(p_contract,p_patient,nullif(trim(p_member_reference),''),p_plan,current_date,me) returning id into v;
 else
  update public.contract_patient_links set insurance_plan_id=p_plan,member_reference=nullif(trim(p_member_reference),'') where id=v;
 end if;
 return v;
end $function$;

CREATE OR REPLACE FUNCTION public.insurance_quote(p_service uuid, p_contract uuid, p_plan uuid, p_date date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare me uuid:=public.my_admin_id(); s public.pricing_services%rowtype; sp public.pricing_supplies%rowtype; line jsonb; c public.contracting_entity_contracts%rowtype; e public.contracting_entities%rowtype; pl public.insurance_plans%rowtype; r public.insurance_plan_service_rules%rowtype; base numeric; center jsonb; quote jsonb; contracted numeric; center_price numeric; cp_type text; cp_value numeric; copay numeric; insurer_net numeric; contractual_discount numeric;begin
 if me is null then raise exception 'غير مصرح';end if;
 select * into c from public.contracting_entity_contracts where id=p_contract and status='active' and p_date between start_date and coalesce(end_date,'9999-12-31'::date);
 if not found then raise exception 'عقد التأمين غير نشط في التاريخ المحدد';end if;
 select * into e from public.contracting_entities where id=c.entity_id;
 if coalesce(e.category,'')<>'insurance' and c.booking_billing_kind<>'insurer' then raise exception 'العقد المحدد ليس عقد تأمين';end if;
 if not (p_service=any(c.booking_service_ids)) then raise exception 'الخدمة غير مشمولة بعقد التأمين';end if;
 select * into pl from public.insurance_plans where id=p_plan and contract_id=p_contract and active and p_date between valid_from and coalesce(valid_to,'9999-12-31'::date);
 if not found then raise exception 'فئة الكارنيه غير صالحة للعقد أو التاريخ';end if;
 select * into s from public.pricing_services where id=p_service and active;
 if not found then raise exception 'الخدمة غير متاحة';end if;
 base:=s.base_price;
 for line in select * from jsonb_array_elements(coalesce(s.supplies_used,'[]'::jsonb)) loop
  select * into sp from public.pricing_supplies where id=(line->>'supply_id')::uuid and active;
  if not found or sp.units_per_package<=0 then raise exception 'أكمل مستلزمات الخدمة';end if;
  base:=base+(line->>'quantity')::numeric*sp.package_price/sp.units_per_package;
 end loop;
 base:=round(base*(1+s.profit_margin_percent/100),2);
 center:=clinic_prices.resolve(s.id,base,p_date);
 center_price:=(center->>'price')::numeric;
 if pl.price_list_id is not null then
  if not exists(select 1 from clinic_prices.lists l where l.id=pl.price_list_id and l.contract_id=p_contract) then raise exception 'لائحة الفئة لا تخص عقد التأمين المحدد';end if;
  quote:=clinic_prices.resolve_explicit_list(s.id,center_price,p_date,pl.price_list_id);
 else
  quote:=clinic_prices.resolve(s.id,center_price,p_date,p_contract);
 end if;
 contracted:=(quote->>'price')::numeric;
 select * into r from public.insurance_plan_service_rules where plan_id=pl.id and service_id=p_service;
 if found and r.copay_type<>'inherit' then cp_type:=r.copay_type;cp_value:=r.copay_value;else cp_type:=pl.copay_type;cp_value:=pl.copay_value;end if;
 copay:=case cp_type when 'percentage' then round(contracted*cp_value/100,2) when 'fixed' then least(cp_value,contracted) else 0 end;
 insurer_net:=round(contracted-copay,2);
 contractual_discount:=greatest(round(center_price-contracted,2),0);
 return jsonb_build_object(
   'service_id',s.id,'service_name',s.name,'contract_id',c.id,'entity_id',e.id,'insurer',e.name,
   'plan_id',pl.id,'plan_name',pl.name,'plan_code',pl.code,'price_list_id',pl.price_list_id,
   'center_price',center_price,'contracted_price',contracted,'contractual_discount',contractual_discount,
   'copay_type',cp_type,'copay_value',cp_value,'patient_copay',copay,'insurer_net',insurer_net,
   'currency','EGP','price_reason',quote->>'reason',
   'account_code',coalesce(e.receivable_account_code,'1121')
 );
end $function$;
