===== clinic_reception.clinic_reception_snapshot_before_catalog(uuid,date,date)
CREATE OR REPLACE FUNCTION clinic_reception.clinic_reception_snapshot_before_catalog(p_workspace uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$declare v jsonb;live boolean;begin
 v:=clinic_reception.reporting_snapshot(p_workspace,p_from,p_to);live:=v->'workspace'->>'mode'='live';
 return v||jsonb_build_object(
 'invoices',(select coalesce(jsonb_agg(x||jsonb_build_object('credited_total',(select coalesce(sum(r.amount),0) from clinic_reception.requests r where workspace_id=p_workspace and subject_id=(x->>'id')::uuid and kind='credit_note' and status='approved'),'payer_coverage',(select coalesce(sum(amount),0) from clinic_reception.claims where workspace_id=p_workspace and invoice_id=(x->>'id')::uuid),'coverage_credit',(select coalesce(sum(l.credit-l.debit),0) from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id=j.id where j.workspace_id=p_workspace and j.source='payer_credit' and j.dimensions->>'invoice_id'=x->>'id' and l.account='2150'))),'[]') from jsonb_array_elements(v->'invoices') x),
 'invoice_credit_notes',(select coalesce(jsonb_agg(jsonb_build_object('invoice_id',r.subject_id,'id',r.id,'amount',r.amount,'scope',coalesce(r.payload->>'scope','service'),'issued_at',(select min(created_at) from clinic_reception.journal where workspace_id=p_workspace and source_id=r.id and source in ('credit_note_ar','credit_note_credit')))),'[]') from clinic_reception.requests r where workspace_id=p_workspace and kind='credit_note' and status='approved'),
 'provider_balances',(select coalesce(jsonb_agg(x||jsonb_build_object('unified_due',case when live then(select clinic_finance.doctor_balance(p.doctor_key) from clinic_reception.providers p where p.id=(x->>'id')::uuid and p.workspace_id=p_workspace) else (x->>'due')::numeric end)),'[]') from jsonb_array_elements(v->'provider_balances') x),
 'suppliers',case when (v->>'can_manage')::boolean then(select coalesce(jsonb_agg(x||jsonb_build_object('unified_due',case when live then(select clinic_finance.supplier_balance(s.inventory_supplier_id) from clinic_reception.suppliers s where s.id=(x->>'id')::uuid and s.workspace_id=p_workspace) else (x->>'balance')::numeric end)),'[]') from jsonb_array_elements(v->'suppliers') x) else v->'suppliers' end);
end $function$

-- also references requests: clinic_reception.controls_operation(uuid,text,jsonb,uuid), clinic_reception.controls_snapshot(uuid,date,date), clinic_reception.doctor_reduction(uuid,numeric,numeric), report_claim_adjustments(date,date,uuid), clinic_reception.financial_review_operation(uuid,jsonb,uuid), clinic_reception.report_before_patient_supplies(uuid,date,date), clinic_reception.review_operation_before_corrections(uuid,jsonb,uuid), clinic_reception.correction_request_check(), clinic_reception.review_operation_before_conditional(uuid,jsonb,uuid), clinic_reception.review_operation(uuid,jsonb,uuid), clinic_reception.check_money_reference(uuid,text,text,text,uuid), clinic_reception.clinic_reception_snapshot_before_catalog(uuid,date,date), clinic_reception.shared_before_patient_supplies(text,uuid,date,date,integer), clinic_finance_overview(), report_adjustments_log(date,date,uuid,text)
===== clinic_reception.clinic_reception_snapshot_before_catalog(uuid,date,date)
CREATE OR REPLACE FUNCTION clinic_reception.clinic_reception_snapshot_before_catalog(p_workspace uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$declare v jsonb;live boolean;begin
 v:=clinic_reception.reporting_snapshot(p_workspace,p_from,p_to);live:=v->'workspace'->>'mode'='live';
 return v||jsonb_build_object(
 'invoices',(select coalesce(jsonb_agg(x||jsonb_build_object('credited_total',(select coalesce(sum(r.amount),0) from clinic_reception.requests r where workspace_id=p_workspace and subject_id=(x->>'id')::uuid and kind='credit_note' and status='approved'),'payer_coverage',(select coalesce(sum(amount),0) from clinic_reception.claims where workspace_id=p_workspace and invoice_id=(x->>'id')::uuid),'coverage_credit',(select coalesce(sum(l.credit-l.debit),0) from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id=j.id where j.workspace_id=p_workspace and j.source='payer_credit' and j.dimensions->>'invoice_id'=x->>'id' and l.account='2150'))),'[]') from jsonb_array_elements(v->'invoices') x),
 'invoice_credit_notes',(select coalesce(jsonb_agg(jsonb_build_object('invoice_id',r.subject_id,'id',r.id,'amount',r.amount,'scope',coalesce(r.payload->>'scope','service'),'issued_at',(select min(created_at) from clinic_reception.journal where workspace_id=p_workspace and source_id=r.id and source in ('credit_note_ar','credit_note_credit')))),'[]') from clinic_reception.requests r where workspace_id=p_workspace and kind='credit_note' and status='approved'),
 'provider_balances',(select coalesce(jsonb_agg(x||jsonb_build_object('unified_due',case when live then(select clinic_finance.doctor_balance(p.doctor_key) from clinic_reception.providers p where p.id=(x->>'id')::uuid and p.workspace_id=p_workspace) else (x->>'due')::numeric end)),'[]') from jsonb_array_elements(v->'provider_balances') x),
 'suppliers',case when (v->>'can_manage')::boolean then(select coalesce(jsonb_agg(x||jsonb_build_object('unified_due',case when live then(select clinic_finance.supplier_balance(s.inventory_supplier_id) from clinic_reception.suppliers s where s.id=(x->>'id')::uuid and s.workspace_id=p_workspace) else (x->>'balance')::numeric end)),'[]') from jsonb_array_elements(v->'suppliers') x) else v->'suppliers' end);
end $function$

===== clinic_reception.controls_snapshot(uuid,date,date)
CREATE OR REPLACE FUNCTION clinic_reception.controls_snapshot(p_workspace uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$declare me uuid:=clinic_reception.access(p_workspace,'view');v jsonb;manager boolean;reviewer boolean;begin
 v:=clinic_reception.packages_snapshot(p_workspace,p_from,p_to);manager:=(v->>'can_manage')::boolean;reviewer:=manager or exists(select 1 from clinic_reception.members where workspace_id=p_workspace and admin_id=me and 'review'=any(capabilities));
 if reviewer and not manager then v:=v||jsonb_build_object('agreements',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from clinic_reception.doctor_agreements x where workspace_id=p_workspace),'purchases',(select coalesce(jsonb_agg(to_jsonb(x)||jsonb_build_object('lines',(select coalesce(jsonb_agg(to_jsonb(l)),'[]') from clinic_reception.purchase_lines l where purchase_id=x.id))),'[]') from clinic_reception.purchases x where workspace_id=p_workspace),'discounts',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from clinic_reception.discount_requests x where workspace_id=p_workspace),'suppliers',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name)),'[]') from clinic_reception.suppliers where workspace_id=p_workspace));end if;
 return v||jsonb_build_object(
 'can_review',reviewer,
 'entities',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from clinic_reception.entities x where workspace_id=p_workspace),
 'entity_contracts',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from clinic_reception.entity_contracts x where workspace_id=p_workspace and (manager or status='active')),
 'quotes',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from clinic_reception.order_quotes x where workspace_id=p_workspace),
 'claims',case when reviewer then(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from clinic_reception.claims x where workspace_id=p_workspace) else '[]'::jsonb end,
 'requests',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from clinic_reception.requests x where workspace_id=p_workspace and (manager or created_by=me or exists(select 1 from clinic_reception.members where workspace_id=p_workspace and admin_id=me and 'review'=any(capabilities)))),
 'transfers',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from clinic_reception.transfers x where workspace_id=p_workspace),
 'counts',(select coalesce(jsonb_agg(case when manager then to_jsonb(x) else to_jsonb(x)-'book' end),'[]') from clinic_reception.counts x where workspace_id=p_workspace and (reviewer or created_by=me)),
 'tasks',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from clinic_reception.tasks x where workspace_id=p_workspace and (manager or assigned_to=me)),
 'outbox',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from clinic_reception.outbox x where workspace_id=p_workspace),
 'attributions',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from clinic_reception.attributions x where workspace_id=p_workspace),
 'provider_balances',case when manager then(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'due',-clinic_reception.balance(p_workspace,'2120','provider_id',x.id::text))),'[]') from clinic_reception.providers x where workspace_id=p_workspace) else '[]'::jsonb end);
