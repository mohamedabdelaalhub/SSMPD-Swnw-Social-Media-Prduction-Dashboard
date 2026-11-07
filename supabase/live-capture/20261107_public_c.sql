-- LIVE CAPTURE (2026-11-07): definitions read from production with pg_get_functiondef (read-only).
-- Reference snapshot of objects that had no CREATE under supabase/. NOT a migration: do not apply blindly.
-- Grants, owners and triggers are not included.
-- public part C: insurance_visit_billing_context .. weekly_report_fallback

CREATE OR REPLACE FUNCTION public.insurance_visit_billing_context(p_visit uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare me uuid:=clinic_finance.require_access('view'); v public.patient_visits%rowtype;begin
 select * into v from public.patient_visits where id=p_visit;
 if not found or v.contract_id is null or v.insurance_plan_id is null then raise exception 'الزيارة ليست زيارة تأمين مكتملة البيانات';end if;
 return jsonb_build_object(
   'visit',(select jsonb_build_object('id',v.id,'visit_number',v.visit_number,'visit_date',v.visit_date,'patient_id',p.id,'patient_name',p.full_name,'patient_code',p.patient_code,'medical_record_no',p.medical_record_no,'contract_id',v.contract_id,'plan_id',v.insurance_plan_id,'plan_name',ip.name,'plan_code',ip.code,'insurer',e.name) from public.patients p join public.contracting_entity_contracts c on c.id=v.contract_id join public.contracting_entities e on e.id=c.entity_id join public.insurance_plans ip on ip.id=v.insurance_plan_id where p.id=v.patient_id),
   'services',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'category',s.category) order by s.category,s.name),'[]'::jsonb) from public.pricing_services s join public.contracting_entity_contracts c on c.id=v.contract_id where s.active and s.id=any(c.booking_service_ids)),
   'shifts',public.insurance_open_shifts()
 );
end $function$;

CREATE OR REPLACE FUNCTION public.insurance_workspace(p_contract uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
 if not public.can_manage_contracting_entities() and not clinic_prices.manage() then raise exception 'لا تملك إدارة التأمين ولوائح الأسعار';end if;
 return jsonb_build_object(
 'contracts',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'entity_id',e.id,'entity_name',e.name,'contract_number',c.contract_number,'start_date',c.start_date,'end_date',c.end_date,'status',c.status,'receivable_account_code',coalesce(e.receivable_account_code,'1121'),'booking_coverage',c.booking_coverage,'service_ids',c.booking_service_ids) order by e.name),'[]'::jsonb) from public.contracting_entity_contracts c join public.contracting_entities e on e.id=c.entity_id where (e.category='insurance' or c.booking_billing_kind='insurer') and (p_contract is null or c.id=p_contract)),
 'plans',(select coalesce(jsonb_agg(p order by p.created_at,p.name),'[]'::jsonb) from public.insurance_plans p where p_contract is null or p.contract_id=p_contract),
 'rules',(select coalesce(jsonb_agg(r order by r.created_at),'[]'::jsonb) from public.insurance_plan_service_rules r join public.insurance_plans p on p.id=r.plan_id where p_contract is null or p.contract_id=p_contract),
 'price_lists',(select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'contract_id',l.contract_id,'name',l.name,'version',l.version,'issue_year',l.issue_year,'application_year',l.application_year,'status',l.status,'valid_from',l.valid_from,'valid_to',l.valid_to) order by l.name,l.version),'[]'::jsonb) from clinic_prices.lists l where l.status='active' and (p_contract is null or l.contract_id=p_contract)),
 'services',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'category',s.category,'active',s.active) order by s.name),'[]'::jsonb) from public.pricing_services s where s.active),
 'accounts',(select coalesce(jsonb_agg(jsonb_build_object('code',a.code,'name',a.name) order by a.code),'[]'::jsonb) from clinic_finance.accounts a join clinic_finance.account_config ac on ac.code=a.code where a.kind='asset' and ac.active and not ac.archived and ac.is_postable)
 );
end $function$;

CREATE OR REPLACE FUNCTION public.meta_job_retry(p_job uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n int;
begin
  if public.my_role() not in ('page_manager','approver','general_manager','super_admin') then raise exception 'ليس لديك صلاحية'; end if;
  -- لو انستجرام ماخلصش ينشر فعليًا (instagram_media_id لسه فاضي)، لازم نمسح
  -- instagram_container_id القديم عند إعادة المحاولة — لو الـcontainer القديم
  -- رجع "ERROR" من ميتا، فضل كده للأبد ومش هيتحول لـ"FINISHED" أبدًا مهما
  -- اتعاد السؤال عليه، فكانت إعادة المحاولة بتفشل فورًا بنفس الخطأ القديم من
  -- غير ما تحاول ترفع فيديو/container جديد خالص.
  update public.meta_publish_jobs set
    status = 'pending',
    scheduled_at = now(),
    attempt_count = 0,
    story_attempts = 0,
    instagram_container_id = case when instagram_media_id is null then null else instagram_container_id end
   where id = p_job and (status in ('failed','partial') or (status = 'published' and story_error is not null));
  get diagnostics n = row_count;
  if n = 0 then raise exception 'المنشور ده مش محتاج إعادة محاولة'; end if;
end $function$;

CREATE OR REPLACE FUNCTION public.meta_publish_issues()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.my_admin_id() is null then raise exception 'سجّل الدخول'; end if;
  if public.my_role() not in ('page_manager','approver','general_manager','super_admin') then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(to_jsonb(x)) from (
    select j.id, j.content_id, c.title, j.brand, j.status, j.attempt_count, j.error_message, j.story_error, j.story_attempts,
           j.scheduled_at, j.published_at, (j.status in ('failed','partial') and j.attempt_count >= 4) as exhausted
      from public.meta_publish_jobs j join public.content_items c on c.id = j.content_id
     where (j.status in ('failed','partial') or (j.status = 'published' and j.publish_story and j.story_error is not null and j.story_attempts >= 3))
       and coalesce(j.published_at, j.scheduled_at) > now() - interval '7 days'
     order by coalesce(j.published_at, j.scheduled_at) desc limit 30) x), '[]'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION public.meta_requeue_retryable_jobs()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n int;
begin
  update public.meta_publish_jobs j
     set status = 'pending', scheduled_at = now()
   where coalesce(j.last_attempt_at, j.updated_at) < now() - interval '8 minutes'
     and j.scheduled_at > now() - interval '1 day'
     and (
       (j.status in ('partial','failed') and j.attempt_count < 4
         and ((j.publish_instagram and j.instagram_media_id is null) or (j.publish_facebook and j.facebook_post_id is null))
         and coalesce(j.error_message,'') ~* '(unexpected error|try again|retry|temporar|HTTP (429|5[0-9][0-9])|timeout|ماخلصش معالجة|rate limit)')
       or
       (j.status in ('published','partial') and j.publish_story and j.story_attempts < 3
         and j.published_at > now() - interval '2 days'
         and ((j.publish_facebook and j.story_facebook_id is null) or (j.publish_instagram and j.story_instagram_id is null)))
     );
  get diagnostics n = row_count;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.my_staff_kpis(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := public.my_admin_id(); on_ boolean; orig text; rows_ jsonb; sm jsonb;
begin
  if me is null then raise exception 'سجّل الدخول'; end if;
  select coalesce((value)::text::boolean, false) into on_ from public.staff_kpi_settings where key = 'self_view';
  if not coalesce(on_, false) then return jsonb_build_object('enabled', false); end if;
  orig := current_setting('request.jwt.claims', true);
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into rows_ from public.staff_kpis_admin(p_from, p_to) r where r.admin_id = me;
  perform set_config('request.jwt.claims', coalesce(orig, ''), true);
  select to_jsonb(s) into sm from (select month, strength, improve, action, score, source from public.staff_monthly_summaries where admin_id = me order by month desc limit 1) s;
  return jsonb_build_object('enabled', true, 'rows', rows_, 'summary', sm,
    'defs', (select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) from public.kpi_defs d));
end $function$;

CREATE OR REPLACE FUNCTION public.patient_portal_journey_action(p_appointment uuid, p_action text, p_payload jsonb DEFAULT '{}'::jsonb, p_token uuid DEFAULT gen_random_uuid())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare uid uuid; account uuid; a clinic_reception.appointments%rowtype; rp clinic_reception.patients%rowtype; ev uuid; h uuid;
begin
  uid:=auth.uid();
  if uid is null then raise exception 'Authentication required'; end if;
  select id into account from public.patient_accounts where auth_user_id=uid and status='active' limit 1;
  if account is null then raise exception 'Patient account is not active'; end if;

  select ca.* into a
  from clinic_reception.appointments ca
  join clinic_reception.patients crp on crp.id=ca.patient_id
  join public.patient_account_access aa on aa.patient_id=crp.patient_id
  where ca.id=p_appointment and aa.account_id=account and aa.verification_status='approved' and aa.revoked_at is null and (aa.expires_at is null or aa.expires_at>now())
  for update of ca;
  if not found then raise exception 'Appointment is not available for this account'; end if;
  select * into rp from clinic_reception.patients where id=a.patient_id;

  select id into ev from clinic_reception.journey_events where workspace_id=a.workspace_id and idempotency_key='portal:'||p_token::text;
  if ev is not null then return jsonb_build_object('event_id',ev,'duplicate',true); end if;

  if p_action='on_the_way' then
    if a.status<>'booked' then raise exception 'Appointment is not awaiting arrival'; end if;
    update clinic_reception.queue_entries set status='on_the_way',updated_at=now() where appointment_id=a.id and status='expected';
    insert into clinic_reception.journey_events(workspace_id,appointment_id,visit_id,patient_id,provider_id,event_type,source,idempotency_key,metadata)
    values(a.workspace_id,a.id,(select id from clinic_reception.visits where appointment_id=a.id),a.patient_id,a.provider_id,'patient.on_the_way','patient_portal','portal:'||p_token::text,coalesce(p_payload,'{}'::jsonb)) returning id into ev;
  elsif p_action='help' then
    insert into clinic_reception.help_requests(workspace_id,appointment_id,visit_id,patient_id,kind,message,metadata)
    values(a.workspace_id,a.id,(select id from clinic_reception.visits where appointment_id=a.id),a.patient_id,coalesce(nullif(p_payload->>'kind',''),'assistance'),nullif(p_payload->>'message',''),coalesce(p_payload,'{}'::jsonb)||jsonb_build_object('source','patient_portal')) returning id into h;
    insert into clinic_reception.journey_events(workspace_id,appointment_id,visit_id,patient_id,provider_id,event_type,source,idempotency_key,metadata)
    values(a.workspace_id,a.id,(select id from clinic_reception.visits where appointment_id=a.id),a.patient_id,a.provider_id,'patient.help_requested','patient_portal','portal:'||p_token::text,jsonb_build_object('help_request_id',h)) returning id into ev;
    perform clinic_reception.queue_journey_message(a.workspace_id,a.id,'help_ack','وصل طلب مساعدتك لفريق الاستقبال وسيتم التعامل معه.',ev::text,(select owner_id from clinic_reception.workspaces where id=a.workspace_id),jsonb_build_object('event_id',ev,'source','patient_portal'));
  else
    raise exception 'Unsupported patient action';
  end if;

  insert into public.patient_portal_audit_log(account_id,patient_id,action,entity_type,entity_id,metadata)
  values(account,rp.patient_id,'journey_'||p_action,'appointment',a.id,jsonb_build_object('event_id',ev));
  return jsonb_build_object('event_id',ev,'appointment_id',a.id,'action',p_action);
