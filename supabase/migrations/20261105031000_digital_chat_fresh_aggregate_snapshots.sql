-- Fresh aggregate-only context for manual and recurring advisory chat. No patient-level records leave the DB.
create or replace function public.digital_chat_aggregate_snapshot(p_agent text)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,clinic_finance as $$
declare m jsonb:='{}'::jsonb;source_text text:='';n integer:=0;bad integer:=0;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service only' using errcode='42501';end if;
 if p_agent='sia' then
  select count(*) filter(where due_at<now() and status not in ('done','approved','completed','cancelled','archived')),
    count(*) filter(where status='review') into n,bad from public.tasks;
  m:=jsonb_build_object('overdue_tasks_to_review',n,'tasks_awaiting_review',bad,
    'owner_requests_open',(select count(*) from public.administrative_assistant_requests where status in ('waiting_owner','pending')));
  source_text:='tasks, administrative_assistant_requests';
 elsif p_agent='hor' then
  select count(*) filter(where visit_date>=current_date-30),
   count(*) filter(where follow_up_date between current_date-30 and current_date-1 and follow_up_status in ('pending','no_show'))
  into n,bad from public.patient_visits;
  m:=jsonb_build_object('visits_last30',n,'followup_status_to_validate',bad);
  source_text:='patient_visits';
 elsif p_agent='hotep' then
  select count(*) filter(where status in ('new','investigating','action_required')),
   count(*) filter(where status in ('new','investigating','action_required') and
    (severity in ('urgent','critical') or clinical_review_required))
  into n,bad from public.patient360_cases;
  m:=jsonb_build_object('open_complaints',n,'urgent_or_clinical',bad,
    'feedback_last30',(select count(*) from public.patient_experience_ratings where created_at>=now()-interval '30 days'));
  source_text:='patient360_cases, patient_experience_ratings';
 elsif p_agent='nefer' then
  select count(*) filter(where received_at>=now()-interval '30 days'),
   count(*) filter(where received_at>=now()-interval '30 days' and current_status='no_response')
  into n,bad from public.leads;
  m:=jsonb_build_object('leads_last30',n,'no_response_last30',bad,
    'contracting_entities',(select count(*) from public.contracting_entities));
  source_text:='leads, contracting_entities';
 elsif p_agent='maat' then
  select count(*),count(*) filter(where abs(net)>0.009) into n,bad from (
   select e.id,coalesce(sum(coalesce(l.debit,0)-coalesce(l.credit,0)),0) net
   from clinic_finance.entries e left join clinic_finance.lines l on l.entry_id=e.id group by e.id
  ) x;
  m:=jsonb_build_object('journal_entries_checked',n,'unbalanced_entries_to_verify',bad,
   'bank_statements_imported',(select count(*) from clinic_finance.bank_statements),
   'pos_settlements_imported',(select count(*) from clinic_finance.pos_settlements));
  source_text:='clinic_finance.entries, lines, bank_statements, pos_settlements';
 else
  raise exception 'No aggregate snapshot for this agent' using errcode='22023';
 end if;
 return jsonb_build_object('agent_code',p_agent,'generated_at',now(),'metrics',m,
  'source',source_text,'limitations','Aggregates only, not proof of misconduct, medical findings or financial fraud');
end $$;
revoke all on function public.digital_chat_aggregate_snapshot(text) from public,anon,authenticated;
grant execute on function public.digital_chat_aggregate_snapshot(text) to service_role;