end $function$

===== clinic_reception_snapshot(uuid,date,date)
CREATE OR REPLACE FUNCTION public.clinic_reception_snapshot(p_workspace uuid, p_from date DEFAULT CURRENT_DATE, p_to date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare result jsonb; extra jsonb; depts jsonb; cur jsonb; k text; v jsonb;
begin
  result := clinic_reception.snapshot_before_lab_units(p_workspace, p_from, p_to);
  select coalesce(jsonb_object_agg(provider_id, ds), '{}'::jsonb) into depts from (
    select pd.provider_id, jsonb_agg(pd.department order by pd.department) ds
      from clinic_reception.provider_departments pd
      join clinic_reception.providers p on p.id = pd.provider_id and p.workspace_id = p_workspace
     group by pd.provider_id) q;
  if depts = '{}'::jsonb then return result; end if;
  select coalesce(jsonb_object_agg(provider_id, codes), '{}'::jsonb) into extra from (
    select pd.provider_id, jsonb_agg(distinct s.code) codes
      from clinic_reception.provider_departments pd
      join clinic_reception.providers p on p.id = pd.provider_id and p.workspace_id = p_workspace and p.active
      join clinic_reception.services s on s.workspace_id = p_workspace and s.active and s.department = pd.department
     group by pd.provider_id) q;
  cur := coalesce(result->'provider_service_scopes', '{}'::jsonb);
  for k, v in select * from jsonb_each(extra) loop
    cur := jsonb_set(cur, array[k], coalesce(cur->k, '[]'::jsonb) || v);
  end loop;
  return result || jsonb_build_object('provider_service_scopes', cur, 'provider_departments', depts);
end $function$

