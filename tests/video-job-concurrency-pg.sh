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
create table public.video_cover_candidates(id uuid primary key, job_id uuid not null references public.video_jobs(id) on delete cascade, candidate_index integer not null check (candidate_index between 1 and 5), timestamp_seconds numeric not null check (timestamp_seconds >= 0), storage_path text not null, drive_url text not null, created_at timestamptz not null default now(), unique (job_id, candidate_index));
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
P -c "truncate public.video_jobs cascade; insert into public.video_jobs(status,attempt_count,worker_id) select 'rendering',1,'dead' from generate_series(1,5); alter table public.video_jobs disable trigger video_jobs_touch; update public.video_jobs set updated_at=now()-interval '40 minutes'; alter table public.video_jobs enable trigger video_jobs_touch"
rm -f "$D"/r*; for i in $(seq 1 25); do ( P -c "set role service_role; select set_config('test.role','service_role',false) is not null; select coalesce(public.claim_next_video_job('s$i',4)->>'id','NULL')" | tail -1 > "$D/r$i" ) & done; wait
D2=$(cat "$D"/r* | grep -v NULL | sort | uniq -d | wc -l | tr -d ' '); C2=$(cat "$D"/r* | grep -vc NULL || true)
[ "$D2" = 0 ] && [ "$C2" = 5 ] && ok "R2 25 parallel claims over 5 stale jobs: each reclaimed once (dupes=$D2, claimed=$C2)" || bad "R2 dupes=$D2 claimed=$C2"
[ "$(P -c "select count(*) from public.video_jobs where attempt_count=2")" = 5 ] && ok "R2 attempt_count=2 on all 5" || bad "R2 attempts"
# R3: permissions on real roles (anon/authenticated denied at privilege level, service_role allowed only with role claim)
for r in anon authenticated; do P -c "set role $r; select public.claim_next_video_job('x',4)" >/dev/null 2>&1 && bad "R3 $r could execute" || ok "R3 $r denied"; done

# ---- Part F: DRAFT fencing (supabase/drafts/20261104_video_job_fencing.sql), applied ONLY to this throwaway cluster
APPLY() { P -f "$ROOT/supabase/drafts/20261104_video_job_fencing.sql" >/dev/null 2>&1; [ "${1:-}" = keep-disabled ] || P -c "alter table public.video_jobs enable trigger video_jobs_fence_guard"; }
APPLY
SR="set role service_role; select set_config('test.role','service_role',false) is not null;"
Q() { local o; o="$(P -c "$SR $1" 2>&1 || true)"; if grep -q "ERROR" <<<"$o"; then grep -m1 "ERROR" <<<"$o"; else tail -1 <<<"$o"; fi; }
staleize() { P -c "alter table public.video_jobs disable trigger user; update public.video_jobs set updated_at=now()-interval '40 minutes' where id='$1'; alter table public.video_jobs enable trigger user"; }
P -c "truncate public.video_jobs cascade; insert into public.video_jobs(id) values('00000000-0000-0000-0000-0000000000f1')"
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
P -c "truncate public.video_jobs cascade; insert into public.video_jobs(id) values('$J')"
Q "select public.claim_next_video_job('legacy',4)->>'id'" | grep -q "$J" && ok "F7 legacy unfenced claim still works with the column present (back-compat)" || bad "F7 legacy"
P -c "drop trigger video_jobs_fence_guard on public.video_jobs; drop function public.video_jobs_fence_guard(); drop function public.video_job_commit_fenced(uuid,uuid,integer,jsonb); drop function public.video_job_update_fenced(uuid,uuid,jsonb); drop function public.claim_next_video_job_fenced(text,integer); alter table public.video_jobs drop column claim_token; alter table public.video_jobs drop column committed_attempt;" && ok "F7 full rollback (L3 drops) executes cleanly on a drained table" || bad "F7 rollback"
Q "select public.claim_next_video_job('legacy2',4) is null" | grep -q t && ok "F7 original claim function intact after rollback" || bad "F7 post-rollback"

