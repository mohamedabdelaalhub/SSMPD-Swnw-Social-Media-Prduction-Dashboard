begin;
create table clinic_reception.split_receipts (
 workspace_id uuid not null references clinic_reception.workspaces(id),
 actor_id uuid not null references public.admins(id),
 token uuid not null,
 payload jsonb not null,
 payment_ids uuid[] not null,
 total numeric(14,2) not null,
 primary key(workspace_id,actor_id,token)
);
alter table clinic_reception.split_receipts enable row level security;
revoke all on clinic_reception.split_receipts from public,anon,authenticated;

create table clinic_reception.plan_schedule_revisions (
 workspace_id uuid not null references clinic_reception.workspaces(id),
 package_id uuid not null references clinic_reception.packages(id),
 actor_id uuid not null references public.admins(id),
 token uuid not null,
 reason text not null,
 before_schedule jsonb not null,
 after_schedule jsonb not null,
 changed_at timestamptz not null default now(),
 primary key(workspace_id,actor_id,token)
);
alter table clinic_reception.plan_schedule_revisions enable row level security;
revoke all on clinic_reception.plan_schedule_revisions from public,anon,authenticated;

create function clinic_reception.revise_plan_schedule(w uuid,p jsonb,t uuid)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare
 actor uuid:=clinic_reception.access(w,'manage');
 pkg uuid:=(p->>'package_id')::uuid;
 before_rows jsonb;
 after_rows jsonb;
 reason_text text:=trim(coalesce(p->>'reason',''));
 previous clinic_reception.plan_schedule_revisions%rowtype;
begin
 if t is null or length(reason_text) not between 3 and 500
    or jsonb_typeof(p->'dates') is distinct from 'array'
    or jsonb_array_length(p->'dates') not between 1 and 365 then
  raise exception 'راجع تواريخ الأقساط وسبب التعديل';
 end if;
 perform 1 from clinic_reception.workspaces where id=w for update;
 select * into previous from clinic_reception.plan_schedule_revisions where workspace_id=w and actor_id=actor and token=t;
 if found then
  if previous.package_id is distinct from pkg or previous.reason is distinct from reason_text
     or previous.after_schedule is distinct from p->'dates' then raise exception 'مفتاح الإعادة مرتبط بتعديل آخر'; end if;
  return jsonb_build_object('id',pkg);
 end if;
 perform 1 from clinic_reception.packages where workspace_id=w and id=pkg and status='active' and payment_schedule='fixed' for update;
 if not found then raise exception 'الخطة غير متاحة لتعديل التواريخ'; end if;
 select jsonb_agg(jsonb_build_object('id',i.id,'due_on',i.due_on) order by i.id)
 into before_rows
 from clinic_reception.installments i
 join jsonb_to_recordset(p->'dates') d(id uuid,due_on date) on d.id=i.id
 where i.package_id=pkg and i.invoice_id is null and i.plan_visit_no>0
   and i.due_on>(now() at time zone 'Africa/Cairo')::date and d.due_on>(now() at time zone 'Africa/Cairo')::date;
 if jsonb_array_length(coalesce(before_rows,'[]'))<>jsonb_array_length(p->'dates')
    or (select count(distinct d->>'id') from jsonb_array_elements(p->'dates') d)<>jsonb_array_length(p->'dates') then
  raise exception 'يمكن تعديل تواريخ الأقساط المستقبلية غير المفوترة فقط';
 end if;
 update clinic_reception.installments i set due_on=d.due_on
 from jsonb_to_recordset(p->'dates') d(id uuid,due_on date) where i.id=d.id;
 after_rows:=p->'dates';
 insert into clinic_reception.plan_schedule_revisions(workspace_id,package_id,actor_id,token,reason,before_schedule,after_schedule)
 values(w,pkg,actor,t,reason_text,before_rows,after_rows);
 return jsonb_build_object('id',pkg);
end $$;
revoke all on function clinic_reception.revise_plan_schedule(uuid,jsonb,uuid) from public,anon,authenticated;

