-- Raise owner review requests for urgent or clinical complaints, without exposing clinical details.
create or replace function public.patient360_escalate_case()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.severity <> 'normal' or new.clinical_review_required then
    insert into public.administrative_assistant_requests(
      source,body,priority,status,requires_owner,requester_id,suggested_action
    ) values (
      'patient360_case',
      'بلاغ من Patient 360 يحتاج مراجعة بشرية داخل شاشة علاقة المريض. لا تتخذ قرارًا طبيًا أو تعويضًا تلقائيًا.',
      case when new.severity='critical' then 'critical' else 'urgent' end,
      'waiting_owner',true,new.created_by,
      jsonb_build_object('type','patient360_case','case_id',new.id,'contact_id',new.contact_id,'category',new.category,'severity',new.severity)
    );
  end if;
  return new;
end $$;
revoke all on function public.patient360_escalate_case() from public,anon,authenticated;
create trigger patient360_case_escalation
  after insert on public.patient360_cases
  for each row execute function public.patient360_escalate_case();
