-- LIVE CAPTURE (2026-11-07): definitions read from production with pg_get_functiondef (read-only).
-- Reference snapshot of objects that had no CREATE under supabase/. NOT a migration: do not apply blindly.
-- Grants, owners and triggers are not included.
-- public part A: administrative_assistant_payroll_audit .. clinic_reception_pbx_event

CREATE OR REPLACE FUNCTION public.administrative_assistant_payroll_audit(p_month date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  dt date := coalesce(date_trunc('month',p_month)::date,date_trunc('month',current_date)::date);
begin
  if not public.business_manager() then raise exception 'غير مصرح'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc)
    from (
      select
        br.id,
        br.subject,
        br.amount,
        br.status,
        br.created_at,
        br.payload->>'month' as month,
        coalesce((br.payload->'hr_calculation'->>'base')::numeric,0) as base_salary,
        coalesce((br.payload->'hr_calculation'->>'allowance')::numeric,0) as allowance,
        coalesce((br.payload->'hr_calculation'->>'salary_deduction')::numeric,0) as salary_deduction,
        coalesce((br.payload->'hr_calculation'->>'late_minutes')::numeric,0) as late_minutes,
        coalesce((br.payload->'hr_calculation'->>'absent_shifts')::int,0) as absent_shifts,
        coalesce((br.payload->'hr_calculation'->>'approved_shifts')::int,0) as approved_shifts,
        prev.amount as previous_amount,
        case when prev.amount is null then null else round(br.amount-prev.amount,2) end as amount_difference,
        (br.payload->'hr_calculation' is null) as missing_hr_calculation,
        (
          br.payload->'hr_calculation' is null
          or coalesce((br.payload->'hr_calculation'->>'salary_deduction')::numeric,0) < 0
          or (coalesce((br.payload->'hr_calculation'->>'absent_shifts')::int,0)>0 and coalesce((br.payload->'hr_calculation'->>'salary_deduction')::numeric,0)=0)
          or (prev.amount is not null and br.amount<>prev.amount)
        ) as requires_owner_review,
        case
          when br.payload->'hr_calculation' is null then 'كشف المرتب لا يحتوي على حساب الموارد البشرية المعتمد'
          when coalesce((br.payload->'hr_calculation'->>'absent_shifts')::int,0)>0 and coalesce((br.payload->'hr_calculation'->>'salary_deduction')::numeric,0)=0 then 'يوجد غياب مسجل ولا يظهر خصم في حساب المرتب؛ يحتاج قرار المالك'
          when prev.amount is not null and br.amount<>prev.amount then 'قيمة المرتب مختلفة عن آخر كشف؛ اعرض الفرق على المالك'
          else 'مطابق للفحص الأولي ويمكن اعتباره طبيعيًا إذا لم توجد ملاحظات أخرى'
        end as assistant_reason
      from clinic_finance.business_requests br
      left join lateral (
        select p.amount
        from clinic_finance.business_requests p
        where p.kind='payroll' and p.subject=br.subject and p.id<>br.id and p.status='approved' and p.created_at<br.created_at
        order by p.created_at desc limit 1
      ) prev on true
      where br.kind='payroll'
        and coalesce(nullif(br.payload->>'month','')::date,date_trunc('month',br.created_at)::date)=dt
        and br.status in ('pending','approved')
    ) x
  ),'[]'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION public.agent_match_patients_by_phone(p_last10 text)
 RETURNS TABLE(id uuid, full_name text, gender text, last_visit_date date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.id, p.full_name, p.gender, p.last_visit_date
  from public.patients p
  where length(p_last10) = 10
    and (right(regexp_replace(coalesce(p.phone,''), '\D', '', 'g'), 10) = p_last10
         or right(regexp_replace(coalesce(p.phone_normalized,''), '\D', '', 'g'), 10) = p_last10)
  order by p.last_visit_date desc nulls last
  limit 4;
$function$;

CREATE OR REPLACE FUNCTION public.ai_clip_auto_enqueue()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  begin
    if new.content_format = 'video' and new.stage = 'in_design' and old.stage is distinct from new.stage then
      insert into public.ai_clip_jobs(content_id, title, source, model, seconds)
        select new.id, coalesce(new.title, ''), 'auto', s.default_model, s.clip_seconds
          from public.ai_clip_settings s where s.enabled and s.auto_enqueue
        on conflict do nothing;
    end if;
  exception when others then null;
  end;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.ai_clip_cancel(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.my_role() not in ('super_admin','general_manager','designer') then raise exception 'Not allowed'; end if;
  update public.ai_clip_jobs set status = 'cancelled', updated_at = now() where id = p_id and status = 'queued';
end $function$;

CREATE OR REPLACE FUNCTION public.ai_clip_overview(p_content_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_s public.ai_clip_settings%rowtype; v_spent numeric; v_jobs jsonb; v_price numeric;
begin
  if public.my_role() not in ('super_admin','general_manager','designer','page_manager') then raise exception 'Not allowed'; end if;
  select * into v_s from public.ai_clip_settings limit 1;
  v_spent := public.ai_clip_month_spent_egp();
  select usd_per_second into v_price from public.ai_clip_prices where model = v_s.default_model;
  select coalesce(jsonb_agg(to_jsonb(j) order by j.created_at desc), '[]'::jsonb) into v_jobs from (
    select id, content_id, title, source, status, model, seconds, error, drive_url, est_cost_usd, usd_to_egp_at_submit, created_at, completed_at
      from public.ai_clip_jobs
     where (p_content_id is null or content_id = p_content_id)
     order by created_at desc limit 30) j;
  return jsonb_build_object(
    'settings', jsonb_build_object('enabled', v_s.enabled, 'auto_enqueue', v_s.auto_enqueue, 'monthly_budget_egp', v_s.monthly_budget_egp,
        'usd_to_egp', v_s.usd_to_egp, 'default_model', v_s.default_model, 'clip_seconds', v_s.clip_seconds),
    'spent_egp', round(v_spent, 2),
    'remaining_egp', greatest(0, round(v_s.monthly_budget_egp - v_spent, 2)),
    'est_clip_egp', round(coalesce(v_price, 0) * v_s.clip_seconds * v_s.usd_to_egp, 2),
    'can_request', public.my_role() in ('super_admin','general_manager','designer'),
    'is_super', public.is_super(),
    'jobs', v_jobs);
end $function$;

CREATE OR REPLACE FUNCTION public.ai_clip_request(p_content_id uuid, p_prompt text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_s public.ai_clip_settings%rowtype; v_id uuid; v_title text;
begin
  if public.my_role() not in ('super_admin','general_manager','designer') then raise exception 'Not allowed'; end if;
  select * into v_s from public.ai_clip_settings limit 1;
  if not v_s.enabled then raise exception 'توليد اللقطات متوقف من الإعدادات'; end if;
  if (select count(*) from public.ai_clip_jobs where status in ('queued','submitted') and requested_by = public.my_admin_id()) >= 3 then
    raise exception 'عندك 3 لقطات قيد التوليد بالفعل، استنى لما تخلص';
  end if;
  select title into v_title from public.content_items where id = p_content_id;
  insert into public.ai_clip_jobs(content_id, title, source, prompt, model, seconds, requested_by)
    values (p_content_id, coalesce(v_title, ''), 'manual', nullif(trim(coalesce(p_prompt, '')), ''), v_s.default_model, v_s.clip_seconds, public.my_admin_id())
    returning id into v_id;
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.ai_clip_save_settings(p_enabled boolean, p_auto boolean, p_budget_egp numeric, p_usd_to_egp numeric, p_model text, p_seconds integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_super() then raise exception 'Not allowed'; end if;
  if not exists (select 1 from public.ai_clip_prices where model = p_model) then raise exception 'نموذج غير معروف'; end if;
  update public.ai_clip_settings set enabled = p_enabled, auto_enqueue = p_auto, monthly_budget_egp = p_budget_egp,
    usd_to_egp = p_usd_to_egp, default_model = p_model, clip_seconds = p_seconds, updated_at = now() where id;
end $function$;

CREATE OR REPLACE FUNCTION public.capture_administrative_assistant_mention()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.body ~* '(@المساعد[[:space:]]*الإداري|@المساعد|@administrative[[:space:]]+assistant)' then
    insert into public.administrative_assistant_requests(source,source_update_id,task_id,requester_id,body,priority,status)
    values ('task_mention',new.id,new.task_id,new.author_id,new.body,'normal','pending')
    on conflict (source_update_id) do nothing;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.claude_autoschedule_approved()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r record; slot timestamptz; n int := 0; tries int; h int;
  claude_id uuid := 'a0fbdfee-d147-4282-b988-186a9ae3e88c';
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  for r in
    select * from (
      select distinct on (c.id) c.id, c.brand, c.updated_at, q.suggested_publish_at
        from public.content_items c
        join public.claude_design_requests q on q.content_id = c.id
       where c.stage = 'ready_to_publish' and q.status = 'done'
         and c.brand in ('sono','dr_dina')
         and coalesce((to_jsonb(c)->>'claude_hold')::boolean, false) = false
         and c.updated_at < now() - interval '2 hours'
         and not exists (select 1 from public.meta_publish_jobs j where j.content_id = c.id and j.status in ('pending','processing','published','partial'))
       order by c.id, q.updated_at desc
    ) x order by x.updated_at limit 10
  loop
    slot := greatest(coalesce(r.suggested_publish_at, now()), now() + interval '30 minutes');
    tries := 0;
    loop
      h := extract(hour from (slot at time zone 'Africa/Cairo'))::int;
      if h < 9 then
        slot := (date_trunc('day', slot at time zone 'Africa/Cairo') + interval '9 hours') at time zone 'Africa/Cairo';
      elsif h >= 23 then
        slot := (date_trunc('day', slot at time zone 'Africa/Cairo') + interval '1 day 9 hours') at time zone 'Africa/Cairo';
      end if;
      exit when tries >= 30 or not exists (
        select 1 from public.meta_publish_jobs j
         where j.brand = r.brand and j.status in ('pending','processing','published','partial')
           and j.scheduled_at between slot - interval '3 hours' and slot + interval '3 hours');
      slot := slot + interval '1 hour';
      tries := tries + 1;
    end loop;
    update public.content_items set stage = 'scheduled', scheduled_publish_at = slot, scheduled_by = claude_id where id = r.id;
    insert into public.meta_publish_jobs(content_id, brand, scheduled_at, publish_facebook, publish_instagram, created_by)
      values (r.id, r.brand, slot, true, true, claude_id);
    update public.claude_design_requests set status = 'scheduled', updated_at = now() where content_id = r.id and status = 'done';
    n := n + 1;
  end loop;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.clinic_finance_insurance_claim_v2(p_invoice uuid, p_contract uuid, p_plan uuid, p_service uuid, p_reference text, p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare me uuid:=clinic_finance.require_access('create'); i clinic_finance.invoices%rowtype; c clinic_finance.insurance_claims%rowtype; q jsonb; used numeric; claim_amount numeric; v uuid; acct text;begin
 perform clinic_finance.lock_day();
 select * into c from clinic_finance.insurance_claims where created_by=me and token=p_token;
 if found then return to_jsonb(c);end if;
 select * into i from clinic_finance.invoices where id=p_invoice for update;
 if not found or i.voided or (i.created_by<>me and not clinic_finance.allowed('review')) then raise exception 'الفاتورة غير متاحة';end if;
 q:=public.insurance_quote(p_service,p_contract,p_plan,i.created_at::date);
 claim_amount:=(q->>'insurer_net')::numeric;
 if claim_amount<=0 then raise exception 'لا يوجد صافي مستحق على شركة التأمين لهذه الخدمة';end if;
 select coalesce((select sum(amount) from clinic_finance.payments where invoice_id=i.id),0)+coalesce((select sum(amount) from clinic_finance.insurance_claims where invoice_id=i.id and status<>'cancelled'),0) into used;
 if used+claim_amount>i.amount then raise exception 'صافي المطالبة يتجاوز المتبقي على الفاتورة';end if;
 acct:=coalesce(nullif(q->>'account_code',''),'1121');
 insert into clinic_finance.insurance_claims(invoice_id,reference,insurer,amount,created_by,token,contract_id,insurance_plan_id,service_id,center_price,contracted_price,contractual_discount,patient_copay,receivable_account_code)
 values(i.id,trim(p_reference),q->>'insurer',claim_amount,me,p_token,p_contract,p_plan,p_service,(q->>'center_price')::numeric,(q->>'contracted_price')::numeric,(q->>'contractual_discount')::numeric,(q->>'patient_copay')::numeric,acct) returning id into v;
 perform clinic_finance.post('insurance_claim',v,'نقل صافي مطالبة '||trim(p_reference),null,acct,'1122',claim_amount);
 update clinic_finance.invoices set bill_payload=coalesce(bill_payload,'{}'::jsonb)||jsonb_build_object('insurance',q,'claim_id',v) where id=i.id;
 insert into clinic_finance.audit(actor,action,entity_id) values(me,'insurance_claim_v2',v);
 return q||jsonb_build_object('claim_id',v,'claim_amount',claim_amount,'claim_status','submitted');
end $function$;

CREATE OR REPLACE FUNCTION public.clinic_info_access()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.has_role('super_admin') or public.has_role('general_manager') or public.has_role('page_manager')
      or public.has_role('approver') or public.has_role('customer_service') or public.has_role('reception');
$function$;

CREATE OR REPLACE FUNCTION public.clinic_info_edit()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.has_role('super_admin') or public.has_role('general_manager') or public.has_role('page_manager') or public.has_role('customer_service');
$function$;

CREATE OR REPLACE FUNCTION public.clinic_reception_agent_context(p_phone text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
WITH input AS (
 SELECT regexp_replace(p_phone,'[^0-9]','','g') AS digits
), canonical AS (
 SELECT CASE WHEN digits LIKE '00%' THEN substr(digits,3)
 WHEN length(digits)=11 AND digits LIKE '01%' THEN '2'||digits ELSE digits END AS phone FROM input
), candidates AS (
 SELECT jsonb_build_object(
 'workspace_id',a.workspace_id,'appointment_id',a.id,'patient_id',a.patient_id,
 'patient_name',p.name,'provider_id',a.provider_id,'provider_name',pr.name,
 'starts_at',a.starts_at,'appointment_status',a.status,'queue_status',q.status,'visit_id',v.id,
 'doctor_session_status',ds.status,'eta_minutes',ds.eta_minutes,
 'doctor_status_updated_at',ds.updated_at) AS value,
 abs(extract(epoch from(a.starts_at-now()))) AS proximity
 FROM clinic_reception.appointments a
 JOIN clinic_reception.workspaces w ON w.id=a.workspace_id AND w.mode='live'
 JOIN clinic_reception.patients p ON p.id=a.patient_id
 JOIN clinic_reception.providers pr ON pr.id=a.provider_id
 LEFT JOIN clinic_reception.queue_entries q ON q.appointment_id=a.id
 LEFT JOIN clinic_reception.visits v ON v.appointment_id=a.id
 LEFT JOIN clinic_reception.doctor_sessions ds ON ds.workspace_id=a.workspace_id AND ds.provider_id=a.provider_id
  AND ds.session_date=(a.starts_at AT TIME ZONE 'Africa/Cairo')::date
 CROSS JOIN canonical c
 CROSS JOIN LATERAL (SELECT regexp_replace(p.phone,'[^0-9]','','g') AS digits) pd
 WHERE length(c.phone) BETWEEN 8 AND 15 AND
 (CASE WHEN pd.digits LIKE '00%' THEN substr(pd.digits,3)
 WHEN length(pd.digits)=11 AND pd.digits LIKE '01%' THEN '2'||pd.digits ELSE pd.digits END)=c.phone
 AND a.starts_at BETWEEN now()-interval '1 day' AND now()+interval '14 days'
 AND a.status NOT IN ('cancelled','no_show')
 ORDER BY proximity,a.id LIMIT 20
), aggregate AS (
 SELECT coalesce(jsonb_agg(value ORDER BY proximity),'[]'::jsonb) AS items FROM candidates
)
SELECT CASE WHEN jsonb_array_length(items)=0 THEN '{}'::jsonb
 ELSE (items->0)||jsonb_build_object('ambiguous',jsonb_array_length(items)>1,'candidates',items) END
FROM aggregate;
$function$;

CREATE OR REPLACE FUNCTION public.clinic_reception_agent_event(p_appointment uuid, p_event_type text, p_payload jsonb DEFAULT '{}'::jsonb, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare a clinic_reception.appointments%rowtype; v clinic_reception.visits%rowtype; ev uuid; h uuid; rating int; actor uuid;
begin
  if p_event_type not in ('patient.on_the_way','patient.help_requested','feedback.completed') then
    raise exception 'Unsupported agent event';
  end if;
  if p_idempotency_key is not null then
    select id into ev from clinic_reception.journey_events where idempotency_key=p_idempotency_key limit 1;
    if ev is not null then return jsonb_build_object('event_id',ev,'duplicate',true); end if;
  end if;
  select * into a from clinic_reception.appointments where id=p_appointment;
  if not found then raise exception 'Appointment not found'; end if;
  select * into v from clinic_reception.visits where appointment_id=a.id;
  select owner_id into actor from clinic_reception.workspaces where id=a.workspace_id;

  if p_event_type='patient.on_the_way' then
    update clinic_reception.queue_entries set status='on_the_way',updated_at=now() where appointment_id=a.id and status='expected';
  elsif p_event_type='patient.help_requested' then
    insert into clinic_reception.help_requests(workspace_id,appointment_id,visit_id,patient_id,kind,message,metadata)
    values(a.workspace_id,a.id,v.id,a.patient_id,coalesce(nullif(p_payload->>'kind',''),'assistance'),nullif(p_payload->>'message',''),coalesce(p_payload,'{}'::jsonb)||jsonb_build_object('source','whatsapp')) returning id into h;
  elsif p_event_type='feedback.completed' then
    rating:=nullif(p_payload->>'rating','')::int;
    if rating not between 1 and 5 then raise exception 'Rating must be 1-5'; end if;
    if exists(select 1 from clinic_reception.patients p where p.id=a.patient_id and p.patient_id is not null) then
      insert into public.patient_experience_ratings(patient_id,visit_date,ratings,comment,created_by,patient_visit_id,source)
      select p.patient_id,(coalesce(v.opened_at,a.starts_at) at time zone 'Africa/Cairo')::date,jsonb_build_array(jsonb_build_object('metric','overall','rating',rating)),coalesce(p_payload->>'comment',''),null,v.archive_visit_id,'whatsapp'
      from clinic_reception.patients p where p.id=a.patient_id;
    end if;
  end if;

  insert into clinic_reception.journey_events(workspace_id,appointment_id,visit_id,patient_id,provider_id,event_type,actor_id,source,idempotency_key,metadata)
  values(a.workspace_id,a.id,v.id,a.patient_id,a.provider_id,p_event_type,null,'whatsapp',p_idempotency_key,coalesce(p_payload,'{}'::jsonb)||case when h is not null then jsonb_build_object('help_request_id',h) else '{}'::jsonb end)
  returning id into ev;

  if p_event_type='patient.help_requested' then
    perform clinic_reception.queue_journey_message(
      a.workspace_id,
      a.id,
      'help_ack',
      'وصل طلب مساعدتك لفريق الاستقبال وسيتم التعامل معه.',
      ev::text,
      actor,
      jsonb_build_object('event_id',ev,'source','whatsapp','help_request_id',h)
    );
  end if;

  return jsonb_build_object('event_id',ev,'appointment_id',a.id,'help_request_id',h);
end $function$;

CREATE OR REPLACE FUNCTION public.clinic_reception_agent_health()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
select jsonb_build_object(
  'live_enabled',s.live_enabled,
  'communications_enabled',s.communications_enabled,
  'pilot_only',s.pilot_only,
  'workspace_id',w.id,
  'pending_messages',(select count(*) from clinic_reception.outbox o where o.workspace_id=w.id and o.status='approved' and o.delivered_at is null),
  'failed_messages',(select count(*) from clinic_reception.outbox o where o.workspace_id=w.id and o.status='approved' and o.delivered_at is null and o.attempts>=5),
  'open_help_requests',(select count(*) from clinic_reception.help_requests h where h.workspace_id=w.id and h.status in ('open','acknowledged')),
  'unresolved_missed_calls',(select count(*) from clinic_reception.call_events c where c.workspace_id=w.id and c.status='missed' and c.resolved_at is null)
)
from clinic_reception.workspaces w cross join clinic_reception.settings s
where w.mode='live' and s.id
order by w.created_at limit 1
$function$;

CREATE OR REPLACE FUNCTION public.clinic_reception_agent_set_communications(p_enabled boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare result jsonb;
begin
  if not exists(select 1 from clinic_reception.workspaces where mode='live') then raise exception 'No live workspace'; end if;
  update clinic_reception.settings set communications_enabled=p_enabled where id;
  select public.clinic_reception_agent_health() into result;
  return result;
end $function$;

CREATE OR REPLACE FUNCTION public.clinic_reception_call_command(p_workspace uuid, p_action text, p_call uuid, p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare me uuid; c clinic_reception.call_events%rowtype; ev uuid;
begin
  me:=clinic_reception.access(p_workspace,'execute');
  select * into c from clinic_reception.call_events where id=p_call and workspace_id=p_workspace for update;
  if not found then raise exception 'Call event not found'; end if;
  if p_action='resolve' then
    update clinic_reception.call_events set resolved_at=coalesce(resolved_at,now()),resolved_by=coalesce(resolved_by,me),updated_at=now() where id=c.id;
    if c.appointment_id is not null then
      insert into clinic_reception.journey_events(workspace_id,appointment_id,visit_id,patient_id,provider_id,event_type,actor_id,source,idempotency_key,metadata)
      select c.workspace_id,a.id,v.id,a.patient_id,a.provider_id,'call.followup_completed',me,'dashboard','call-resolve:'||p_token::text,jsonb_build_object('call_id',c.id)
      from clinic_reception.appointments a left join clinic_reception.visits v on v.appointment_id=a.id where a.id=c.appointment_id
      on conflict(workspace_id,idempotency_key) where idempotency_key is not null do nothing
      returning id into ev;
    end if;
    return jsonb_build_object('id',c.id,'resolved',true,'event_id',ev);
  end if;
  raise exception 'Unsupported call action';
end $function$;

CREATE OR REPLACE FUNCTION public.clinic_reception_call_command_live(p_action text, p_call uuid, p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare ws uuid;
begin
  select id into ws from clinic_reception.workspaces where mode='live' order by created_at limit 1;
  if ws is null then raise exception 'No live workspace'; end if;
  return public.clinic_reception_call_command(ws,p_action,p_call,p_token);
end $function$;

CREATE OR REPLACE FUNCTION public.clinic_reception_calls_snapshot(p_workspace uuid, p_day date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare me uuid; d date;
begin
  me:=clinic_reception.access(p_workspace,'view');
  d:=coalesce(p_day,clinic_reception.today());
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',c.id,'appointment_id',c.appointment_id,'patient_id',c.patient_id,'patient_name',p.name,
      'direction',c.direction,'status',c.status,'provider',c.provider,'caller',c.caller,'callee',c.callee,
      'started_at',c.started_at,'answered_at',c.answered_at,'ended_at',c.ended_at,'duration_seconds',c.duration_seconds,
      'resolved_at',c.resolved_at,'metadata',c.metadata
    ) order by c.started_at desc)
    from clinic_reception.call_events c
    left join clinic_reception.patients p on p.id=c.patient_id
    where c.workspace_id=p_workspace and (c.started_at at time zone 'Africa/Cairo')::date between d-1 and d
  ),'[]'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION public.clinic_reception_calls_snapshot_live(p_day date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare ws uuid;
begin
  select id into ws from clinic_reception.workspaces where mode='live' order by created_at limit 1;
  if ws is null then return '[]'::jsonb; end if;
  return public.clinic_reception_calls_snapshot(ws,p_day);
end $function$;

CREATE OR REPLACE FUNCTION public.clinic_reception_checkin_candidates(p_phone text, p_lat double precision, p_lng double precision, p_accuracy double precision DEFAULT NULL::double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare s clinic_reception.journey_settings%rowtype; ws uuid; dist double precision; result jsonb;
begin
  select w.id into ws
  from clinic_reception.workspaces w
  join clinic_reception.settings st on st.id=w.id
  where w.mode='live' and st.live_enabled
  order by w.created_at
  limit 1;
  if ws is null then return '[]'::jsonb; end if;
  select * into s from clinic_reception.journey_settings where workspace_id=ws;
  if coalesce(s.location_required,true) then
    if s.clinic_lat is null or s.clinic_lng is null then raise exception 'موقع المركز لم يتم اعتماده بعد لتسجيل الوصول بالـ QR'; end if;
    if p_lat is null or p_lng is null then raise exception 'فعّل الموقع لإكمال تسجيل الوصول'; end if;
    dist:=6371000*2*asin(sqrt(power(sin(radians(p_lat-s.clinic_lat)/2),2)+cos(radians(s.clinic_lat))*cos(radians(p_lat))*power(sin(radians(p_lng-s.clinic_lng)/2),2)));
    if dist>s.radius_meters+least(coalesce(p_accuracy,0),100) then raise exception 'أنت خارج نطاق المركز المسموح لتسجيل الوصول'; end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('appointment_id',a.id,'starts_at',a.starts_at,'provider_name',pr.name,'service_name',sv.name) order by a.starts_at),'[]'::jsonb)
  into result
  from clinic_reception.appointments a
  join clinic_reception.workspaces w on w.id=a.workspace_id and w.mode='live'
  join clinic_reception.patients p on p.id=a.patient_id
  join clinic_reception.providers pr on pr.id=a.provider_id
  join clinic_reception.services sv on sv.id=a.service_id
  where a.workspace_id=ws
    and regexp_replace(p.phone,'\\D','','g')=regexp_replace(p_phone,'\\D','','g')
    and length(regexp_replace(p_phone,'\\D','','g'))>=8
    and (a.starts_at at time zone 'Africa/Cairo')::date=clinic_reception.today()
    and a.status in ('booked','arrived');
  return result;
end $function$;

CREATE OR REPLACE FUNCTION public.clinic_reception_checkin_public(p_token uuid, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision, p_accuracy double precision DEFAULT NULL::double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare t clinic_reception.checkin_tokens%rowtype; a clinic_reception.appointments%rowtype; s clinic_reception.journey_settings%rowtype; actor uuid; v clinic_reception.visits%rowtype; svc clinic_reception.services%rowtype; pat clinic_reception.patients%rowtype; ext uuid; dist double precision; ev uuid;
begin
  select * into t from clinic_reception.checkin_tokens where token=p_token for update;
  if not found or t.used_at is not null or t.expires_at<now() then raise exception 'رابط تسجيل الوصول غير صالح أو انتهت صلاحيته'; end if;
  select * into a from clinic_reception.appointments where id=t.appointment_id and workspace_id=t.workspace_id for update;
  if not found or a.status not in ('booked','arrived') then raise exception 'الحجز غير متاح لتسجيل الوصول'; end if;
  if now()<a.starts_at-interval '4 hours' or now()>a.ends_at+interval '6 hours' then raise exception 'تسجيل الوصول خارج الفترة المسموح بها'; end if;
  select * into s from clinic_reception.journey_settings where workspace_id=t.workspace_id;
  if coalesce(s.location_required,true) then
    if s.clinic_lat is null or s.clinic_lng is null then raise exception 'موقع المركز لم يتم اعتماده بعد لتسجيل الوصول بالـ QR'; end if;
    if p_lat is null or p_lng is null then raise exception 'فعّل الموقع لإكمال تسجيل الوصول'; end if;
    dist:=6371000*2*asin(sqrt(power(sin(radians(p_lat-s.clinic_lat)/2),2)+cos(radians(s.clinic_lat))*cos(radians(p_lat))*power(sin(radians(p_lng-s.clinic_lng)/2),2)));
    if dist>s.radius_meters+least(coalesce(p_accuracy,0),100) then
      insert into clinic_reception.help_requests(workspace_id,appointment_id,patient_id,kind,message,metadata)
      values(t.workspace_id,a.id,a.patient_id,'location_verification','محاولة تسجيل وصول من خارج نطاق المركز',jsonb_build_object('distance_meters',round(dist::numeric,1),'accuracy',p_accuracy));
      raise exception 'أنت خارج نطاق المركز المسموح لتسجيل الوصول';
    end if;
  end if;
  select owner_id into actor from clinic_reception.workspaces where id=t.workspace_id;
  select * into v from clinic_reception.visits where appointment_id=a.id;
  if v.id is null then
    insert into clinic_reception.visits(workspace_id,appointment_id,patient_id,opened_by) values(t.workspace_id,a.id,a.patient_id,actor) returning * into v;
    select * into svc from clinic_reception.services where id=a.service_id;
    insert into clinic_reception.orders(workspace_id,visit_id,service_id,provider_id,price,snapshot,created_by) values(t.workspace_id,v.id,svc.id,a.provider_id,svc.price,to_jsonb(svc),actor);
    update clinic_reception.appointments set status='arrived',arrived_at=now() where id=a.id;
    if (select mode from clinic_reception.workspaces where id=t.workspace_id)='live' then
      select * into pat from clinic_reception.patients where id=a.patient_id;
      if pat.patient_id is not null then
        insert into public.patient_visits(patient_id,visit_number,visit_date,created_by,encounter_type) values(pat.patient_id,'RX-'||v.visit_no,(v.opened_at at time zone 'Africa/Cairo')::date,actor,'checkup') returning id into ext;
        update public.patient_visits set doctor_name=(select name from clinic_reception.providers where id=a.provider_id),specialty=svc.department where id=ext;
        update clinic_reception.visits set archive_visit_id=ext where id=v.id;
      end if;
    end if;
  end if;
  update clinic_reception.checkin_tokens set used_at=now(),request_lat=p_lat,request_lng=p_lng,request_accuracy=p_accuracy,distance_meters=dist where id=t.id;
  update clinic_reception.queue_entries set visit_id=v.id,status='waiting',queued_at=coalesce(queued_at,now()),checkin_method='qr',location_verified=case when s.clinic_lat is null or s.clinic_lng is null then null else true end,updated_at=now() where appointment_id=a.id;
  insert into clinic_reception.journey_events(workspace_id,appointment_id,visit_id,patient_id,provider_id,event_type,actor_id,source,idempotency_key,metadata)
  values(t.workspace_id,a.id,v.id,a.patient_id,a.provider_id,'patient.arrived',null,'qr','qr:'||t.id::text,jsonb_build_object('distance_meters',dist,'accuracy',p_accuracy)) returning id into ev;
  perform clinic_reception.queue_journey_message(t.workspace_id,a.id,'journey_arrived','تم تسجيل وصولك إلى المركز. أنت الآن ضمن قائمة الانتظار وسنبلغك عند دورك.',ev::text,actor,jsonb_build_object('event_id',ev,'source','qr'));
  return jsonb_build_object('ok',true,'patient_name',(select name from clinic_reception.patients where id=a.patient_id),'provider_name',(select name from clinic_reception.providers where id=a.provider_id),'appointment_id',a.id);
end $function$;

CREATE OR REPLACE FUNCTION public.clinic_reception_checkin_static(p_appointment uuid, p_phone text, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision, p_accuracy double precision DEFAULT NULL::double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare a clinic_reception.appointments%rowtype; actor uuid; tok uuid;begin
  select a.* into a
  from clinic_reception.appointments a
  join clinic_reception.workspaces w on w.id=a.workspace_id and w.mode='live'
  join clinic_reception.patients p on p.id=a.patient_id
  where a.id=p_appointment
    and a.status in ('booked','arrived')
    and (a.starts_at at time zone 'Africa/Cairo')::date=clinic_reception.today()
    and regexp_replace(p.phone,'\\D','','g')=regexp_replace(p_phone,'\\D','','g')
    and length(regexp_replace(p_phone,'\\D','','g'))>=8
  for update of a;
  if not found then raise exception 'لم نجد حجز اليوم بهذه البيانات'; end if;
  select owner_id into actor from clinic_reception.workspaces where id=a.workspace_id;
  insert into clinic_reception.checkin_tokens(workspace_id,appointment_id,expires_at,created_by)
  values(a.workspace_id,a.id,now()+interval '10 minutes',actor) returning token into tok;
  return public.clinic_reception_checkin_public(tok,p_lat,p_lng,p_accuracy);
end $function$;

CREATE OR REPLACE FUNCTION public.clinic_reception_journey_prepare_finish(p_workspace uuid, p_appointment uuid, p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  me uuid;
  a clinic_reception.appointments%rowtype;
  v clinic_reception.visits%rowtype;
  o clinic_reception.orders%rowtype;
  open_count integer;
  simple_primary boolean;
  exec_result jsonb;
  workspace_mode text;
  previous_sandbox text:=current_setting('clinic_reception.sandbox_workspace',true);
begin
  select mode into workspace_mode from clinic_reception.workspaces where id=p_workspace;
  if workspace_mode is null then raise exception 'مساحة العمل غير متاحة'; end if;
  if workspace_mode='trial' then
    perform clinic_reception.sandbox_access(p_workspace);
    perform set_config('clinic_reception.sandbox_workspace',p_workspace::text,true);
  end if;
  me:=clinic_reception.access(p_workspace,'execute');
  if p_token is null then raise exception 'طلب غير صالح'; end if;
  select * into a from clinic_reception.appointments where id=p_appointment and workspace_id=p_workspace;
  if not found then raise exception 'الحجز غير متاح'; end if;
  select * into v from clinic_reception.visits where appointment_id=a.id and status='open';
  if not found then raise exception 'الزيارة غير متاحة'; end if;

  select count(*) into open_count from clinic_reception.orders where visit_id=v.id and status='ordered';
  if open_count=0 then
    if workspace_mode='trial' then perform set_config('clinic_reception.sandbox_workspace',coalesce(previous_sandbox,''),true); end if;
    return jsonb_build_object('ready',true,'auto_executed',false);
  end if;

  if open_count=1 then
    select * into o from clinic_reception.orders where visit_id=v.id and status='ordered' limit 1;
    simple_primary:=o.service_id=a.service_id
      and coalesce((o.snapshot->>'requires_device')::boolean,false)=false
      and jsonb_array_length(coalesce(o.snapshot->'bom','[]'::jsonb))=0;
    if simple_primary then
      exec_result:=public.clinic_reception_command(
        p_workspace,'execute',
        jsonb_build_object('id',o.id,'provider_id',a.provider_id,'materials','[]'::jsonb),
        p_token
      );
      if workspace_mode='trial' then perform set_config('clinic_reception.sandbox_workspace',coalesce(previous_sandbox,''),true); end if;
      return jsonb_build_object('ready',true,'auto_executed',true,'execution',exec_result);
    end if;
  end if;

  if workspace_mode='trial' then perform set_config('clinic_reception.sandbox_workspace',coalesce(previous_sandbox,''),true); end if;
  return jsonb_build_object(
    'ready',false,
    'auto_executed',false,
    'open_orders',(
      select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.snapshot->>'name','department',x.snapshot->>'department')),'[]'::jsonb)
      from clinic_reception.orders x where x.visit_id=v.id and x.status='ordered'
    )
  );
exception when others then
  if workspace_mode='trial' then perform set_config('clinic_reception.sandbox_workspace',coalesce(previous_sandbox,''),true); end if;
  raise;
end
$function$;

CREATE OR REPLACE FUNCTION public.clinic_reception_journey_request_service(p_workspace uuid, p_appointment uuid, p_service uuid, p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  me uuid;
  workspace_mode text;
  previous_sandbox text:=current_setting('clinic_reception.sandbox_workspace',true);
  a clinic_reception.appointments%rowtype;
  v clinic_reception.visits%rowtype;
  s clinic_reception.services%rowtype;
  order_id uuid;
  event_id uuid;
  event_type text;
begin
  select mode into workspace_mode from clinic_reception.workspaces where id=p_workspace;
  if workspace_mode is null then raise exception 'مساحة العمل غير متاحة'; end if;
  if workspace_mode='trial' then
    perform clinic_reception.sandbox_access(p_workspace);
    perform set_config('clinic_reception.sandbox_workspace',p_workspace::text,true);
  end if;

  me:=clinic_reception.access(p_workspace,'execute');
  if p_token is null then raise exception 'طلب غير صالح'; end if;

  select id into event_id from clinic_reception.journey_events
  where workspace_id=p_workspace and idempotency_key='service-request:'||p_token::text;
  if event_id is not null then
    select (metadata->>'order_id')::uuid into order_id from clinic_reception.journey_events where id=event_id;
    if workspace_mode='trial' then perform set_config('clinic_reception.sandbox_workspace',coalesce(previous_sandbox,''),true); end if;
    return jsonb_build_object('order_id',order_id,'event_id',event_id,'duplicate',true);
  end if;

  select * into a from clinic_reception.appointments
  where id=p_appointment and workspace_id=p_workspace;
  if not found or a.status not in ('arrived','completed') then raise exception 'الحجز غير متاح لطلب خدمة'; end if;

  select * into v from clinic_reception.visits
  where appointment_id=a.id and workspace_id=p_workspace and status='open';
  if not found then raise exception 'الزيارة غير مفتوحة'; end if;

  select * into s from clinic_reception.services
  where id=p_service and workspace_id=p_workspace and active;
  if not found then raise exception 'الخدمة غير متاحة'; end if;

  insert into clinic_reception.orders(
    workspace_id,visit_id,service_id,provider_id,quantity,price,snapshot,created_by
  ) values(
    p_workspace,v.id,s.id,null,1,s.price,to_jsonb(s),me
  ) returning id into order_id;

  event_type:=case clinic_reception.diagnostic_result_type(to_jsonb(s))
    when 'lab_result' then 'lab.requested'
    when 'radiology' then 'imaging.requested'
    else case when lower(coalesce(s.department,'')||' '||coalesce(s.name,'')) ~ '(علاج طبيعي|physio|physical therapy|rehab)'
      then 'physio.requested' else 'service.requested' end
  end;

  insert into clinic_reception.journey_events(
    workspace_id,appointment_id,visit_id,patient_id,provider_id,event_type,actor_id,source,idempotency_key,metadata
  ) values(
    p_workspace,a.id,v.id,a.patient_id,a.provider_id,event_type,me,'dashboard','service-request:'||p_token::text,
    jsonb_build_object('order_id',order_id,'service_id',s.id,'service_name',s.name,'provider_required_at_execution',true)
  ) returning id into event_id;

  insert into clinic_reception.audit(workspace_id,actor_id,action,entity_id)
  values(p_workspace,me,'journey_request_service',order_id);

  if workspace_mode='trial' then perform set_config('clinic_reception.sandbox_workspace',coalesce(previous_sandbox,''),true); end if;
  return jsonb_build_object('order_id',order_id,'event_id',event_id,'event_type',event_type);
exception when others then
  if workspace_mode='trial' then perform set_config('clinic_reception.sandbox_workspace',coalesce(previous_sandbox,''),true); end if;
  raise;
end
$function$;

CREATE OR REPLACE FUNCTION public.clinic_reception_journey_reschedule(p_workspace uuid, p_appointment uuid, p_starts_at timestamp with time zone, p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  a clinic_reception.appointments%rowtype;
  payload jsonb;
  result jsonb;
  me uuid;
  ev uuid;
  body text;
begin
  me:=clinic_reception.access(p_workspace,'book');
  if p_token is null then raise exception 'طلب غير صالح'; end if;
  select * into a from clinic_reception.appointments
  where id=p_appointment and workspace_id=p_workspace and status='booked' for update;
  if not found then raise exception 'الحجز غير متاح لتغيير الموعد'; end if;

  payload:=jsonb_strip_nulls(jsonb_build_object(
    'id',a.id,'patient_id',a.patient_id,'provider_id',a.provider_id,'service_id',a.service_id,
    'starts_at',p_starts_at,'source',a.source,'source_evidence',a.source_evidence,
    'package_id',a.package_id,'package_visit_no',a.package_visit_no,'device_id',a.device_id
  ));
  result:=public.clinic_reception_command(p_workspace,'reschedule',payload,p_token);

  insert into clinic_reception.journey_events(
    workspace_id,appointment_id,visit_id,patient_id,provider_id,event_type,actor_id,source,idempotency_key,metadata
  ) values(
    p_workspace,a.id,(select id from clinic_reception.visits where appointment_id=a.id),a.patient_id,a.provider_id,
    'appointment.rescheduled',me,'dashboard','reschedule:'||p_token::text,
    jsonb_build_object('old_starts_at',a.starts_at,'new_starts_at',p_starts_at)
  ) on conflict do nothing returning id into ev;

  select * into a from clinic_reception.appointments where id=p_appointment;
  body:='تم تعديل موعدك في سونو إلى '||to_char(a.starts_at at time zone 'Africa/Cairo','YYYY-MM-DD HH24:MI')||'.';
  perform clinic_reception.queue_journey_message(
    p_workspace,a.id,'reschedule',body,a.starts_at::text||':'||a.status,me,
    jsonb_build_object('event_id',ev,'starts_at',a.starts_at,'action','appointment_rescheduled')
  );

  return result||jsonb_build_object('event_id',ev,'starts_at',a.starts_at);
end
$function$;

CREATE OR REPLACE FUNCTION public.clinic_reception_journey_reschedule_slots(p_workspace uuid, p_appointment uuid, p_day date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  a clinic_reception.appointments%rowtype;
  mins integer;
  result jsonb;
begin
  perform clinic_reception.access(p_workspace,'book');
  select * into a from clinic_reception.appointments
  where id=p_appointment and workspace_id=p_workspace and status='booked';
  if not found then raise exception 'الحجز غير متاح لتغيير الموعد'; end if;
  mins:=greatest(5,ceil(extract(epoch from (a.ends_at-a.starts_at))/60)::int);

  with slots as (
    select gs as starts_at, gs+make_interval(mins=>mins) as ends_at
    from clinic_reception.availability av
    cross join lateral generate_series(
      av.starts_at,
      av.ends_at-make_interval(mins=>mins),
      make_interval(mins=>mins)
    ) gs
    where av.workspace_id=p_workspace
      and av.provider_id=a.provider_id
      and (gs at time zone 'Africa/Cairo')::date=p_day
  ), free as (
    select s.* from slots s
    where not exists(
      select 1 from clinic_reception.appointments other
      where other.workspace_id=p_workspace
        and other.provider_id=a.provider_id
        and other.id<>a.id
        and other.status not in ('cancelled','no_show')
        and other.starts_at<s.ends_at and other.ends_at>s.starts_at
    )
  )
  select jsonb_build_object(
    'appointment_id',a.id,
    'provider_id',a.provider_id,
    'service_id',a.service_id,
    'current_starts_at',a.starts_at,
    'day',p_day,
    'slots',coalesce(jsonb_agg(jsonb_build_object('starts_at',starts_at) order by starts_at),'[]'::jsonb)
  ) into result from free;
  return result;
end
$function$;

CREATE OR REPLACE FUNCTION public.clinic_reception_journey_snapshot(p_workspace uuid, p_day date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare me uuid; d date; result jsonb;
begin
  me:=clinic_reception.access(p_workspace,'view');
  d:=coalesce(p_day,clinic_reception.today());
  select jsonb_build_object(
    'day',d,
    'settings',coalesce((select to_jsonb(s)-'updated_by' from clinic_reception.journey_settings s where s.workspace_id=p_workspace),'{}'::jsonb),
    'appointments',coalesce((select jsonb_agg(x order by x.starts_at,x.priority desc,x.patient_name) from (
      select a.id,a.patient_id,p.name patient_name,p.file_no,p.phone,a.provider_id,pr.name provider_name,pr.department,a.service_id,s.name service_name,a.starts_at,a.ends_at,a.status appointment_status,a.arrived_at,
             v.id visit_id,v.visit_no,v.status visit_status,
             q.id queue_id,coalesce(q.status,case when a.status='arrived' then 'waiting' when a.status='completed' then 'completed' when a.status='cancelled' then 'cancelled' when a.status='no_show' then 'no_show' else 'expected' end) queue_status,
             coalesce(q.priority,0) priority,q.priority_reason,q.queued_at,q.called_at,q.service_started_at,q.service_ended_at,q.checkin_method,q.location_verified,
             case when q.queued_at is not null and q.service_started_at is null and q.status in ('waiting','called','on_hold') then greatest(0,floor(extract(epoch from (now()-q.queued_at))/60))::int else 0 end wait_minutes
      from clinic_reception.appointments a
      join clinic_reception.patients p on p.id=a.patient_id
      join clinic_reception.providers pr on pr.id=a.provider_id
      join clinic_reception.services s on s.id=a.service_id
      left join clinic_reception.visits v on v.appointment_id=a.id
      left join clinic_reception.queue_entries q on q.appointment_id=a.id
      where a.workspace_id=p_workspace and (a.starts_at at time zone 'Africa/Cairo')::date=d
    ) x),'[]'::jsonb),
    'doctor_sessions',coalesce((select jsonb_agg(to_jsonb(ds)||jsonb_build_object('provider_name',pr.name,'department',pr.department) order by pr.name) from clinic_reception.doctor_sessions ds join clinic_reception.providers pr on pr.id=ds.provider_id where ds.workspace_id=p_workspace and ds.session_date=d),'[]'::jsonb),
    'help_requests',coalesce((select jsonb_agg(to_jsonb(h)||jsonb_build_object('patient_name',p.name,'provider_name',pr.name) order by h.created_at desc) from clinic_reception.help_requests h join clinic_reception.patients p on p.id=h.patient_id join clinic_reception.appointments a on a.id=h.appointment_id join clinic_reception.providers pr on pr.id=a.provider_id where h.workspace_id=p_workspace and h.status in ('open','acknowledged') and (a.starts_at at time zone 'Africa/Cairo')::date=d),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.event_at desc) from (select * from clinic_reception.journey_events where workspace_id=p_workspace and (event_at at time zone 'Africa/Cairo')::date=d order by event_at desc limit 300) e),'[]'::jsonb),
    'outbox',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'appointment_id',o.appointment_id,'kind',o.kind,'status',o.status,'created_at',o.created_at,'delivered_at',o.delivered_at,'last_error',o.last_error) order by o.created_at desc) from clinic_reception.outbox o join clinic_reception.appointments a on a.id=o.appointment_id where o.workspace_id=p_workspace and o.kind in ('journey_arrived','queue_called','doctor_delay','feedback_request','help_ack','followup_reminder') and (a.starts_at at time zone 'Africa/Cairo')::date between d-1 and d+1),'[]'::jsonb)
  ) into result;
  return result;
end $function$;

CREATE OR REPLACE FUNCTION public.clinic_reception_pbx_event(p_provider text, p_external_call_id text, p_direction text, p_status text, p_caller text DEFAULT NULL::text, p_callee text DEFAULT NULL::text, p_started_at timestamp with time zone DEFAULT now(), p_answered_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_ended_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_duration_seconds integer DEFAULT NULL::integer, p_recording_url text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare ws uuid; phone text; pat clinic_reception.patients%rowtype; appt clinic_reception.appointments%rowtype; callid uuid; ev uuid;
begin
  if p_direction not in ('inbound','outbound') then raise exception 'Invalid direction'; end if;
  if p_status not in ('ringing','answered','missed','completed','failed','busy','cancelled') then raise exception 'Invalid status'; end if;
  if nullif(trim(p_external_call_id),'') is null then raise exception 'External call id required'; end if;
  if not exists(select 1 from clinic_reception.settings s where s.id and s.live_enabled) then raise exception 'Reception live mode is disabled'; end if;
  select w.id into ws from clinic_reception.workspaces w where w.mode='live' order by w.created_at limit 1;
  if ws is null then raise exception 'No live workspace'; end if;
  phone:=case when p_direction='inbound' then p_caller else p_callee end;
  if nullif(regexp_replace(coalesce(phone,''),'\\D','','g'),'') is not null then
    select * into pat from clinic_reception.patients p where p.workspace_id=ws and right(regexp_replace(p.phone,'\\D','','g'),10)=right(regexp_replace(phone,'\\D','','g'),10) order by p.updated_at desc limit 1;
  end if;
  if pat.id is not null then
    select * into appt from clinic_reception.appointments a where a.workspace_id=ws and a.patient_id=pat.id and a.starts_at between p_started_at-interval '2 days' and p_started_at+interval '14 days' order by abs(extract(epoch from (a.starts_at-p_started_at))) limit 1;
  end if;

  insert into clinic_reception.call_events(workspace_id,appointment_id,patient_id,direction,status,provider,external_call_id,caller,callee,started_at,answered_at,ended_at,duration_seconds,recording_url,metadata,updated_at)
  values(ws,appt.id,pat.id,p_direction,p_status,coalesce(nullif(p_provider,''),'pbx'),p_external_call_id,p_caller,p_callee,coalesce(p_started_at,now()),p_answered_at,p_ended_at,p_duration_seconds,p_recording_url,coalesce(p_metadata,'{}'::jsonb),now())
  on conflict(provider,external_call_id) do update set
    status=excluded.status,appointment_id=coalesce(clinic_reception.call_events.appointment_id,excluded.appointment_id),patient_id=coalesce(clinic_reception.call_events.patient_id,excluded.patient_id),
    caller=coalesce(excluded.caller,clinic_reception.call_events.caller),callee=coalesce(excluded.callee,clinic_reception.call_events.callee),
    answered_at=coalesce(excluded.answered_at,clinic_reception.call_events.answered_at),ended_at=coalesce(excluded.ended_at,clinic_reception.call_events.ended_at),
    duration_seconds=coalesce(excluded.duration_seconds,clinic_reception.call_events.duration_seconds),recording_url=coalesce(excluded.recording_url,clinic_reception.call_events.recording_url),
    metadata=clinic_reception.call_events.metadata||excluded.metadata,updated_at=now()
  returning id into callid;

  if appt.id is not null and p_status in ('missed','completed','answered') then
    insert into clinic_reception.journey_events(workspace_id,appointment_id,visit_id,patient_id,provider_id,event_type,source,idempotency_key,metadata)
    values(ws,appt.id,(select id from clinic_reception.visits where appointment_id=appt.id),appt.patient_id,appt.provider_id,'call.'||p_status,'system','pbx:'||coalesce(nullif(p_provider,''),'pbx')||':'||p_external_call_id||':'||p_status,jsonb_build_object('call_id',callid,'direction',p_direction,'phone',phone))
    on conflict(workspace_id,idempotency_key) where idempotency_key is not null do nothing
    returning id into ev;
  end if;
  return jsonb_build_object('call_id',callid,'workspace_id',ws,'patient_id',pat.id,'appointment_id',appt.id,'event_id',ev);
end $function$;
