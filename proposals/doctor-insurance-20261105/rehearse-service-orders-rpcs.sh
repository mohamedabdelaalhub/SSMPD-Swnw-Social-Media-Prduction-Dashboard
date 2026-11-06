#!/bin/bash
# Throwaway Postgres rehearsal of tables + RPCs. Run: sudo bash rehearse-service-orders-rpcs.sh <dir>
set -euo pipefail
D="$1"; N=swnw-rehearse2-$$
trap 'docker rm -f $N >/dev/null 2>&1 || true' EXIT
docker run -d --name $N -e POSTGRES_PASSWORD=x --network none postgres:16-alpine >/dev/null
for i in $(seq 1 40); do docker exec $N pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done; sleep 2
q(){ docker exec -i $N psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
q <<'SQL'
create schema clinic_reception;
create role authenticated nologin; create role anon nologin;
create table clinic_reception.workspaces(id uuid primary key default gen_random_uuid());
create table clinic_reception.services(id uuid primary key default gen_random_uuid(), workspace_id uuid, name text, price numeric);
create table clinic_reception.patients(id uuid primary key default gen_random_uuid(), workspace_id uuid, name text, phone text);
create table clinic_reception.visits(id uuid primary key default gen_random_uuid(), workspace_id uuid, patient_id uuid);
create table clinic_reception.orders(id uuid primary key default gen_random_uuid(), workspace_id uuid, visit_id uuid, service_id uuid,
  provider_id uuid, quantity numeric not null default 1, price numeric not null, discount numeric not null default 0, snapshot jsonb);
create function clinic_reception.access(p_workspace uuid,p_action text) returns uuid language plpgsql as $f$
begin if current_setting('test.deny',true)='1' then raise exception 'denied'; end if; return gen_random_uuid(); end $f$;
create function public.assert_eq(a numeric,b numeric) returns void language plpgsql as $f$ begin if a is distinct from b then raise exception 'FAIL expected % got %',b,a; end if; end $f$;
SQL
q < "$D/service-orders-migration.sql"
echo "== rpcs apply x2"; q < "$D/service-orders-rpcs.sql"; q < "$D/service-orders-rpcs.sql"
echo "== behaviour"
q <<'SQL'
create temp table ids as select gen_random_uuid() w, gen_random_uuid() s_lab, gen_random_uuid() s_rad, gen_random_uuid() s_cons,
  gen_random_uuid() pat, gen_random_uuid() vis, gen_random_uuid() o_cons, gen_random_uuid() o_lab, gen_random_uuid() o_rad, gen_random_uuid() prov_lab, gen_random_uuid() prov_rad;
insert into clinic_reception.workspaces select w from ids;
insert into clinic_reception.services select s_lab,w,'CBC',100 from ids union all select s_rad,w,'US',200 from ids union all select s_cons,w,'Consult',300 from ids;
insert into clinic_reception.patients select pat,w,'Mona','0100' from ids;
insert into clinic_reception.visits select vis,w,pat from ids;
insert into clinic_reception.orders(id,workspace_id,visit_id,service_id,price,discount,snapshot)
  select o_cons,w,vis,s_cons,300,20,'{"name":"Consult"}'::jsonb from ids union all
  select o_lab,w,vis,s_lab,100,0,'{"name":"CBC"}'::jsonb from ids union all
  select o_rad,w,vis,s_rad,200,10,'{"name":"US"}'::jsonb from ids;
insert into clinic_reception.external_providers(id,workspace_id,name,kind,phone,terms)
  select prov_lab,w,'Lab A','lab','0111','{}'::jsonb from ids union all
  select prov_rad,w,'Rad B','radiology','0122','{"providerSharePercent":70,"centerSharePercent":30}'::jsonb from ids;
insert into clinic_reception.referral_rates(workspace_id,doctor_key,category,percent) select w,'dr9','consult',10 from ids;
insert into clinic_reception.service_performers(service_id,doctor_key) select s_rad,'drA' from ids;

-- internal consult with referral: net 240, commission 24
select assert_eq((public.clinic_reception_so_attach(w,o_cons,'{"kind":"service","referring_doctor_key":"dr9","category":"consult"}')->'priced'->>'referral_commission')::numeric,24) from ids;
-- external lab without cost list -> error
do $$ declare r ids%rowtype; begin select * into r from ids; begin
  perform public.clinic_reception_so_attach(r.w,r.o_lab,jsonb_build_object('kind','lab','mode','external','provider_id',r.prov_lab));
  raise exception 'FAIL missing cost accepted'; exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end; end $$;
insert into clinic_reception.provider_cost_list select prov_lab,s_lab,extract(year from current_date)::int,40 from ids;
select assert_eq((public.clinic_reception_so_attach(w,o_lab,jsonb_build_object('kind','lab','mode','external','provider_id',prov_lab))->'priced'->>'provider_payable')::numeric,40) from ids;
-- radiology performer allow-list
do $$ declare r ids%rowtype; begin select * into r from ids; begin
  perform public.clinic_reception_so_attach(r.w,r.o_rad,jsonb_build_object('kind','radiology','mode','external','provider_id',r.prov_rad,'performing_doctor_key','drX'));
  raise exception 'FAIL wrong performer accepted'; exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end; end $$;
select assert_eq((public.clinic_reception_so_attach(w,o_rad,jsonb_build_object('kind','radiology','mode','external','provider_id',prov_rad,'performing_doctor_key','drA'))->'priced'->>'provider_payable')::numeric,126) from ids;
-- status flow + report
select public.clinic_reception_so_set_status(w,o_lab,'scheduled') from ids;
do $$ declare r ids%rowtype; begin select * into r from ids; begin
  perform public.clinic_reception_so_attach_report(r.w,r.o_lab,'reports/a.pdf'); raise exception 'FAIL report before done';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end; end $$;
select public.clinic_reception_so_set_status(w,o_lab,'attended') from ids;
select public.clinic_reception_so_set_status(w,o_lab,'done') from ids;
do $$ declare r ids%rowtype; begin select * into r from ids; begin
  perform public.clinic_reception_so_attach_report(r.w,r.o_lab,'../etc/passwd'); raise exception 'FAIL bad path';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end; end $$;
select public.clinic_reception_so_attach_report(w,o_lab,'reports/a.pdf') from ids;
-- board minimal data: no price/commission keys
select assert_eq((select count(*) from ids, jsonb_array_elements(public.clinic_reception_so_provider_board(w)) e where e ? 'price' or e ? 'priced' or e ? 'referral_commission')::numeric,0) from ids;
select assert_eq(jsonb_array_length(public.clinic_reception_so_provider_board(w))::numeric,2) from ids;
-- access denied
set test.deny='1';
do $$ declare r ids%rowtype; begin select * into r from ids; begin perform public.clinic_reception_so_catalog(r.w);
  raise exception 'FAIL denied access allowed'; exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end; end $$;
SQL
echo "== rollback rpcs + tables"; q < "$D/service-orders-rpcs-rollback.sql"; q < "$D/service-orders-rollback.sql"
echo REHEARSAL_RPCS_OK
