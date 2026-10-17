-- Read the same operational rows from existing dashboard modules. No invoice/receipt copies.
create index if not exists reception_attribution_lead on clinic_reception.attributions(lead_id,appointment_id);
create index if not exists reception_provider_employee on clinic_reception.orders(executed_by,completed_at) where status='completed';
create function public.clinic_reception_shared_records(p_context text,p_id uuid default null,p_from date default null,p_to date default null,p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare me uuid:=public.my_admin_id();pf date:=coalesce(p_from,(now() at time zone 'Africa/Cairo')::date-30);pt date:=coalesce(p_to,(now() at time zone 'Africa/Cairo')::date+case when p_context in ('patient','lead') then 30 else 0 end);pid uuid;financial boolean:=false;manager boolean:=false;reviewer boolean:=false;outcome jsonb;
begin
 if me is null or not exists(select 1 from public.admins where id=me and active) then raise exception 'سجل الدخول' using errcode='42501';end if;
 if pt<pf or pt-pf>366 or p_offset<0 or p_offset>100000 then raise exception 'راجع الفترة والصفحة';end if;
 manager:=public.operations_manager();reviewer:=clinic_finance.allowed('review');
 if p_context='bookings' then
  if not(public.has_role('super_admin') or public.has_role('general_manager') or public.has_role('reception') or public.has_role('customer_service') or clinic_finance.allowed('view')) then raise exception 'لا توجد صلاحية للحجوزات' using errcode='42501';end if;
 elsif p_context='patient' then
  if p_id is null or not(public.has_archive_access() or public.has_archive_review_access() or public.can_access_leads()) then raise exception 'لا توجد صلاحية لملف المريض' using errcode='42501';end if;pid:=p_id;
  financial:=clinic_finance.allowed('view');
 elsif p_context='lead' then
  if p_id is null or not public.can_access_leads() then raise exception 'لا توجد صلاحية لليد' using errcode='42501';end if;
  select patient_id into pid from public.leads where id=p_id and (public.has_role('super_admin') or public.has_role('general_manager') or public.has_role('reception') or public.has_role('customer_service') and assigned_to=me);
  if not found then raise exception 'الليد غير موجود';end if;
 elsif p_context='finance' then
  perform clinic_finance.require_access('view');financial:=true;
 elsif p_context in ('indicators','staff') then
  if not manager then raise exception 'هذا التقرير للإدارة' using errcode='42501';end if;
 else raise exception 'نطاق غير صالح';end if;
 with appointments as (
 select a.id,a.workspace_id,a.starts_at,a.status,a.created_at,a.created_by,(a.starts_at at time zone 'Africa/Cairo')::date appointment_date,to_char(a.starts_at at time zone 'Africa/Cairo','HH24:MI') appointment_time,p.phone,p.patient_id,p.file_no,p.name patient_name,pr.name provider_name,sv.name service_name,v.id visit_id,v.visit_no,v.archive_visit_id,at.lead_id,at.ad_id,at.campaign_id,at.evidence
 from clinic_reception.appointments a join clinic_reception.workspaces w on w.id=a.workspace_id and w.mode='live'
 join clinic_reception.patients p on p.id=a.patient_id join clinic_reception.providers pr on pr.id=a.provider_id join clinic_reception.services sv on sv.id=a.service_id
 left join clinic_reception.visits v on v.appointment_id=a.id left join clinic_reception.attributions at on at.appointment_id=a.id
 where (select live_enabled from clinic_reception.settings where id) and
 (p_context not in ('patient','lead') or p.patient_id=pid) and (p_context<>'lead' or at.lead_id=p_id) and (p_context<>'bookings' or clinic_finance.allowed('review') or clinic_finance.allowed('view') and a.created_by=me or public.has_role('super_admin') or public.has_role('general_manager') or public.has_role('reception') or exists(select 1 from public.leads l where l.id=at.lead_id and l.assigned_to=me))
 and (a.starts_at at time zone 'Africa/Cairo')::date between pf and pt),
 invoices as (
 select i.id,i.workspace_id,i.patient_id,i.invoice_no,i.description,i.created_at,i.amount,clinic_reception.due(i.id) due,p.file_no,p.name patient_name,v.visit_no,
 coalesce((select sum(r.amount) from clinic_reception.requests r where r.workspace_id=i.workspace_id and r.kind='credit_note' and r.subject_id=i.id and r.status='approved'),0) credited
 from clinic_reception.invoices i join clinic_reception.workspaces w on w.id=i.workspace_id and w.mode='live' join clinic_reception.patients p on p.id=i.patient_id left join clinic_reception.visits v on v.id=i.visit_id
 where (financial or p_context='indicators') and (reviewer or p_context='indicators' or exists(select 1 from clinic_reception.journal own where own.workspace_id=i.workspace_id and own.actor_id=me and (own.source_id=i.id or own.dimensions->>'invoice_id'=i.id::text))) and (select live_enabled from clinic_reception.settings where id)
 and (p_context<>'patient' or p.patient_id=pid) and (i.created_at at time zone 'Africa/Cairo')::date between pf and pt),
 payments as (
 select pay.id,pay.workspace_id,pay.reference,pay.method,pay.amount,pay.created_at,pay.created_by,p.file_no,p.name patient_name,
 (select coalesce(jsonb_agg(jsonb_build_object('invoice_id',i.id,'invoice_no',i.invoice_no,'visit_no',v.visit_no,'amount',a.amount)),'[]') from clinic_reception.allocations a join clinic_reception.invoices i on i.id=a.invoice_id left join clinic_reception.visits v on v.id=i.visit_id where a.payment_id=pay.id) allocations
 from clinic_reception.payments pay join clinic_reception.workspaces w on w.id=pay.workspace_id and w.mode='live' join clinic_reception.patients p on p.id=pay.patient_id
 where financial and (reviewer or pay.created_by=me) and (select live_enabled from clinic_reception.settings where id) and (p_context<>'patient' or p.patient_id=pid)
 and (pay.created_at at time zone 'Africa/Cairo')::date between pf and pt),
 staff as (
 select actor_id,sum(bookings) bookings,sum(executions) executions,sum(collections) collections
 from (
 select a.created_by actor_id,count(*) bookings,0::bigint executions,0::bigint collections from clinic_reception.appointments a join clinic_reception.workspaces w on w.id=a.workspace_id and w.mode='live' where (a.created_at at time zone 'Africa/Cairo')::date between pf and pt and (select live_enabled from clinic_reception.settings where id) group by a.created_by
 union all select o.executed_by,0,count(*),0 from clinic_reception.orders o join clinic_reception.workspaces w on w.id=o.workspace_id and w.mode='live' where o.status='completed' and (o.completed_at at time zone 'Africa/Cairo')::date between pf and pt and (select live_enabled from clinic_reception.settings where id) group by o.executed_by
 union all select pay.created_by,0,0,count(*) from clinic_reception.payments pay join clinic_reception.workspaces w on w.id=pay.workspace_id and w.mode='live' where (pay.created_at at time zone 'Africa/Cairo')::date between pf and pt and (select live_enabled from clinic_reception.settings where id) group by pay.created_by
 )s group by actor_id)
 select jsonb_build_object('context',p_context,'from',pf,'to',pt,'live_enabled',(select live_enabled from clinic_reception.settings where id),'financial',financial,
 'appointments',case when p_context in ('patient','lead','bookings') then(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from(select * from appointments order by starts_at desc,id limit 100 offset p_offset)a)else '[]'::jsonb end,
 'invoices',case when financial then(select coalesce(jsonb_agg(to_jsonb(i)),'[]') from(select * from invoices order by created_at desc,id limit 100 offset p_offset)i)else '[]'::jsonb end,
 'payments',case when financial then(select coalesce(jsonb_agg(to_jsonb(p)),'[]') from(select * from payments order by created_at desc,id limit 100 offset p_offset)p)else '[]'::jsonb end,
 'claims',case when financial then(select coalesce(jsonb_agg(to_jsonb(c)),'[]') from(select c.id,c.amount,c.paid,c.contractual,c.allowance,c.amount-c.paid-c.contractual due,e.name entity_name,i.invoice_no from clinic_reception.claims c join invoices i on i.id=c.invoice_id join clinic_reception.entities e on e.id=c.entity_id order by i.created_at desc limit 100 offset p_offset)c)else '[]'::jsonb end,
 'doctor_fees',case when financial then(select coalesce(jsonb_agg(to_jsonb(o)),'[]') from(select o.id,i.invoice_no,p.name provider_name,o.doctor_fee original_fee,agreement.finance_contract_id,clinic_finance.doctor_balance(p.doctor_key) unified_balance from invoices i join clinic_reception.invoices ri on ri.id=i.id join clinic_reception.orders o on o.id=ri.order_id join clinic_reception.providers p on p.id=o.provider_id left join clinic_reception.doctor_agreements agreement on agreement.id=o.agreement_id order by i.created_at desc limit 100 offset p_offset)o)else '[]'::jsonb end,
 'staff',case when p_context='staff' then(select coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('name',a.name)),'[]') from staff s join public.admins a on a.id=s.actor_id)else '[]'::jsonb end,
 'summary',case when p_context='indicators' then jsonb_build_object('bookings',(select count(*) from appointments),'arrived',(select count(*) from appointments where status in ('arrived','completed')),'cancelled',(select count(*) from appointments where status='cancelled'),'net_billed',(select coalesce(sum(amount-credited),0) from invoices))else '{}'::jsonb end,
 'notice','قراءة من نفس سجلات الحجز والخدمة؛ لا تعيد تسجيل الفاتورة أو التحصيل يدويًا. الأرقام تخص عمليات الاستقبال الجديدة فقط.') into outcome;
 return outcome;
