#!/bin/bash
# Throwaway Postgres rehearsal. Run: sudo -n bash rehearse-reception-booking-visitno-fix.sh <dir>
set -euo pipefail
D="$1"; N=swnw-rehearse6-$$
trap 'docker rm -f $N >/dev/null 2>&1 || true' EXIT
docker run -d --name $N -e POSTGRES_PASSWORD=x --network none postgres:16-alpine >/dev/null
for i in $(seq 1 40); do docker exec $N pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done; sleep 2
q(){ docker exec -i $N psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
q <<'SQL'
create role authenticated nologin;
create schema clinic_reception;
create table clinic_reception.packages(id uuid primary key,workspace_id uuid);
create table clinic_reception.entitlements(package_id uuid,visit_no int,used int,quantity int);
create function clinic_reception.bridge_command(p_workspace uuid,p_action text,p_payload jsonb,p_x uuid) returns boolean language plpgsql security definer as $f$
declare device uuid;
begin
 device:=nullif(p_payload->>'device_id','')::uuid;
 if false or device is not null or exists(select 1 from clinic_reception.entitlements e join clinic_reception.packages p on p.id=e.package_id where p.workspace_id=p_workspace and p.id=nullif(p_payload->>'package_id','')::uuid and e.visit_no=(p_payload->>'package_visit_no')::integer and e.used<e.quantity) then return true; end if;
 return false;
end $f$;
grant execute on function clinic_reception.bridge_command(uuid,text,jsonb,uuid) to authenticated;
create function public.fails(sqltext text,pattern text) returns void language plpgsql as $f$
begin begin execute sqltext; exception when others then if sqlerrm like pattern then return; end if; raise exception 'FAIL wrong error: %',sqlerrm; end; raise exception 'FAIL expected error %',pattern; end $f$;
insert into clinic_reception.packages values('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1');
insert into clinic_reception.entitlements values('00000000-0000-0000-0000-0000000000a1',1,0,1);
SQL
echo "== reproduce bug"
q -c "select public.fails(\$\$select clinic_reception.bridge_command('00000000-0000-0000-0000-0000000000b1','book','{\"package_visit_no\":\"\"}'::jsonb,null)\$\$,'%invalid input syntax for type integer%')"
echo "== apply x2"; q < "$D/reception-booking-visitno-fix.sql"; q < "$D/reception-booking-visitno-fix.sql"
echo "== behaviour"
q <<'SQL'
do $t$ begin
 if clinic_reception.bridge_command('00000000-0000-0000-0000-0000000000b1','book','{"package_visit_no":""}'::jsonb,null) is not false then raise exception 'FAIL empty visit no should be false'; end if;
 if clinic_reception.bridge_command('00000000-0000-0000-0000-0000000000b1','book','{}'::jsonb,null) is not false then raise exception 'FAIL missing visit no should be false'; end if;
 if clinic_reception.bridge_command('00000000-0000-0000-0000-0000000000b1','book','{"package_id":"00000000-0000-0000-0000-0000000000a1","package_visit_no":"1"}'::jsonb,null) is not true then raise exception 'FAIL real package visit should be true'; end if;
 if clinic_reception.bridge_command('00000000-0000-0000-0000-0000000000b1','book','{"package_id":"00000000-0000-0000-0000-0000000000a1","package_visit_no":"2"}'::jsonb,null) is not false then raise exception 'FAIL other visit should be false'; end if;
 if not has_function_privilege('authenticated','clinic_reception.bridge_command(uuid,text,jsonb,uuid)','execute') then raise exception 'FAIL grant lost'; end if;
 if not (select prosecdef from pg_proc where oid='clinic_reception.bridge_command(uuid,text,jsonb,uuid)'::regprocedure) then raise exception 'FAIL security definer lost'; end if;
end $t$;
SQL
echo "== rollback restores original"; q < "$D/reception-booking-visitno-fix-rollback.sql"
q -c "select public.fails(\$\$select clinic_reception.bridge_command('00000000-0000-0000-0000-0000000000b1','book','{\"package_visit_no\":\"\"}'::jsonb,null)\$\$,'%invalid input syntax for type integer%')"
q -c "do \$t\$ begin if not has_function_privilege('authenticated','clinic_reception.bridge_command(uuid,text,jsonb,uuid)','execute') then raise exception 'FAIL grant lost after rollback'; end if; end \$t\$"
echo "REHEARSAL OK"
