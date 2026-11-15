-- «تأكيد الحجز» (owner request 2026-11-15): after calling the patient, reception marks a booked appointment as
-- confirmed. Additive: two nullable columns, one trigger and one new action routed by the public command wrapper.
-- Rescheduling (time or doctor) clears the confirmation, because the patient has to confirm the new slot.
-- Session length (same request): a booking may carry "minutes" (5-480) chosen by reception, e.g. 30 minutes for a
-- physiotherapy session whose catalog length is 45. Without it the length stays exactly as before.
begin;
create or replace function clinic_reception.booking_minutes(p_workspace uuid,p_payload jsonb) returns integer language plpgsql stable security definer set search_path=pg_catalog,public as $$declare n integer;begin
 if nullif(p_payload->>'minutes','') is not null then
  if p_payload->>'minutes' !~ '^[0-9]{1,3}$' then raise exception 'مدة الجلسة غير صحيحة';end if;
  n:=(p_payload->>'minutes')::integer;
 elsif nullif(p_payload->>'package_id','') is null then select minutes into n from clinic_reception.services where workspace_id=p_workspace and id=(p_payload->>'service_id')::uuid;
 else select ceil(sum((e.snapshot->>'minutes')::numeric*(e.quantity-e.used))) into n from clinic_reception.entitlements e join clinic_reception.packages p on p.id=e.package_id where p.workspace_id=p_workspace and p.id=(p_payload->>'package_id')::uuid and p.patient_id=(p_payload->>'patient_id')::uuid and e.visit_no=(p_payload->>'package_visit_no')::integer and e.used<e.quantity;end if;
 if n is null or n not between 5 and 480 then raise exception 'راجع مدة خدمات الزيارة؛ الحد ثماني ساعات';end if;return n;
end $$;
revoke all on function clinic_reception.booking_minutes(uuid,jsonb) from public,anon,authenticated;
alter table clinic_reception.appointments
 add column if not exists confirmed_at timestamptz,
 add column if not exists confirmed_by uuid references public.admins(id);

create or replace function clinic_reception.clear_confirmation_on_move() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin new.confirmed_at:=null;new.confirmed_by:=null;return new;end $$;
revoke all on function clinic_reception.clear_confirmation_on_move() from public,anon,authenticated;
drop trigger if exists appointments_clear_confirmation on clinic_reception.appointments;
create trigger appointments_clear_confirmation before update of starts_at,provider_id on clinic_reception.appointments
 for each row when (old.starts_at is distinct from new.starts_at or old.provider_id is distinct from new.provider_id)
 execute function clinic_reception.clear_confirmation_on_move();

-- Same access rule as booking. Idempotent by nature (sets or clears one timestamp), so the retry token is only required.
create function clinic_reception.confirm_booking(p_workspace uuid,p_payload jsonb,p_token uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid;a clinic_reception.appointments%rowtype;yes boolean;
begin
 me:=clinic_reception.access(p_workspace,'book');
 if p_token is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'طلب غير صالح';end if;
 yes:=coalesce((p_payload->>'confirmed')::boolean,true);
 select * into a from clinic_reception.appointments where workspace_id=p_workspace and id=nullif(p_payload->>'id','')::uuid for update;
 if not found then raise exception 'الحجز غير موجود';end if;
 if a.status<>'booked' then raise exception 'يمكن تأكيد الحجز قبل حضور المريض فقط';end if;
 update clinic_reception.appointments set confirmed_at=case when yes then coalesce(a.confirmed_at,now()) end,confirmed_by=case when yes then coalesce(a.confirmed_by,me) end
  where id=a.id returning * into a;
 return jsonb_build_object('id',a.id,'confirmed_at',a.confirmed_at);
end $$;
revoke all on function clinic_reception.confirm_booking(uuid,jsonb,uuid) from public,anon,authenticated;

alter function public.clinic_reception_command(uuid,text,jsonb,uuid) rename to command_before_booking_confirm;
alter function public.command_before_booking_confirm(uuid,text,jsonb,uuid) set schema clinic_reception;
revoke all on function clinic_reception.command_before_booking_confirm(uuid,text,jsonb,uuid) from public,anon,authenticated;
create function public.clinic_reception_command(p_workspace uuid,p_action text,p_payload jsonb,p_token uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if p_action='confirm' then return clinic_reception.confirm_booking(p_workspace,p_payload,p_token); end if;
 return clinic_reception.command_before_booking_confirm(p_workspace,p_action,p_payload,p_token);
end $$;
revoke all on function public.clinic_reception_command(uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.clinic_reception_command(uuid,text,jsonb,uuid) to authenticated;
commit;
