begin;
alter table clinic_finance.booking_messages drop constraint booking_messages_status_check;
alter table clinic_finance.booking_messages add constraint booking_messages_status_check check(status in ('ready','leased','sent','delivery_unknown','manual_sent','cancelled'));
alter table clinic_finance.booking_messages add column lease_token uuid,add column lease_until timestamptz,add column provider_message_id text,add column sent_at timestamptz;
create unique index booking_message_provider_id on clinic_finance.booking_messages(provider_message_id) where provider_message_id is not null;
-- Only the service role may lease/acknowledge. No browser role can forge delivery.
create function public.clinic_booking_outbox(p_action text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v jsonb;msg clinic_finance.booking_messages%rowtype;lease uuid;begin
perform pg_advisory_xact_lock(927311);
if p_action='lease' then
 update clinic_finance.booking_messages set status='delivery_unknown',note='انتهت مهلة الإرسال دون إقرار؛ لا تعاد تلقائيًا لتجنب التكرار' where status='leased' and lease_until<now();
 update clinic_finance.booking_messages m set status='cancelled',note='الحجز أُلغي أو تغير قبل الإرسال' from public.customer_bookings b where b.id=m.booking_id and m.status='ready' and (b.status not in ('confirmed','rescheduled') or b.appointment_date<(now() at time zone 'Africa/Cairo')::date or m.version is distinct from b.appointment_date::text||' '||coalesce(b.appointment_time,'')||' '||coalesce(b.doctor_id,b.doctor_name,''));
 with picked as(select m.id from clinic_finance.booking_messages m join public.customer_bookings b on b.id=m.booking_id where m.status='ready' and (m.kind='confirmation' or b.appointment_date<=(now() at time zone 'Africa/Cairo')::date+1) order by m.created_at,m.id limit 20 for update of m skip locked),leased as(update clinic_finance.booking_messages m set status='leased',lease_token=gen_random_uuid(),lease_until=now()+interval '10 minutes' from picked p where m.id=p.id returning m.id,m.phone,m.body,m.kind,m.booking_id,m.lease_token,m.lease_until) select coalesce(jsonb_agg(leased),'[]') into v from leased;return v;
elsif p_action='ack' then
 select * into msg from clinic_finance.booking_messages where id=(p_payload->>'id')::uuid for update;
 if not found or msg.lease_token is distinct from (p_payload->>'lease_token')::uuid or msg.lease_token is null then raise exception 'Invalid message lease';end if;
 if msg.status='sent' and msg.provider_message_id=p_payload->>'provider_message_id' then return jsonb_build_object('id',msg.id,'status','sent');end if;
 if msg.status not in ('leased','delivery_unknown') or coalesce(length(trim(p_payload->>'provider_message_id')),0)<2 then raise exception 'Message is not acknowledgeable';end if;
 update clinic_finance.booking_messages set status='sent',provider_message_id=trim(p_payload->>'provider_message_id'),sent_at=now(),note='تأكيد وصول من قناة الإرسال المرتبطة' where id=msg.id;
 return jsonb_build_object('id',msg.id,'status','sent');
else raise exception 'Unsupported outbox action';end if;end $$;
revoke all on function public.clinic_booking_outbox(text,jsonb) from public,anon,authenticated;
grant execute on function public.clinic_booking_outbox(text,jsonb) to service_role;

create function public.clinic_booking_message_resolve(p_id uuid,p_decision text,p_confirmed boolean,p_note text) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$declare me uuid:=clinic_finance.require_access('review');m clinic_finance.booking_messages%rowtype;begin perform pg_advisory_xact_lock(927311);select * into m from clinic_finance.booking_messages where id=p_id for update;if not found or m.status<>'delivery_unknown' or p_confirmed is distinct from true or coalesce(length(trim(p_note)),0)<3 or coalesce(p_decision,'') not in ('retry','sent') then raise exception 'أكد نتيجة فحص الرسالة غير المؤكدة وسجل دليلها';end if;update clinic_finance.booking_messages set status=case when p_decision='retry' then 'ready' else 'manual_sent' end,sent_by=case when p_decision='sent' then me end,lease_token=null,lease_until=null,note=p_note where id=p_id;insert into clinic_finance.audit(actor,action,entity_id,detail) values(me,'booking_delivery_resolved',p_id,jsonb_build_object('decision',p_decision,'note',p_note));return p_id;end $$;
revoke all on function public.clinic_booking_message_resolve(uuid,text,boolean,text) from public,anon;
grant execute on function public.clinic_booking_message_resolve(uuid,text,boolean,text) to authenticated;
commit;