# ---- Part G: transition safety (OLD unfenced worker during the switch); draft re-applied to a clean state
P -c "truncate public.video_jobs cascade; insert into public.video_jobs(id) values('$J')"
APPLY
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
P -c "truncate public.video_jobs cascade; insert into public.video_jobs(id) values('$J')"
TG=$(Q "select public.claim_next_video_job_fenced('n',4)->>'claim_token'"); staleize $J
O=$(Q "select coalesce(public.claim_next_video_job('r',4)->>'attempt_count','NULL')"); [ "$O" = 2 ] && ok "G7 stale fenced job recovered by the unmodified claim function (attempt 2)" || bad "G7 $O"
# G8 fresh (not stale) fenced job cannot be force-failed by an old worker
P -c "truncate public.video_jobs cascade; insert into public.video_jobs(id) values('$J')"; Q "select public.claim_next_video_job_fenced('n',4)->>'id'" >/dev/null
O=$(RAW "update public.video_jobs set status='failed' where id='$J'"); grep -q "claim token" <<<"$O" && ok "G8 old worker cannot fail a fresh fenced job" || bad "G8 $O"
# G9 two LEGACY workers: documented NON-protection (old zombie vs old holder) -> requires stop/drain before enabling fenced claims
P -c "truncate public.video_jobs cascade; insert into public.video_jobs(id) values('$J')"; Q "select public.claim_next_video_job('oldA',4)->>'id'" >/dev/null
RAW "update public.video_jobs set output_video_url='oldB-overwrite' where id='$J'" | grep -q ERROR && bad "G9 unexpected block" || ok "G9 KNOWN LIMIT: two legacy workers can still overwrite each other (job without token); drain legacy workers before the switch"

# G10/G11 real-privilege model: authenticated/anon have only SELECT on video_jobs; dashboard actions go through SECURITY DEFINER RPCs (owner postgres)
P -c "truncate public.video_jobs cascade; insert into public.video_jobs(id) values('$J'); revoke all on public.video_jobs from authenticated, anon; grant select on public.video_jobs to authenticated;
create function public.test_cancel(p_id uuid) returns void language plpgsql security definer set search_path=public as \$\$ begin update public.video_jobs set status='cancelled' where id=p_id; end \$\$;
revoke all on function public.test_cancel(uuid) from public, anon; grant execute on function public.test_cancel(uuid) to authenticated;"
TH=$(Q "select public.claim_next_video_job_fenced('n',4)->>'claim_token'")
O=$(P -c "set role authenticated; select set_config('test.role','authenticated',false) is not null; update public.video_jobs set status='ready' where id='$J'" 2>&1 || true); grep -q "permission denied" <<<"$O" && ok "G11 authenticated has no direct UPDATE on video_jobs" || bad "G11 $O"
O=$(P -c "set role anon; update public.video_jobs set status='ready' where id='$J'" 2>&1 || true); grep -q "permission denied" <<<"$O" && ok "G11 anon denied" || bad "G11 anon $O"
O=$(P -c "set role authenticated; select set_config('test.role','authenticated',false) is not null; select public.test_cancel('$J')" 2>&1 || true); grep -q ERROR <<<"$O" && bad "G10 cancel via definer RPC blocked: $O" || ok "G10 dashboard cancel through a definer RPC still works on a held job"
Q "select public.video_job_update_fenced('$J','$TH','{\"status\":\"rendering\"}')" | grep -q "stale claim" && ok "G10 worker's next fenced call fails after cancel (abort signal)" || bad "G10 abort"
# G12 spoofing attempts by a service_role client cannot exempt a plain UPDATE: fake JWT claims and the old GUC name change nothing
P -c "truncate public.video_jobs cascade; insert into public.video_jobs(id) values('$J')"; Q "select public.claim_next_video_job_fenced('n',4)->>'id'" >/dev/null
O=$(P -c "set role service_role; select set_config('request.jwt.claims','{\"role\":\"postgres\"}',false), set_config('swnw.fenced','1',false), set_config('test.role','authenticated',false); update public.video_jobs set output_video_url='spoof' where id='$J'" 2>&1 || true); grep -q "claim token" <<<"$O" && ok "G12 spoofed claims / GUC do not exempt an old worker's UPDATE" || bad "G12 $O"

