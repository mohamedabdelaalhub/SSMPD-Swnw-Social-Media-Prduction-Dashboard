#!/bin/bash
# Throwaway Postgres rehearsal incl. storage/auth stubs. Run: sudo bash rehearse-service-orders-reports.sh <dir>
set -euo pipefail
D="$1"; N=swnw-rehearse4-$$
trap 'docker rm -f $N >/dev/null 2>&1 || true' EXIT
docker run -d --name $N -e POSTGRES_PASSWORD=x --network none postgres:16-alpine >/dev/null
for i in $(seq 1 40); do docker exec $N pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done; sleep 2
q(){ docker exec -i $N psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
q <<'SQL'
create role authenticated nologin; create role anon nologin;
create schema clinic_reception; create schema storage; create schema auth;
create function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('test.uid',true),'')::uuid $f$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security;
create table public.patient_accounts(id uuid primary key default gen_random_uuid(),auth_user_id uuid,status text);
create table public.patient_account_access(id uuid primary key default gen_random_uuid(),account_id uuid,patient_id uuid,verification_status text,revoked_at timestamptz,expires_at timestamptz);
create table clinic_reception.workspaces(id uuid primary key default gen_random_uuid());
create table clinic_reception.services(id uuid primary key default gen_random_uuid(),workspace_id uuid,name text,price numeric,code text,department text,active boolean default true);
create table clinic_reception.providers(id uuid primary key default gen_random_uuid(),workspace_id uuid,name text,doctor_key text,active boolean default true);
create table clinic_reception.patients(id uuid primary key default gen_random_uuid(),workspace_id uuid,patient_id uuid,name text,phone text);
create table clinic_reception.visits(id uuid primary key default gen_random_uuid(),workspace_id uuid,patient_id uuid);
create table clinic_reception.orders(id uuid primary key default gen_random_uuid(),workspace_id uuid,visit_id uuid,service_id uuid,provider_id uuid,quantity numeric not null default 1,price numeric not null,discount numeric not null default 0,snapshot jsonb);
create table clinic_reception.audit(id bigint generated always as identity primary key,workspace_id uuid,actor_id uuid not null,action text not null,entity_id uuid,created_at timestamptz default now(),detail jsonb not null default '{}');
create function clinic_reception.access(p_workspace uuid,p_action text) returns uuid language plpgsql as $f$
begin if current_setting('test.deny',true)='1' then raise exception 'denied'; end if; return gen_random_uuid(); end $f$;
create function public.fails(sqltext text,pattern text) returns void language plpgsql as $f$
begin begin execute sqltext; exception when others then if sqlerrm like pattern then return; end if; raise exception 'FAIL wrong error: %',sqlerrm; end; raise exception 'FAIL expected error %',pattern; end $f$;
create function public.assert_eq(a numeric,b numeric) returns void language plpgsql as $f$ begin if a is distinct from b then raise exception 'FAIL expected % got %',b,a; end if; end $f$;
SQL
q < "$D/service-orders-migration.sql"; q < "$D/service-orders-rpcs.sql"
echo "== reports apply x2"; q < "$D/service-orders-reports.sql"; q < "$D/service-orders-reports.sql"
echo "== behaviour"
q <<'SQL'
create temp table ids as select gen_random_uuid() w, gen_random_uuid() o, gen_random_uuid() s, gen_random_uuid() pat, gen_random_uuid() rp, gen_random_uuid() vis,
  gen_random_uuid() acc_ok, gen_random_uuid() u_ok, gen_random_uuid() acc_bad, gen_random_uuid() u_bad;