end $function$;

CREATE OR REPLACE FUNCTION public.patient_portal_journey_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare uid uuid; account uuid; result jsonb;
begin
  uid:=auth.uid();
  if uid is null then raise exception 'Authentication required'; end if;
  select id into account from public.patient_accounts where auth_user_id=uid and status='active' limit 1;
  if account is null then raise exception 'Patient account is not active'; end if;

  select jsonb_build_object(
    'patients',coalesce((
      select jsonb_agg(jsonb_build_object('patient_id',p.id,'name',p.full_name,'file_no',p.medical_record_no,'is_primary',aa.is_primary) order by aa.is_primary desc,p.full_name)
      from public.patient_account_access aa
      join public.patients p on p.id=aa.patient_id
      where aa.account_id=account and aa.verification_status='approved' and aa.revoked_at is null and (aa.expires_at is null or aa.expires_at>now())
    ),'[]'::jsonb),
    'appointments',coalesce((
      select jsonb_agg(x order by x.starts_at desc) from (
        select a.id appointment_id,rp.patient_id,p.full_name patient_name,a.starts_at,a.ends_at,a.status appointment_status,
               pr.name provider_name,pr.department,s.name service_name,
               q.status queue_status,q.queued_at,q.called_at,q.service_started_at,q.service_ended_at,q.location_verified,
               case when q.queued_at is not null and q.service_started_at is null and q.status in ('waiting','called','on_hold') then greatest(0,floor(extract(epoch from (now()-q.queued_at))/60))::int else 0 end wait_minutes,
               v.id visit_id,v.status visit_status
        from public.patient_account_access aa
        join public.patients p on p.id=aa.patient_id
        join clinic_reception.patients rp on rp.patient_id=p.id
        join clinic_reception.appointments a on a.patient_id=rp.id
        join clinic_reception.providers pr on pr.id=a.provider_id
        join clinic_reception.services s on s.id=a.service_id
        left join clinic_reception.queue_entries q on q.appointment_id=a.id
        left join clinic_reception.visits v on v.appointment_id=a.id
        where aa.account_id=account and aa.verification_status='approved' and aa.revoked_at is null and (aa.expires_at is null or aa.expires_at>now())
          and a.starts_at between now()-interval '30 days' and now()+interval '90 days'
      ) x
    ),'[]'::jsonb),
    'events',coalesce((
      select jsonb_agg(jsonb_build_object('appointment_id',e.appointment_id,'event_type',e.event_type,'event_at',e.event_at,'source',e.source,'metadata',e.metadata) order by e.event_at desc)
      from clinic_reception.journey_events e
      join clinic_reception.patients rp on rp.id=e.patient_id
      join public.patient_account_access aa on aa.patient_id=rp.patient_id
      where aa.account_id=account and aa.verification_status='approved' and aa.revoked_at is null and (aa.expires_at is null or aa.expires_at>now())
        and e.event_at>now()-interval '30 days'
    ),'[]'::jsonb)
  ) into result;

  insert into public.patient_portal_audit_log(account_id,action,entity_type,metadata)
  values(account,'journey_snapshot_viewed','patient_journey',jsonb_build_object('auth_user_id',uid));
  return result;
end $function$;

CREATE OR REPLACE FUNCTION public.patient_portal_service_reports()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'service',o.snapshot->>'name','uploaded_at',r.uploaded_at,'file_name',r.file_name,'mime',r.mime_type,'path',r.storage_path) order by r.uploaded_at desc),'[]'::jsonb)
 from clinic_reception.order_reports r
 join clinic_reception.orders o on o.id=r.order_id
 join clinic_reception.visits v on v.id=o.visit_id
 join clinic_reception.patients p on p.id=v.patient_id
 join public.patient_account_access a on a.patient_id=p.patient_id
 join public.patient_accounts pa on pa.id=a.account_id
 where r.patient_visible and pa.auth_user_id=auth.uid() and pa.status='active' and a.verification_status='approved'
   and a.revoked_at is null and (a.expires_at is null or a.expires_at>now()) $function$;