# ---- Part H: attempt-scoped archive commit (DB is the arbiter; Drive folders are per attempt)
P -c "truncate public.video_jobs cascade; insert into public.video_jobs(id) values('$J')"
HT1=$(Q "select public.claim_next_video_job_fenced('wA',4)->>'claim_token'"); staleize $J
HT2=$(Q "select public.claim_next_video_job_fenced('wB',4)->>'claim_token'")
RES='{"drive_video_url":"https://drive.google.com/f/x","drive_video_id":"id","drive_folder_url":"https://drive.google.com/f/f"}'
rm -f "$D"/h*
for i in $(seq 1 10); do ( Q "select public.video_job_commit_fenced('$J','$HT1',1,'{\"drive_video_url\":\"https://drive.google.com/f/ZOMBIE\",\"drive_video_id\":\"zid\"}')" | grep -q ERROR || echo WON >> "$D/h1_$i" ) & ( Q "select public.video_job_commit_fenced('$J','$HT2',2,'$RES')" | grep -q ERROR || echo WON >> "$D/h2_$i" ) & done; wait
Z=$( (ls "$D"/h1_* 2>/dev/null || true) | wc -l | tr -d ' '); W=$( (ls "$D"/h2_* 2>/dev/null || true) | wc -l | tr -d ' ')
[ "$Z" = 0 ] && ok "H1 20 parallel commits: the zombie token never commits (0 of 10)" || bad "H1 zombie committed $Z"
[ "$W" -ge 1 ] && ok "H2 the current holder commits and its retries are idempotent ($W of 10 returned success)" || bad "H2 winner $W"
[ "$(P -c "select status||'|'||committed_attempt||'|'||drive_video_url from public.video_jobs where id='$J'")" = "ready|2|https://drive.google.com/f/x" ] && ok "H3 final state is exactly the winner's commit (attempt 2, winner's url)" || bad "H3 $(P -c "select status,committed_attempt,drive_video_url from public.video_jobs where id='$J'")"
Q "select public.video_job_commit_fenced('$J','$HT1',1,'$RES')" | grep -q "stale claim" && ok "H4 late zombie commit after the winner is rejected" || bad "H4"
Q "select public.video_job_commit_fenced('$J','$HT2',2,'{\"drive_video_url\":\"https://drive.google.com/f/CHANGED\",\"drive_video_id\":\"id2\"}')->>'drive_video_url'" | grep -q "https://drive.google.com/f/x" && ok "H5 winner's repeated commit returns the stored result, cannot change it" || bad "H5"
P -c "truncate public.video_jobs cascade; insert into public.video_jobs(id) values('$J')"; Q "select public.claim_next_video_job_fenced('w',4)->>'id'" >/dev/null
Q "select public.video_job_commit_fenced('$J',null,1,'$RES')" | grep -q "required" && ok "H6 null token rejected" || bad "H6"
for r in anon authenticated; do P -c "set role $r; select public.video_job_commit_fenced('$J','$HT2',1,'$RES')" >/dev/null 2>&1 && bad "H7 $r" || ok "H7 $r commit denied"; done

