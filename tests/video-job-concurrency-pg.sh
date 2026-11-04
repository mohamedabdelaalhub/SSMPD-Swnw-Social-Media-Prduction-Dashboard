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
 input_schema_version int not null default 1, output_video_url text, cover_url text, voiceover_url text, subtitles_url text, generation_state jsonb not null default '{}'::jsonb, archive_status text not null default 'pending', archive_error text, drive_video_url text, drive_video_id text, drive_folder_url text, archived_at timestamptz,
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
staleize() { P -c "alter table public.video_jobs disable trigger user; update public.video_jobs set updated_at=now()-interval '40 minutes' where id='$1'; alter table public.video_jobs enable trigger user"; }
P -c "truncate public.video_jobs; insert into public.video_jobs(id) values('00000000-0000-0000-0000-0000000000f1')"
J=00000000-0000-0000-0000-0000000000f1
T1=$(Q "select public.claim_next_video_job_fenced('wA',4)->>'claim_token'")
[ -n "$T1" ] && [ "$(P -c "select claim_token::text from public.video_jobs where id='$J'")" = "$T1" ] && ok "F1 token issued and stored" || bad "F1"
O=$(Q "select public.video_job_update_fenced('$J','$T1','{\"status\":\"rendering\",\"progress_percent\":50}')->>'status'"); [ "$O" = rendering ] && ok "F2 holder updates whitelisted columns" || bad "F2 got: $O"
for col in attempt_count worker_id claim_token id; do O=$(Q "select public.video_job_update_fenced('$J','$T1','{\"$col\":\"x\"}')"); echo "$O" | grep -q "column not allowed" && ok "F3 $col rejected" || bad "F3 $col"; done
# F4 concurrent zombie vs reclaimer: job goes stale, 1 reclaimer claims while 20 zombie sessions keep writing with the OLD token
staleize $J
rm -f "$D"/z* "$D"/n*
( Q "select coalesce(public.claim_next_video_job_fenced('wB',4)->>'claim_token','NULL')" > "$D/n1" ) &
for i in $(seq 1 20); do ( for k in 1 2 3 4 5; do Q "select public.video_job_update_fenced('$J','$T1','{\"status\":\"ready\",\"output_video_url\":\"zombie$i\"}')" | grep -q ERROR || echo WROTE >> "$D/z$i"; done ) & done; wait
T2=$(cat "$D/n1")
ST=$(P -c "select status||'|'||coalesce(worker_id,'')||'|'||coalesce(claim_token::text,'') from public.video_jobs where id='$J'")
if [ "$T2" != NULL ] && [ "$T2" != "$T1" ]; then
 echo "info F4 reclaimer won: $ST (zombie writes accepted before the reclaim: $(ls "$D"/z* 2>/dev/null | wc -l | tr -d ' '))"
 ok "F4 reclaimer obtained a NEW token during the zombie storm"
elif [ "$T2" = NULL ]; then
 # legitimate lease semantics: a zombie that is still writing keeps updated_at fresh, so the job is NOT stale and nobody may take it
 [ "$(P -c "select claim_token::text from public.video_jobs where id='$J'")" = "$T1" ] && ok "F4 (race outcome B) live token holder kept the job; no second holder was created" || bad "F4 outcome B state $ST"
