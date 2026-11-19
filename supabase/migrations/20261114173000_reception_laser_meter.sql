begin;
create table clinic_reception.laser_pulse_services (
 service_code text primary key
);
alter table clinic_reception.laser_pulse_services enable row level security;
revoke all on clinic_reception.laser_pulse_services from public,anon,authenticated;

do $migration$
declare
 original text;
 revised text;
 marker constant text:='  materials:=p_payload->''materials'';';
begin
 original:=pg_get_functiondef('clinic_reception.service_operation(uuid,text,jsonb,uuid)'::regprocedure);
 revised:=replace(original,marker,$patch$
  if exists(select 1 from clinic_reception.laser_pulse_services where service_code=o.snapshot->>'code') then
   if device.id is null or device.meter_kind<>'shots' then
    raise exception 'اختر جهاز ليزر بعداد نبضات';
   end if;
   actual_qty:=clinic_reception.number(p_payload->>'meter_after',0,true)
               -clinic_reception.number(p_payload->>'meter_before',0,true);
   if actual_qty<=0 then raise exception 'قراءة نهاية الجلسة لازم تزيد عن البداية'; end if;
   if o.entitlement_id is not null and actual_qty>o.quantity then
    raise exception 'النبضات الفعلية تتجاوز الرصيد المخصص للزيارة';
   end if;
   o.quantity:=actual_qty;
   update clinic_reception.orders set quantity=actual_qty where id=o.id;
  end if;
$patch$||marker);
 if revised=original then raise exception 'Laser execution insertion point changed'; end if;
 execute revised;
end
$migration$;
commit;