end $$;
revoke all on function public.clinic_reception_shared_records(text,uuid,date,date,integer) from public,anon,authenticated;
grant execute on function public.clinic_reception_shared_records(text,uuid,date,date,integer) to authenticated;
-- Preserve atomic command replay. Lead selection is part of booking, not a later manual copy.
alter function public.clinic_reception_command(uuid,text,jsonb,uuid) rename to clinic_reception_command_before_shared;
alter function public.clinic_reception_command_before_shared(uuid,text,jsonb,uuid) set schema clinic_reception;
revoke all on function clinic_reception.clinic_reception_command_before_shared(uuid,text,jsonb,uuid) from public,anon,authenticated;
create function public.clinic_reception_command(p_workspace uuid,p_action text,p_payload jsonb,p_token uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid;result jsonb;lead_id uuid;aid uuid;previous clinic_reception.commands%rowtype;
begin
 me:=clinic_reception.access(p_workspace,'view');perform 1 from clinic_reception.workspaces where id=p_workspace for update;
 select * into previous from clinic_reception.commands where workspace_id=p_workspace and actor_id=me and token=p_token;
 if found then if previous.action<>p_action or previous.payload is distinct from p_payload then raise exception 'مفتاح إعادة المحاولة مرتبط بطلب آخر';end if;return previous.response;end if;
 if (p_action='book' and nullif(p_payload->>'lead_id','') is not null) or p_action='lead_link' then
  if not exists(select 1 from public.leads where id=(p_payload->>'lead_id')::uuid and (public.has_role('super_admin') or public.has_role('general_manager') or public.has_role('reception') or public.has_role('customer_service') and assigned_to=me)) then raise exception 'الليد خارج صلاحيتك' using errcode='42501';end if;
 end if;
 result:=clinic_reception.clinic_reception_command_before_shared(p_workspace,p_action,p_payload,p_token);
 if p_action='book' and nullif(p_payload->>'lead_id','') is not null then
  lead_id:=(p_payload->>'lead_id')::uuid;aid:=(result->>'id')::uuid;
  perform clinic_reception.clinic_reception_command_before_shared(p_workspace,'lead_link',jsonb_build_object('appointment_id',aid,'lead_id',lead_id),gen_random_uuid());
 end if;
 return result;
end $$;
revoke all on function public.clinic_reception_command(uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.clinic_reception_command(uuid,text,jsonb,uuid) to authenticated;
create function public.clinic_reception_patient_leads(p_workspace uuid,p_patient uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare me uuid:=clinic_reception.access(p_workspace,'book');begin
 if not exists(select 1 from clinic_reception.workspaces where id=p_workspace and mode='live') or not public.can_access_leads() then return '[]';end if;
 return(select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'label',p.name||' — '||l.source)),'[]') from public.leads l join clinic_reception.patients p on p.patient_id=l.patient_id and p.workspace_id=p_workspace and p.id=p_patient where public.has_role('super_admin') or public.has_role('general_manager') or public.has_role('reception') or public.has_role('customer_service') and l.assigned_to=me);
end $$;
revoke all on function public.clinic_reception_patient_leads(uuid,uuid) from public,anon,authenticated;
grant execute on function public.clinic_reception_patient_leads(uuid,uuid) to authenticated;
-- Use the existing lead row and its audit triggers. Never create a second lead or a manual lead invoice.
create function clinic_reception.sync_lead_booking() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.lead_id is not null and exists(select 1 from clinic_reception.workspaces where id=new.workspace_id and mode='live') then
  update public.leads set current_status=case when current_status in ('new','in_progress','booked','booked_on_system') then 'booked_on_system' else current_status end,
   booking_reference='RX-'||new.appointment_id::text,booking_date=(select (starts_at at time zone 'Africa/Cairo')::date from clinic_reception.appointments where id=new.appointment_id),booked_by=coalesce(booked_by,public.my_admin_id()) where id=new.lead_id;
 end if;return new;
end $$;
create trigger reception_shared_lead after insert or update of lead_id on clinic_reception.attributions for each row execute function clinic_reception.sync_lead_booking();
