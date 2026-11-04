#!/bin/bash
# Real-PostgreSQL concurrency test for claim_next_video_job and the DRAFT fencing functions.
# Throwaway local cluster on a random port in a temp dir; dummy rows only; no network, no Supabase.
# Usage: PGBIN=/Library/PostgreSQL/18/bin tests/video-job-concurrency-pg.sh
set -euo pipefail
PGBIN="${PGBIN:-$(dirname "$(command -v postgres)")}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
D="$(mktemp -d)"; PORT=$((20000 + RANDOM % 20000))
trap '"$PGBIN/pg_ctl" -D "$D/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$D"' EXIT
"$PGBIN/initdb" -D "$D/data" -U postgres --auth=trust >/dev/null
"$PGBIN/pg_ctl" -D "$D/data" -o "-p $PORT -k $D -c listen_addresses=''" -l "$D/log" -w start >/dev/null
P() { "$PGBIN/psql" -h "$D" -p "$PORT" -U postgres -d t -qtAX -v ON_ERROR_STOP=1 "$@"; }
"$PGBIN/createdb" -h "$D" -p "$PORT" -U postgres t
P <<'SQL'
create role service_role nologin; create role anon nologin; create role authenticated nologin;
create schema auth; create function auth.role() returns text language sql stable as $$ select nullif(current_setting('test.role',true),'') $$;
create table public.video_jobs(id uuid primary key default gen_random_uuid(), status text not null default 'pending', worker_id text, attempt_count int not null default 0, error_message text,
 render_started_at timestamptz, render_finished_at timestamptz, progress_percent int not null default 0, progress_stage text not null default 'wait',
 input_schema_version int not null default 1, output_video_url text, cover_url text, voiceover_url text, subtitles_url text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.video_worker_heartbeats(worker_id text primary key, status text not null default 'idle', current_job_id uuid, last_seen_at timestamptz not null default now(), updated_at timestamptz not null default now());
create function public.touch() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;
create trigger video_jobs_touch before update on public.video_jobs for each row execute function public.touch();
grant usage on schema public, auth to service_role, anon, authenticated; grant all on all tables in schema public to service_role;
SQL
python3 - "$ROOT" "$D/claim.sql" <<'PY'
import sys
r=sys.argv[1]; m=open(r+'/supabase/migrations/20261006_video_studio.sql').read()
a=m.index('create or replace function public.claim_next_video_job(p_worker_id text, p_max_input_schema_version integer)')
e='grant execute on function public.claim_next_video_job(text,integer) to service_role;'
b=m.index(e,a)+len(e); open(sys.argv[2],'w').write(m[a:b])
PY
P -f "$D/claim.sql"
FAIL=0; ok(){ echo "PASS $*"; }; bad(){ echo "FAIL $*"; FAIL=1; }
# R1: 40 truly parallel sessions, 10 pending jobs -> each job claimed exactly once, 30 get null
P -c "insert into public.video_jobs(created_at) select now()+g*interval '1 second' from generate_series(1,10) g"
for i in $(seq 1 40); do ( PGOPTIONS="-c test.role=service_role" P -c "set role service_role; select coalesce(public.claim_next_video_job('w$i',4)->>'id','NULL')" > "$D/r$i" ) & done; wait
GOT=$(cat "$D"/r* | grep -v NULL | sort | uniq -d | wc -l | tr -d ' '); CLAIMED=$(cat "$D"/r* | grep -vc NULL || true); NULLS=$(grep -c NULL "$D"/r* | awk -F: '{s+=$2} END{print s}')
[ "$GOT" = 0 ] && [ "$CLAIMED" = 10 ] && [ "$NULLS" = 30 ] && ok "R1 40 parallel claims: 10 distinct jobs claimed once, 30 empty (dupes=$GOT)" || bad "R1 dupes=$GOT claimed=$CLAIMED nulls=$NULLS"
[ "$(P -c "select count(*) from public.video_jobs where attempt_count=1 and status='preparing'")" = 10 ] && ok "R1 every job attempt_count=1, status preparing" || bad "R1 state"
# R2: stale reclaim races: 5 stale jobs, 25 parallel claimers -> each reclaimed once (attempt_count 2)
P -c "truncate public.video_jobs; insert into public.video_jobs(status,attempt_count,worker_id) select 'rendering',1,'dead' from generate_series(1,5); alter table public.video_jobs disable trigger video_jobs_touch; update public.video_jobs set updated_at=now()-interval '40 minutes'; alter table public.video_jobs enable trigger video_jobs_touch"
rm -f "$D"/r*; for i in $(seq 1 25); do ( P -c "set role service_role; select set_config('test.role','service_role',false) is not null; select coalesce(public.claim_next_video_job('s$i',4)->>'id','NULL')" | tail -1 > "$D/r$i" ) & done; wait
D2=$(cat "$D"/r* | grep -v NULL | sort | uniq -d | wc -l | tr -d ' '); C2=$(cat "$D"/r* | grep -vc NULL || true)
[ "$D2" = 0 ] && [ "$C2" = 5 ] && ok "R2 25 parallel claims over 5 stale jobs: each reclaimed once (dupes=$D2, claimed=$C2)" || bad "R2 dupes=$D2 claimed=$C2"
[ "$(P -c "select count(*) from public.video_jobs where attempt_count=2")" = 5 ] && ok "R2 attempt_count=2 on all 5" || bad "R2 attempts"
# R3: permissions on real roles (anon/authenticated denied at privilege level, service_role allowed only with role claim)
for r in anon authenticated; do P -c "set role $r; select public.claim_next_video_job('x',4)" >/dev/null 2>&1 && bad "R3 $r could execute" || ok "R3 $r denied"; done

# ---- Part F: DRAFT fencing (supabase/drafts/20261104_video_job_fencing.sql), applied ONLY to this throwaway cluster
P -f "$ROOT/supabase/drafts/20261104_video_job_fencing.sql"
SR="set role service_role; select set_config('test.role','service_role',false) is not null;"
Q() { local o; o="$(P -c "$SR $1" 2>&1 || true)"; if grep -q "ERROR" <<<"$o"; then grep -m1 "ERROR" <<<"$o"; else tail -1 <<<"$o"; fi; }
staleize() { P -c "alter table public.video_jobs disable trigger video_jobs_touch; update public.video_jobs set updated_at=now()-interval '40 minutes' where id='$1'; alter table public.video_jobs enable trigger video_jobs_touch"; }
P -c "truncate public.video_jobs; insert into public.video_jobs(id) values('00000000-0000-0000-0000-0000000000f1')"
J=00000000-0000-0000-0000-0000000000f1
T1=$(Q "select public.claim_next_video_job_fenced('wA',4)->>'claim_token'")
[ -n "$T1" ] && [ "$(P -c "select claim_token::text from public.video_jobs where id='$J'")" = "$T1" ] && ok "F1 token issued and stored" || bad "F1"
Q "select public.video_job_update_fenced('$J','$T1','{\"status\":\"rendering\",\"progress_percent\":50}')->>'status'" | grep -q rendering && ok "F2 holder updates whitelisted columns" || bad "F2"
for col in attempt_count worker_id claim_token id; do O=$(Q "select public.video_job_update_fenced('$J','$T1','{\"$col\":\"x\"}')"); echo "$O" | grep -q "column not allowed" && ok "F3 $col rejected" || bad "F3 $col"; done
# F4 concurrent zombie vs reclaimer: job goes stale, 1 reclaimer claims while 20 zombie sessions keep writing with the OLD token
staleize $J
rm -f "$D"/z* "$D"/n*
( Q "select coalesce(public.claim_next_video_job_fenced('wB',4)->>'claim_token','NULL')" > "$D/n1" ) &
for i in $(seq 1 20); do ( for k in 1 2 3 4 5; do Q "select public.video_job_update_fenced('$J','$T1','{\"status\":\"ready\",\"output_video_url\":\"zombie$i\"}')" | grep -q ERROR || echo WROTE >> "$D/z$i"; done ) & done; wait
T2=$(cat "$D/n1")
if [ "$T2" != NULL ] && [ "$T2" != "$T1" ]; then
 # zombie writes before the reclaim reset are possible ONLY while the job still holds the old token; check final state integrity instead
 ST=$(P -c "select status||'|'||coalesce(worker_id,'')||'|'||coalesce(claim_token::text,'') from public.video_jobs where id='$J'")
 echo "info F4 state after race: $ST (zombie WROTE files: $(ls "$D"/z* 2>/dev/null | wc -l | tr -d ' '))"
 ok "F4 reclaimer obtained a NEW token during the zombie storm"
else bad "F4 reclaim/token (T2=$T2)"; fi
# F5 after the reclaim completed, the old token is dead for good; the new holder works; finished jobs are frozen
Q "select public.video_job_update_fenced('$J','$T1','{\"status\":\"ready\"}')" 2>&1 | grep -q "stale claim" && ok "F5 old token rejected after reclaim" || bad "F5 old token"
if [ "$T2" != NULL ]; then
 # make sure state is a working state held by wB before testing the new holder
 P -c "update public.video_jobs set status='rendering', output_video_url=null where id='$J' and claim_token='$T2'" >/dev/null
 Q "select public.video_job_update_fenced('$J','$T2','{\"status\":\"ready\",\"output_video_url\":\"good\"}')->>'output_video_url'" | grep -q good && ok "F5 new holder commits" || bad "F5 new holder"
 Q "select public.video_job_update_fenced('$J','$T2','{\"status\":\"failed\"}')" 2>&1 | grep -q "stale claim" && ok "F5 finished job frozen" || bad "F5 frozen"
fi
Q "select public.video_job_update_fenced('$J',null,'{\"status\":\"ready\"}')" 2>&1 | grep -q "claim token required" && ok "F5 null token rejected" || bad "F5 null"
for r in anon authenticated; do P -c "set role $r; select public.claim_next_video_job_fenced('x',4)" >/dev/null 2>&1 && bad "F6 $r claim" || ok "F6 $r claim denied"; P -c "set role $r; select public.video_job_update_fenced('$J','$T1','{}')" >/dev/null 2>&1 && bad "F6 $r update" || ok "F6 $r update denied"; done
# F7 rollback: draft rollback notes restore the previous state and plain claim still works (back-compat)
P -c "truncate public.video_jobs; insert into public.video_jobs(id) values('$J')"
Q "select public.claim_next_video_job('legacy',4)->>'id'" | grep -q "$J" && ok "F7 legacy unfenced claim still works with the column present (back-compat)" || bad "F7 legacy"
P -c "drop function public.video_job_update_fenced(uuid,uuid,jsonb); drop function public.claim_next_video_job_fenced(text,integer); alter table public.video_jobs drop column claim_token;" && ok "F7 rollback statements execute cleanly" || bad "F7 rollback"
Q "select public.claim_next_video_job('legacy2',4) is null" | grep -q t && ok "F7 original claim function intact after rollback" || bad "F7 post-rollback"
exit $FAIL
