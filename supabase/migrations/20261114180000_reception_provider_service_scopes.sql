begin;
create table clinic_reception.provider_service_scopes (
 provider_id uuid not null references clinic_reception.providers(id),
 service_code text not null,
 primary key(provider_id,service_code)
);
alter table clinic_reception.provider_service_scopes enable row level security;
revoke all on clinic_reception.provider_service_scopes from public,anon,authenticated;

create function clinic_reception.has_provider_service_scope(p_provider uuid,p_code text,p_day date)
returns boolean language sql stable set search_path=pg_catalog,public as $$
 select count(*)=1
 from clinic_reception.provider_service_scopes scope
 join clinic_reception.providers p on p.id=scope.provider_id and p.active
 join clinic_finance.doctor_contracts c on c.doctor_key=p.doctor_key and c.service_scope=scope.service_code
 where scope.provider_id=p_provider and scope.service_code=p_code
   and c.status='active' and p_day between c.valid_from and c.valid_to
   and c.basis='performed' and c.base_scope='service' and c.deduction in ('none','cost')
$$;
revoke all on function clinic_reception.has_provider_service_scope(uuid,text,date) from public,anon,authenticated;

do $migration$
declare original text; revised text;
begin
 original:=pg_get_functiondef('clinic_reception.workspace_command(uuid,text,jsonb,uuid)'::regprocedure);
 revised:=replace(original,'else department=s.department',
  'else department=s.department or (w.mode=''live'' and clinic_reception.has_provider_service_scope(id,s.code,((p_payload->>''starts_at'')::timestamptz at time zone ''Africa/Cairo'')::date))');
 if revised=original then raise exception 'Booking department gate changed'; end if;
 execute revised;

 original:=pg_get_functiondef('clinic_reception.service_operation(uuid,text,jsonb,uuid)'::regprocedure);
 revised:=replace(original,
  'active and department=s.department)',
  'active and (department=s.department or clinic_reception.has_provider_service_scope(id,s.code,clinic_reception.today())))');
 if revised=original then raise exception 'Service order department gate changed'; end if;
 original:=revised;
 revised:=replace(original,
  'active and department=o.snapshot->>''department'')',
  'active and (department=o.snapshot->>''department'' or clinic_reception.has_provider_service_scope(id,o.snapshot->>''code'',clinic_reception.today()) or (o.snapshot->>''code'' in (''0001371'',''0001372'') and o.snapshot->>''code''=any(clinic_reception.consultation_scopes(doctor_key,clinic_reception.today())))))');
 if revised=original then raise exception 'Service execution department gate changed'; end if;
 execute revised;
end
$migration$;

alter function public.clinic_reception_snapshot(uuid,date,date) rename to snapshot_before_provider_scopes;
alter function public.snapshot_before_provider_scopes(uuid,date,date) set schema clinic_reception;
revoke all on function clinic_reception.snapshot_before_provider_scopes(uuid,date,date) from public,anon,authenticated;
create function public.clinic_reception_snapshot(p_workspace uuid,p_from date default current_date,p_to date default current_date)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
 result:=clinic_reception.snapshot_before_provider_scopes(p_workspace,p_from,p_to);
 if result#>>'{workspace,mode}'<>'live' then return result; end if;
 return result||jsonb_build_object('provider_service_scopes',coalesce((
  select jsonb_object_agg(provider_id,codes)
  from (
   select scope.provider_id,jsonb_agg(scope.service_code order by scope.service_code) codes
   from clinic_reception.provider_service_scopes scope
   join clinic_reception.providers p on p.id=scope.provider_id and p.workspace_id=p_workspace
   where clinic_reception.has_provider_service_scope(scope.provider_id,scope.service_code,p_from)
   group by scope.provider_id
  ) allowed
 ),'{}'::jsonb));
end $$;
revoke all on function public.clinic_reception_snapshot(uuid,date,date) from public,anon,authenticated;
grant execute on function public.clinic_reception_snapshot(uuid,date,date) to authenticated;
commit;