else bad "F4 reclaim returned the old token"; fi
# make the following checks deterministic regardless of the race outcome above: force a clean stale reclaim without concurrent writers
if [ "$T2" = NULL ]; then staleize $J; T2=$(Q "select coalesce(public.claim_next_video_job_fenced('wB',4)->>'claim_token','NULL')"); fi
# F5 after the reclaim completed, the old token is dead for good; the new holder works; finished jobs are frozen
Q "select public.video_job_update_fenced('$J','$T1','{\"status\":\"ready\"}')" 2>&1 | grep -q "stale claim" && ok "F5 old token rejected after reclaim" || bad "F5 old token"
if [ "$T2" != NULL ]; then
 # make sure state is a working state held by wB before testing the new holder
 P -c "alter table public.video_jobs disable trigger user; update public.video_jobs set status='rendering', output_video_url=null where id='$J' and claim_token='$T2'; alter table public.video_jobs enable trigger user" >/dev/null
 Q "select public.video_job_update_fenced('$J','$T2','{\"status\":\"ready\",\"output_video_url\":\"good\"}')->>'output_video_url'" | grep -q good && ok "F5 new holder commits" || bad "F5 new holder"
 Q "select public.video_job_update_fenced('$J','$T2','{\"status\":\"failed\"}')" 2>&1 | grep -q "stale claim" && ok "F5 finished job frozen" || bad "F5 frozen"
fi
Q "select public.video_job_update_fenced('$J',null,'{\"status\":\"ready\"}')" 2>&1 | grep -q "claim token required" && ok "F5 null token rejected" || bad "F5 null"
for r in anon authenticated; do P -c "set role $r; select public.claim_next_video_job_fenced('x',4)" >/dev/null 2>&1 && bad "F6 $r claim" || ok "F6 $r claim denied"; P -c "set role $r; select public.video_job_update_fenced('$J','$T1','{}')" >/dev/null 2>&1 && bad "F6 $r update" || ok "F6 $r update denied"; done
# F7 rollback: draft rollback notes restore the previous state and plain claim still works (back-compat)
P -c "truncate public.video_jobs; insert into public.video_jobs(id) values('$J')"
Q "select public.claim_next_video_job('legacy',4)->>'id'" | grep -q "$J" && ok "F7 legacy unfenced claim still works with the column present (back-compat)" || bad "F7 legacy"
P -c "drop trigger video_jobs_fence_guard on public.video_jobs; drop function public.video_jobs_fence_guard(); drop function public.video_job_commit_fenced(uuid,uuid,integer,jsonb); drop function public.video_job_update_fenced(uuid,uuid,jsonb); drop function public.claim_next_video_job_fenced(text,integer); alter table public.video_jobs drop column claim_token; alter table public.video_jobs drop column committed_attempt;" && ok "F7 full rollback (L3 drops) executes cleanly on a drained table" || bad "F7 rollback"
Q "select public.claim_next_video_job('legacy2',4) is null" | grep -q t && ok "F7 original claim function intact after rollback" || bad "F7 post-rollback"

