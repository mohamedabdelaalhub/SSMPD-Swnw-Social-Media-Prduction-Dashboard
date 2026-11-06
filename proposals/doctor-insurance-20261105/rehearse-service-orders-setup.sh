#!/bin/bash
# Throwaway Postgres rehearsal: tables + RPCs + setup RPCs. Run: sudo bash rehearse-service-orders-setup.sh <dir>
set -euo pipefail
D="$1"; N=swnw-rehearse3-$$
trap 'docker rm -f $N >/dev/null 2>&1 || true' EXIT
docker run -d --name $N -e POSTGRES_PASSWORD=x --network none postgres:16-alpine >/dev/null
for i in $(seq 1 40); do docker exec $N pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done; sleep 2
q(){ docker exec -i $N psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
q <<'SQL'
create schema clinic_reception;
create role authenticated nologin; create role anon nologin;
create table clinic_reception.workspaces(id uuid primary key default gen_random_uuid());
create table clinic_reception.services(id uuid primary key default gen_random_uuid(), workspace_id uuid, code text, name text, department text, price numeric, active boolean default true);
create table clinic_reception.providers(id uuid primary key default gen_random_uuid(), workspace_id uuid, name text, doctor_key text, active boolean default true);
create table clinic_reception.patients(id uuid primary key default gen_random_uuid(), workspace_id uuid, name text, phone text);
create table clinic_reception.visits(id uuid primary key default gen_random_uuid(), workspace_id uuid, patient_id uuid);
create table clinic_reception.orders(id uuid primary key default gen_random_uuid(), workspace_id uuid, visit_id uuid, service_id uuid, provider_id uuid, quantity numeric not null default 1, price numeric not null, discount numeric not null default 0, snapshot jsonb);
create table clinic_reception.audit(id bigint generated always as identity primary key, workspace_id uuid, actor_id uuid not null, action text not null, entity_id uuid, created_at timestamptz default now(), detail jsonb not null default '{}');
create function clinic_reception.access(p_workspace uuid,p_action text) returns uuid language plpgsql as $f$
begin if current_setting('test.deny',true)='1' then raise exception 'denied'; end if; return gen_random_uuid(); end $f$;
create function public.fails(sqltext text, pattern text) returns void language plpgsql as $f$
begin begin execute sqltext; exception when others then if sqlerrm like pattern then return; end if; raise exception 'FAIL wrong error: %',sqlerrm; end; raise exception 'FAIL expected error %',pattern; end $f$;
create function public.assert_eq(a numeric,b numeric) returns void language plpgsql as $f$ begin if a is distinct from b then raise exception 'FAIL expected % got %',b,a; end if; end $f$;
SQL
q < "$D/service-orders-migration.sql"; q < "$D/service-orders-rpcs.sql"
echo "== setup rpcs apply x2"; q < "$D/service-orders-setup-rpcs.sql"; q < "$D/service-orders-setup-rpcs.sql"
echo "== behaviour"
q <<'SQL'
create temp table ids as select gen_random_uuid() w, gen_random_uuid() s1, gen_random_uuid() lab;
insert into clinic_reception.workspaces select w from ids;
insert into clinic_reception.services(id,workspace_id,code,name,department,price) select s1,w,'c1','Consult','x',300 from ids;
insert into clinic_reception.providers(workspace_id,name,doctor_key) select w,'Dr A','drA' from ids;
select (public.clinic_reception_so_setup_save(w,'service_specialty',jsonb_build_object('service_id',s1,'specialty_id','neuro')))->>'op' from ids;
select (public.clinic_reception_so_setup_save(w,'service_specialty',jsonb_build_object('service_id',s1,'specialty_id','neuro')))->>'op' from ids; -- idempotent
select assert_eq(jsonb_array_length(public.clinic_reception_so_setup_load(w)->'service_specialties')::numeric,1) from ids;
select public.clinic_reception_so_setup_save(w,'performer',jsonb_build_object('service_id',s1,'doctor_key','drA')) from ids;
select public.fails(format($$select public.clinic_reception_so_setup_save(%L,'performer',jsonb_build_object('service_id',%L,'doctor_key','drA','specialty_id','neuro'))$$,w,s1),'%واحد فقط%') from ids;
select public.fails(format($$select public.clinic_reception_so_setup_save(%L,'performer',jsonb_build_object('service_id',%L,'doctor_key','nobody'))$$,w,s1),'%الطبيب غير موجود%') from ids;
-- referral rate: new rate closes the previous open one
select public.clinic_reception_so_setup_save(w,'referral_rate',jsonb_build_object('doctor_key','drA','category','consult','percent',10,'valid_from','2026-01-01')) from ids;
select public.clinic_reception_so_setup_save(w,'referral_rate',jsonb_build_object('doctor_key','drA','category','consult','percent',12,'valid_from','2026-06-01')) from ids;
select assert_eq((select count(*) from clinic_reception.referral_rates where valid_to='2026-05-31')::numeric,1);
select assert_eq((select count(*) from clinic_reception.referral_rates where valid_to is null)::numeric,1);
select public.fails(format($$select public.clinic_reception_so_setup_save(%L,'referral_rate',jsonb_build_object('doctor_key','drA','category','consult','percent',101))$$,w),'%بين 0 و100%') from ids;
select public.fails(format($$select public.clinic_reception_so_setup_save(%L,'referral_rate',jsonb_build_object('doctor_key','drA','category','bogus','percent',5))$$,w),'%تصنيف%') from ids;
-- providers + terms validation + cost
select public.clinic_reception_so_setup_save(w,'provider','{"name":"Lab A","kind":"lab","phone":"0111"}'::jsonb) from ids;
select public.clinic_reception_so_setup_save(w,'provider','{"name":"Rad B","kind":"radiology","terms":{"providerSharePercent":70,"centerSharePercent":30}}'::jsonb) from ids;
select public.fails(format($$select public.clinic_reception_so_setup_save(%L,'provider','{"name":"X","kind":"radiology","terms":{"providerSharePercent":170}}'::jsonb)$$,w),'%بين 0 و100%') from ids;
select public.fails(format($$select public.clinic_reception_so_setup_save(%L,'provider','{"name":"X","kind":"radiology","terms":{"secret":1}}'::jsonb)$$,w),'%شرط غير معروف%') from ids;
update ids set lab=(select id from clinic_reception.external_providers where name='Lab A');
select public.clinic_reception_so_setup_save(w,'cost',jsonb_build_object('provider_id',lab,'service_id',s1,'cost',40)) from ids;
select public.clinic_reception_so_setup_save(w,'cost',jsonb_build_object('provider_id',lab,'service_id',s1,'cost',45)) from ids;
select assert_eq((select cost from clinic_reception.provider_cost_list),45);
select public.fails(format($$select public.clinic_reception_so_setup_save(%L,'cost',jsonb_build_object('provider_id',%L,'service_id',%L,'cost',-1))$$,w,lab,s1),'%التكلفة%') from ids;
select assert_eq((select count(*) from clinic_reception.audit where action like 'so_setup_%')::numeric,(select count(*) from clinic_reception.audit)::numeric);
select assert_eq((select count(*) from clinic_reception.audit)::numeric,9);
-- cross-workspace isolation
select public.fails(format($$select public.clinic_reception_so_setup_save(gen_random_uuid(),'service_specialty',jsonb_build_object('service_id',%L,'specialty_id','x'))$$,s1),'%الخدمة غير موجودة%') from ids;
-- load shows terms (manage only), access denied path
select assert_eq(jsonb_array_length(public.clinic_reception_so_setup_load(w)->'providers')::numeric,2) from ids;
set test.deny='1';
select public.fails(format($$select public.clinic_reception_so_setup_load(%L)$$,w),'%denied%') from ids;
SQL
echo "== rollback"; q < "$D/service-orders-setup-rpcs-rollback.sql"; q < "$D/service-orders-rpcs-rollback.sql"; q < "$D/service-orders-rollback.sql"
echo REHEARSAL_SETUP_OK
