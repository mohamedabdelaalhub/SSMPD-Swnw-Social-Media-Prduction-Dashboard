begin;
alter function public.clinic_reception_snapshot(uuid,date,date) set schema clinic_reception;
alter function clinic_reception.clinic_reception_snapshot(uuid,date,date) rename to reporting_snapshot;
create or replace function public.clinic_reception_snapshot(p_workspace uuid,p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$declare v jsonb;live boolean;begin
 v:=clinic_reception.reporting_snapshot(p_workspace,p_from,p_to);live:=v->'workspace'->>'mode'='live';
 return v||jsonb_build_object(
 'invoices',(select coalesce(jsonb_agg(x||jsonb_build_object('credited_total',(select coalesce(sum(r.amount),0) from clinic_reception.requests r where workspace_id=p_workspace and subject_id=(x->>'id')::uuid and kind='credit_note' and status='approved'),'payer_coverage',(select coalesce(sum(amount),0) from clinic_reception.claims where workspace_id=p_workspace and invoice_id=(x->>'id')::uuid),'coverage_credit',(select coalesce(sum(l.credit-l.debit),0) from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id=j.id where j.workspace_id=p_workspace and j.source='payer_credit' and j.dimensions->>'invoice_id'=x->>'id' and l.account='2150'))),'[]') from jsonb_array_elements(v->'invoices') x),
 'invoice_credit_notes',(select coalesce(jsonb_agg(jsonb_build_object('invoice_id',r.subject_id,'id',r.id,'amount',r.amount,'scope',coalesce(r.payload->>'scope','service'),'issued_at',(select min(created_at) from clinic_reception.journal where workspace_id=p_workspace and source_id=r.id and source in ('credit_note_ar','credit_note_credit')))),'[]') from clinic_reception.requests r where workspace_id=p_workspace and kind='credit_note' and status='approved'),
 'provider_balances',(select coalesce(jsonb_agg(x||jsonb_build_object('unified_due',case when live then(select clinic_finance.doctor_balance(p.doctor_key) from clinic_reception.providers p where p.id=(x->>'id')::uuid and p.workspace_id=p_workspace) else (x->>'due')::numeric end)),'[]') from jsonb_array_elements(v->'provider_balances') x),
 'suppliers',case when (v->>'can_manage')::boolean then(select coalesce(jsonb_agg(x||jsonb_build_object('unified_due',case when live then(select clinic_finance.supplier_balance(s.inventory_supplier_id) from clinic_reception.suppliers s where s.id=(x->>'id')::uuid and s.workspace_id=p_workspace) else (x->>'balance')::numeric end)),'[]') from jsonb_array_elements(v->'suppliers') x) else v->'suppliers' end);
end $$;
revoke all on function clinic_reception.reporting_snapshot(uuid,date,date) from public,anon,authenticated;
revoke all on function public.clinic_reception_snapshot(uuid,date,date) from public,anon,authenticated;
grant execute on function public.clinic_reception_snapshot(uuid,date,date) to authenticated;
commit;
