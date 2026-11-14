begin;
create table clinic_reception.plan_amendments (
 workspace_id uuid not null references clinic_reception.workspaces(id),
 actor_id uuid not null references public.admins(id),
 token uuid not null,
 package_id uuid not null references clinic_reception.packages(id),
 request jsonb not null,
 previous_terms jsonb not null,
 changed_at timestamptz not null default now(),
 primary key(workspace_id,actor_id,token)
);
alter table clinic_reception.plan_amendments enable row level security;
revoke all on clinic_reception.plan_amendments from public,anon,authenticated;

create function clinic_reception.amend_plan(w uuid,p jsonb,t uuid)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare
 actor uuid:=clinic_reception.access(w,'manage');
 pkg clinic_reception.packages%rowtype;
 previous clinic_reception.plan_amendments%rowtype;
 service_line clinic_reception.template_lines%rowtype;
 old_terms jsonb;
 new_price numeric(14,2);
 new_visits integer;
 paid numeric;
 locked_visits integer;
 locked_price numeric;
 locked_installments numeric;
 future_visits integer;
 n integer;
begin
 if t is null or jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>12000
    or length(trim(coalesce(p->>'reason',''))) not between 3 and 500
    or coalesce(p->>'visits','') !~ '^[1-9][0-9]{0,2}$' then
  raise exception 'راجع السعر وعدد الزيارات وسبب التعديل';
 end if;
 new_price:=clinic_reception.number(p->>'price');
 new_visits:=(p->>'visits')::integer;
 perform 1 from clinic_reception.workspaces where id=w for update;
 select * into previous from clinic_reception.plan_amendments
 where workspace_id=w and actor_id=actor and token=t;
 if found then
  if previous.request is distinct from p then raise exception 'مفتاح الإعادة مرتبط بتعديل آخر'; end if;
  return jsonb_build_object('id',previous.package_id);
 end if;
 select * into pkg from clinic_reception.packages
 where id=(p->>'package_id')::uuid and workspace_id=w and status='active' and payment_schedule='visit' for update;
 if not found then raise exception 'اختر خطة نشطة مرتبطة بحضور الزيارات'; end if;
 select greatest(
  coalesce((select max(package_visit_no) from clinic_reception.appointments
   where package_id=pkg.id and status in ('booked','arrived','completed')),0),
  coalesce((select max(visit_no) from clinic_reception.entitlements
   where package_id=pkg.id and (used>0 or recognized>0)),0),
  coalesce((select max(plan_visit_no) from clinic_reception.installments
   where package_id=pkg.id and invoice_id is not null),0)
 ) into locked_visits;
 if new_visits>365 or new_visits<=locked_visits or new_price<1 then
  raise exception 'راجع عدد الزيارات المستقبلية بعد الزيارات المحجوزة أو المنفذة';
 end if;
 future_visits:=new_visits-locked_visits;
 select coalesce(sum(amount-credit_amount),0) into paid from clinic_reception.payments where package_id=pkg.id;
 if new_price<greatest(paid,pkg.funded) then raise exception 'السعر الجديد أقل من المبلغ المحصل أو المخصص'; end if;
 select * into strict service_line from clinic_reception.template_lines where template_id=pkg.template_id;
 select jsonb_build_object('price',pkg.contract_price,'visits',pkg.visits,
 'installments',(select jsonb_agg(to_jsonb(i) order by i.plan_visit_no) from clinic_reception.installments i where package_id=pkg.id))
 into old_terms;
 select coalesce(sum(allocated_value),0) into locked_price
 from clinic_reception.entitlements where package_id=pkg.id and visit_no<=locked_visits;
 select coalesce(sum(amount),0) into locked_installments
 from clinic_reception.installments where package_id=pkg.id and plan_visit_no<=locked_visits;
 if new_price-locked_price<future_visits*0.01 or new_price-locked_installments<future_visits*0.01 then
  raise exception 'السعر لا يغطي المبالغ السابقة والزيارات المتبقية';
 end if;
 delete from clinic_reception.installments where package_id=pkg.id and plan_visit_no>locked_visits;
 delete from clinic_reception.entitlements where package_id=pkg.id and visit_no>locked_visits;
 for n in 1..future_visits loop
  insert into clinic_reception.entitlements(package_id,visit_no,service_id,quantity,allocated_value,snapshot)
  values(pkg.id,locked_visits+n,service_line.service_id,service_line.quantity,
   trunc((new_price-locked_price)*n/future_visits,2)-trunc((new_price-locked_price)*(n-1)/future_visits,2),service_line.service_snapshot);
  insert into clinic_reception.installments(package_id,due_on,amount,created_by,plan_visit_no)
  values(pkg.id,(now() at time zone 'Africa/Cairo')::date,
   trunc((new_price-locked_installments)*n/future_visits,2)-trunc((new_price-locked_installments)*(n-1)/future_visits,2),actor,locked_visits+n);
 end loop;
 update clinic_reception.packages set contract_price=new_price,visits=new_visits where id=pkg.id;
 insert into clinic_reception.plan_amendments(workspace_id,actor_id,token,package_id,request,previous_terms)
 values(w,actor,t,pkg.id,p,old_terms);
 return jsonb_build_object('id',pkg.id);
