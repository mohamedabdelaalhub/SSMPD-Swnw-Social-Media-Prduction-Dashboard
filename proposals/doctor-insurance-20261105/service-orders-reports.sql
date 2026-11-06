-- ADDITIVE ONLY. Private bucket + report registry + storage policies + RPCs. Review file.
begin;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('service-reports','service-reports',false,20971520,array['application/pdf','image/jpeg','image/png'])
on conflict(id) do nothing;

create table if not exists clinic_reception.order_reports(
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references clinic_reception.orders(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null check (mime_type in ('application/pdf','image/jpeg','image/png')),
  file_size bigint not null check (file_size>0 and file_size<=20971520),
  checksum text,
  patient_visible boolean not null default true,
  uploaded_by uuid not null,
  uploaded_at timestamptz not null default now());
alter table clinic_reception.order_reports enable row level security;

-- path format: <workspace uuid>/<order uuid>/<safe file name>
create or replace function public.clinic_reception_so_path_ok(p_name text) returns boolean language sql immutable as $$
 select p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9._-]{1,120}$' and p_name not like '%..%' $$;

create or replace function public.clinic_reception_so_can_upload(p_name text) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
declare ws uuid; ord uuid; ok boolean:=false;
begin
 if not public.clinic_reception_so_path_ok(p_name) then return false;end if;
 ws:=split_part(p_name,'/',1)::uuid; ord:=split_part(p_name,'/',2)::uuid;
 begin perform clinic_reception.access(ws,'execute'); ok:=true; exception when others then return false; end;
 return exists(select 1 from clinic_reception.orders o join clinic_reception.order_ext x on x.order_id=o.id
   where o.id=ord and o.workspace_id=ws and x.status='done');
end $$;

create or replace function public.clinic_reception_so_can_read_staff(p_name text) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
declare ws uuid;
begin
 if not public.clinic_reception_so_path_ok(p_name) then return false;end if;
 ws:=split_part(p_name,'/',1)::uuid;
 begin perform clinic_reception.access(ws,'view'); return true; exception when others then return false; end;
end $$;

create or replace function public.clinic_reception_so_patient_can_read(p_name text) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(
  select 1 from clinic_reception.order_reports r
  join clinic_reception.orders o on o.id=r.order_id
  join clinic_reception.visits v on v.id=o.visit_id
  join clinic_reception.patients p on p.id=v.patient_id
  join public.patient_account_access a on a.patient_id=p.patient_id
  join public.patient_accounts pa on pa.id=a.account_id
  where r.storage_path=p_name and r.patient_visible and pa.auth_user_id=auth.uid() and pa.status='active'
    and a.verification_status='approved' and a.revoked_at is null and (a.expires_at is null or a.expires_at>now())) $$;

revoke all on function public.clinic_reception_so_path_ok(text),public.clinic_reception_so_can_upload(text),public.clinic_reception_so_can_read_staff(text),public.clinic_reception_so_patient_can_read(text) from public,anon;
grant execute on function public.clinic_reception_so_path_ok(text),public.clinic_reception_so_can_upload(text),public.clinic_reception_so_can_read_staff(text),public.clinic_reception_so_patient_can_read(text) to authenticated;

drop policy if exists so_reports_insert on storage.objects;
create policy so_reports_insert on storage.objects for insert to authenticated
  with check (bucket_id='service-reports' and public.clinic_reception_so_can_upload(name));
drop policy if exists so_reports_staff_read on storage.objects;
create policy so_reports_staff_read on storage.objects for select to authenticated
  using (bucket_id='service-reports' and public.clinic_reception_so_can_read_staff(name));
drop policy if exists so_reports_patient_read on storage.objects;
create policy so_reports_patient_read on storage.objects for select to authenticated
  using (bucket_id='service-reports' and public.clinic_reception_so_patient_can_read(name));

create or replace function public.clinic_reception_so_register_report(p_workspace uuid,p_order uuid,p_path text,p_name text,p_mime text,p_size bigint,p_checksum text default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=clinic_reception.access(p_workspace,'execute'); rid uuid;
begin
 if not public.clinic_reception_so_path_ok(p_path) or split_part(p_path,'/',1)<>p_workspace::text or split_part(p_path,'/',2)<>p_order::text then
   raise exception 'مسار الملف غير صحيح';end if;
 if not exists(select 1 from storage.objects where bucket_id='service-reports' and name=p_path) then raise exception 'الملف غير مرفوع';end if;
 if not exists(select 1 from clinic_reception.order_ext x join clinic_reception.orders o on o.id=x.order_id
     where x.order_id=p_order and o.workspace_id=p_workspace and x.status='done') then raise exception 'التقرير يُرفع بعد اكتمال التنفيذ فقط';end if;
 insert into clinic_reception.order_reports(order_id,storage_path,file_name,mime_type,file_size,checksum,uploaded_by)
   values(p_order,p_path,left(trim(p_name),200),p_mime,p_size,p_checksum,me) returning id into rid;
 update clinic_reception.order_ext set report_file_ref=p_path,status='report_uploaded' where order_id=p_order;
 insert into clinic_reception.audit(workspace_id,actor_id,action,entity_id,detail)
   values(p_workspace,me,'so_report_registered',p_order,jsonb_build_object('path',p_path,'size',p_size,'mime',p_mime));
 return jsonb_build_object('report_id',rid,'order_id',p_order,'status','report_uploaded');
end $$;

create or replace function public.clinic_reception_so_reports(p_workspace uuid,p_order uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare me uuid:=clinic_reception.access(p_workspace,'view');
begin
 return coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'path',r.storage_path,'file_name',r.file_name,'mime',r.mime_type,'size',r.file_size,'uploaded_at',r.uploaded_at) order by r.uploaded_at desc)
   from clinic_reception.order_reports r join clinic_reception.orders o on o.id=r.order_id
   where r.order_id=p_order and o.workspace_id=p_workspace),'[]'::jsonb);
end $$;

create or replace function public.patient_portal_service_reports() returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'service',o.snapshot->>'name','uploaded_at',r.uploaded_at,'file_name',r.file_name,'mime',r.mime_type,'path',r.storage_path) order by r.uploaded_at desc),'[]'::jsonb)
 from clinic_reception.order_reports r
 join clinic_reception.orders o on o.id=r.order_id
 join clinic_reception.visits v on v.id=o.visit_id
 join clinic_reception.patients p on p.id=v.patient_id
 join public.patient_account_access a on a.patient_id=p.patient_id
 join public.patient_accounts pa on pa.id=a.account_id
 where r.patient_visible and pa.auth_user_id=auth.uid() and pa.status='active' and a.verification_status='approved'
   and a.revoked_at is null and (a.expires_at is null or a.expires_at>now()) $$;

revoke all on function public.clinic_reception_so_register_report(uuid,uuid,text,text,text,bigint,text),public.clinic_reception_so_reports(uuid,uuid),public.patient_portal_service_reports() from public,anon,authenticated;
grant execute on function public.clinic_reception_so_register_report(uuid,uuid,text,text,text,bigint,text),public.clinic_reception_so_reports(uuid,uuid),public.patient_portal_service_reports() to authenticated;
commit;
