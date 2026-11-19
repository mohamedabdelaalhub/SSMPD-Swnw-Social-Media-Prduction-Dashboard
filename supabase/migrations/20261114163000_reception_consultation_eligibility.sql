begin;
create function clinic_reception.consultation_scopes(p_doctor_key text, p_day date)
returns text[] language sql stable set search_path=pg_catalog,public as $$
  select coalesce(array_agg(service_scope order by service_scope), array[]::text[])
  from (
    select service_scope
    from clinic_finance.doctor_contracts
    where doctor_key=p_doctor_key and status='active'
      and p_day between valid_from and valid_to
      and service_scope in ('0001371','0001372')
      and basis='performed' and base_scope='service' and deduction in ('none','cost')
    group by service_scope having count(*)=1
  ) eligible
$$;
revoke all on function clinic_reception.consultation_scopes(text,date) from public,anon,authenticated;

do $$
declare
  original text;
  revised text;
begin
  original:=pg_get_functiondef('clinic_reception.workspace_command(uuid,text,jsonb,uuid)'::regprocedure);
  revised:=replace(original,$old$and active and department=s.department;$old$,$new$and active and (
    case when w.mode='live' and s.code in ('0001371','0001372')
      then s.code=any(clinic_reception.consultation_scopes(doctor_key,((p_payload->>'starts_at')::timestamptz at time zone 'Africa/Cairo')::date))
      else department=s.department
    end
   );$new$);
  if original=revised then raise exception 'Booking provider eligibility clause has changed'; end if;
  execute revised;
end
$$;

alter function public.clinic_reception_snapshot(uuid,date,date) rename to snapshot_before_consultation_scopes;
alter function public.snapshot_before_consultation_scopes(uuid,date,date) set schema clinic_reception;
revoke all on function clinic_reception.snapshot_before_consultation_scopes(uuid,date,date) from public,anon,authenticated;

create function public.clinic_reception_snapshot(p_workspace uuid,p_from date default current_date,p_to date default current_date)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  snapshot jsonb;
  scopes jsonb;
begin
  snapshot:=clinic_reception.snapshot_before_consultation_scopes(p_workspace,p_from,p_to);
  if snapshot#>>'{workspace,mode}'='live' then
    select coalesce(jsonb_object_agg(p.id,clinic_reception.consultation_scopes(p.doctor_key,p_from)), '{}'::jsonb)
    into scopes
    from clinic_reception.providers p where p.workspace_id=p_workspace and p.active;
    snapshot:=snapshot||jsonb_build_object('consultation_scopes',scopes);
  end if;
  return snapshot;
end
$$;
revoke all on function public.clinic_reception_snapshot(uuid,date,date) from public,anon,authenticated;
grant execute on function public.clinic_reception_snapshot(uuid,date,date) to authenticated;
commit;
