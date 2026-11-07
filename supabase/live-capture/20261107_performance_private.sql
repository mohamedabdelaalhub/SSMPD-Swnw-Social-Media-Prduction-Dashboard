-- LIVE CAPTURE (2026-11-07): definitions read from production with pg_get_functiondef (read-only).
-- Reference snapshot of objects that had no CREATE under supabase/. NOT a migration: do not apply blindly.
-- Grants, owners and triggers are not included.

CREATE OR REPLACE FUNCTION performance_private.admin_has_role(p_admin uuid, p_role text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select exists(select 1 from public.admins a where a.id=p_admin and a.active and a.role=p_role)
      or exists(select 1 from public.admin_extra_roles r where r.admin_id=p_admin and r.role=p_role)
$function$;

CREATE OR REPLACE FUNCTION performance_private.ensure_primary_performance_allocation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if tg_op='INSERT' then
    insert into public.performance_role_allocations(admin_id,role,allocation_pct,set_by) values(new.id,new.role,100,new.id) on conflict do nothing;
  elsif new.role is distinct from old.role and (select count(*) from public.performance_role_allocations where admin_id=new.id)=1
        and exists(select 1 from public.performance_role_allocations where admin_id=new.id and role=old.role and allocation_pct=100) then
    delete from public.performance_role_allocations where admin_id=new.id;
    insert into public.performance_role_allocations(admin_id,role,allocation_pct,set_by) values(new.id,new.role,100,new.id);
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION performance_private.feedback_signal_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'performance_private'
AS $function$begin perform performance_private.sync_feedback_signal(new.id);return new;end$function$;

CREATE OR REPLACE FUNCTION performance_private.patient_quality_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'performance_private'
AS $function$
begin
  perform performance_private.sync_patient_quality(new.id);
  return new;
end $function$;

CREATE OR REPLACE FUNCTION performance_private.personal_notices()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  with open_rows as (
    select * from public.performance_evidence
    where admin_id=public.my_admin_id() and status in('open','confirmed')
  ), s as (
    select count(*)::int n,
           count(*) filter(where severity in('high','critical'))::int urgent,
           max(detected_at) latest_at,
           (array_agg(id order by detected_at desc))[1] latest_id,
           (array_agg(source_id order by detected_at desc))[1] latest_source
    from open_rows
  )
  select case when n=0 then '[]'::jsonb else jsonb_build_array(jsonb_build_object(
    'key','performance:quality:'||latest_id::text,
    'at',latest_at,
    'message','عندك '||n||' تنبيه جودة تسجيل يحتاج مراجعة'||case when urgent>0 then ' — منها '||urgent||' مهم' else '' end,
    'type','my_kpi',
    'id',latest_source,
    'read',exists(select 1 from public.personal_notice_reads r where r.admin_id=public.my_admin_id() and r.notice_key='performance:quality:'||latest_id::text)
  )) end from s
$function$;

CREATE OR REPLACE FUNCTION performance_private.scan_patient_quality()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'performance_private'
AS $function$
declare r record;n int:=0;
begin
  for r in select id from public.patients where status='active' and created_by is not null loop
    perform performance_private.sync_patient_quality(r.id);n:=n+1;
  end loop;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION performance_private.set_evidence(p_admin uuid, p_category text, p_metric text, p_source_type text, p_source_id text, p_active boolean, p_severity text, p_affects boolean, p_title text, p_detail text, p_action text, p_evidence jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'performance_private'
AS $function$
declare actor uuid:=public.my_admin_id();
begin
  if p_admin is null then return; end if;
  if p_active then
    insert into public.performance_evidence(admin_id,category,metric,source_type,source_id,severity,status,affects_score,title,detail,suggested_action,evidence,detected_at,due_at)
    values(p_admin,p_category,p_metric,p_source_type,p_source_id,p_severity,'open',p_affects,p_title,coalesce(p_detail,''),coalesce(p_action,''),coalesce(p_evidence,'{}'::jsonb),now(),now()+interval '24 hours')
    on conflict(admin_id,source_type,source_id,metric) do update set
      category=excluded.category,severity=excluded.severity,affects_score=excluded.affects_score,title=excluded.title,
      detail=excluded.detail,suggested_action=excluded.suggested_action,evidence=excluded.evidence,
      status=case when public.performance_evidence.status in ('dismissed','fixed_by_employee','fixed_by_other') then 'open' else public.performance_evidence.status end,
      detected_at=case when public.performance_evidence.status in ('dismissed','fixed_by_employee','fixed_by_other') then now() else public.performance_evidence.detected_at end,
      due_at=case when public.performance_evidence.status in ('dismissed','fixed_by_employee','fixed_by_other') then now()+interval '24 hours' else public.performance_evidence.due_at end,
      fixed_at=null,fixed_by=null;
  else
    update public.performance_evidence set
      status=case when actor=p_admin then 'fixed_by_employee' else 'fixed_by_other' end,
      fixed_at=now(),fixed_by=actor
    where admin_id=p_admin and source_type=p_source_type and source_id=p_source_id and metric=p_metric
      and status in ('open','confirmed');
  end if;
end $function$;

CREATE OR REPLACE FUNCTION performance_private.sync_feedback_signal(p_rating uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'performance_private'
AS $function$
declare r public.patient_experience_ratings%rowtype; v public.patient_visits%rowtype; p public.patients%rowtype;c text;theme text:='general';team text:='center';sent text:='neutral';sev text:='info';candidate uuid;conf numeric:=0.45; st text:='dismissed';
begin
  select * into r from public.patient_experience_ratings where id=p_rating;
  if not found or length(trim(coalesce(r.comment,'')))=0 then delete from public.patient_feedback_signals where rating_id=p_rating; return; end if;
  select * into v from public.patient_visits where id=r.patient_visit_id;
  select * into p from public.patients where id=r.patient_id;
  c:=lower(trim(r.comment));
  if c ~ '(استقبال|ريسبشن)' then theme:='reception';team:='reception';
  elsif c ~ '(تمريض|ممرض|ممرضة)' then theme:='nursing';team:='nursing';
  elsif c ~ '(انتظار|تأخير|اتأخر|متأخر|بطء)' then theme:='waiting_time';team:='operations';
  elsif c ~ '(دكتور|طبيب|اخصائي|أخصائي)' then theme:='provider_communication';team:='clinical';
  elsif c ~ '(سعر|تكلفة|غالي|مبلغ)' then theme:='cost';team:='management';
  elsif c ~ '(شرح|توضيح|فاهم|فهم|مابيفهم|ما بيفهم|مش فاهم)' then theme:='communication_clarity';team:='service';
  end if;
  if c ~ '(سيئ|سيء|وحش|مشكلة|مابيفهم|ما بيفهم|مش فاهم|غير راض|تأخير|متأخر|غالي|تعامل وحش|مافهم|لم يفهم)' then sent:='negative';sev:='medium';st:='open';
  elsif c ~ '(ممتاز|جيد جدا|جيد جدًا|رائع|محترم|شكرا|شكرًا|متعاون|كويس)' then sent:='positive';sev:='info';st:='confirmed';
  end if;
  if theme='reception' and p.created_by is not null and r.visit_date is not null and p.created_at::date between r.visit_date-2 and r.visit_date+2
     and (performance_private.admin_has_role(p.created_by,'reception') or performance_private.admin_has_role(p.created_by,'customer_service')) then candidate:=p.created_by;conf:=0.82; end if;
  if theme='nursing' and v.created_by is not null and performance_private.admin_has_role(v.created_by,'nursing') then candidate:=v.created_by;conf:=0.85; end if;
  insert into public.patient_feedback_signals(rating_id,patient_visit_id,admin_id,team,theme,sentiment,severity,confidence,status,detected_at)
  values(r.id,r.patient_visit_id,candidate,team,theme,sent,sev,conf,st,coalesce(r.created_at,now()))
  on conflict(rating_id) do update set patient_visit_id=excluded.patient_visit_id,admin_id=excluded.admin_id,team=excluded.team,
    theme=excluded.theme,sentiment=excluded.sentiment,severity=excluded.severity,confidence=excluded.confidence,
    status=case when public.patient_feedback_signals.reviewed_at is null then excluded.status else public.patient_feedback_signals.status end;
end $function$;

CREATE OR REPLACE FUNCTION performance_private.sync_patient_quality(p_patient uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'performance_private'
AS $function$
declare p public.patients%rowtype; digits text; dup_count int:=0; meta jsonb;
begin
  select * into p from public.patients where id=p_patient;
  if not found or p.created_by is null then return; end if;
  digits:=regexp_replace(coalesce(nullif(p.phone_normalized,''),p.phone,''),'[^0-9]','','g');
  meta:=jsonb_build_object('patient_name',coalesce(p.full_name,''),'patient_code',coalesce(p.patient_code,''));
  perform performance_private.set_evidence(p.created_by,'data_quality','patient_name_missing','patient',p.id::text,
    p.status='active' and length(trim(coalesce(p.full_name,'')))=0,'high',true,'اسم المريض غير مكتمل','اسم المريض فارغ في الملف.','أكمل الاسم من مصدر موثوق قبل متابعة الخدمة.',meta||jsonb_build_object('field','full_name'));
  perform performance_private.set_evidence(p.created_by,'data_quality','patient_phone_invalid','patient',p.id::text,
    p.status='active' and digits !~ '^[0-9]{8,15}$','high',true,'رقم الهاتف ناقص أو غير صالح','رقم الاتصال لا يطابق صيغة هاتف قابلة للاستخدام.','راجع رقم الهاتف مع المريض وحدّث الملف.',meta||jsonb_build_object('field','phone'));
  perform performance_private.set_evidence(p.created_by,'data_quality','patient_age_missing','patient',p.id::text,
    p.status='active' and (p.age is null or p.age<0 or p.age>120),'medium',true,'العمر غير مكتمل','العمر غير مسجل أو خارج النطاق المنطقي.','أكمل العمر الصحيح من بيانات المريض.',meta||jsonb_build_object('field','age'));
  if digits ~ '^[0-9]{8,15}$' then
    select count(*) into dup_count from public.patients x where x.status='active' and x.id<>p.id
      and regexp_replace(coalesce(nullif(x.phone_normalized,''),x.phone,''),'[^0-9]','','g')=digits;
  end if;
  perform performance_private.set_evidence(p.created_by,'data_quality','patient_duplicate_phone','patient',p.id::text,
    p.status='active' and dup_count>0,'low',false,'ملف مكرر محتمل','رقم الهاتف موجود في ملف نشط آخر؛ يحتاج مراجعة قبل اعتباره خطأ.','راجع البحث عن المريض وتأكد هل الملفان لنفس الشخص.',meta||jsonb_build_object('field','phone','matches',dup_count));
end $function$;