# ---- Part G: transition safety (OLD unfenced worker during the switch); draft re-applied to a clean state
P -c "truncate public.video_jobs; insert into public.video_jobs(id) values('$J')"
P -f "$ROOT/supabase/drafts/20261104_video_job_fencing.sql"
RAW() { P -c "$SR $1" 2>&1 || true; }     # raw legacy-style statements as the OLD worker sends them (PostgREST PATCH = plain UPDATE as service_role)
TF=$(Q "select public.claim_next_video_job_fenced('new',4)->>'claim_token'")
O=$(RAW "update public.video_jobs set output_video_url='OLD-ZOMBIE', status='ready' where id='$J'"); grep -q "claim token" <<<"$O" && ok "G1 old unfenced worker cannot overwrite a fenced job (status/outputs)" || bad "G1 $O"
O=$(RAW "update public.video_jobs set progress_percent=99 where id='$J'"); grep -q "claim token" <<<"$O" && ok "G2 old worker cannot even touch progress on a fenced job" || bad "G2 $O"
[ "$(P -c "select coalesce(output_video_url,'-')||'|'||status from public.video_jobs where id='$J'")" = "-|preparing" ] && ok "G3 fenced job unchanged by the rejected old-worker writes" || bad "G3"
Q "select public.video_job_update_fenced('$J','$TF','{\"archive_status\":\"uploading\",\"generation_state\":{\"k\":1},\"status\":\"uploading\"}')->>'archive_status'" | grep -q uploading && ok "G4 fenced RPC accepts the real worker columns (archive_status, generation_state, ...)" || bad "G4"
Q "select public.video_job_update_fenced('$J','$TF','{\"output_video_url\":null,\"drive_video_url\":\"d\"}')->>'drive_video_url'" | grep -q d && ok "G5 explicit null and new value applied like a PostgREST PATCH" || bad "G5"
# G6 transition: fenced worker holds job, it goes stale, OLD worker claims through the LEGACY function: token dies, legacy writes work, fenced zombie is locked out
staleize $J
O=$(Q "select public.claim_next_video_job('legacy-old',4)->>'worker_id'"); [ "$O" = legacy-old ] && ok "G6 legacy claim reclaims the stale fenced job" || bad "G6 $O"
[ "$(P -c "select coalesce(claim_token::text,'NULL') from public.video_jobs where id='$J'")" = NULL ] && ok "G6 token cleared by the legacy claim" || bad "G6 token"
RAW "update public.video_jobs set status='rendering' where id='$J'" | grep -q ERROR && bad "G6 legacy write" || ok "G6 legacy worker can continue its own job"
Q "select public.video_job_update_fenced('$J','$TF','{\"status\":\"ready\"}')" | grep -q "stale claim" && ok "G6 old fenced token locked out after legacy reclaim" || bad "G6 old token"
# G7 stale recovery by the claim function itself still works for a fenced job (guard allows working->pending/failed only when stale)
P -c "truncate public.video_jobs; insert into public.video_jobs(id) values('$J')"
TG=$(Q "select public.claim_next_video_job_fenced('n',4)->>'claim_token'"); staleize $J
O=$(Q "select coalesce(public.claim_next_video_job('r',4)->>'attempt_count','NULL')"); [ "$O" = 2 ] && ok "G7 stale fenced job recovered by the unmodified claim function (attempt 2)" || bad "G7 $O"
# G8 fresh (not stale) fenced job cannot be force-failed by an old worker
P -c "truncate public.video_jobs; insert into public.video_jobs(id) values('$J')"; Q "select public.claim_next_video_job_fenced('n',4)->>'id'" >/dev/null
O=$(RAW "update public.video_jobs set status='failed' where id='$J'"); grep -q "claim token" <<<"$O" && ok "G8 old worker cannot fail a fresh fenced job" || bad "G8 $O"
# G9 two LEGACY workers: documented NON-protection (old zombie vs old holder) -> requires stop/drain before enabling fenced claims
P -c "truncate public.video_jobs; insert into public.video_jobs(id) values('$J')"; Q "select public.claim_next_video_job('oldA',4)->>'id'" >/dev/null
RAW "update public.video_jobs set output_video_url='oldB-overwrite' where id='$J'" | grep -q ERROR && bad "G9 unexpected block" || ok "G9 KNOWN LIMIT: two legacy workers can still overwrite each other (job without token); drain legacy workers before the switch"