CREATE OR REPLACE FUNCTION public.performance_available_roles(p_admin uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare actor uuid:=public.my_admin_id();out jsonb;
begin
  if actor is null or (actor<>p_admin and not (public.has_role('super_admin') or public.has_role('general_manager'))) then raise exception 'غير مصرح' using errcode='42501';end if;
  with assigned as (select a.role from public.admins a where a.id=p_admin union select e.role from public.admin_extra_roles e where e.admin_id=p_admin)
  select coalesce(jsonb_agg(jsonb_build_object('role',x.role,'allocation_pct',coalesce(p.allocation_pct,0)) order by x.role),'[]'::jsonb)
  into out from assigned x left join public.performance_role_allocations p on p.admin_id=p_admin and p.role=x.role;
  return out;
end $function$;

CREATE OR REPLACE FUNCTION public.performance_evidence_review(p_evidence uuid, p_decision text, p_note text DEFAULT ''::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if public.my_admin_id() is null or not (public.has_role('super_admin') or public.has_role('general_manager')) then raise exception 'غير مصرح' using errcode='42501';end if;
  if p_decision not in ('confirmed','dismissed') then raise exception 'قرار غير صالح';end if;
  update public.performance_evidence set status=p_decision,affects_score=case when p_decision='confirmed' then true else false end,
    reviewed_at=now(),reviewed_by=public.my_admin_id(),review_note=nullif(trim(coalesce(p_note,'')),'') where id=p_evidence;
  if not found then raise exception 'الملاحظة غير متاحة';end if;
end $function$;

CREATE OR REPLACE FUNCTION public.performance_feedback_queue(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if public.my_admin_id() is null or not (public.has_role('super_admin') or public.has_role('general_manager')) then raise exception 'غير مصرح' using errcode='42501';end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'admin_id',s.admin_id,'team',s.team,'theme',s.theme,'sentiment',s.sentiment,'severity',s.severity,'confidence',s.confidence,'status',s.status,'detected_at',s.detected_at,'visit_id',s.patient_visit_id,'comment',r.comment,'encounter_type',r.encounter_type,'visit_date',r.visit_date) order by s.detected_at desc)
    from public.patient_feedback_signals s join public.patient_experience_ratings r on r.id=s.rating_id
    where s.sentiment='negative' and s.status in('open','confirmed') and s.detected_at>=p_from and s.detected_at<p_to),'[]'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION public.performance_feedback_review(p_signal uuid, p_decision text, p_note text DEFAULT ''::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if public.my_admin_id() is null or not (public.has_role('super_admin') or public.has_role('general_manager')) then raise exception 'غير مصرح' using errcode='42501';end if;
  if p_decision not in ('confirmed','dismissed') then raise exception 'قرار غير صالح';end if;
  update public.patient_feedback_signals set status=p_decision,reviewed_at=now(),reviewed_by=public.my_admin_id(),review_note=nullif(trim(coalesce(p_note,'')),'') where id=p_signal;
  if not found then raise exception 'الملاحظة غير متاحة';end if;
end $function$;

CREATE OR REPLACE FUNCTION public.performance_set_role_allocations(p_admin uuid, p_allocations jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare x jsonb;total numeric:=0;r text;pct numeric;
begin
  if public.my_admin_id() is null or not (public.has_role('super_admin') or public.has_role('general_manager')) then raise exception 'غير مصرح' using errcode='42501';end if;
  if not exists(select 1 from public.admins where id=p_admin and active) then raise exception 'الموظف غير متاح';end if;
  if coalesce(jsonb_typeof(p_allocations),'null')<>'array' then raise exception 'التوزيع غير صالح';end if;
  if jsonb_array_length(p_allocations)=0 then delete from public.performance_role_allocations where admin_id=p_admin;return;end if;
  for x in select * from jsonb_array_elements(p_allocations) loop
    r:=trim(x->>'role');pct:=(x->>'allocation_pct')::numeric;
    if pct<=0 or pct>100 or not exists(select 1 from public.admins a where a.id=p_admin and a.role=r union all select 1 from public.admin_extra_roles e where e.admin_id=p_admin and e.role=r) then raise exception 'الدور أو النسبة غير صالحين';end if;
    total:=total+pct;
  end loop;
  if abs(total-100)>0.01 then raise exception 'مجموع نسب الأدوار لازم يساوي 100%%';end if;
  delete from public.performance_role_allocations where admin_id=p_admin;
  insert into public.performance_role_allocations(admin_id,role,allocation_pct,set_by)
  select p_admin,x->>'role',(x->>'allocation_pct')::numeric,public.my_admin_id() from jsonb_array_elements(p_allocations) x;
end $function$;

CREATE OR REPLACE FUNCTION public.personal_home_rating_queue()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := public.my_admin_id(); r text := public.my_role();
begin
  if me is null then raise exception 'سجّل الدخول'; end if;
  if r not in ('page_manager','approver','general_manager','super_admin') then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(to_jsonb(x)) from (
    select c.id, c.title, c.brand, c.content_format, c.published_at
      from public.content_items c
     where c.stage = 'published' and c.published_at between now() - interval '30 days' and now() - interval '3 days'
       and not exists (select 1 from public.content_ratings cr where cr.content_id = c.id)
       and (r in ('approver','general_manager','super_admin') or c.created_by = me)
     order by c.published_at desc limit 8) x), '[]'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION public.reap_stuck_meta_publish_jobs()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n integer := 0; r integer;
begin
  update public.meta_publish_jobs
     set status = 'failed', error_code = 'STUCK_TIMEOUT',
         error_message = 'النشر وقف في النص مرتين (انقطاع قبل ما يخلص). راجع الصفحة وتأكد مفيش نسخة اتنشرت قبل ما تعيد الجدولة.'
   where status = 'processing'
     and last_attempt_at < now() - interval '10 minutes'
     and coalesce(attempt_count, 0) >= 2;
  get diagnostics r = row_count; n := n + r;
  update public.meta_publish_jobs
     set status = 'pending', scheduled_at = now(),
         error_code = null, error_message = null
   where status = 'processing'
     and last_attempt_at < now() - interval '10 minutes'
     and coalesce(attempt_count, 0) < 2;
  get diagnostics r = row_count; n := n + r;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.refresh_content_learnings()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n int;
begin
  update public.content_learnings set active = false where source = 'system' and active;
  with m as (select * from public.content_performance(60) where brand in ('sono','dr_dina')),
  base as (select brand, avg(engagement)::numeric b from m group by brand having count(*) >= 6 and avg(engagement) > 0),
  dims as (
    select brand, 'format' dim, content_format v, engagement e from m
    union all select brand, 'daypart', daypart, engagement from m
    union all select brand, 'weekday', weekday, engagement from m
    union all select brand, 'cta_type', cta_type, engagement from m
    union all select brand, 'specialty', specialty, engagement from m
  ),
  agg as (select brand, dim, v, count(*) cnt, avg(e)::numeric a from dims where v is not null and v <> '' group by 1,2,3 having count(*) >= 3),
  ins as (
    insert into public.content_learnings(brand, dimension, value, verdict, confidence, evidence, note, source, expires_at)
    select a.brand, a.dim, a.v,
           case when a.a / b.b >= 1.25 then 'do_more' when a.a / b.b <= 0.4 and a.cnt >= 5 then 'avoid' else 'do_less' end,
           case when a.cnt >= 5 and (a.a / b.b >= 1.4 or a.a / b.b <= 0.6) then 'strong' else 'tentative' end,
           jsonb_build_object('posts', a.cnt, 'avg_engagement', round(a.a, 1), 'brand_avg', round(b.b, 1), 'ratio', round(a.a / b.b, 2)),
           a.dim || ' = ' || a.v || ': متوسط التفاعل ' || round(a.a / b.b, 2) || '× متوسط الصفحة (' || a.cnt || ' منشورات)',
           'system', now() + interval '10 days'
      from agg a join base b using (brand)
     where a.a / b.b >= 1.25 or a.a / b.b <= 0.75
    returning 1)
  select count(*) into n from ins;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.staff_comprehensive_performance(p_from timestamp with time zone, p_to timestamp with time zone, p_admin uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'performance_private', 'clinic_people'
AS $function$
declare
  actor uuid:=public.my_admin_id(); subject uuid:=coalesce(p_admin,public.my_admin_id());
  v_name text;v_primary_role text;v_days numeric;
  v_roles jsonb:='[]'::jsonb;v_role_breakdown jsonb:='[]'::jsonb;v_role_score numeric;
  v_att_total int:=0;v_att_present int:=0;v_att_late int:=0;v_att_absent int:=0;v_att_early int:=0;v_att_missing_out int:=0;v_att_score numeric;
  v_task_sample int:=0;v_task_timed int:=0;v_task_ontime numeric:=0;v_task_weight numeric:=0;v_task_score numeric;v_overdue int:=0;
  v_task_quality_sample int:=0;v_task_quality_score numeric;v_revisions int:=0;
  v_reg_count int:=0;v_issue_weight numeric:=0;v_data_score numeric;v_open_issues int:=0;
  v_clinical_sample int:=0;v_clinical_complete int:=0;v_clinical_score numeric;
  v_quality_score numeric;v_quality_sample int:=0;v_quality_sum numeric:=0;v_quality_weight numeric:=0;
  v_patient_sample int:=0;v_patient_score numeric;v_patient_negative int:=0;v_patient_open int:=0;
  v_dims jsonb:='[]'::jsonb;v_sum numeric:=0;v_w numeric:=0;v_dim_count int:=0;v_total_sample int:=0;v_score numeric;v_band text;v_conf text;v_provisional boolean;
  v_issues jsonb:='[]'::jsonb;v_feedback jsonb:='[]'::jsonb;v_steps jsonb:='[]'::jsonb;
begin
  if actor is null or subject is null then raise exception 'سجل الدخول' using errcode='42501';end if;
  if p_to is null or p_from is null or p_to<=p_from or p_to-p_from>interval '370 days' then raise exception 'فترة الأداء غير صالحة';end if;
  if subject<>actor and not (public.has_role('super_admin') or public.has_role('general_manager')) then raise exception 'يمكنك متابعة أدائك فقط' using errcode='42501';end if;
  select name,role into v_name,v_primary_role from public.admins where id=subject and active;
  if v_name is null then raise exception 'الموظف غير متاح';end if;
  v_days:=greatest(1,extract(epoch from(p_to-p_from))/86400.0);

  with assigned as (
    select v_primary_role role union select e.role from public.admin_extra_roles e where e.admin_id=subject
  ), custom as (select role,allocation_pct from public.performance_role_allocations where admin_id=subject),
  chosen as (
    select a.role,case when exists(select 1 from custom) then coalesce(c.allocation_pct,0) else 100.0/nullif(count(*) over(),0) end allocation_pct
    from assigned a left join custom c using(role)
  )
  select coalesce(jsonb_agg(jsonb_build_object('role',role,'allocation_pct',round(allocation_pct,1)) order by allocation_pct desc,role),'[]'::jsonb)
  into v_roles from chosen where allocation_pct>0;

  select count(*)::int,
         count(*) filter(where a.actual_start is not null)::int,
         count(*) filter(where a.actual_start is null)::int,
         count(*) filter(where a.actual_start is not null and a.scheduled_start is not null and a.actual_start>a.scheduled_start+interval '10 minutes')::int,
         count(*) filter(where a.actual_end is not null and a.scheduled_end is not null and a.actual_end<a.scheduled_end-interval '15 minutes')::int,
         count(*) filter(where a.actual_start is not null and a.actual_end is null)::int
  into v_att_total,v_att_present,v_att_absent,v_att_late,v_att_early,v_att_missing_out
  from clinic_people.attendance a join clinic_people.people p on p.id=a.person_id
  where p.admin_id=subject and p.status<>'ended' and a.status='approved'
    and a.day >= (p_from at time zone 'Africa/Cairo')::date and a.day <= (p_to at time zone 'Africa/Cairo')::date
    and not exists(select 1 from clinic_people.requests q where q.person_id=p.id and q.status='approved' and q.kind='leave' and a.day between q.from_date and q.to_date);
  if v_att_total>=3 then
    v_att_score:=greatest(0,least(100,100-(60.0*v_att_absent/v_att_total)-(20.0*v_att_late/v_att_total)-(10.0*v_att_early/v_att_total)-(10.0*v_att_missing_out/v_att_total)));
  end if;

  with base as (
    select t.*,case t.priority when 'urgent' then 4 when 'high' then 3 when 'normal' then 2 else 1 end::numeric wt
    from public.tasks t where t.assignee_id=subject and not exists(select 1 from public.tasks c where c.parent_task_id=t.id)
      and t.first_submitted_at>=p_from and t.first_submitted_at<p_to
  )
  select count(*)::int,count(*) filter(where first_submission_due_at is not null)::int,
         coalesce(sum(wt) filter(where first_submission_due_at is not null),0),
         coalesce(sum(wt) filter(where first_submission_due_at is not null and first_submitted_at<=first_submission_due_at),0),
         count(*) filter(where exists(select 1 from public.task_updates u where u.task_id=base.id and u.status_from='review' and u.status_to='revision' and u.created_at>=base.first_submitted_at))::int
  into v_task_sample,v_task_timed,v_task_weight,v_task_ontime,v_revisions from base;
  if v_task_timed>=2 and v_task_weight>0 then v_task_score:=least(100,100*v_task_ontime/v_task_weight);end if;
  if v_task_sample>=2 then
    with base as (
      select t.id,case t.priority when 'urgent' then 4 when 'high' then 3 when 'normal' then 2 else 1 end::numeric wt,t.first_submitted_at
      from public.tasks t where t.assignee_id=subject and not exists(select 1 from public.tasks c where c.parent_task_id=t.id)
        and t.first_submitted_at>=p_from and t.first_submitted_at<p_to
    )
    select count(*)::int,100*coalesce(sum(wt) filter(where not exists(select 1 from public.task_updates u where u.task_id=base.id and u.status_from='review' and u.status_to='revision' and u.created_at>=base.first_submitted_at)),0)/nullif(sum(wt),0)
    into v_task_quality_sample,v_task_quality_score from base;
  end if;
  if p_to>=now()-interval '1 day' then
    select count(*)::int into v_overdue from public.tasks t where t.assignee_id=subject and t.status not in ('done','review') and t.due_at<now()
      and not exists(select 1 from public.tasks c where c.parent_task_id=t.id);
  end if;

  select count(*)::int into v_reg_count from public.patients p where p.created_by=subject and p.created_at>=p_from and p.created_at<p_to;
  select coalesce(sum((case e.severity when 'critical' then 2 when 'high' then 1.25 when 'medium' then 1 when 'low' then .5 else .25 end)*
    (case e.status when 'dismissed' then 0 when 'fixed_by_employee' then case when e.fixed_at<=e.due_at then .1 else .35 end when 'fixed_by_other' then .75 else 1 end)),0),
    count(*) filter(where e.status in ('open','confirmed'))::int
  into v_issue_weight,v_open_issues
  from public.performance_evidence e join public.patients p on p.id::text=e.source_id
  where e.admin_id=subject and e.source_type='patient' and e.affects_score and p.created_at>=p_from and p.created_at<p_to;
  if v_reg_count>=3 then v_data_score:=greatest(0,least(100,100-(100*v_issue_weight/nullif(v_reg_count*3.0,0))));end if;

  if performance_private.admin_has_role(subject,'nursing') then
    select count(*)::int,count(*) filter(where
      ((case when nullif(trim(coalesce(v.blood_pressure,'')),'') is not null then 1 else 0 end)+
       (case when nullif(trim(coalesce(v.pulse,'')),'') is not null then 1 else 0 end)+
       (case when nullif(trim(coalesce(v.oxygen_percent,'')),'') is not null then 1 else 0 end)+
       (case when nullif(trim(coalesce(v.weight,'')),'') is not null then 1 else 0 end))>=2)::int
    into v_clinical_sample,v_clinical_complete from public.patient_visits v where v.created_by=subject and v.created_at>=p_from and v.created_at<p_to and v.encounter_type in('checkup','follow_up','emergency','session','home_visit');
    if v_clinical_sample>=3 then v_clinical_score:=100.0*v_clinical_complete/v_clinical_sample;end if;
  end if;

  if v_data_score is not null then v_quality_sum:=v_quality_sum+v_data_score*45;v_quality_weight:=v_quality_weight+45;v_quality_sample:=v_quality_sample+v_reg_count;end if;
  if v_task_quality_score is not null then v_quality_sum:=v_quality_sum+v_task_quality_score*30;v_quality_weight:=v_quality_weight+30;v_quality_sample:=v_quality_sample+v_task_quality_sample;end if;
  if v_clinical_score is not null then v_quality_sum:=v_quality_sum+v_clinical_score*25;v_quality_weight:=v_quality_weight+25;v_quality_sample:=v_quality_sample+v_clinical_sample;end if;
  if v_quality_weight>0 then v_quality_score:=v_quality_sum/v_quality_weight;end if;

  with assigned as (
    select v_primary_role role union select e.role from public.admin_extra_roles e where e.admin_id=subject
  ), custom as (select role,allocation_pct from public.performance_role_allocations where admin_id=subject),
  role_alloc as (
    select a.role,case when exists(select 1 from custom) then coalesce(c.allocation_pct,0) else 100.0/nullif(count(*) over(),0) end allocation_pct
    from assigned a left join custom c using(role)
  ),
  ci as (
    select c.id,c.created_by,c.assigned_designer,c.created_at,
      (select min((e->>'at')::timestamptz) from jsonb_array_elements(coalesce(c.stage_history,'[]'::jsonb)) e where e->>'stage'='initial_approval') t_init,
      (select min((e->>'at')::timestamptz) from jsonb_array_elements(coalesce(c.stage_history,'[]'::jsonb)) e where e->>'stage'='in_design') t_design,
      (select min((e->>'at')::timestamptz) from jsonb_array_elements(coalesce(c.stage_history,'[]'::jsonb)) e where e->>'stage'='final_approval') t_final,
      (select min((e->>'at')::timestamptz) from jsonb_array_elements(coalesce(c.stage_history,'[]'::jsonb)) e where e->>'stage'='ready_to_publish') t_ready,
      exists(select 1 from public.activity_log al where al.content_id=c.id and al.to_stage='needs_revision') had_rev
    from public.content_items c
  ),
  decisions as (
    select a.actor_id,a.created_at,a.from_stage,a.action,a.created_at-lag(a.created_at) over(partition by a.content_id order by a.created_at) gap from public.activity_log a
  ),
  perf as (
    select c.created_by,cp.published_at,cp.engagement::numeric/nullif(avg(cp.engagement) over(partition by cp.brand),0) ratio
    from public.content_performance(120) cp join public.content_items c on c.id=cp.content_id
  ),
  fc as (
    select distinct on(l.id) l.id,l.received_at,s.changed_by,s.changed_at from public.leads l join public.lead_status_log s on s.lead_id=l.id and s.changed_at>=l.received_at
    where l.received_at>=p_from and l.received_at<p_to and s.changed_by=subject order by l.id,s.changed_at
  ),
  review_pairs as (
    select d.author_id,extract(epoch from(d.created_at-s.created_at))/3600.0 hours
    from public.task_updates s join lateral(
      select x.author_id,x.created_at from public.task_updates x where x.task_id=s.task_id and x.created_at>s.created_at and x.status_from='review' and x.status_to in('done','revision') order by x.created_at limit 1
    ) d on true where s.status_to='review' and s.created_at>=p_from and s.created_at<p_to and d.author_id=subject
  ),
  m(k,val,n) as (
    select 'content_created',count(*)::numeric,count(*)::int from ci where created_by=subject and created_at>=p_from and created_at<p_to
    union all select 'first_pass_rate',100*avg((not had_rev)::int),count(*)::int from ci where created_by=subject and created_at>=p_from and created_at<p_to and t_ready is not null
    union all select 'idea_to_approval_hours',avg(extract(epoch from(t_ready-t_init))/3600),count(*)::int from ci where created_by=subject and t_init>=p_from and t_init<p_to and t_ready>=t_init
    union all select 'post_engagement_ratio',avg(ratio),count(*)::int from perf where created_by=subject and published_at>=p_from and published_at<p_to and ratio is not null
    union all select 'designs_delivered',count(*)::numeric,count(*)::int from ci where assigned_designer=subject and t_final>=p_from and t_final<p_to
    union all select 'design_turnaround_hours',avg(extract(epoch from(t_final-t_design))/3600),count(*)::int from ci where assigned_designer=subject and t_final>=p_from and t_final<p_to and t_design is not null and t_final>=t_design
    union all select 'design_first_pass_rate',100*avg((not had_rev)::int),count(*)::int from ci where assigned_designer=subject and t_final>=p_from and t_final<p_to
    union all select 'approval_response_hours',avg(extract(epoch from gap)/3600),count(*)::int from decisions where actor_id=subject and gap is not null and created_at>=p_from and created_at<p_to and from_stage in('initial_approval','final_approval') and (action in('اعتماد نهائي','اعتماد','طلب تعديل') or action like 'اعتماد أولي%')
    union all select 'approvals_done',count(*)::numeric,count(*)::int from decisions where actor_id=subject and created_at>=p_from and created_at<p_to and from_stage in('initial_approval','final_approval') and (action in('اعتماد نهائي','اعتماد','طلب تعديل') or action like 'اعتماد أولي%')
    union all select 'task_review_response_hours',avg(hours),count(*)::int from review_pairs
    union all select 'lead_attempts',count(*)::numeric,count(*)::int from public.lead_attempts where employee_id=subject and attempt_date>=p_from and attempt_date<p_to
    union all select 'lead_first_contact_minutes',avg(extract(epoch from(changed_at-received_at))/60),count(*)::int from fc
    union all select 'bookings_made',count(*)::numeric,count(*)::int from public.leads where booked_by=subject and booking_date>=p_from::date and booking_date<p_to::date
  ),
  scored as (
    select ra.role,ra.allocation_pct,d.kpi,d.label_ar,d.unit,d.direction,d.min_sample,m.val,m.n,
      round(t.target*case when d.scales then v_days/30 else 1 end,1) target,t.weight,
      case when m.val is null or coalesce(m.n,0)<d.min_sample then null
           when d.direction='higher' then least(100,100*m.val/nullif(t.target*case when d.scales then v_days/30 else 1 end,0))
           else case when m.val<=t.target then 100 else least(100,100*t.target/nullif(m.val,0)) end end kscore
    from role_alloc ra join public.kpi_targets t on t.role=ra.role join public.kpi_defs d on d.kpi=t.kpi left join m on m.k=d.kpi
    where ra.allocation_pct>0 and d.kpi not in('tasks_on_time_rate','tasks_overdue_now')
  ), per_role as (
    select role,allocation_pct,case when count(kscore)>0 then sum(kscore*weight)/nullif(sum(weight) filter(where kscore is not null),0) end role_score,
      coalesce(jsonb_agg(jsonb_build_object('kpi',kpi,'label',label_ar,'unit',unit,'value',round(val,2),'sample',coalesce(n,0),'target',target,'score',case when kscore is null then null else round(kscore,1) end) order by kpi) filter(where val is not null or coalesce(n,0)>0),'[]'::jsonb) metrics
    from scored group by role,allocation_pct
  )
  select coalesce(jsonb_agg(jsonb_build_object('role',role,'allocation_pct',round(allocation_pct,1),'score',case when role_score is null then null else round(role_score,1) end,'metrics',metrics) order by allocation_pct desc,role),'[]'::jsonb),
    sum(role_score*allocation_pct) filter(where role_score is not null)/nullif(sum(allocation_pct) filter(where role_score is not null),0)
  into v_role_breakdown,v_role_score from per_role;

  with scores as (
    select ((r.ratings->>0)::numeric) val from public.patient_experience_ratings r join public.patients p on p.id=r.patient_id
    where r.source='patient_portal' and r.created_at>=p_from and r.created_at<p_to and p.created_by=subject
      and p.created_at::date between r.visit_date-2 and r.visit_date+2
      and (performance_private.admin_has_role(subject,'reception') or performance_private.admin_has_role(subject,'customer_service'))
    union all
    select (((r.ratings->>1)::numeric+(r.ratings->>2)::numeric+(r.ratings->>3)::numeric)/3.0) val
    from public.patient_experience_ratings r join public.patient_visits v on v.id=r.patient_visit_id
    where r.source='patient_portal' and r.created_at>=p_from and r.created_at<p_to and v.created_by=subject
      and ((performance_private.admin_has_role(subject,'nursing') and v.encounter_type in('lab','radiology')) or (performance_private.admin_has_role(subject,'psychology_specialist') and v.encounter_type='session'))
  ) select count(*)::int,20*avg(val) into v_patient_sample,v_patient_score from scores;
  select count(*) filter(where sentiment='negative' and status='confirmed')::int,count(*) filter(where sentiment='negative' and status='open')::int
  into v_patient_negative,v_patient_open from public.patient_feedback_signals where admin_id=subject and detected_at>=p_from and detected_at<p_to;
  if v_patient_score is not null and v_patient_sample>=5 then v_patient_score:=greatest(0,v_patient_score-least(20,v_patient_negative*5));end if;

  if v_att_score is not null then
    v_dims:=v_dims||jsonb_build_array(jsonb_build_object('key','attendance','label','الحضور والانضباط','weight',15,'score',round(v_att_score,1),'sample',v_att_total,'counted',true,'details',jsonb_build_object('shifts',v_att_total,'present',v_att_present,'late',v_att_late,'absent',v_att_absent,'early_leave',v_att_early,'missing_checkout',v_att_missing_out)));
    v_sum:=v_sum+v_att_score*15;v_w:=v_w+15;v_dim_count:=v_dim_count+1;v_total_sample:=v_total_sample+v_att_total;
  else v_dims:=v_dims||jsonb_build_array(jsonb_build_object('key','attendance','label','الحضور والانضباط','weight',15,'score',null,'sample',v_att_total,'counted',false));end if;
  if v_task_score is not null then
    v_dims:=v_dims||jsonb_build_array(jsonb_build_object('key','tasks','label','الالتزام بتنفيذ المهام','weight',20,'score',round(v_task_score,1),'sample',v_task_timed,'counted',true,'details',jsonb_build_object('submitted',v_task_sample,'timed',v_task_timed,'overdue_now',v_overdue)));
    v_sum:=v_sum+v_task_score*20;v_w:=v_w+20;v_dim_count:=v_dim_count+1;v_total_sample:=v_total_sample+v_task_timed;
  else v_dims:=v_dims||jsonb_build_array(jsonb_build_object('key','tasks','label','الالتزام بتنفيذ المهام','weight',20,'score',null,'sample',v_task_timed,'counted',false,'details',jsonb_build_object('overdue_now',v_overdue)));end if;
  if v_quality_score is not null then
    v_dims:=v_dims||jsonb_build_array(jsonb_build_object('key','quality','label','جودة ودقة العمل','weight',25,'score',round(v_quality_score,1),'sample',v_quality_sample,'counted',true,'details',jsonb_build_object('registration_score',case when v_data_score is null then null else round(v_data_score,1) end,'registrations',v_reg_count,'open_data_issues',v_open_issues,'task_first_pass_score',case when v_task_quality_score is null then null else round(v_task_quality_score,1) end,'task_revisions',v_revisions,'clinical_documentation_score',case when v_clinical_score is null then null else round(v_clinical_score,1) end,'clinical_records',v_clinical_sample)));
    v_sum:=v_sum+v_quality_score*25;v_w:=v_w+25;v_dim_count:=v_dim_count+1;v_total_sample:=v_total_sample+v_quality_sample;
  else v_dims:=v_dims||jsonb_build_array(jsonb_build_object('key','quality','label','جودة ودقة العمل','weight',25,'score',null,'sample',v_quality_sample,'counted',false));end if;
  if v_role_score is not null then
    v_dims:=v_dims||jsonb_build_array(jsonb_build_object('key','role_results','label','نتائج الدور الوظيفي','weight',30,'score',round(v_role_score,1),'sample',jsonb_array_length(v_role_breakdown),'counted',true,'details',v_role_breakdown));
    v_sum:=v_sum+v_role_score*30;v_w:=v_w+30;v_dim_count:=v_dim_count+1;v_total_sample:=v_total_sample+jsonb_array_length(v_role_breakdown);
  else v_dims:=v_dims||jsonb_build_array(jsonb_build_object('key','role_results','label','نتائج الدور الوظيفي','weight',30,'score',null,'sample',0,'counted',false,'details',v_role_breakdown));end if;
  if v_patient_score is not null and v_patient_sample>=5 then
    v_dims:=v_dims||jsonb_build_array(jsonb_build_object('key','patient_experience','label','تجربة المريض','weight',10,'score',round(v_patient_score,1),'sample',v_patient_sample,'counted',true,'details',jsonb_build_object('ratings',v_patient_sample,'confirmed_negative_comments',v_patient_negative,'open_comments',v_patient_open)));
    v_sum:=v_sum+v_patient_score*10;v_w:=v_w+10;v_dim_count:=v_dim_count+1;v_total_sample:=v_total_sample+v_patient_sample;
  else v_dims:=v_dims||jsonb_build_array(jsonb_build_object('key','patient_experience','label','تجربة المريض','weight',10,'score',case when v_patient_score is null then null else round(v_patient_score,1) end,'sample',v_patient_sample,'counted',false,'details',jsonb_build_object('minimum_sample',5,'open_comments',v_patient_open)));end if;

  if v_w>0 then v_score:=round(v_sum/v_w,1);end if;
  v_provisional:=v_score is null or v_dim_count<3 or v_total_sample<8;
  v_conf:=case when v_dim_count>=4 and v_total_sample>=20 then 'مرتفعة' when v_dim_count>=3 and v_total_sample>=8 then 'متوسطة' else 'منخفضة' end;
  v_band:=case when v_provisional then 'نتيجة مبدئية' when v_score<60 then 'سيئ' when v_score<75 then 'مقبول' when v_score<85 then 'جيد' else 'ممتاز' end;

  select coalesce(jsonb_agg(jsonb_build_object('id',id,'metric',metric,'severity',severity,'status',status,'affects_score',affects_score,'title',title,'detail',detail,'suggested_action',suggested_action,'evidence',evidence,'source_type',source_type,'source_id',source_id,'detected_at',detected_at,'due_at',due_at) order by case severity when 'critical' then 1 when 'high' then 2 when 'medium' then 3 else 4 end,detected_at desc),'[]'::jsonb)
  into v_issues from (select * from public.performance_evidence where admin_id=subject and status in('open','confirmed') order by detected_at desc limit 30)e;
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'theme',s.theme,'team',s.team,'sentiment',s.sentiment,'severity',s.severity,'confidence',s.confidence,'status',s.status,'detected_at',s.detected_at,'visit_id',s.patient_visit_id) order by s.detected_at desc),'[]'::jsonb)
  into v_feedback from (select * from public.patient_feedback_signals where admin_id=subject and sentiment='negative' and status in('open','confirmed') order by detected_at desc limit 20)s;

  if v_open_issues>0 then v_steps:=v_steps||jsonb_build_array('صحح '||v_open_issues||' مشكلة بيانات مفتوحة؛ التصحيح المبكر يحسن جودة التسجيل.');end if;
  if v_att_score is not null and v_att_score<75 then v_steps:=v_steps||jsonb_build_array('راجع مواعيد الحضور والانصراف وقلل التأخير والخروج المبكر خلال الفترة القادمة.');end if;
  if v_task_score is not null and v_task_score<75 then v_steps:=v_steps||jsonb_build_array('ابدأ بالمهام ذات الموعد الأقرب وسلّم للمراجعة قبل موعد الاستحقاق.');end if;
  if v_task_quality_score is not null and v_task_quality_score<75 then v_steps:=v_steps||jsonb_build_array('راجع المطلوب قبل التسليم لتقليل رجوع المهام للتعديل وتحسين الاعتماد من أول مرة.');end if;
  if v_clinical_score is not null and v_clinical_score<75 then v_steps:=v_steps||jsonb_build_array('أكمل بيانات القياسات الطبية الأساسية قبل إنهاء إدخال الزيارة.');end if;
  if v_role_score is not null and v_role_score<75 then v_steps:=v_steps||jsonb_build_array('ركز على أضعف مؤشر في دورك الوظيفي وراجع مستهدفه داخل تفاصيل الأداء.');end if;
  if v_patient_score is not null and v_patient_sample>=5 and v_patient_score<75 then v_steps:=v_steps||jsonb_build_array('راجع ملاحظات تجربة المرضى المتكررة وركز على وضوح التواصل وجودة الخدمة.');end if;
  if jsonb_array_length(v_steps)=0 and v_score is not null then v_steps:=jsonb_build_array('حافظ على مستوى الأداء الحالي وراقب الاتجاه مقارنة بالفترة السابقة.');end if;

  return jsonb_build_object('admin_id',subject,'name',v_name,'primary_role',v_primary_role,'roles',v_roles,'role_breakdown',v_role_breakdown,
    'from',p_from,'to',p_to,'score',v_score,'band',v_band,'provisional',v_provisional,'confidence',v_conf,'dimensions',v_dims,
    'issues',v_issues,'feedback',v_feedback,'improvement_steps',v_steps,'sample_total',v_total_sample,
    'method','تقييم ومتابعة وتوجيه فقط — لا يرتبط بالخصم أو الرواتب');
