begin;
alter table clinic_reception.packages add column payment_schedule text
 check (payment_schedule in ('fixed','visit'));

alter table clinic_reception.package_templates add column orthodontic boolean not null default false;
alter table clinic_reception.installments add column plan_visit_no integer check(plan_visit_no>=0);

do $migration$
declare
 original text;
 revised text;
 marker constant text := '  insert into clinic_reception.packages(workspace_id,patient_id,template_id,name,contract_price,visits,expires_on,terms,created_by)';
begin
 original := pg_get_functiondef('clinic_reception.service_operation(uuid,text,jsonb,uuid)'::regprocedure);
 if strpos(original,marker)=0 then raise exception 'Package contracting insertion point changed'; end if;
 revised := replace(original,marker,$patch$
  if p_payload ? 'orthodontic_terms' then
   if jsonb_typeof(p_payload->'orthodontic_terms') is distinct from 'object'
      or coalesce(p_payload#>>'{orthodontic_terms,schedule}','') not in ('fixed','visit')
      or coalesce(p_payload#>>'{orthodontic_terms,visits}','') !~ '^[1-9][0-9]{0,2}$'
      or coalesce(p_payload#>>'{orthodontic_terms,days}','') !~ '^[1-9][0-9]{0,3}$' then
    raise exception 'راجع السعر والزيارات والمدة وطريقة الاستحقاق';
   end if;
   tp.price := clinic_reception.number(p_payload#>>'{orthodontic_terms,price}');
   tp.visits := (p_payload#>>'{orthodontic_terms,visits}')::integer;
   tp.validity_days := (p_payload#>>'{orthodontic_terms,days}')::integer;
   if tp.visits>365 or tp.validity_days>3650 or tp.price<1
      or (select count(*) from clinic_reception.template_lines where template_id=tp.id)<>1
      or not exists(select 1 from clinic_reception.template_lines where template_id=tp.id and visit_no=1)
      or to_jsonb(tp)->>'orthodontic' is distinct from 'true' then
    raise exception 'اختر قالب تقويم معتمد بمكوّن زيارة واحد وراجع مدة العقد';
   end if;
   if jsonb_typeof(p_payload->'installments') is distinct from 'array'
      or jsonb_array_length(p_payload->'installments')<>tp.visits+1
      or (p_payload->'installments'->0->>'amount')::numeric is distinct from round(tp.price/4,2) then
    raise exception 'راجع جدول التقويم والمقدم';
   end if;
  end if;
$patch$||marker);
 revised := replace(revised,
   '  select sum(quantity*standalone_price),count(*) into sum_price,remaining from clinic_reception.template_lines where template_id=tp.id;',
   $patch$
  if p_payload ? 'orthodontic_terms' then
   update clinic_reception.packages set payment_schedule=p_payload#>>'{orthodontic_terms,schedule}' where id=v;
   insert into clinic_reception.entitlements(package_id,visit_no,service_id,quantity,allocated_value,snapshot)
   select v,seq,l.service_id,l.quantity,
          trunc(tp.price*seq/tp.visits,2)-trunc(tp.price*(seq-1)/tp.visits,2),l.service_snapshot
   from clinic_reception.template_lines l cross join generate_series(1,tp.visits) seq
   where l.template_id=tp.id;
  else
   select sum(quantity*standalone_price),count(*) into sum_price,remaining from clinic_reception.template_lines where template_id=tp.id;
$patch$);
 revised := replace(revised,'  -- An optional schedule is a reminder/contract term, not automatically an unconditional receivable.',
  E'  end if;\n  -- An optional schedule is a reminder/contract term, not automatically an unconditional receivable.');
 if strpos(revised,'generate_series(1,tp.visits)')=0 or strpos(revised,'  end if;'||chr(10)||'  -- An optional schedule')=0 then
  raise exception 'Package contracting body changed';
 end if;
 revised := replace(revised,
   'insert into clinic_reception.installments(package_id,due_on,amount,unconditional,created_by) values(v,(material->>''due_on'')::date,percent,false,p_me);',
   'insert into clinic_reception.installments(package_id,due_on,amount,unconditional,created_by,plan_visit_no) values(v,(material->>''due_on'')::date,percent,false,p_me,case when p_payload ? ''orthodontic_terms'' then n end); n:=n+1;');
 if strpos(revised,'created_by,plan_visit_no)')=0 then raise exception 'Installment insertion point changed'; end if;
 execute revised;
end
$migration$;
alter function public.clinic_reception_snapshot(uuid,date,date) rename to snapshot_before_orthodontics;
alter function public.snapshot_before_orthodontics(uuid,date,date) set schema clinic_reception;
revoke all on function clinic_reception.snapshot_before_orthodontics(uuid,date,date) from public,anon,authenticated;
create function public.clinic_reception_snapshot(p_workspace uuid,p_from date default current_date,p_to date default current_date)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
 result:=clinic_reception.snapshot_before_orthodontics(p_workspace,p_from,p_to);
 return result||jsonb_build_object('attended_package_visits',(
  select coalesce(jsonb_object_agg(package_id,visits),'{}'::jsonb)
  from (
   select a.package_id,jsonb_agg(distinct a.package_visit_no) visits
   from clinic_reception.appointments a
   join clinic_reception.visits v on v.appointment_id=a.id
   where a.workspace_id=p_workspace and a.package_id is not null
     and a.status in ('arrived','completed')
   group by a.package_id
  ) attended
 ));
end $$;
revoke all on function public.clinic_reception_snapshot(uuid,date,date) from public,anon,authenticated;
grant execute on function public.clinic_reception_snapshot(uuid,date,date) to authenticated;
commit;
