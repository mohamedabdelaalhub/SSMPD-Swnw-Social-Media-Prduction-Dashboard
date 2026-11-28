-- Rollback of 20261127300000_no_meter_pulses.sql: drops the outer wrapper / report / helpers, puts the previous command back and the
-- last-reading function as in 20261127270000. The no_meter columns stay (they describe sessions already executed that way).
begin;
drop function if exists public.clinic_reception_command(uuid, text, jsonb, uuid);
drop function if exists public.clinic_reception_no_meter_sessions(uuid, date, date);
drop function if exists clinic_reception.no_meter_payload(uuid, jsonb);
drop function if exists clinic_reception.no_meter_mark(uuid, uuid, numeric, text);
alter function clinic_reception.command_before_no_meter(uuid, text, jsonb, uuid) set schema public;
alter function public.command_before_no_meter(uuid, text, jsonb, uuid) rename to clinic_reception_command;
revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid) to authenticated;
create or replace function public.clinic_reception_device_last_reading(p_workspace uuid, p_device uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare r record;
begin
  perform clinic_reception.access(p_workspace, 'execute');
  select u.meter_after, o.completed_at, o.executed_by into r
    from clinic_reception.device_uses u join clinic_reception.orders o on o.id = u.order_id
   where u.workspace_id = p_workspace and u.device_id = p_device and u.meter_after is not null
   order by o.completed_at desc nulls last, u.meter_after desc limit 1;
  if not found then return jsonb_build_object('device_id', p_device, 'meter_after', null); end if;
  return jsonb_build_object('device_id', p_device, 'meter_after', r.meter_after, 'at', r.completed_at,
    'by', (select coalesce(nullif(trim(to_jsonb(a)->>'name'), ''), 'موظف') from public.admins a where a.id = r.executed_by));
end $$;
commit;