end $$;
revoke all on function clinic_reception.amend_plan(uuid,jsonb,uuid) from public,anon,authenticated;

create function clinic_reception.amend_laser_visit(w uuid,p jsonb,t uuid)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare
 actor uuid:=clinic_reception.access(w,'manage');
 old_line clinic_reception.entitlements%rowtype;
 service clinic_reception.services%rowtype;
 previous clinic_reception.plan_amendments%rowtype;
 qty numeric(14,3);
begin
 if t is null or jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>12000
    or length(trim(coalesce(p->>'reason',''))) not between 3 and 500 then
  raise exception 'راجع خدمة الليزر الجديدة وسبب التعديل';
 end if;
 perform 1 from clinic_reception.workspaces where id=w for update;
 select * into previous from clinic_reception.plan_amendments where workspace_id=w and actor_id=actor and token=t;
 if found then
  if previous.request is distinct from p then raise exception 'مفتاح الإعادة مرتبط بتعديل آخر'; end if;
  return jsonb_build_object('id',previous.package_id);
 end if;
 select e.* into old_line from clinic_reception.entitlements e
 join clinic_reception.packages b on b.id=e.package_id
 where e.id=(p->>'entitlement_id')::uuid and b.workspace_id=w and b.status='active' for update of e;
 if not found or old_line.used>0 or old_line.recognized>0 or exists (
  select 1 from clinic_reception.appointments a where a.package_id=old_line.package_id
   and a.package_visit_no=old_line.visit_no and a.status in ('booked','arrived','completed')
 ) then raise exception 'غيّر طريقة الحساب لزيارة مستقبلية لم تُحجز أو تُستخدم'; end if;
 select * into service from clinic_reception.services where id=(p->>'service_id')::uuid and workspace_id=w and active;
 if not found or old_line.snapshot->>'name' not like '%ليزر%' or service.name not like '%ليزر%'
    or not (exists(select 1 from clinic_reception.laser_pulse_services where service_code=old_line.snapshot->>'code')
         <> exists(select 1 from clinic_reception.laser_pulse_services where service_code=service.code)) then
  raise exception 'اختر خدمة ليزر نشطة بطريقة حساب مختلفة';
 end if;
 qty:=clinic_reception.number(p->>'quantity',0);
 update clinic_reception.entitlements set service_id=service.id,quantity=qty,snapshot=to_jsonb(service)
 where id=old_line.id;
 insert into clinic_reception.plan_amendments(workspace_id,actor_id,token,package_id,request,previous_terms)
 values(w,actor,t,old_line.package_id,p,to_jsonb(old_line));
 return jsonb_build_object('id',old_line.package_id);
end $$;
revoke all on function clinic_reception.amend_laser_visit(uuid,jsonb,uuid) from public,anon,authenticated;

alter function public.clinic_reception_command(uuid,text,jsonb,uuid) rename to command_before_plan_amendments;
alter function public.command_before_plan_amendments(uuid,text,jsonb,uuid) set schema clinic_reception;
revoke all on function clinic_reception.command_before_plan_amendments(uuid,text,jsonb,uuid) from public,anon,authenticated;
create function public.clinic_reception_command(p_workspace uuid,p_action text,p_payload jsonb,p_token uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if p_action='amend_laser_visit' then return clinic_reception.amend_laser_visit(p_workspace,p_payload,p_token); end if;
 if p_action='amend_plan' then return clinic_reception.amend_plan(p_workspace,p_payload,p_token); end if;
 return clinic_reception.command_before_plan_amendments(p_workspace,p_action,p_payload,p_token);
end $$;
revoke all on function public.clinic_reception_command(uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.clinic_reception_command(uuid,text,jsonb,uuid) to authenticated;
alter function public.clinic_reception_snapshot(uuid,date,date) rename to snapshot_before_plan_amendments;
alter function public.snapshot_before_plan_amendments(uuid,date,date) set schema clinic_reception;
revoke all on function clinic_reception.snapshot_before_plan_amendments(uuid,date,date) from public,anon,authenticated;
create function public.clinic_reception_snapshot(p_workspace uuid,p_from date default current_date,p_to date default current_date)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 return clinic_reception.snapshot_before_plan_amendments(p_workspace,p_from,p_to)||jsonb_build_object('plan_amendments_enabled',true);
end $$;
revoke all on function public.clinic_reception_snapshot(uuid,date,date) from public,anon,authenticated;
grant execute on function public.clinic_reception_snapshot(uuid,date,date) to authenticated;
commit;
