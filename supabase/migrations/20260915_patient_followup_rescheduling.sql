-- متابعة المريض: وقت الموعد، التأجيل، ورسالة واضحة في بوابة المريض.
begin;

alter table public.patient_visits
  add column if not exists follow_up_time time,
  add column if not exists follow_up_status text,
  add column if not exists follow_up_status_at timestamptz,
  add column if not exists follow_up_reschedule_reason text,
  add column if not exists follow_up_reschedule_note text,
  add column if not exists follow_up_patient_message text,
  add column if not exists follow_up_rescheduled_at timestamptz;

update public.patient_visits
set follow_up_status = 'pending'
where follow_up_date is not null and follow_up_status is null;

alter table public.patient_visits
  drop constraint if exists patient_visits_follow_up_status_check;

alter table public.patient_visits
  add constraint patient_visits_follow_up_status_check check (
    follow_up_status is null or follow_up_status in ('pending', 'rescheduled', 'attended', 'no_show')
  );

create index if not exists patient_visits_follow_up_status_idx
  on public.patient_visits (follow_up_status, follow_up_date, follow_up_time);

create or replace function public.refresh_overdue_followups()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  changed_count integer;
begin
  update public.patient_visits
  set follow_up_status = 'no_show',
      follow_up_status_at = now()
  where follow_up_date is not null
    and follow_up_status in ('pending', 'rescheduled')
    and follow_up_date < timezone('Africa/Cairo', now())::date;

  get diagnostics changed_count = row_count;
  return changed_count;
end;
$$;

revoke all on function public.refresh_overdue_followups() from public;
grant execute on function public.refresh_overdue_followups() to authenticated;

commit;
