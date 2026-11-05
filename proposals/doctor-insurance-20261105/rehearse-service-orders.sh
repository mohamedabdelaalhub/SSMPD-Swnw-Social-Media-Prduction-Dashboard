#!/bin/bash
# Throwaway Postgres rehearsal (no published ports, destroyed at end). Run: sudo bash rehearse-service-orders.sh <dir-with-sql>
set -euo pipefail
D="$1"; N=swnw-rehearse-$$
trap 'docker rm -f $N >/dev/null 2>&1 || true' EXIT
docker run -d --name $N -e POSTGRES_PASSWORD=x --network none postgres:16-alpine >/dev/null
for i in $(seq 1 40); do docker exec $N pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
sleep 2
q(){ docker exec -i $N psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
q <<'SQL'
create schema clinic_reception;
create table clinic_reception.workspaces(id uuid primary key default gen_random_uuid());
create table clinic_reception.services(id uuid primary key default gen_random_uuid(), workspace_id uuid);
create table clinic_reception.orders(id uuid primary key default gen_random_uuid(), workspace_id uuid, service_id uuid, provider_id uuid);
SQL
echo "== apply #1"; q < "$D/service-orders-migration.sql"
echo "== apply #2 (idempotent)"; q < "$D/service-orders-migration.sql"
echo "== behaviour"
q <<'SQL'
insert into clinic_reception.workspaces default values;
insert into clinic_reception.services default values;
insert into clinic_reception.orders default values;
insert into clinic_reception.external_providers(workspace_id,name,kind) select id,'Lab A','lab' from clinic_reception.workspaces;
-- external requires provider
do $$ begin
  begin insert into clinic_reception.order_ext(order_id,kind,mode) select id,'lab','external' from clinic_reception.orders;
    raise exception 'FAIL external without provider accepted';
  exception when check_violation then null; end;
  begin insert into clinic_reception.order_ext(order_id,kind,mode,billing_party) select id,'service','internal','provider' from clinic_reception.orders;
    raise exception 'FAIL provider billing on internal accepted';
  exception when check_violation then null; end;
  begin insert into clinic_reception.referral_rates(workspace_id,doctor_key,category,percent) select id,'d','lab',101 from clinic_reception.workspaces;
    raise exception 'FAIL percent>100 accepted';
  exception when check_violation then null; end;
end $$;
insert into clinic_reception.order_ext(order_id,kind,mode,external_provider_id)
  select o.id,'lab','external',p.id from clinic_reception.orders o, clinic_reception.external_providers p;
update clinic_reception.order_ext set status='scheduled';
update clinic_reception.order_ext set status='attended';
do $$ begin
  begin update clinic_reception.order_ext set status='patient_notified'; raise exception 'FAIL bad transition accepted';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;
update clinic_reception.order_ext set status='done';
select 'log rows='||count(*) from clinic_reception.order_status_log;
SQL
echo "== rollback"; q < "$D/service-orders-rollback.sql"
q -t -c "select count(*) from information_schema.tables where table_schema='clinic_reception' and table_name in ('order_ext','referral_rates','external_providers')" | tr -d ' \n'; echo " leftover tables (expect 0)"
q -t -c "select count(*) from clinic_reception.orders" | tr -d ' \n'; echo " existing orders rows untouched (expect 1)"
echo REHEARSAL_OK