# ---- Part I: rollback ladder (review #104)
P -c "truncate public.video_jobs cascade; insert into public.video_jobs(id) values('$J')"
APPLY
IT=$(Q "select public.claim_next_video_job_fenced('w',4)->>'claim_token'")
DRAIN="select count(*) from public.video_jobs where claim_token is not null and status in ('preparing','rendering','uploading')"
[ "$(P -c "$DRAIN")" = 1 ] && ok "I0 drain query reports the active fenced job (1) so L2/L3 are NOT allowed yet" || bad "I0"
RAW "update public.video_jobs set progress_percent=5 where id='$J'" | grep -q "claim token" && ok "I1a guard is active" || bad "I1a"
P -c "alter table public.video_jobs disable trigger video_jobs_fence_guard"
RAW "update public.video_jobs set progress_percent=6 where id='$J'" | grep -q ERROR && bad "I1b legacy write after L1" || ok "I1b L1 (disable trigger) re-opens legacy writes with nothing dropped"
Q "select public.video_job_update_fenced('$J','$IT','{\"progress_percent\":7}')->>'progress_percent'" | grep -q 7 && ok "I1c a still-running fenced worker keeps working under L1 (no break)" || bad "I1c"
P -c "alter table public.video_jobs enable trigger video_jobs_fence_guard"
RAW "update public.video_jobs set progress_percent=8 where id='$J'" | grep -q "claim token" && ok "I1d L1 is reversible (re-enabled guard blocks again)" || bad "I1d"
Q "select public.video_job_commit_fenced('$J','$IT',1,'{\"drive_video_url\":\"https://drive.google.com/f/keep\",\"drive_video_id\":\"kid\",\"drive_folder_url\":\"https://drive.google.com/f/kf\"}')->>'status'" | grep -q ready && ok "I2a job committed before rollback" || bad "I2a"
[ "$(P -c "$DRAIN")" = 0 ] && ok "I2b drain query is 0 after the job finished: L2 allowed" || bad "I2b"
P -c "drop trigger video_jobs_fence_guard on public.video_jobs; drop function public.video_jobs_fence_guard(); drop function public.video_job_commit_fenced(uuid,uuid,integer,jsonb); drop function public.video_job_update_fenced(uuid,uuid,jsonb); drop function public.claim_next_video_job_fenced(text,integer);" >/dev/null && ok "I2c L2 executes (functions + trigger dropped, columns kept)" || bad "I2c"
[ "$(P -c "select drive_video_url||'|'||committed_attempt||'|'||status from public.video_jobs where id='$J'")" = "https://drive.google.com/f/keep|1|ready" ] && ok "I2d committed output references and committed_attempt survive L2" || bad "I2d"
Q "select public.video_job_update_fenced('$J','$IT','{}')" | grep -qi "does not exist" && ok "I3 a fenced worker that is still running after L2 fails loudly (function missing): stop it BEFORE L2" || bad "I3"
P -c "insert into public.video_jobs(id) values('00000000-0000-0000-0000-0000000000f2')"
Q "select public.claim_next_video_job('legacy',4)->>'id'" | grep -q f2 && RAW "update public.video_jobs set output_video_url='legacy-ok' where id='00000000-0000-0000-0000-0000000000f2'" | grep -q ERROR && bad "I4 legacy after L2" || ok "I4 legacy worker claims and writes normally after L2"