end $function$;

CREATE OR REPLACE FUNCTION public.staff_comprehensive_team(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare out jsonb;
begin
  if public.my_admin_id() is null or not (public.has_role('super_admin') or public.has_role('general_manager')) then raise exception 'غير مصرح' using errcode='42501';end if;
  select jsonb_build_object(
    'staff',coalesce(jsonb_agg(public.staff_comprehensive_performance(p_from,p_to,a.id) order by a.name),'[]'::jsonb),
    'unassigned_feedback',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'team',s.team,'theme',s.theme,'severity',s.severity,'confidence',s.confidence,'status',s.status,'detected_at',s.detected_at,'visit_id',s.patient_visit_id) order by s.detected_at desc) from (select * from public.patient_feedback_signals where admin_id is null and sentiment='negative' and status='open' and detected_at>=p_from and detected_at<p_to order by detected_at desc limit 30)s),'[]'::jsonb)
  ) into out from public.admins a where a.active;
  return out;
end $function$;

CREATE OR REPLACE FUNCTION public.staff_kpi_month_data(p_month date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare m date := coalesce(p_month, (date_trunc('month', now() at time zone 'Africa/Cairo') - interval '1 month')::date);
  f timestamptz := (m::timestamp at time zone 'Africa/Cairo');
  t timestamptz := ((m + interval '1 month')::timestamp at time zone 'Africa/Cairo');
  pf timestamptz := ((m - interval '1 month')::timestamp at time zone 'Africa/Cairo');
  out jsonb;
begin
  with cur as (select * from public.staff_kpis_admin(f, t)),
       prv as (select * from public.staff_kpis_admin(pf, f)),
       per as (
         select c.admin_id, c.admin_name, c.admin_role,
                jsonb_agg(jsonb_build_object('kpi', c.kpi, 'label', d.label_ar, 'unit', d.unit, 'direction', d.direction, 'value', round(c.value, 2), 'sample', c.sample, 'target', c.target, 'weight', c.weight, 'score', c.score, 'prev_value', (select round(p.value, 2) from prv p where p.admin_id = c.admin_id and p.kpi = c.kpi and p.sample > 0)) order by d.sort_order) filter (where c.sample > 0) as kpis,
                case when count(c.score) >= 2 then round(sum(c.score * c.weight) filter (where c.score is not null) / nullif(sum(c.weight) filter (where c.score is not null), 0)) end as score,
                bool_or(c.sample > 0) as active
           from cur c join public.kpi_defs d on d.kpi = c.kpi group by c.admin_id, c.admin_name, c.admin_role)
  select jsonb_build_object('month', m, 'from', f, 'to', t,
    'staff', coalesce((select jsonb_agg(jsonb_build_object('admin_id', p.admin_id, 'name', p.admin_name, 'role', p.admin_role, 'score', p.score, 'kpis', p.kpis, 'review', (select jsonb_build_object('rating', r.rating, 'note', r.note) from public.staff_reviews r where r.admin_id = p.admin_id and r.month = m))) from per p where p.active), '[]'::jsonb),
    'inactive', coalesce((select jsonb_agg(p.admin_name) from per p where not p.active), '[]'::jsonb))
  into out;
  return out;
end $function$;

CREATE OR REPLACE FUNCTION public.staff_kpi_scan_alerts()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n int;
begin
  with cand as (
    select r.admin_id, r.admin_name, r.kpi, r.value, r.target, r.score, d.label_ar, d.unit
      from public.staff_kpis_admin(now() - interval '14 days', now()) r
      join public.kpi_defs d on d.kpi = r.kpi
     where r.score is not null and r.score < d.alert_below and r.sample >= greatest(d.min_sample, 1)
       and (r.weight >= 2 or (r.kpi = 'tasks_overdue_now' and r.value >= 3))
  ), ins as (
    insert into public.staff_kpi_alerts(admin_id, kpi, period_end, value, target, score, message)
    select admin_id, kpi, (date_trunc('week', now() at time zone 'Africa/Cairo'))::date, round(value, 1), target, score,
           'تنبيه أداء: ' || admin_name || ' — ' || label_ar || ' ' || round(value, 1) || ' ' || unit || ' مقابل مستهدف ' || target
      from cand
    on conflict (admin_id, kpi, period_end) do nothing
    returning 1)
  select count(*) into n from ins;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.staff_kpis(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(admin_id uuid, admin_name text, admin_role text, kpi text, value numeric, sample integer, target numeric, weight numeric, score numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare v_days numeric;
begin
  if public.my_role() not in ('super_admin','general_manager') then raise exception 'غير مصرح'; end if;
  v_days := greatest(1, extract(epoch from (p_to - p_from)) / 86400.0);
  return query
  with ci as (
    select c.id, c.created_by, c.assigned_designer, c.created_at,
      (select min((e->>'at')::timestamptz) from jsonb_array_elements(coalesce(c.stage_history,'[]'::jsonb)) e where e->>'stage'='initial_approval') as t_init,
      (select min((e->>'at')::timestamptz) from jsonb_array_elements(coalesce(c.stage_history,'[]'::jsonb)) e where e->>'stage'='in_design') as t_design,
      (select min((e->>'at')::timestamptz) from jsonb_array_elements(coalesce(c.stage_history,'[]'::jsonb)) e where e->>'stage'='final_approval') as t_final,
      (select min((e->>'at')::timestamptz) from jsonb_array_elements(coalesce(c.stage_history,'[]'::jsonb)) e where e->>'stage'='ready_to_publish') as t_ready,
      exists(select 1 from public.activity_log a where a.content_id = c.id and a.to_stage = 'needs_revision') as had_rev
    from public.content_items c
  ),
  decisions as (
    select a.actor_id, a.created_at, a.from_stage, a.action,
           a.created_at - lag(a.created_at) over (partition by a.content_id order by a.created_at) as gap
    from public.activity_log a
  ),
  perf as (
    select c.created_by, cp.published_at,
           cp.engagement::numeric / nullif(avg(cp.engagement) over (partition by cp.brand), 0) as ratio
    from public.content_performance(120) cp join public.content_items c on c.id = cp.content_id
  ),
  fc as (
    select distinct on (l.id) l.id, l.received_at, s.changed_by, s.changed_at
    from public.leads l join public.lead_status_log s on s.lead_id = l.id and s.changed_at >= l.received_at
    where l.received_at >= p_from and l.received_at < p_to and s.changed_by is not null
    order by l.id, s.changed_at
  ),
  m(who, k, val, n) as (
    select created_by, 'content_created', count(*)::numeric, count(*)::int from ci where created_at >= p_from and created_at < p_to and created_by is not null group by created_by
    union all select created_by, 'first_pass_rate', 100*avg((not had_rev)::int), count(*)::int from ci where created_at >= p_from and created_at < p_to and t_ready is not null and created_by is not null group by created_by
    union all select created_by, 'idea_to_approval_hours', avg(extract(epoch from (t_ready - t_init))/3600), count(*)::int from ci where t_init >= p_from and t_init < p_to and t_ready >= t_init and created_by is not null group by created_by
    union all select created_by, 'post_engagement_ratio', avg(ratio), count(*)::int from perf where published_at >= p_from and published_at < p_to and ratio is not null and created_by is not null group by created_by
    union all select assigned_designer, 'designs_delivered', count(*)::numeric, count(*)::int from ci where t_final >= p_from and t_final < p_to and assigned_designer is not null group by assigned_designer
    union all select assigned_designer, 'design_turnaround_hours', avg(extract(epoch from (t_final - t_design))/3600), count(*)::int from ci where t_final >= p_from and t_final < p_to and t_design is not null and t_final >= t_design and assigned_designer is not null group by assigned_designer
    union all select assigned_designer, 'design_first_pass_rate', 100*avg((not had_rev)::int), count(*)::int from ci where t_final >= p_from and t_final < p_to and assigned_designer is not null group by assigned_designer
    union all select actor_id, 'approval_response_hours', avg(extract(epoch from gap)/3600), count(*)::int from decisions where gap is not null and created_at >= p_from and created_at < p_to and from_stage in ('initial_approval','final_approval') and (action in ('اعتماد نهائي','اعتماد','طلب تعديل') or action like 'اعتماد أولي%') and actor_id is not null group by actor_id
    union all select actor_id, 'approvals_done', count(*)::numeric, count(*)::int from decisions where created_at >= p_from and created_at < p_to and from_stage in ('initial_approval','final_approval') and (action in ('اعتماد نهائي','اعتماد','طلب تعديل') or action like 'اعتماد أولي%') and actor_id is not null group by actor_id
    union all select employee_id, 'lead_attempts', count(*)::numeric, count(*)::int from public.lead_attempts where attempt_date >= p_from and attempt_date < p_to and employee_id is not null group by employee_id
    union all select changed_by, 'lead_first_contact_minutes', avg(extract(epoch from (changed_at - received_at))/60), count(*)::int from fc group by changed_by
    union all select booked_by, 'bookings_made', count(*)::numeric, count(*)::int from public.leads where booked_by is not null and booking_date >= p_from::date and booking_date < p_to::date group by booked_by
    union all select assignee_id, 'tasks_on_time_rate', 100*avg((completed_at <= due_at)::int), count(*)::int from public.tasks where status = 'done' and completed_at >= p_from and completed_at < p_to and due_at is not null group by assignee_id
    union all select assignee_id, 'tasks_overdue_now', (count(*) filter (where due_at < now()))::numeric, count(*)::int from public.tasks where status <> 'done' and assignee_id is not null group by assignee_id
  )
  select a.id, a.name, a.role, d.kpi, mm.val, coalesce(mm.n, 0),
         round(t.target * case when d.scales then v_days/30 else 1 end, 1), t.weight,
         case when mm.val is null or coalesce(mm.n, 0) < d.min_sample then null
              when d.direction = 'higher' then least(100, round(100 * mm.val / nullif(t.target * case when d.scales then v_days/30 else 1 end, 0), 1))
              else case when mm.val <= t.target then 100 else least(100, round(100 * t.target / nullif(mm.val, 0), 1)) end end
    from public.admins a
    join public.kpi_targets t on t.role = a.role
    join public.kpi_defs d on d.kpi = t.kpi
    left join m mm on mm.who = a.id and mm.k = d.kpi
   where a.active
   order by a.name, d.sort_order;
end $function$;

CREATE OR REPLACE FUNCTION public.staff_kpis_admin(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(admin_id uuid, admin_name text, admin_role text, kpi text, value numeric, sample integer, target numeric, weight numeric, score numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare au uuid;
begin
  select a.user_id into au from public.admins a where a.role = 'super_admin' and a.active order by a.created_at limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', au, 'role', 'authenticated')::text, true);
  return query select * from public.staff_kpis(p_from, p_to);
end $function$;

CREATE OR REPLACE FUNCTION public.staff_summary_fallback(p_month date DEFAULT NULL::date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare d jsonb; x jsonb; best jsonb; worst jsonb; n int := 0; m date;
begin
  d := public.staff_kpi_month_data(p_month);
  m := (d->>'month')::date;
  for x in select * from jsonb_array_elements(d->'staff') loop
    continue when exists (select 1 from public.staff_monthly_summaries s where s.admin_id = (x->>'admin_id')::uuid and s.month = m);
    select k into best from jsonb_array_elements(x->'kpis') k where k->>'score' is not null order by (k->>'score')::numeric desc, (k->>'weight')::numeric desc limit 1;
    select k into worst from jsonb_array_elements(x->'kpis') k where k->>'score' is not null order by (k->>'score')::numeric asc, (k->>'weight')::numeric desc limit 1;
    perform public.staff_summary_save((x->>'admin_id')::uuid, m,
      case when best is null then 'بيانات الشهر غير كافية لتحديد نقطة قوة.' else 'أقوى نقطة: ' || (best->>'label') || ' — ' || (best->>'value') || ' ' || (best->>'unit') || ' مقابل مستهدف ' || (best->>'target') || '.' end,
      case when worst is null or (worst->>'score')::numeric >= 80 then 'مفيش نقطة ضعف واضحة هذا الشهر.' else 'أضعف نقطة: ' || (worst->>'label') || ' — ' || (worst->>'value') || ' ' || (worst->>'unit') || ' مقابل مستهدف ' || (worst->>'target') || '.' end,
      case when worst is null or (worst->>'score')::numeric >= 80 then 'استمر على نفس الإيقاع وراجع المستهدفات الشهر الجاي.' else 'ركّز الشهر الجاي على «' || (worst->>'label') || '» وراجع مع المسؤول سبب الفرق عن المستهدف.' end,
      'system');
    n := n + 1;
  end loop;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.staff_summary_save(p_admin uuid, p_month date, p_strength text, p_improve text, p_action text, p_source text DEFAULT 'claude'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare d jsonb; s jsonb;
begin
  if p_source not in ('claude','system') then raise exception 'bad source'; end if;
  d := public.staff_kpi_month_data(p_month);
  select x into s from jsonb_array_elements(d->'staff') x where x->>'admin_id' = p_admin::text;
  insert into public.staff_monthly_summaries(admin_id, month, strength, improve, action, score, kpis, source)
  values (p_admin, date_trunc('month', p_month)::date, left(coalesce(p_strength,''), 800), left(coalesce(p_improve,''), 800), left(coalesce(p_action,''), 800), nullif(s->>'score','')::int, coalesce(s->'kpis','[]'::jsonb), p_source)
  on conflict (admin_id, month) do update set strength = excluded.strength, improve = excluded.improve, action = excluded.action, score = excluded.score, kpis = excluded.kpis, source = excluded.source, created_at = now();
end $function$;

CREATE OR REPLACE FUNCTION public.task_checklist_add(p_task_id uuid, p_body text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid;
begin
  if public.my_admin_id() is null or not public.task_can_access(p_task_id) then raise exception 'Not allowed'; end if;
  insert into public.task_checklist_items(task_id, body, sort_order, created_by)
    values (p_task_id, trim(p_body), coalesce((select max(sort_order)+1 from public.task_checklist_items where task_id=p_task_id),0), public.my_admin_id())
    returning id into v_id;
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.task_checklist_counts(p_task_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return coalesce((select jsonb_object_agg(x.task_id, jsonb_build_object('total',x.total,'done',x.done)) from (
    select c.task_id, count(*) total, count(*) filter (where c.done) done
      from public.task_checklist_items c
     where c.task_id = any(p_task_ids) and c.removed_at is null and public.task_can_access(c.task_id)
     group by c.task_id) x),'{}'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION public.task_checklist_list(p_task_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.task_can_access(p_task_id) then raise exception 'Not allowed'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'body',c.body,'done',c.done,'done_at',c.done_at) order by c.sort_order, c.created_at)
    from public.task_checklist_items c where c.task_id=p_task_id and c.removed_at is null),'[]'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION public.task_checklist_remove(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_task uuid;
begin
  select task_id into v_task from public.task_checklist_items where id=p_id and removed_at is null;
  if v_task is null or public.my_admin_id() is null or not public.task_can_access(v_task) then raise exception 'Not allowed'; end if;
  update public.task_checklist_items set removed_at=now() where id=p_id;
end $function$;

CREATE OR REPLACE FUNCTION public.task_checklist_toggle(p_id uuid, p_done boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_task uuid;
begin
  select task_id into v_task from public.task_checklist_items where id=p_id and removed_at is null;
  if v_task is null or public.my_admin_id() is null or not public.task_can_access(v_task) then raise exception 'Not allowed'; end if;
  update public.task_checklist_items set done=coalesce(p_done,false),
    done_by=case when coalesce(p_done,false) then public.my_admin_id() else null end,
    done_at=case when coalesce(p_done,false) then now() else null end where id=p_id;
end $function$;

CREATE OR REPLACE FUNCTION public.upcoming_health_occasions(p_days integer DEFAULT 28)
 RETURNS TABLE(name text, starts_on date, ends_on date, specialty text, note text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select o.name, x.s, (x.s + o.span_days - 1), o.specialty, o.note
    from public.health_occasions o
   cross join lateral (select make_date(coalesce(o.year, extract(year from current_date)::int + k), o.month, least(o.day, 28)) + (o.day - least(o.day, 28)) as s
                         from generate_series(0, 1) k where o.year is null or k = 0) x
   where x.s <= current_date + p_days and (x.s + o.span_days - 1) >= current_date
   order by x.s;
$function$;

CREATE OR REPLACE FUNCTION public.weekly_marketing_report_data(p_days integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_to timestamptz := now();
  v_from timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days,7), 31)));
  v_prev timestamptz := now() - make_interval(days => 2*greatest(1, least(coalesce(p_days,7), 31)));
  v_pub jsonb; v_totals jsonb; v_prev_totals jsonb; v_top jsonb; v_low jsonb; v_fmt jsonb; v_hours jsonb;
  v_sched jsonb; v_ads jsonb; v_leads jsonb; v_msgs jsonb; v_tasks jsonb; v_pending jsonb; v_followers jsonb;
begin
  -- المحتوى المنشور في الفترة (+ الروابط والأرقام)
  select coalesce(jsonb_agg(x order by x->>'published_at' desc), '[]'::jsonb) into v_pub from (
    select jsonb_build_object('id', c.id, 'title', c.title, 'brand', c.brand, 'format', c.content_format, 'published_at', c.published_at,
      'by_claude', c.created_by = 'a0fbdfee-d147-4282-b988-186a9ae3e88c', 'url', coalesce(j.facebook_permalink, j.instagram_permalink, c.published_url),
      'fb_url', j.facebook_permalink, 'ig_url', j.instagram_permalink,
      'reach', coalesce(i.fb_reach,0) + coalesce(i.ig_reach,0), 'views', coalesce(i.fb_views,0) + coalesce(i.ig_views,0),
      'reactions', coalesce(i.fb_reactions,0) + coalesce(i.ig_likes,0), 'comments', coalesce(i.fb_comments,0) + coalesce(i.ig_comments,0),
      'shares', coalesce(i.fb_shares,0) + coalesce(i.ig_shares,0), 'saves', coalesce(i.ig_saves,0),
      'interactions', coalesce(i.fb_reactions,0)+coalesce(i.fb_comments,0)+coalesce(i.fb_shares,0)+coalesce(i.ig_interactions,0)) x
    from public.content_items c
    left join public.post_insights i on i.content_id = c.id
    left join lateral (select facebook_permalink, instagram_permalink from public.meta_publish_jobs where content_id = c.id and status = 'published' order by published_at desc nulls last limit 1) j on true
    where c.stage = 'published' and c.published_at >= v_from and c.published_at <= v_to
  ) s;

  select jsonb_build_object('posts', count(*), 'reach', coalesce(sum(coalesce(i.fb_reach,0)+coalesce(i.ig_reach,0)),0),
      'interactions', coalesce(sum(coalesce(i.fb_reactions,0)+coalesce(i.fb_comments,0)+coalesce(i.fb_shares,0)+coalesce(i.ig_interactions,0)),0),
      'claude_posts', count(*) filter (where c.created_by = 'a0fbdfee-d147-4282-b988-186a9ae3e88c'),
      'staff_posts', count(*) filter (where c.created_by <> 'a0fbdfee-d147-4282-b988-186a9ae3e88c'))
    into v_totals
    from public.content_items c left join public.post_insights i on i.content_id = c.id
   where c.stage = 'published' and c.published_at >= v_from and c.published_at <= v_to;
  select jsonb_build_object('posts', count(*), 'reach', coalesce(sum(coalesce(i.fb_reach,0)+coalesce(i.ig_reach,0)),0),
      'interactions', coalesce(sum(coalesce(i.fb_reactions,0)+coalesce(i.fb_comments,0)+coalesce(i.fb_shares,0)+coalesce(i.ig_interactions,0)),0))
    into v_prev_totals
    from public.content_items c left join public.post_insights i on i.content_id = c.id
   where c.stage = 'published' and c.published_at >= v_prev and c.published_at < v_from;

  -- أفضل وأضعف 3 منشورات بالتفاعل
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_top from (select e as x from jsonb_array_elements(v_pub) e order by (e->>'interactions')::int desc limit 3) s;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_low from (select e as x from jsonb_array_elements(v_pub) e where (e->>'reach')::int > 0 order by (e->>'interactions')::numeric / nullif((e->>'reach')::numeric,0) asc nulls last limit 3) s;

  -- أداء كل نوع محتوى + أفضل ساعات النشر (توقيت القاهرة)
  select coalesce(jsonb_agg(jsonb_build_object('format', f, 'posts', n, 'avg_reach', round(r), 'avg_interactions', round(it)) order by it desc), '[]'::jsonb) into v_fmt from (
    select e->>'format' f, count(*) n, avg((e->>'reach')::numeric) r, avg((e->>'interactions')::numeric) it from jsonb_array_elements(v_pub) e group by 1) s;
  select coalesce(jsonb_agg(jsonb_build_object('hour', h, 'posts', n, 'avg_interactions', round(it)) order by it desc), '[]'::jsonb) into v_hours from (
    select extract(hour from (e->>'published_at')::timestamptz at time zone 'Africa/Cairo')::int h, count(*) n, avg((e->>'interactions')::numeric) it from jsonb_array_elements(v_pub) e group by 1) s;

  -- المجدول للأسبوع الجاي
  select coalesce(jsonb_agg(jsonb_build_object('title', title, 'brand', brand, 'format', content_format, 'at', scheduled_publish_at) order by scheduled_publish_at), '[]'::jsonb) into v_sched
    from public.content_items where stage = 'scheduled' and scheduled_publish_at between v_to and v_to + interval '7 days';
  -- بانتظار الاعتماد/المراجعة
  select coalesce(jsonb_agg(jsonb_build_object('title', title, 'brand', brand, 'stage', stage, 'format', content_format, 'since', updated_at) order by updated_at), '[]'::jsonb) into v_pending
    from public.content_items where stage in ('initial_approval','final_approval','needs_revision','ready_to_publish');

  -- إعلانات (آخر استيراد من ميتا) + عدد النتائج
  select coalesce(jsonb_agg(jsonb_build_object('name', campaign_name, 'objective', objective, 'spent', amount_spent, 'reach', reach, 'results', results, 'indicator', result_indicator, 'cost_per_result', cost_per_result, 'ctr', ctr, 'from', reporting_start, 'to', reporting_end) order by amount_spent desc nulls last), '[]'::jsonb) into v_ads
    from public.ad_campaigns;

  -- ليدز الأسبوع (أعداد بس، من غير أي بيانات شخصية)
  select jsonb_build_object('new_leads', count(*) filter (where created_at >= v_from), 'from_ads', count(*) filter (where created_at >= v_from and (meta_campaign_id is not null or acquisition_type ilike '%ad%' or acquisition_type ilike '%paid%' or acquisition_type ilike '%إعلان%')),
      'booked', count(*) filter (where booking_date >= v_from::date and booking_date <= v_to::date),
      'prev_new_leads', count(*) filter (where created_at >= v_prev and created_at < v_from)) into v_leads from public.leads;
  select jsonb_build_object('messages', count(*) filter (where updated_at >= v_from), 'needing_reply', count(*) filter (where status = 'new')) into v_msgs from public.social_messages;

  -- متابعين (إدخال يدوي أسبوعي)
  select coalesce(jsonb_agg(jsonb_build_object('week', week_start, 'reach', reach, 'engagement_rate', engagement_rate, 'new_followers', new_followers) order by week_start desc), '[]'::jsonb) into v_followers
    from (select * from public.weekly_social_metrics order by week_start desc limit 4) w;

  -- مهام مشروع التسويق (حالة كل مهمة + مسؤولها)
  select coalesce(jsonb_agg(jsonb_build_object('title', t.title, 'status', t.status, 'assignee', a.name, 'due', t.due_at, 'overdue', t.status <> 'done' and t.due_at < now(), 'updated_at', t.updated_at) order by t.due_at), '[]'::jsonb) into v_tasks
    from public.tasks t left join public.admins a on a.id = t.assignee_id
   where t.project_id = '1b618cc4-7e28-4d9d-bb0a-17f3bdf71f32' and t.title <> 'التقرير الأسبوعي لتسويق سونو';

  return jsonb_build_object(
    'period', jsonb_build_object('from', v_from, 'to', v_to, 'days', greatest(1, least(coalesce(p_days,7), 31))),
    'totals', v_totals, 'previous_totals', v_prev_totals, 'published', v_pub, 'top_posts', v_top, 'weakest_posts', v_low,
    'by_format', v_fmt, 'by_hour_cairo', v_hours, 'scheduled_next_7_days', v_sched, 'waiting_approval', v_pending,
    'ads', v_ads, 'leads', v_leads, 'social_messages', v_msgs, 'weekly_social_metrics', v_followers, 'marketing_project_tasks', v_tasks);
end $function$;

CREATE OR REPLACE FUNCTION public.weekly_midweek_nudge()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.weekly_reports; total int; open_n int; rec record; n int := 0; mgr uuid;
  proj uuid := '1b618cc4-7e28-4d9d-bb0a-17f3bdf71f32';
begin
  select * into r from public.weekly_reports where week_end >= current_date - 10 order by week_end desc, created_at desc limit 1;
  if not found then return 0; end if;
  select count(*), count(*) filter (where status <> 'done') into total, open_n
    from public.tasks where project_id = proj and description like '%[weekly:' || r.id || ':%';
  if total = 0 or open_n = 0 then return 0; end if;
  select manager_id into mgr from public.task_projects where id = proj;
  for rec in
    select distinct on (assignee_id) assignee_id, id, title,
           count(*) over (partition by assignee_id) as mine
      from public.tasks
     where project_id = proj and description like '%[weekly:' || r.id || ':%' and status <> 'done'
     order by assignee_id, due_at
  loop
    insert into public.task_notifications(recipient_id, task_id, kind, message)
      values (rec.assignee_id, rec.id, 'due_soon', 'تذكير منتصف الأسبوع: عندك ' || rec.mine || ' من مقترحات تقرير الجمعة لسه مفتوحة — أقربها: ' || rec.title)
      on conflict do nothing;
    n := n + 1;
  end loop;
  if mgr is not null then
    select id into rec.id from public.tasks where project_id = proj and description like '%[weekly:' || r.id || ':%' and status <> 'done' order by due_at limit 1;
    insert into public.task_notifications(recipient_id, task_id, kind, message)
      values (mgr, rec.id, 'due_soon', 'منتصف الأسبوع: ' || open_n || ' من ' || total || ' مقترحات تقرير الجمعة لسه مفتوحة')
      on conflict do nothing;
    n := n + 1;
  end if;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.weekly_proposals_to_tasks(p_report_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.weekly_reports; it jsonb; i int := 0; n int := 0;
  proj uuid := '1b618cc4-7e28-4d9d-bb0a-17f3bdf71f32';
  claude uuid := 'a0fbdfee-d147-4282-b988-186a9ae3e88c';
  mgr uuid; assg uuid; v_id uuid; marker text; due timestamptz; owner text; ttl text;
begin
  select * into r from public.weekly_reports where id = p_report_id;
  if not found then raise exception 'weekly report not found'; end if;
  select manager_id into mgr from public.task_projects where id = proj;
  for it in select * from jsonb_array_elements(case when jsonb_typeof(r.priorities) = 'array' then r.priorities else '[]'::jsonb end) loop
    i := i + 1;
    exit when i > 6;
    ttl := left(trim(coalesce(it->>'title', '')), 180);
    if ttl = '' then continue; end if;
    marker := '[weekly:' || p_report_id || ':' || i || ']';
    if exists (select 1 from public.tasks where project_id = proj and description like '%' || marker || '%') then continue; end if;
    owner := trim(coalesce(it->>'owner', ''));
    assg := null;
    if owner <> '' then select id into assg from public.admins where active and name ilike '%' || owner || '%' order by name limit 1; end if;
    assg := coalesce(assg, mgr, claude);
    due := ((current_date + coalesce(nullif(it->>'due_days', '')::int, 5)) + time '22:59') at time zone 'Africa/Cairo';
    insert into public.tasks(project_id, title, description, expected_output, assignee_id, created_by, due_at, priority)
      values (proj, ttl, left(coalesce(it->>'why', ''), 1500) || E'\n' || marker, left(coalesce(it->>'expected', ''), 600), assg, claude, due, 'normal')
      returning id into v_id;
    insert into public.task_project_members(project_id, admin_id, role_name) values (proj, assg, 'contributor') on conflict (project_id, admin_id) do nothing;
    if assg <> claude then
      insert into public.task_notifications(recipient_id, task_id, kind, message) values (assg, v_id, 'assigned', 'تم إسناد مهمة جديدة إليك: ' || ttl) on conflict do nothing;
    end if;
    n := n + 1;
  end loop;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.weekly_report_fallback()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_task record; v_uid uuid; v_d jsonb; v_top jsonb; v_body text; v_pct numeric; v_prev numeric; v_cur numeric;
  c_marker constant text := '📊 تقرير آلي مبسّط';
begin
  select t.id, t.status, t.due_at into v_task from public.tasks t
   where t.title = 'التقرير الأسبوعي لتسويق سونو' and t.status in ('todo','in_progress','revision')
   order by t.due_at asc limit 1;
  if not found then return 'no open task'; end if;
  if v_task.due_at is null or v_task.due_at > now() + interval '150 minutes' then return 'not yet due'; end if;
  if exists (select 1 from public.task_updates u where u.task_id = v_task.id and u.body like c_marker || '%') then return 'already posted'; end if;
  select user_id into v_uid from public.admins where id = 'a0fbdfee-d147-4282-b988-186a9ae3e88c';
  if v_uid is null then return 'no claude account'; end if;

  v_d := public.weekly_marketing_report_data(7);
  v_cur := coalesce((v_d->'totals'->>'reach')::numeric, 0); v_prev := coalesce((v_d->'previous_totals'->>'reach')::numeric, 0);
  v_pct := case when v_prev > 0 then round((v_cur - v_prev) * 100 / v_prev) else null end;
  v_top := v_d->'top_posts'->0;
  v_body := c_marker || E' (التحليل الكامل لم يكتمل في الميعاد، وده ملخص أرقام الأسبوع)\n' ||
    '• منشورات آخر 7 أيام: ' || (v_d->'totals'->>'posts') || ' (Claude ' || (v_d->'totals'->>'claude_posts') || ' · الفريق ' || (v_d->'totals'->>'staff_posts') || E')\n' ||
    '• الوصول: ' || (v_d->'totals'->>'reach') || coalesce(' (' || case when v_pct >= 0 then '+' else '' end || v_pct || '% عن الأسبوع اللي قبله)', '') || E'\n' ||
    '• التفاعل: ' || (v_d->'totals'->>'interactions') || E'\n' ||
    '• ليدز جديدة: ' || (v_d->'leads'->>'new_leads') || ' · حجوزات: ' || (v_d->'leads'->>'booked') || E'\n' ||
    '• مجدول للأسبوع الجاي: ' || jsonb_array_length(v_d->'scheduled_next_7_days') || ' · بانتظار الاعتماد: ' || jsonb_array_length(v_d->'waiting_approval') || E'\n' ||
    case when v_top is not null then '• أفضل منشور: ' || (v_top->>'title') || coalesce(' — ' || (v_top->>'url'), '') || E'\n' else '' end ||
    '• التقرير التفصيلي هيتسلّم أول ما يتاح.';
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  perform public.task_add_comment(v_task.id, v_body, '[]'::jsonb);
  insert into public.weekly_reports(week_start, week_end, summary, source)
    values ((now() - interval '7 days')::date, now()::date, v_body, 'fallback') on conflict do nothing;
  return 'posted';
end $function$;