# G10/G11 real-privilege model: authenticated/anon have only SELECT on video_jobs; dashboard actions go through SECURITY DEFINER RPCs (owner postgres)
P -c "truncate public.video_jobs; insert into public.video_jobs(id) values('$J'); revoke all on public.video_jobs from authenticated, anon; grant select on public.video_jobs to authenticated;
create function public.test_cancel(p_id uuid) returns void language plpgsql security definer set search_path=public as \$\$ begin update public.video_jobs set status='cancelled' where id=p_id; end \$\$;
revoke all on function public.test_cancel(uuid) from public, anon; grant execute on function public.test_cancel(uuid) to authenticated;"
TH=$(Q "select public.claim_next_video_job_fenced('n',4)->>'claim_token'")
O=$(P -c "set role authenticated; select set_config('test.role','authenticated',false) is not null; update public.video_jobs set status='ready' where id='$J'" 2>&1 || true); grep -q "permission denied" <<<"$O" && ok "G11 authenticated has no direct UPDATE on video_jobs" || bad "G11 $O"
O=$(P -c "set role anon; update public.video_jobs set status='ready' where id='$J'" 2>&1 || true); grep -q "permission denied" <<<"$O" && ok "G11 anon denied" || bad "G11 anon $O"
O=$(P -c "set role authenticated; select set_config('test.role','authenticated',false) is not null; select public.test_cancel('$J')" 2>&1 || true); grep -q ERROR <<<"$O" && bad "G10 cancel via definer RPC blocked: $O" || ok "G10 dashboard cancel through a definer RPC still works on a held job"
Q "select public.video_job_update_fenced('$J','$TH','{\"status\":\"rendering\"}')" | grep -q "stale claim" && ok "G10 worker's next fenced call fails after cancel (abort signal)" || bad "G10 abort"
# G12 spoofing attempts by a service_role client cannot exempt a plain UPDATE: fake JWT claims and the old GUC name change nothing
P -c "truncate public.video_jobs; insert into public.video_jobs(id) values('$J')"; Q "select public.claim_next_video_job_fenced('n',4)->>'id'" >/dev/null
O=$(P -c "set role service_role; select set_config('request.jwt.claims','{\"role\":\"postgres\"}',false), set_config('swnw.fenced','1',false), set_config('test.role','authenticated',false); update public.video_jobs set output_video_url='spoof' where id='$J'" 2>&1 || true); grep -q "claim token" <<<"$O" && ok "G12 spoofed claims / GUC do not exempt an old worker's UPDATE" || bad "G12 $O"

# ---- Part H: attempt-scoped archive commit (DB is the arbiter; Drive folders are per attempt)
P -c "truncate public.video_jobs; insert into public.video_jobs(id) values('$J')"
HT1=$(Q "select public.claim_next_video_job_fenced('wA',4)->>'claim_token'"); staleize $J
HT2=$(Q "select public.claim_next_video_job_fenced('wB',4)->>'claim_token'")
RES='{"drive_video_url":"https://drive/x","drive_video_id":"id","drive_folder_url":"https://drive/f"}'
rm -f "$D"/h*
for i in $(seq 1 10); do ( Q "select public.video_job_commit_fenced('$J','$HT1',1,'{\"drive_video_url\":\"https://drive/ZOMBIE\",\"drive_video_id\":\"zid\"}')" | grep -q ERROR || echo WON >> "$D/h1_$i" ) & ( Q "select public.video_job_commit_fenced('$J','$HT2',2,'$RES')" | grep -q ERROR || echo WON >> "$D/h2_$i" ) & done; wait
Z=$( (ls "$D"/h1_* 2>/dev/null || true) | wc -l | tr -d ' '); W=$( (ls "$D"/h2_* 2>/dev/null || true) | wc -l | tr -d ' ')
[ "$Z" = 0 ] && ok "H1 20 parallel commits: the zombie token never commits (0 of 10)" || bad "H1 zombie committed $Z"
[ "$W" -ge 1 ] && ok "H2 the current holder commits and its retries are idempotent ($W of 10 returned success)" || bad "H2 winner $W"
[ "$(P -c "select status||'|'||committed_attempt||'|'||drive_video_url from public.video_jobs where id='$J'")" = "ready|2|https://drive/x" ] && ok "H3 final state is exactly the winner's commit (attempt 2, winner's url)" || bad "H3 $(P -c "select status,committed_attempt,drive_video_url from public.video_jobs where id='$J'")"
Q "select public.video_job_commit_fenced('$J','$HT1',1,'$RES')" | grep -q "stale claim" && ok "H4 late zombie commit after the winner is rejected" || bad "H4"
Q "select public.video_job_commit_fenced('$J','$HT2',2,'{\"drive_video_url\":\"https://drive/CHANGED\",\"drive_video_id\":\"id2\"}')->>'drive_video_url'" | grep -q "https://drive/x" && ok "H5 winner's repeated commit returns the stored result, cannot change it" || bad "H5"
P -c "truncate public.video_jobs; insert into public.video_jobs(id) values('$J')"; Q "select public.claim_next_video_job_fenced('w',4)->>'id'" >/dev/null
Q "select public.video_job_commit_fenced('$J',null,1,'$RES')" | grep -q "required" && ok "H6 null token rejected" || bad "H6"
for r in anon authenticated; do P -c "set role $r; select public.video_job_commit_fenced('$J','$HT2',1,'$RES')" >/dev/null 2>&1 && bad "H7 $r" || ok "H7 $r commit denied"; done

