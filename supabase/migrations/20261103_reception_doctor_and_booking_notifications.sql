alter table clinic_reception.outbox drop constraint if exists outbox_kind_check;
alter table clinic_reception.outbox add constraint outbox_kind_check check (kind = any (array[
  'confirmation','reminder','cancellation','reschedule','journey_arrived','queue_called','doctor_delay','feedback_request','help_ack','followup_reminder','result_ready','followup_booking_offer','doctor_booking','doctor_arrival'
]::text[]));

create or replace function clinic_reception.queue_appointment_communications()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_patient text;
  v_provider text;
  v_phone text;
  v_actor uuid;
  v_total int;
  v_arrived int;
  v_waiting int;
  v_kind text;
  v_body text;
  v_version text;
begin
  select p.name into v_patient from clinic_reception.patients p where p.id=new.patient_id;
  select pr.name,
         (select cp.phone from clinic_people.people cp where cp.doctor_key=pr.doctor_key and cp.status='active' and nullif(trim(cp.phone),'') is not null order by cp.updated_at desc nulls last limit 1)
    into v_provider,v_phone
  from clinic_reception.providers pr where pr.id=new.provider_id;
  select coalesce(new.created_by,w.owner_id) into v_actor from clinic_reception.workspaces w where w.id=new.workspace_id;

  if new.status='booked' and (
    tg_op='INSERT' or old.status is distinct from new.status or old.starts_at is distinct from new.starts_at or old.provider_id is distinct from new.provider_id
  ) then
    v_kind:=case when tg_op='UPDATE' and (old.starts_at is distinct from new.starts_at or old.provider_id is distinct from new.provider_id) then 'reschedule' else 'confirmation' end;
    v_version:=new.starts_at::text||':'||new.status;
    v_body:=case when v_kind='reschedule' then 'تم تحديث حجزك في عيادات سونو: ' else 'تم تأكيد حجزك في عيادات سونو: ' end
      ||coalesce(v_patient,'المريض')||'، '
      ||to_char(new.starts_at at time zone 'Africa/Cairo','YYYY-MM-DD HH24:MI')||'، '
      ||coalesce(v_provider,'الطبيب')||'.';
    perform clinic_reception.queue_journey_message(new.workspace_id,new.id,v_kind,v_body,v_version,v_actor,jsonb_build_object('target_role','patient','provider_id',new.provider_id));

    if nullif(trim(v_phone),'') is not null then
      select count(*) into v_total from clinic_reception.appointments a
      where a.workspace_id=new.workspace_id and a.provider_id=new.provider_id
        and (a.starts_at at time zone 'Africa/Cairo')::date=(new.starts_at at time zone 'Africa/Cairo')::date
        and a.status not in ('cancelled','no_show');
      v_body:='حجز جديد في سونو يوم '||to_char(new.starts_at at time zone 'Africa/Cairo','YYYY-MM-DD')
        ||' الساعة '||to_char(new.starts_at at time zone 'Africa/Cairo','HH24:MI')
        ||' للمريض '||coalesce(v_patient,'—')||'. إجمالي حجوزات عيادتك حتى الآن: '||v_total||'.';
      perform clinic_reception.queue_journey_message(new.workspace_id,new.id,'doctor_booking',v_body,v_version,v_actor,
        jsonb_build_object('target_role','doctor','target_phone',v_phone,'provider_id',new.provider_id,'total_bookings',v_total));
    end if;
  end if;

  if new.status='arrived' and (
    tg_op='INSERT' or old.status is distinct from new.status or (old.arrived_at is null and new.arrived_at is not null)
  ) and nullif(trim(v_phone),'') is not null then
    select count(*) into v_total from clinic_reception.appointments a
      where a.workspace_id=new.workspace_id and a.provider_id=new.provider_id
        and (a.starts_at at time zone 'Africa/Cairo')::date=(new.starts_at at time zone 'Africa/Cairo')::date
        and a.status not in ('cancelled','no_show');
    select count(*) into v_arrived from clinic_reception.appointments a
      where a.workspace_id=new.workspace_id and a.provider_id=new.provider_id
        and (a.starts_at at time zone 'Africa/Cairo')::date=(new.starts_at at time zone 'Africa/Cairo')::date
        and a.status in ('arrived','completed');
    select count(*) into v_waiting from clinic_reception.queue_entries q
      join clinic_reception.appointments a on a.id=q.appointment_id
      where q.workspace_id=new.workspace_id and q.provider_id=new.provider_id
        and (a.starts_at at time zone 'Africa/Cairo')::date=(new.starts_at at time zone 'Africa/Cairo')::date
        and q.status in ('waiting','called','on_hold');
    v_version:=coalesce(new.arrived_at,now())::text;
    v_body:='المريض '||coalesce(v_patient,'—')||' وصل المركز الساعة '
      ||to_char(coalesce(new.arrived_at,now()) at time zone 'Africa/Cairo','HH24:MI')||'. حضر '
      ||v_arrived||' من '||v_total||' حجوزات، والمنتظرون الآن '||v_waiting||'.';
    perform clinic_reception.queue_journey_message(new.workspace_id,new.id,'doctor_arrival',v_body,v_version,v_actor,
      jsonb_build_object('target_role','doctor','target_phone',v_phone,'provider_id',new.provider_id,'arrived_count',v_arrived,'total_bookings',v_total,'waiting_count',v_waiting));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_appointment_communications on clinic_reception.appointments;
create trigger trg_appointment_communications
after insert or update of starts_at,status,arrived_at,provider_id on clinic_reception.appointments
for each row execute function clinic_reception.queue_appointment_communications();