# ---- Part K (review #106): initial migration state, atomic candidates, reconciliation, mixed old/fenced rollback without reference loss
KA=00000000-0000-0000-0000-0000000000a1; KB=00000000-0000-0000-0000-0000000000b1; KC=00000000-0000-0000-0000-0000000000c1; KD=00000000-0000-0000-0000-0000000000d1
P -c "truncate public.video_jobs cascade; drop trigger if exists video_jobs_fence_guard on public.video_jobs" ; P -c "drop function if exists public.video_jobs_fence_guard(); drop function if exists public.video_job_commit_fenced(uuid,uuid,integer,jsonb); drop function if exists public.video_job_update_fenced(uuid,uuid,jsonb); drop function if exists public.claim_next_video_job_fenced(text,integer); alter table public.video_jobs drop column if exists claim_token; alter table public.video_jobs drop column if exists committed_attempt;"
APPLY keep-disabled
[ "$(P -c "select tgenabled::text from pg_trigger where tgname='video_jobs_fence_guard'")" = D ] && ok "K1 initial migration state: guard trigger exists but is DISABLED (enable needs the separate security-review step)" || bad "K1"
P -c "insert into public.video_jobs(id) values('$J')"
KT=$(Q "select public.claim_next_video_job_fenced('n',4)->>'claim_token'")
RAW "update public.video_jobs set progress_percent=3 where id='$J'" | grep -q ERROR && bad "K2 legacy write with guard disabled" || ok "K2 with the guard disabled the fenced RPCs exist and legacy writes are NOT blocked (no behaviour change yet)"
CAND='[{"candidate_index":1,"timestamp_seconds":1.5,"storage_path":"u/c/covers/j/attempt-01/1.jpg","drive_url":"https://drive.google.com/f/c1"},{"candidate_index":2,"timestamp_seconds":3,"storage_path":"u/c/covers/j/attempt-01/2.jpg","drive_url":"https://drive.google.com/f/c2"}]'
CR='{"drive_video_url":"https://drive.google.com/f/v","drive_video_id":"vid","drive_folder_url":"https://drive.google.com/f/f","cover_candidates":'"$CAND"'}'
Q "select public.video_job_commit_fenced('$J','$KT',1,'$CR')->>'status'" | grep -q ready && [ "$(P -c "select count(*) from public.video_cover_candidates where job_id='$J'")" = 2 ] && ok "K3 commit writes the job state AND both candidate rows in one transaction" || bad "K3"
P -c "delete from public.video_cover_candidates where job_id='$J'"
Q "select public.video_job_commit_fenced('$J','$KT',1,'$CR')->>'status'" | grep -q ready && [ "$(P -c "select count(*) from public.video_cover_candidates where job_id='$J'")" = 2 ] && ok "K4 RECONCILIATION: a repeated commit by the committed winner restores missing candidate rows (idempotent)" || bad "K4"
Q "select public.video_job_commit_fenced('$J','$KT',1,'$CR')->>'status'" >/dev/null; [ "$(P -c "select count(*) from public.video_cover_candidates where job_id='$J'")" = 2 ] && ok "K5 repeating it again creates no duplicates (unique per job+index)" || bad "K5"
OLDID=$(P -c "select id from public.video_cover_candidates where job_id='$J' and candidate_index=1"); Q "select public.video_job_commit_fenced('$J','$KT',1,'$CR')" >/dev/null
[ "$(P -c "select id from public.video_cover_candidates where job_id='$J' and candidate_index=1")" = "$OLDID" ] && ok "K6 candidate ids are stable across reconciliation (selected_cover_id references stay valid)" || bad "K6"
BADT=$(P -c "select gen_random_uuid()")
Q "select public.video_job_commit_fenced('$J','$BADT',1,'$CR')" | grep -q "stale claim" && [ "$(P -c "select drive_url from public.video_cover_candidates where job_id='$J' and candidate_index=1")" = "https://drive.google.com/f/c1" ] && ok "K7 a zombie/wrong token cannot write or change candidate rows" || bad "K7"
Q "select public.video_job_commit_fenced('$J','$KT',2,'{\"drive_video_url\":\"https://drive.google.com/f/OTHER\",\"drive_video_id\":\"x\",\"cover_candidates\":[]}')" | grep -q "stale claim" && ok "K8 same token but a different attempt number is not the committed winner: rejected" || bad "K8"
# K9 atomicity: a bad candidate (index 9) rolls the whole commit back
P -c "insert into public.video_jobs(id) values('$KB')"; KBT=$(Q "select public.claim_next_video_job_fenced('n2',4)->>'claim_token'")
Q "select public.video_job_commit_fenced('$KB','$KBT',1,'{\"drive_video_url\":\"https://drive.google.com/f/b\",\"drive_video_id\":\"b\",\"cover_candidates\":[{\"candidate_index\":9,\"timestamp_seconds\":1,\"storage_path\":\"p\",\"drive_url\":\"d\"}]}')" | grep -qi "ERROR" && [ "$(P -c "select status||'|'||coalesce(committed_attempt::text,'-') from public.video_jobs where id='$KB'")" = "preparing|-" ] && ok "K9 a bad candidate rolls the whole commit back (job stays working, nothing half-written)" || bad "K9"
# K10 concurrent: 10 zombie + 10 holder commits with different candidate sets -> exactly the holder's rows
P -c "truncate public.video_jobs cascade; insert into public.video_jobs(id) values('$KC')"
Z1=$(Q "select public.claim_next_video_job_fenced('a',4)->>'claim_token'"); staleize $KC; Z2=$(Q "select public.claim_next_video_job_fenced('b',4)->>'claim_token'")
for i in $(seq 1 10); do ( Q "select public.video_job_commit_fenced('$KC','$Z1',1,'{\"drive_video_url\":\"https://drive.google.com/f/Z\",\"drive_video_id\":\"z\",\"cover_candidates\":[{\"candidate_index\":1,\"timestamp_seconds\":1,\"storage_path\":\"z\",\"drive_url\":\"https://drive.google.com/f/ZOMBIE\"}]}')" >/dev/null ) & ( Q "select public.video_job_commit_fenced('$KC','$Z2',2,'{\"drive_video_url\":\"https://drive.google.com/f/W\",\"drive_video_id\":\"w\",\"cover_candidates\":[{\"candidate_index\":1,\"timestamp_seconds\":1,\"storage_path\":\"w\",\"drive_url\":\"https://drive.google.com/f/WIN1\"},{\"candidate_index\":2,\"timestamp_seconds\":2,\"storage_path\":\"w2\",\"drive_url\":\"https://drive.google.com/f/WIN2\"}]}')" >/dev/null ) & done; wait
[ "$(P -c "select string_agg(drive_url,',' order by candidate_index) from public.video_cover_candidates where job_id='$KC'")" = "https://drive.google.com/f/WIN1,https://drive.google.com/f/WIN2" ] && ok "K10 20 parallel commits: candidate rows are exactly the winner's (zombie rows never appear)" || bad "K10 $(P -c "select string_agg(drive_url,',') from public.video_cover_candidates where job_id='$KC'")"
# K11 mixed old/fenced workers through the rollback ladder, proving no output reference loss
P -c "truncate public.video_jobs cascade"
P -c "insert into public.video_jobs(id,status,drive_video_url,drive_video_id,drive_folder_url,cover_url,output_video_url,archive_status) values('$KA','ready','https://drive.google.com/f/legacyA','ida','https://drive.google.com/f/fa','https://drive.google.com/f/ca','https://out/a','archived'); insert into public.video_cover_candidates(id,job_id,candidate_index,timestamp_seconds,storage_path,drive_url) values (gen_random_uuid(),'$KA',1,1,'p','https://drive.google.com/f/legacy-cand')"
P -c "insert into public.video_jobs(id) values('$KB')"; KBT=$(Q "select public.claim_next_video_job_fenced('fw',4)->>'claim_token'")
Q "select public.video_job_commit_fenced('$KB','$KBT',1,'{\"drive_video_url\":\"https://drive.google.com/f/fencedB\",\"drive_video_id\":\"idb\",\"drive_folder_url\":\"https://drive.google.com/f/fb\",\"cover_candidates\":[{\"candidate_index\":1,\"timestamp_seconds\":1,\"storage_path\":\"pb\",\"drive_url\":\"https://drive.google.com/f/cb\"}]}')" >/dev/null
P -c "insert into public.video_jobs(id) values('$KC')"; KCT=$(Q "select public.claim_next_video_job_fenced('fw2',4)->>'claim_token'")      # fenced job in flight
P -c "insert into public.video_jobs(id) values('$KD')"; Q "select public.claim_next_video_job('oldw',4)->>'id'" >/dev/null                                                  # legacy job in flight
REFS="select md5(coalesce(string_agg(id||'|'||coalesce(drive_video_url,'')||'|'||coalesce(drive_video_id,'')||'|'||coalesce(drive_folder_url,'')||'|'||coalesce(cover_url,'')||'|'||coalesce(output_video_url,''),';' order by id),'')) from public.video_jobs where id in ('$KA','$KB')"
CANDS="select md5(coalesce(string_agg(job_id||'|'||candidate_index||'|'||id||'|'||drive_url||'|'||storage_path,';' order by job_id,candidate_index),'')) from public.video_cover_candidates"
R0=$(P -c "$REFS"); C0=$(P -c "$CANDS"); N0=$(P -c "select count(*) from public.video_cover_candidates")
P -c "alter table public.video_jobs enable trigger video_jobs_fence_guard"
RAW "update public.video_jobs set progress_percent=11 where id='$KC'" | grep -q "claim token" && RAW "update public.video_jobs set progress_percent=12 where id='$KD'" | grep -q ERROR && bad "K11a mixed state guard behaviour" || ok "K11a mixed state with guard ENABLED: old worker blocked on the fenced job, legacy job (no token) unaffected"
[ "$(P -c "$REFS")" = "$R0" ] && ok "K11b references unchanged while mixed workers run" || bad "K11b"
P -c "alter table public.video_jobs disable trigger video_jobs_fence_guard"      # L1
[ "$(P -c "$REFS")" = "$R0" ] && [ "$(P -c "$CANDS")" = "$C0" ] && ok "K11c L1: no reference or candidate loss" || bad "K11c"
Q "select public.video_job_update_fenced('$KC','$KCT','{\"progress_percent\":20}')->>'progress_percent'" | grep -q 20 && ok "K11d L1: the fenced worker still works in the mixed state (and legacy writes are possible: documented risk of L1)" || bad "K11d"
# L0: fenced worker stops -> its job goes stale; legacy worker (or a restarted one) reclaims via the unmodified claim function
staleize $KC
Q "select public.claim_next_video_job('oldw',4)->>'id'" | grep -q "$KC" && ok "K11e L0: stale fenced job is reclaimed by the LEGACY claim function (token cleared)" || bad "K11e"
[ "$(P -c "select coalesce(claim_token::text,'NULL') from public.video_jobs where id='$KC'")" = NULL ] && ok "K11f reclaimed job carries no stale token" || bad "K11f"
# finish remaining in-flight jobs the legacy way, then drain
P -c "update public.video_jobs set status='ready', drive_video_url='https://drive.google.com/f/legacyC' where id in ('$KC','$KD')"
[ "$(P -c "select count(*) from public.video_jobs where claim_token is not null and status in ('preparing','rendering','uploading')")" = 0 ] && ok "K11g drain query = 0: L2 allowed" || bad "K11g"
P -c "drop trigger video_jobs_fence_guard on public.video_jobs; drop function public.video_jobs_fence_guard(); drop function public.video_job_commit_fenced(uuid,uuid,integer,jsonb); drop function public.video_job_update_fenced(uuid,uuid,jsonb); drop function public.claim_next_video_job_fenced(text,integer)"   # L2
[ "$(P -c "$REFS")" = "$R0" ] && [ "$(P -c "$CANDS")" = "$C0" ] && [ "$(P -c "select count(*) from public.video_cover_candidates")" = "$N0" ] && ok "K11h L2: references, candidate rows and ids identical to before" || bad "K11h"
P -c "alter table public.video_jobs drop column claim_token; alter table public.video_jobs drop column committed_attempt"   # L3
[ "$(P -c "$REFS")" = "$R0" ] && [ "$(P -c "$CANDS")" = "$C0" ] && ok "K11i L3: still no output reference loss (reference columns are plain, independent of the dropped columns)" || bad "K11i"