# ---- Part I: rollback ladder (review #104)
P -c "truncate public.video_jobs; insert into public.video_jobs(id) values('$J')"
P -f "$ROOT/supabase/drafts/20261104_video_job_fencing.sql" >/dev/null 2>&1
IT=$(Q "select public.claim_next_video_job_fenced('w',4)->>'claim_token'")
DRAIN="select count(*) from public.video_jobs where claim_token is not null and status in ('preparing','rendering','uploading')"
[ "$(P -c "$DRAIN")" = 1 ] && ok "I0 drain query reports the active fenced job (1) so L2/L3 are NOT allowed yet" || bad "I0"
RAW "update public.video_jobs set progress_percent=5 where id='$J'" | grep -q "claim token" && ok "I1a guard is active" || bad "I1a"
P -c "alter table public.video_jobs disable trigger video_jobs_fence_guard"
RAW "update public.video_jobs set progress_percent=6 where id='$J'" | grep -q ERROR && bad "I1b legacy write after L1" || ok "I1b L1 (disable trigger) re-opens legacy writes with nothing dropped"
Q "select public.video_job_update_fenced('$J','$IT','{\"progress_percent\":7}')->>'progress_percent'" | grep -q 7 && ok "I1c a still-running fenced worker keeps working under L1 (no break)" || bad "I1c"
P -c "alter table public.video_jobs enable trigger video_jobs_fence_guard"
RAW "update public.video_jobs set progress_percent=8 where id='$J'" | grep -q "claim token" && ok "I1d L1 is reversible (re-enabled guard blocks again)" || bad "I1d"
Q "select public.video_job_commit_fenced('$J','$IT',1,'{\"drive_video_url\":\"https://drive/keep\",\"drive_video_id\":\"kid\",\"drive_folder_url\":\"https://drive/kf\"}')->>'status'" | grep -q ready && ok "I2a job committed before rollback" || bad "I2a"
[ "$(P -c "$DRAIN")" = 0 ] && ok "I2b drain query is 0 after the job finished: L2 allowed" || bad "I2b"
P -c "drop trigger video_jobs_fence_guard on public.video_jobs; drop function public.video_jobs_fence_guard(); drop function public.video_job_commit_fenced(uuid,uuid,integer,jsonb); drop function public.video_job_update_fenced(uuid,uuid,jsonb); drop function public.claim_next_video_job_fenced(text,integer);" >/dev/null && ok "I2c L2 executes (functions + trigger dropped, columns kept)" || bad "I2c"
[ "$(P -c "select drive_video_url||'|'||committed_attempt||'|'||status from public.video_jobs where id='$J'")" = "https://drive/keep|1|ready" ] && ok "I2d committed output references and committed_attempt survive L2" || bad "I2d"
Q "select public.video_job_update_fenced('$J','$IT','{}')" | grep -qi "does not exist" && ok "I3 a fenced worker that is still running after L2 fails loudly (function missing): stop it BEFORE L2" || bad "I3"
P -c "insert into public.video_jobs(id) values('00000000-0000-0000-0000-0000000000f2')"
Q "select public.claim_next_video_job('legacy',4)->>'id'" | grep -q f2 && RAW "update public.video_jobs set output_video_url='legacy-ok' where id='00000000-0000-0000-0000-0000000000f2'" | grep -q ERROR && bad "I4 legacy after L2" || ok "I4 legacy worker claims and writes normally after L2"
exit $FAIL