alter function public.clinic_reception_command(uuid,text,jsonb,uuid) rename to command_before_split_receipt;
alter function public.command_before_split_receipt(uuid,text,jsonb,uuid) set schema clinic_reception;
revoke all on function clinic_reception.command_before_split_receipt(uuid,text,jsonb,uuid) from public,anon,authenticated;

create function public.clinic_reception_command(p_workspace uuid,p_action text,p_payload jsonb,p_token uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
 actor uuid;
 prev clinic_reception.split_receipts%rowtype;
 part jsonb;
 response jsonb;
 ids uuid[]:='{}';
 total numeric:=0;
 ordinal integer:=0;
begin
 if p_action='revise_plan_schedule' then
  return clinic_reception.revise_plan_schedule(p_workspace,p_payload,p_token);
 end if;
 if p_action is distinct from 'collect_split' then
  return clinic_reception.command_before_split_receipt(p_workspace,p_action,p_payload,p_token);
 end if;
 actor:=clinic_reception.access(p_workspace,'collect');
 if p_token is null or jsonb_typeof(p_payload->'parts') is distinct from 'array'
    or octet_length(p_payload::text)>10000 then raise exception 'راجع بيانات الإيصال'; end if;
 if jsonb_array_length(p_payload->'parts') not between 2 and 5 then
  raise exception 'أدخل من طريقتين إلى خمس طرق للسداد';
 end if;
 perform 1 from clinic_reception.workspaces where id=p_workspace for update;
 select * into prev from clinic_reception.split_receipts
 where workspace_id=p_workspace and actor_id=actor and token=p_token;
 if found then
  if prev.payload is distinct from p_payload then raise exception 'مفتاح الإعادة مرتبط بإيصال آخر'; end if;
  return jsonb_build_object('id',p_token,'total',prev.total,'payment_ids',prev.payment_ids);
 end if;
 for part in select value from jsonb_array_elements(p_payload->'parts') loop
  if jsonb_typeof(part) is distinct from 'object' then raise exception 'راجع بند السداد'; end if;
  ordinal:=ordinal+1;
  total:=total+clinic_reception.number(part->>'amount');
  response:=clinic_reception.command_before_split_receipt(p_workspace,'collect',
   (p_payload - 'parts')||jsonb_build_object('amount',part->>'amount','method',part->>'method',
    'reference',part->>'reference','shift_id',part->>'shift_id'),
   md5('split:'||p_token::text||':'||ordinal)::uuid);
  ids:=array_append(ids,(response->>'id')::uuid);
 end loop;
 insert into clinic_reception.split_receipts values(p_workspace,actor,p_token,p_payload,ids,total);
 return jsonb_build_object('id',p_token,'total',total,'payment_ids',ids);
end $$;
revoke all on function public.clinic_reception_command(uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.clinic_reception_command(uuid,text,jsonb,uuid) to authenticated;
alter function public.clinic_reception_snapshot(uuid,date,date) rename to snapshot_before_split_receipt;
alter function public.snapshot_before_split_receipt(uuid,date,date) set schema clinic_reception;
revoke all on function clinic_reception.snapshot_before_split_receipt(uuid,date,date) from public,anon,authenticated;
create function public.clinic_reception_snapshot(p_workspace uuid,p_from date default current_date,p_to date default current_date)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 return clinic_reception.snapshot_before_split_receipt(p_workspace,p_from,p_to)||jsonb_build_object(
  'split_receipts_enabled',true,
  'split_receipts',coalesce((
   select jsonb_agg(jsonb_build_object('id',r.token,'package_id',r.payload->>'package_id','total',r.total))
   from clinic_reception.split_receipts r
   where r.workspace_id=p_workspace and r.actor_id=public.my_admin_id()
  ),'[]'::jsonb)
 );
end $$;
revoke all on function public.clinic_reception_snapshot(uuid,date,date) from public,anon,authenticated;
grant execute on function public.clinic_reception_snapshot(uuid,date,date) to authenticated;
commit;