# ---- Part L (review #108): adversarial tests for DB-commit authorization, payload integrity, candidate ids, retries, cross-job isolation
LA=00000000-0000-0000-0000-0000000000e1; LB=00000000-0000-0000-0000-0000000000e2
APPLY
P -c "truncate public.video_jobs cascade; insert into public.video_jobs(id) values('$LA'),('$LB')"
LAT=$(Q "select public.claim_next_video_job_fenced('la',4)->>'claim_token'"); LBT=$(Q "select public.claim_next_video_job_fenced('lb',4)->>'claim_token'")
G='https://drive.google.com/file/d/ok'
good='"drive_video_url":"'$G'","drive_video_id":"v"'
rej(){ Q "select public.video_job_commit_fenced('$LA','$LAT',${3:-1},'$2')" | grep -qiE "invalid|required" && ok "L $1" || bad "L $1 ($(Q "select public.video_job_commit_fenced('$LA','$LAT',${3:-1},'$2')" | cut -c1-90))"; }
rej "result not an object (array)" '[1]'; rej "result not an object (string)" '"x"'
rej "http (not https) url" '{"drive_video_url":"http://drive.google.com/f","drive_video_id":"v"}'
rej "lookalike host drive.google.com.evil.example" '{"drive_video_url":"https://drive.google.com.evil.example/f","drive_video_id":"v"}'
rej "javascript: url" '{"drive_video_url":"javascript:alert(1)","drive_video_id":"v"}'
rej "non-string url" '{"drive_video_url":5,"drive_video_id":"v"}'
rej "bad folder url" '{'"$good"',"drive_folder_url":"https://evil.example/f"}'
rej "bad cover url" '{'"$good"',"cover_url":"ftp://x"}'
rej "path traversal in storage_path" '{'"$good"',"cover_candidates":[{"candidate_index":1,"timestamp_seconds":1,"storage_path":"../../etc/passwd","drive_url":"'$G'"}]}'
rej "absolute storage_path" '{'"$good"',"cover_candidates":[{"candidate_index":1,"timestamp_seconds":1,"storage_path":"/abs","drive_url":"'$G'"}]}'
rej "more than 5 candidates" '{'"$good"',"cover_candidates":[1,2,3,4,5,6]}'
for badidx in 0 6 '"a"' null '1.5'; do rej "candidate_index $badidx" '{'"$good"',"cover_candidates":[{"candidate_index":'$badidx',"timestamp_seconds":1,"storage_path":"p","drive_url":"'$G'"}]}'; done
rej "negative timestamp" '{'"$good"',"cover_candidates":[{"candidate_index":1,"timestamp_seconds":-1,"storage_path":"p","drive_url":"'$G'"}]}'
rej "candidate drive_url not drive" '{'"$good"',"cover_candidates":[{"candidate_index":1,"timestamp_seconds":1,"storage_path":"p","drive_url":"https://evil.example/x"}]}'
rej "attempt 0" "{$good}" 0; rej "attempt 100" "{$good}" 100
Q "select public.video_job_commit_fenced('$LA','$LAT',1,jsonb_build_object('drive_video_url','https://drive.google.com/f','drive_video_id','v','x',repeat('A',70000)))" | grep -qi "invalid result" && ok "L oversize payload (>64KB) rejected" || bad "L oversize payload"
[ "$(P -c "select status||'|'||coalesce(committed_attempt::text,'-') from public.video_jobs where id='$LA'")" = "preparing|-" ] && ok "L none of the rejected payloads changed the job (still working, nothing committed)" || bad "L state after rejections"
# candidate id integrity
CJ='{"drive_video_url":"'$G'","drive_video_id":"va","cover_candidates":[{"id":"11111111-1111-1111-1111-111111111111","candidate_index":1,"timestamp_seconds":1,"storage_path":"a/1.jpg","drive_url":"'$G'"}]}'
Q "select public.video_job_commit_fenced('$LA','$LAT',1,'$CJ')->>'status'" | grep -q ready && [ "$(P -c "select id from public.video_cover_candidates where job_id='$LA'")" != 11111111-1111-1111-1111-111111111111 ] && ok "L client-supplied candidate id is IGNORED (server generates ids)" || bad "L candidate id ignored"
CB='{"drive_video_url":"'$G'","drive_video_id":"vb","cover_candidates":[{"id":"'$(P -c "select id from public.video_cover_candidates where job_id='$LA'")'","candidate_index":1,"timestamp_seconds":2,"storage_path":"b/1.jpg","drive_url":"https://drive.google.com/file/d/b1"}]}'
Q "select public.video_job_commit_fenced('$LB','$LBT',1,'$CB')->>'status'" | grep -q ready && [ "$(P -c "select drive_url from public.video_cover_candidates where job_id='$LA'")" = "$G" ] && [ "$(P -c "select count(*) from public.video_cover_candidates")" = 2 ] && ok "L cross-job candidate id collision attempt: job A's row untouched, job B gets its own row" || bad "L cross-job"
Q "select public.video_job_commit_fenced('$LA','$LBT',1,'{$good}')" | grep -q "stale claim" && ok "L token of job B cannot commit job A" || bad "L cross-job token"
# role spoofing: authenticated with a faked service_role claim cannot execute at all
O=$(P -c "set role authenticated; select set_config('test.role','service_role',false) is not null; select public.video_job_commit_fenced('$LA','$LAT',1,'{$good}')" 2>&1 || true); grep -q "permission denied" <<<"$O" && ok "L authenticated + faked service_role claim: EXECUTE denied before any claim is read" || bad "L spoof"
# injection-ish text is stored inertly
P -c "truncate public.video_jobs cascade; insert into public.video_jobs(id) values('$LA')"; LAT=$(Q "select public.claim_next_video_job_fenced('la',4)->>'claim_token'")
INJ="x'; drop table public.video_jobs; --"
Q "select public.video_job_update_fenced('$LA','$LAT',jsonb_build_object('progress_stage',\$q\$$INJ\$q\$))->>'progress_stage'" >/dev/null
[ "$(P -c "select progress_stage from public.video_jobs where id='$LA'")" = "x'; drop table public.video_jobs; --" ] && ok "L SQL-looking text in a patch is stored literally, the table is intact" || bad "L injection"
# retry storm
RES2='{"drive_video_url":"'$G'","drive_video_id":"v","cover_candidates":[{"candidate_index":1,"timestamp_seconds":1,"storage_path":"p","drive_url":"'$G'"},{"candidate_index":2,"timestamp_seconds":2,"storage_path":"p2","drive_url":"'$G'"}]}'
rm -f "$D"/s*; for i in $(seq 1 30); do ( Q "select public.video_job_commit_fenced('$LA','$LAT',1,'$RES2')" | grep -q ERROR || echo OK >> "$D/s$i" ) & done; wait
[ "$( (ls "$D"/s* 2>/dev/null || true) | wc -l | tr -d ' ')" = 30 ] && [ "$(P -c "select count(*) from public.video_cover_candidates where job_id='$LA'")" = 2 ] && ok "L 30 parallel identical commits: all succeed idempotently, exactly 2 candidate rows, no deadlock" || bad "L retry storm"
exit $FAIL