create or replace function public.clinic_reception_message_claim(p_limit integer default 10)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare result jsonb;
begin
 if p_limit not between 1 and 50 then raise exception 'Invalid batch'; end if;
 with patient_eligible as(
   select o.id from clinic_reception.outbox o
   join clinic_reception.workspaces w on w.id=o.workspace_id
   join clinic_reception.appointments a on a.id=o.appointment_id
   join clinic_reception.patients p on p.id=a.patient_id
   join clinic_reception.consents consent on consent.workspace_id=w.id and consent.patient_id=p.id
   join clinic_reception.settings settings on settings.id
   where settings.live_enabled and settings.communications_enabled and w.mode='live' and o.status='approved' and o.delivered_at is null and o.attempts<5 and (o.lease_until is null or o.lease_until<now()) and consent.allowed and nullif(trim(p.phone),'') is not null
     and not exists(select 1 from public.leads l where l.patient_id=p.patient_id and l.do_not_contact)
     and (
       (o.kind in ('confirmation','reminder','reschedule') and a.status='booked' and a.starts_at>now() and o.version=a.starts_at::text||':'||a.status)
       or (o.kind='cancellation' and a.status='cancelled' and o.version=a.starts_at::text||':'||a.status)
       or (o.kind='journey_arrived' and a.status in ('arrived','completed'))
       or (o.kind='queue_called' and a.status='arrived')
       or (o.kind='doctor_delay' and a.status in ('booked','arrived'))
       or (o.kind='feedback_request' and a.status='completed')
       or (o.kind in ('help_ack','followup_reminder') and a.status not in ('cancelled','no_show'))
       or (o.kind in ('result_ready','followup_booking_offer') and a.status='completed')
     )
 ), doctor_eligible as(
   select o.id from clinic_reception.outbox o
   join clinic_reception.workspaces w on w.id=o.workspace_id
   join clinic_reception.appointments a on a.id=o.appointment_id
   join clinic_reception.providers pr on pr.id=a.provider_id
   join clinic_reception.settings settings on settings.id
   where settings.live_enabled and settings.communications_enabled and w.mode='live' and o.status='approved' and o.delivered_at is null and o.attempts<5 and (o.lease_until is null or o.lease_until<now())
     and o.kind in ('doctor_booking','doctor_arrival')
     and nullif(trim(o.payload->>'target_phone'),'') is not null
     and ((o.kind='doctor_booking' and a.status='booked' and a.starts_at>now() and o.version=a.starts_at::text||':'||a.status)
       or (o.kind='doctor_arrival' and a.status in ('arrived','completed')))
 ), eligible as(
   select id from patient_eligible union select id from doctor_eligible
 ), picked as(
   select o.id from clinic_reception.outbox o join eligible e on e.id=o.id order by o.created_at,o.id for update of o skip locked limit p_limit
 ), claimed as(
   update clinic_reception.outbox o set lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes',attempts=attempts+1 from picked where o.id=picked.id returning o.*
 )
 select coalesce(jsonb_agg(jsonb_build_object(
   'id',c.id,'lease_token',c.lease_token,'idempotency_key','rx:'||c.id,
   'phone',case when c.kind in ('doctor_booking','doctor_arrival') then c.payload->>'target_phone' else p.phone end,
   'body',c.body,'kind',c.kind,'appointment_id',c.appointment_id,'payload',c.payload
 ) order by c.created_at,c.id),'[]') into result
 from claimed c
 join clinic_reception.appointments a on a.id=c.appointment_id
 join clinic_reception.patients p on p.id=a.patient_id;
 return result;
end
$$;

create or replace function public.clinic_reception_message_validate(p_id uuid, p_lease uuid)
returns boolean
language sql
stable security definer
set search_path = pg_catalog, public
as $$
select exists(
 select 1 from clinic_reception.outbox o
 join clinic_reception.workspaces w on w.id=o.workspace_id
 join clinic_reception.appointments a on a.id=o.appointment_id
 join clinic_reception.patients p on p.id=a.patient_id
 join clinic_reception.settings s on s.id
 left join clinic_reception.consents c on c.workspace_id=w.id and c.patient_id=p.id
 where o.id=p_id and o.lease_token=p_lease and o.lease_until>=now() and o.status='approved' and o.delivered_at is null and w.mode='live' and s.live_enabled and s.communications_enabled
 and (
   (
     o.kind in ('doctor_booking','doctor_arrival')
     and nullif(trim(o.payload->>'target_phone'),'') is not null
     and ((o.kind='doctor_booking' and a.status='booked' and a.starts_at>now() and o.version=a.starts_at::text||':'||a.status)
       or (o.kind='doctor_arrival' and a.status in ('arrived','completed')))
   )
   or (
     o.kind not in ('doctor_booking','doctor_arrival')
     and c.allowed
     and not exists(select 1 from public.leads l where l.patient_id=p.patient_id and l.do_not_contact)
     and (
       (o.kind in ('confirmation','reminder','reschedule') and a.status='booked' and a.starts_at>now() and o.version=a.starts_at::text||':'||a.status)
       or (o.kind='cancellation' and a.status='cancelled' and o.version=a.starts_at::text||':'||a.status)
       or (o.kind='journey_arrived' and a.status in ('arrived','completed'))
       or (o.kind='queue_called' and a.status='arrived')
       or (o.kind='doctor_delay' and a.status in ('booked','arrived'))
       or (o.kind='feedback_request' and a.status='completed')
       or (o.kind in ('help_ack','followup_reminder') and a.status not in ('cancelled','no_show'))
       or (o.kind in ('result_ready','followup_booking_offer') and a.status='completed')
     )
   )
 )
)
$$;