insert into clinic_reception.workspaces select w from ids;
insert into clinic_reception.services(id,workspace_id,name,price) select s,w,'CBC',100 from ids;
insert into clinic_reception.patients(id,workspace_id,patient_id,name,phone) select rp,w,pat,'Mona','0100' from ids;
insert into clinic_reception.visits(id,workspace_id,patient_id) select vis,w,rp from ids;
insert into clinic_reception.orders(id,workspace_id,visit_id,service_id,price,snapshot) select o,w,vis,s,100,'{"name":"CBC"}'::jsonb from ids;
insert into clinic_reception.order_ext(order_id,kind) select o,'lab' from ids;
insert into public.patient_accounts(id,auth_user_id,status) select acc_ok,u_ok,'active' from ids union all select acc_bad,u_bad,'active' from ids;
insert into public.patient_account_access(account_id,patient_id,verification_status) select acc_ok,pat,'approved' from ids;
insert into public.patient_account_access(account_id,patient_id,verification_status,revoked_at) select acc_bad,pat,'revoked',now() from ids;
-- bucket private with limits
select assert_eq((select count(*) from storage.buckets where id='service-reports' and public=false and file_size_limit=20971520)::numeric,1);
select assert_eq((select count(*) from pg_policies where schemaname='storage' and policyname like 'so_reports_%')::numeric,3);
-- path validation
select assert_eq((public.clinic_reception_so_path_ok('00000000-0000-0000-0000-000000000000/00000000-0000-0000-0000-000000000001/a.pdf'))::int::numeric,1);
select assert_eq((public.clinic_reception_so_path_ok('00000000-0000-0000-0000-000000000000/00000000-0000-0000-0000-000000000001/../x.pdf'))::int::numeric,0);
select assert_eq((public.clinic_reception_so_path_ok('x/y/z.pdf'))::int::numeric,0);
select assert_eq((public.clinic_reception_so_path_ok('00000000-0000-0000-0000-000000000000/00000000-0000-0000-0000-000000000001/a b.pdf'))::int::numeric,0);
-- upload only after 'done'
select assert_eq((public.clinic_reception_so_can_upload(w||'/'||o||'/r.pdf'))::int::numeric,0) from ids;
update clinic_reception.order_ext set status='scheduled'; update clinic_reception.order_ext set status='attended'; update clinic_reception.order_ext set status='done';
select assert_eq((public.clinic_reception_so_can_upload(w||'/'||o||'/r.pdf'))::int::numeric,1) from ids;
select assert_eq((public.clinic_reception_so_can_upload(gen_random_uuid()||'/'||o||'/r.pdf'))::int::numeric,0) from ids;   -- wrong workspace
-- register requires an existing object and matching path
select public.fails(format($$select public.clinic_reception_so_register_report(%L,%L,%L,'r.pdf','application/pdf',10)$$,w,o,w||'/'||o||'/r.pdf'),'%غير مرفوع%') from ids;
insert into storage.objects(bucket_id,name) select 'service-reports',w||'/'||o||'/r.pdf' from ids;
select public.fails(format($$select public.clinic_reception_so_register_report(%L,%L,%L,'r.pdf','application/pdf',10)$$,w,gen_random_uuid(),w||'/'||o||'/r.pdf'),'%مسار%') from ids;
select public.fails(format($$select public.clinic_reception_so_register_report(%L,%L,%L,'r.exe','application/x-msdownload',10)$$,w,o,w||'/'||o||'/r.pdf'),'%check%') from ids;
select public.clinic_reception_so_register_report(w,o,w||'/'||o||'/r.pdf','r.pdf','application/pdf',10) from ids;
select assert_eq((select count(*) from clinic_reception.order_ext where status='report_uploaded' and report_file_ref is not null)::numeric,1);
select assert_eq((select count(*) from clinic_reception.audit where action='so_report_registered')::numeric,1);
-- staff read ok / denied
select assert_eq((public.clinic_reception_so_can_read_staff(w||'/'||o||'/r.pdf'))::int::numeric,1) from ids;
select assert_eq(jsonb_array_length(public.clinic_reception_so_reports(w,o))::numeric,1) from ids;
-- patient access: approved account sees it; revoked account and anonymous do not
select set_config('test.uid',u_ok::text,false) from ids;
select assert_eq((public.clinic_reception_so_patient_can_read(w||'/'||o||'/r.pdf'))::int::numeric,1) from ids;
select assert_eq(jsonb_array_length(public.patient_portal_service_reports())::numeric,1);
select set_config('test.uid',u_bad::text,false) from ids;
select assert_eq((public.clinic_reception_so_patient_can_read(w||'/'||o||'/r.pdf'))::int::numeric,0) from ids;
select assert_eq(jsonb_array_length(public.patient_portal_service_reports())::numeric,0);
select set_config('test.uid','',false);
select assert_eq(jsonb_array_length(public.patient_portal_service_reports())::numeric,0);
-- hidden report not visible to patient
select set_config('test.uid',u_ok::text,false) from ids;
update clinic_reception.order_reports set patient_visible=false;
select assert_eq(jsonb_array_length(public.patient_portal_service_reports())::numeric,0);
select assert_eq((public.clinic_reception_so_patient_can_read(w||'/'||o||'/r.pdf'))::int::numeric,0) from ids;
-- staff denied path
set test.deny='1';
select assert_eq((public.clinic_reception_so_can_read_staff(w||'/'||o||'/r.pdf'))::int::numeric,0) from ids;
select public.fails(format($$select public.clinic_reception_so_reports(%L,%L)$$,w,o),'%denied%') from ids;
SQL
echo "== rollback"; q < "$D/service-orders-reports-rollback.sql"; q < "$D/service-orders-rpcs-rollback.sql"; q < "$D/service-orders-rollback.sql"
echo REHEARSAL_REPORTS_OK
