#!/bin/bash
# Offline live-schema-DRIFT review: loads the repo's REAL supabase/setup.sql + ALL migrations (with Supabase stubs) into a throwaway PostgreSQL, applies the
# DRAFT fencing migration on top and exercises it against the real video_jobs (real constraints, grants, RLS policy, triggers, claim function versions).
# No network, dummy rows only (FK checks bypassed for fixtures via session_replication_role=replica). Usage: PGBIN=/Library/PostgreSQL/18/bin tests/real-schema-fencing.sh
set -uo pipefail
PGBIN="${PGBIN:-$(dirname "$(command -v postgres)")}"; ROOT="$(cd "$(dirname "$0")/.." && pwd)"
D="$(mktemp -d)"; PORT=$((20000 + RANDOM % 20000)); FAIL=0
trap '"$PGBIN/pg_ctl" -D "$D/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$D"' EXIT
"$PGBIN/initdb" -D "$D/data" -U postgres --auth=trust >/dev/null
"$PGBIN/pg_ctl" -D "$D/data" -o "-p $PORT -k $D -c listen_addresses=''" -l "$D/log" -w start >/dev/null
"$PGBIN/createdb" -h "$D" -p "$PORT" -U postgres t
P() { "$PGBIN/psql" -h "$D" -p "$PORT" -U postgres -d t -qtAX "$@"; }
ok(){ echo "PASS $*"; }; bad(){ echo "FAIL $*"; FAIL=1; }
. "$ROOT/tests/real-schema-lib.sh"
load_real_schema || { echo "FAIL stubs"; exit 2; }
MERR=$((TOTAL-OKN))
echo "info: $OKN of $TOTAL migration files apply with 0 errors ($MERR still failing; classified by tests/real-schema-report.sh)"
[ "$(P -c "select count(*) from pg_proc where proname='claim_next_video_job'")" = 2 ] && ok "S0 real schema loaded: setup.sql + migrations ($MERR files still failing), both claim_next_video_job versions present" || bad "S0 real schema load"
# Supabase gives service_role ALL on public tables through default privileges (not part of setup.sql), so the stub grants it after loading.
P -c "grant all on all tables in schema public to service_role; grant all on all sequences in schema public to service_role; grant usage on schema public to anon, authenticated, service_role" >/dev/null
# Fixture simplification (documented in the report): the parent rows (content_items, admins) are not created, so the two parent FKs of video_jobs are dropped in THIS throwaway DB only.
P -c "do \$\$ declare c record; begin for c in select conname from pg_constraint where conrelid='public.video_jobs'::regclass and contype='f' loop execute format('alter table public.video_jobs drop constraint %I', c.conname); end loop; end \$\$" >/dev/null
Q() { local o; o="$(P -c "set role service_role; select set_config('test.role','service_role',false) is not null; $1" 2>&1 || true)"; if grep -q ERROR <<<"$o"; then grep -m1 ERROR <<<"$o"; else tail -1 <<<"$o"; fi; }
job() { P -c "set session_replication_role=replica; insert into public.video_jobs(content_id,created_by,duration_min_seconds,duration_max_seconds,script_text,title,video_template) values (gen_random_uuid(),gen_random_uuid(),10,30,'s','t','quick_tips') returning id" | head -1; }
staleize() { P -c "alter table public.video_jobs disable trigger user; update public.video_jobs set updated_at=now()-interval '40 minutes' where id='$1'; alter table public.video_jobs enable trigger user"; }
ALLP="DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE"
[ "$(P -c "select string_agg(privilege_type,',' order by privilege_type) from information_schema.role_table_grants where table_schema='public' and table_name='video_jobs' and grantee='authenticated'")" = "$ALLP" ] && [ "$(P -c "select string_agg(privilege_type,',' order by privilege_type) from information_schema.role_table_grants where table_schema='public' and table_name='video_jobs' and grantee='anon'")" = "$ALLP" ] && ok "S1 LIVE-LIKE grants (review #122): with Supabase default privileges in the fixture anon AND authenticated hold all 7 table privileges on video_jobs, as the live read-only check found" || bad "S1 grants"
[ "$(P -c "select count(*) from pg_policies where tablename='video_jobs' and cmd<>'SELECT'")" = 0 ] && ok "S2 REAL RLS: only a SELECT policy exists on video_jobs (no UPDATE policy for users)" || bad "S2"
P -v ON_ERROR_STOP=1 -f "$ROOT/supabase/drafts/20261104_video_job_fencing.sql" >/dev/null 2>"$D/draft.err" && ok "S3 the draft applies cleanly on the REAL schema" || bad "S3 $(head -2 "$D/draft.err")"
[ "$(P -c "select tgenabled::text from pg_trigger where tgname='video_jobs_fence_guard'")" = D ] && ok "S4 initial state: guard disabled" || bad "S4"
J=$(job); T=$(Q "select public.claim_next_video_job_fenced('w1',4)->>'claim_token'")
[ -n "$T" ] && [ "$(P -c "select status||'|'||attempt_count from public.video_jobs where id='$J'")" = "preparing|1" ] && ok "S5 fenced claim works through the REAL claim_next_video_job(text,integer) (status preparing, attempt 1, token issued)" || bad "S5 $T"
Q "select public.video_job_update_fenced('$J','$T','{\"status\":\"rendering\",\"progress_percent\":55}')->>'status'" | grep -q rendering && ok "S6 fenced update respects real columns" || bad "S6"
Q "select public.video_job_update_fenced('$J','$T','{\"progress_percent\":101}')" | grep -q "progress_percent_check" && [ "$(P -c "select progress_percent from public.video_jobs where id='$J'")" = 55 ] && ok "S7 a real CHECK constraint violation is raised and leaves the row untouched" || bad "S7"
Q "select public.video_job_update_fenced('$J','$T','{\"archive_status\":\"nonsense\"}')" | grep -q "archive_status_check" && ok "S8 real archive_status CHECK enforced through the fenced RPC" || bad "S8"
CR='{"drive_video_url":"https://drive.google.com/file/d/v","drive_video_id":"v","drive_folder_url":"https://drive.google.com/drive/folders/f","cover_candidates":[{"candidate_index":1,"timestamp_seconds":1,"storage_path":"u/c/covers/j/attempt-01/1.jpg","drive_url":"https://drive.google.com/file/d/c1"}]}'
Q "select public.video_job_commit_fenced('$J','$T',1,'$CR')->>'status'" | grep -q ready && [ "$(P -c "select archive_status||'|'||committed_attempt||'|'||(select count(*) from public.video_cover_candidates where job_id='$J') from public.video_jobs where id='$J'")" = "archived|1|1" ] && ok "S9 commit on the REAL tables: ready + archived + committed_attempt + real candidate row" || bad "S9"
P -c "alter table public.video_jobs enable trigger video_jobs_fence_guard"
J2=$(job); T2=$(Q "select public.claim_next_video_job_fenced('w2',4)->>'claim_token'")
O10=$(P -c "set role service_role; select set_config('test.role','service_role',false) is not null; update public.video_jobs set output_video_url='x' where id='$J2'" 2>&1); grep -q "claim token" <<<"$O10" && ok "S10 guard enabled on the REAL table: old-style service_role PATCH on a held job is rejected" || bad "S10"
P -c "set role service_role; update public.video_jobs set title='edit' where id='$J'" 2>&1 | grep -q ERROR && bad "S11 finished job edit blocked" || ok "S11 the guard does not touch finished jobs (no token-protected working state)"
[ "$(P -c "select string_agg(tgname,',' order by tgname) from pg_trigger where tgrelid='public.video_jobs'::regclass and not tgisinternal")" = "video_jobs_fence_guard,video_jobs_touch" ] && Q "select public.video_job_update_fenced('$J2','$T2','{\"progress_percent\":9}')->>'progress_percent'" | grep -q 9 && ok "S12 trigger order with the real video_jobs_touch trigger is fine (fence_guard before touch), fenced update still works" || bad "S12"
staleize "$J2"; Q "select coalesce(public.claim_next_video_job('legacy',4)->>'attempt_count','NULL')" | grep -q 2 && ok "S13 stale fenced job reclaimed by the REAL unmodified claim function (attempt 2)" || bad "S13"
P -c "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('claim_next_video_job_fenced','video_job_update_fenced','video_job_commit_fenced') and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('public',p.oid,'execute'))" | grep -q '^0$' && ok "S14 new RPCs are executable by service_role only (anon/authenticated/public denied)" || bad "S14"
P -c "alter table public.video_jobs disable trigger video_jobs_fence_guard"; P -c "set role service_role; update public.video_jobs set progress_percent=1 where id='$J2'" 2>&1 | grep -q ERROR && bad "S15 L1" || ok "S15 L1 (disable trigger) works on the real table"
P -c "update public.video_jobs set status='ready' where id='$J2'; drop trigger video_jobs_fence_guard on public.video_jobs; drop function public.video_jobs_fence_guard(); drop function public.video_job_commit_fenced(uuid,uuid,integer,jsonb); drop function public.video_job_update_fenced(uuid,uuid,jsonb); drop function public.claim_next_video_job_fenced(text,integer); alter table public.video_jobs drop column claim_token; alter table public.video_jobs drop column committed_attempt" >/dev/null 2>&1 && [ "$(P -c "select count(*) from pg_proc where proname='claim_next_video_job'")" = 2 ] && [ "$(P -c "select count(*) from public.video_cover_candidates")" = 1 ] && ok "S16 L2+L3 on the real schema: original claim functions intact, candidate rows kept" || bad "S16"

# ---- S17-S20 (review #110): independent audit of SECURITY DEFINER hygiene and the BYPASSRLS assumption on the REAL schema
P -v ON_ERROR_STOP=1 -f "$ROOT/supabase/drafts/20261104_video_job_fencing.sql" >/dev/null 2>&1   # re-apply after S16's rollback
[ "$(P -c "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('claim_next_video_job_fenced','video_job_update_fenced','video_job_commit_fenced','video_commit_validate','video_jobs_fence_guard')")" = 5 ] && ok "S17 draft re-applied for the audit (5 objects)" || bad "S17"
BADSP=$(P -c "select string_agg(p.proname,',') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('claim_next_video_job_fenced','video_job_update_fenced','video_job_commit_fenced') and (not p.prosecdef or p.proconfig is null or not (p.proconfig::text ~ 'search_path=public, pg_temp'))")
[ -z "$BADSP" ] && ok "S18 the 3 new SECURITY DEFINER RPCs pin search_path = public, pg_temp (pg_temp last) and are definer" || bad "S18 $BADSP"
echo "info S19 EXISTING definer functions that mention video (real loaded schema): name | search_path config | anon exec | authenticated exec"
P -c "select '  '||p.oid::regprocedure::text||' | '||coalesce(p.proconfig::text,'NO search_path') ||' | '||has_function_privilege('anon',p.oid,'execute')::text||' | '||has_function_privilege('authenticated',p.oid,'execute')::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and (p.proname ilike '%video%' or p.prosrc ilike '%video_jobs%') and p.proname not in ('claim_next_video_job_fenced','video_job_update_fenced','video_job_commit_fenced') order by 1"
NOSP=$(P -c "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and (p.proname ilike '%video%' or p.prosrc ilike '%video_jobs%') and p.proname not in ('claim_next_video_job_fenced','video_job_update_fenced','video_job_commit_fenced') and (p.proconfig is null or not (p.proconfig::text ~ 'search_path'))")
[ "$NOSP" = 0 ] && ok "S19 every existing video-related SECURITY DEFINER function pins a search_path" || bad "S19 $NOSP existing video definer functions WITHOUT a search_path"
NOPGT=$(P -c "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and (p.proname ilike '%video%' or p.prosrc ilike '%video_jobs%') and p.proname not in ('claim_next_video_job_fenced','video_job_update_fenced','video_job_commit_fenced') and p.proconfig::text ~ 'search_path' and p.proconfig::text !~ 'pg_temp'")
echo "info S19b existing video definer functions whose search_path does not list pg_temp explicitly (pre-existing, not changed by the draft): $NOPGT"
# S20: the BYPASSRLS assumption. Without it a service_role UPDATE is silently filtered by RLS (0 rows, no error): legacy workers would not work either.
J3=$(job); P -c "alter role service_role nobypassrls"
N0=$(P -c "set role service_role; with u as (update public.video_jobs set progress_percent=33 where id='$J3' returning 1) select count(*) from u")
P -c "alter role service_role bypassrls"
N1=$(P -c "set role service_role; with u as (update public.video_jobs set progress_percent=34 where id='$J3' returning 1) select count(*) from u")
[ "$N0" = 0 ] && [ "$N1" = 1 ] && ok "S20 without BYPASSRLS a service_role UPDATE affects 0 rows silently (legacy worker and guard would both be inert); with it 1 row: live service_role MUST have BYPASSRLS, so the live check is a precondition, not an option" || bad "S20 n0=$N0 n1=$N1"

# ---- S21-S24 (review #120): the LIVE claim_next_video_job(text,integer) is the 20260921_image_storyboard definition (md5(pg_get_functiondef) matched offline), not 20261006.
python3 - "$ROOT" "$D/claim_live.sql" <<'PY'
import re,sys
s=open(sys.argv[1]+'/supabase/migrations/20260921_image_storyboard.sql').read()
m=re.search(r'(create\s+or\s+replace\s+function\s+public\.claim_next_video_job\s*\(p_worker_id text,\s*p_max_input_schema_version integer\).*?\bas\s+(\$[A-Za-z_]*\$).*?\2\s*;)',s,re.I|re.S)
open(sys.argv[2],'w').write(m.group(1)+'\n')
PY
P -v ON_ERROR_STOP=1 -f "$D/claim_live.sql" >/dev/null 2>&1 && [ "$(P -c "select md5(pg_get_functiondef('public.claim_next_video_job(text,integer)'::regprocedure))")" = ff2f643124012e0277fb2323439dae06 ] && ok "S21 offline definition of the 20260921 claim function reproduces the LIVE md5(pg_get_functiondef) ff2f6431... exactly" || bad "S21"
P -c "truncate public.video_jobs cascade"
L1=$(job); TL=$(Q "select public.claim_next_video_job_fenced('wl',4)->>'claim_token'")
[ -n "$TL" ] && ok "S22 fenced claim works through the LIVE-version claim function" || bad "S22"
staleize "$L1"; Q "select coalesce(public.claim_next_video_job('legacy',4)->>'attempt_count','NULL')" | grep -q 2 && ok "S23 stale fenced job reclaimed by the LIVE-version claim function (attempt 2)" || bad "S23"
P -c "truncate public.video_jobs cascade"; L2=$(job); P -c "update public.video_jobs set input_schema_version=4 where id='$L2'"
[ "$(Q "select coalesce(public.claim_next_video_job('w',4)->>'id','NULL')")" = NULL ] && [ "$(Q "select coalesce(public.claim_next_video_job_fenced('w',4)->>'id','NULL')")" = NULL ] && ok "S24 BEHAVIOUR OF THE LIVE VERSION (unchanged by the wrapper): a job with input_schema_version 4 (studio storyboard) is NEVER claimed because the cap is least(p_max,3); the repo-latest 20261006 version raises it to 4" || bad "S24"

# ---- S25-S31 (review #122): effective privilege risk of the live anon/authenticated ALL grants, and the minimal REVOKE draft.
P -c "truncate public.video_jobs cascade"; P -c "alter table public.video_jobs disable trigger video_jobs_fence_guard" >/dev/null 2>&1
R1=$(job); R2=$(job)
DEL=$(P -c "set role anon; with d as (delete from public.video_jobs returning 1) select count(*) from d")
UPD=$(P -c "set role authenticated; with u as (update public.video_jobs set progress_percent=5 returning 1) select count(*) from u")
INS=$(P -c "set role authenticated; insert into public.video_jobs(content_id,created_by,duration_min_seconds,duration_max_seconds,script_text,title,video_template) values (gen_random_uuid(),gen_random_uuid(),10,30,'s','t','quick_tips')" 2>&1 | grep -c "row-level security")
[ "$DEL" = 0 ] && [ "$UPD" = 0 ] && [ "$INS" = 1 ] && ok "S25 RLS (SELECT policy only) still stops row DML despite the grants: anon DELETE 0 rows, authenticated UPDATE 0 rows, authenticated INSERT violates RLS" || bad "S25 del=$DEL upd=$UPD ins=$INS"
P -c "set role anon; truncate public.video_jobs cascade" >/dev/null 2>&1; [ "$(P -c "select count(*) from public.video_jobs")" = 0 ] && ok "S26 RISK DEMONSTRATED (throwaway DB): anon can TRUNCATE video_jobs with the live-like grants; RLS does not apply to TRUNCATE" || bad "S26 truncate was blocked"
R3=$(job)
P -c "create policy tmp_permissive on public.video_jobs for all to authenticated using (true) with check (true)" >/dev/null
UPD2=$(P -c "set role authenticated; with u as (update public.video_jobs set progress_percent=7 returning 1) select count(*) from u")
P -c "drop policy tmp_permissive on public.video_jobs" >/dev/null
[ "$UPD2" -ge 1 ] && ok "S27 FRAGILITY: one future permissive policy would immediately expose full DML to authenticated (the grants are the only other barrier)" || bad "S27 upd2=$UPD2"
P -c "select string_agg(a::text,'|' order by a::text) from pg_class c, unnest(c.relacl) a where c.oid='public.video_jobs'::regclass" > "$D/acl_before.txt"
P -c "create publication supabase_realtime_test for table public.video_jobs" >/dev/null 2>&1
POL0=$(P -c "select string_agg(policyname||':'||cmd||':'||roles::text||':'||coalesce(qual,''),'|' order by policyname) from pg_policies where schemaname='public' and tablename='video_jobs'")
python3 - "$ROOT" "$D/revoke.sql" "$D/rollback.sql" <<'PY'
import sys
t=open(sys.argv[1]+'/supabase/drafts/20261104_video_jobs_revoke_api_privileges.sql').read()
body=[l for l in t.splitlines() if not l.startswith('--')]
open(sys.argv[2],'w').write('\n'.join(body))
rb=[l[len('--   '):] for l in t.splitlines() if l.startswith('--   begin; grant all')]
open(sys.argv[3],'w').write('\n'.join(rb))
PY
[ -s "$D/rollback.sql" ] || bad "S28 rollback text not found in the draft"
P -v ON_ERROR_STOP=1 -f "$D/revoke.sql" >/dev/null 2>&1 && ok "S28 REVOKE draft applies cleanly (one transaction)" || bad "S28 revoke failed"
AUTHP=$(P -c "select string_agg(privilege_type,',' order by privilege_type) from information_schema.role_table_grants where table_schema='public' and table_name='video_jobs' and grantee='authenticated'")
ANONP=$(P -c "select count(*) from information_schema.role_table_grants where table_schema='public' and table_name='video_jobs' and grantee='anon'")
COLP=$(P -c "select count(*) from information_schema.column_privileges where table_schema='public' and table_name='video_jobs' and grantee='anon'")
SRP=$(P -c "select string_agg(privilege_type,',' order by privilege_type) from information_schema.role_table_grants where table_schema='public' and table_name='video_jobs' and grantee='service_role'")
[ "$AUTHP" = SELECT ] && [ "$ANONP" = 0 ] && [ "$COLP" = 0 ] && [ "$SRP" = "$ALLP" ] && ok "S29 after REVOKE: authenticated SELECT only, anon nothing (table and column level), service_role unchanged (all 7)" || bad "S29 auth=$AUTHP anon=$ANONP col=$COLP sr=$SRP"
SEL=$(P -c "set role authenticated; select count(*) from public.video_jobs")
ANONSEL=$(P -c "set role anon; select count(*) from public.video_jobs" 2>&1 | grep -c "permission denied")
TR=$(P -c "set role authenticated; truncate public.video_jobs cascade" 2>&1 | grep -c "permission denied")
TR2=$(P -c "set role anon; truncate public.video_jobs cascade" 2>&1 | grep -c "permission denied")
SRU=$(P -c "set role service_role; with u as (update public.video_jobs set progress_percent=9 returning 1) select count(*) from u")
[ "$SEL" -ge 0 ] 2>/dev/null && [ "$ANONSEL" = 1 ] && [ "$TR" = 1 ] && [ "$TR2" = 1 ] && [ "$SRU" -ge 1 ] && ok "S30 after REVOKE: authenticated SELECT still works (dashboard/realtime need), anon SELECT denied, TRUNCATE denied for both, service_role UPDATE still works ($SRU row(s))" || bad "S30 sel=$SEL anonsel=$ANONSEL tr=$TR tr2=$TR2 sru=$SRU"
POL1=$(P -c "select string_agg(policyname||':'||cmd||':'||roles::text||':'||coalesce(qual,''),'|' order by policyname) from pg_policies where schemaname='public' and tablename='video_jobs'")
PUB=$(P -c "select count(*) from pg_publication_tables where pubname='supabase_realtime_test' and tablename='video_jobs'")
SELP=$(P -c "select has_table_privilege('authenticated','public.video_jobs','SELECT')")
[ "$POL0" = "$POL1" ] && [ -n "$POL0" ] && [ "$PUB" = 1 ] && [ "$SELP" = t ] && ok "S32 realtime-relevant state (review #124: video_jobs IS in the live supabase_realtime publication): after REVOKE the RLS policy set is byte-identical, authenticated keeps SELECT (the two things postgres_changes authorizes with), publication membership is untouched" || bad "S32 pol0=$POL0 pol1=$POL1 pub=$PUB sel=$SELP"
P -v ON_ERROR_STOP=1 -f "$D/rollback.sql" >/dev/null 2>&1; P -c "select string_agg(a::text,'|' order by a::text) from pg_class c, unnest(c.relacl) a where c.oid='public.video_jobs'::regclass" > "$D/acl_after.txt"
cmp -s "$D/acl_before.txt" "$D/acl_after.txt" && ok "S31 documented rollback restores the original ACL (same set of entries; entry order inside relacl may differ, which has no effect)" || { bad "S31 rollback differs"; cat "$D/acl_before.txt" "$D/acl_after.txt"; diff "$D/acl_before.txt" "$D/acl_after.txt" | head -5; }

# ---- S33-S37 (reviews #125/#127): snapshot-based rollback on ACLs shaped like live PLUS explicit grantees, grant options, PUBLIC, non-owner grantors; operator packet; Q3 de-duplication.
P -c "create role extra_reader nologin; create role chain_a nologin; create role chain_b nologin; create role chain_base nologin; create role diamond_member nologin" >/dev/null
P -c "grant chain_base to chain_a, chain_b; grant chain_a, chain_b to diamond_member; grant chain_a to authenticated; grant chain_b to authenticated" >/dev/null
python3 - "$ROOT" "$D/q1.sql" "$D/q1v.sql" <<'PY'
import sys
t=open(sys.argv[1]+'/supabase/drafts/20261104_video_jobs_revoke_operator_checks.sql').read()
body=t.split('-- Q1 ',1)[1].split('-- Q2',1)[0]
q1=body.split('-- Q1v',1)[0]; q1v=body.split('-- Q1v',1)[1]
open(sys.argv[2],'w').write(q1.split('\n',1)[1])
open(sys.argv[3],'w').write(q1v.split('\n',1)[1])
PY
snap() { P -f "$D/q1v.sql"; }
reset_acl() { P -c "revoke all on table public.video_jobs from extra_reader, chain_base, chain_a, public cascade; revoke all on table public.video_jobs from anon, authenticated cascade; grant all on table public.video_jobs to anon, authenticated" >/dev/null 2>&1; }
# Case A: owner-granted explicit grantee WITH GRANT OPTION + PUBLIC + untouched non-owner-grantor entry (chain_base=r/extra_reader)
reset_acl; P -c "grant select on table public.video_jobs to extra_reader with grant option; grant select on table public.video_jobs to public" >/dev/null
P -c "set role extra_reader; grant select on table public.video_jobs to chain_base" >/dev/null 2>&1
P -F '|' -f "$D/q1.sql" > "$D/q1.out" 2>&1
V0=$(snap); grep '^rollback_stmt|' "$D/q1.out" | sed 's/^rollback_stmt|//' > "$D/gen_rollback.sql"
NGEN=$(grep -c '^grant' "$D/gen_rollback.sql"); NFLAG=$(grep -c 'NON-OWNER GRANTOR' "$D/gen_rollback.sql")
P -v ON_ERROR_STOP=1 -f "$D/revoke.sql" >/dev/null 2>&1; VMID=$(snap)
P -v ON_ERROR_STOP=1 -f "$D/gen_rollback.sql" >/dev/null 2>&1; V1=$(snap)
[ "$NGEN" = 2 ] && [ "$NFLAG" = 0 ] && [ "$V0" != "$VMID" ] && [ "$V0" = "$V1" ] && ok "S33 ACL with an owner-granted GRANT OPTION grantee, PUBLIC and an untouched non-owner-grantor entry (chain_base=r/extra_reader): the REVOKE changes the ACL, the snapshot-generated rollback ($NGEN statements, only the grantees the draft removes) restores it exactly: Q1v before == after (raw relacl kept as canonical)" || { bad "S33 gen=$NGEN flag=$NFLAG"; echo "V0=$V0"; echo "VMID=$VMID"; echo "V1=$V1"; cat "$D/gen_rollback.sql"; }
# Case B: anon/authenticated entries carrying a NON-OWNER grantor: the generated statement is flagged and the inexactness is DETECTED by Q1v, not hidden
reset_acl; P -c "grant select on table public.video_jobs to extra_reader with grant option; revoke all on table public.video_jobs from authenticated" >/dev/null
P -c "set role extra_reader; grant select on table public.video_jobs to authenticated" >/dev/null 2>&1
P -F '|' -f "$D/q1.sql" > "$D/q1b.out" 2>&1; VB0=$(snap); grep '^rollback_stmt|' "$D/q1b.out" | sed 's/^rollback_stmt|//' > "$D/gen_rollback_b.sql"
NFB=$(grep -c 'NON-OWNER GRANTOR' "$D/gen_rollback_b.sql")
P -v ON_ERROR_STOP=1 -f "$D/revoke.sql" >/dev/null 2>&1; P -v ON_ERROR_STOP=1 -f "$D/gen_rollback_b.sql" >/dev/null 2>&1; VB1=$(snap)
[ "$NFB" -ge 1 ] && [ "$VB0" != "$VB1" ] && ok "S33b KNOWN LIMIT, DETECTED: when an anon/authenticated ACL entry was granted by a NON-OWNER role (authenticated=r/extra_reader), the generated statement carries a NON-OWNER GRANTOR flag and replaying it as the owner records the owner as grantor, so Q1v after != before (mismatch shown, not hidden): such a rollback must be replayed with SET ROLE to that grantor or accepted as inexact" || { bad "S33b flag=$NFB"; echo "VB0=$VB0"; echo "VB1=$VB1"; }
# Case C: a dependent grant (authenticated granted onward) makes the draft's plain REVOKE fail safely: transaction aborted, ACL unchanged
reset_acl; P -c "revoke all on table public.video_jobs from authenticated; grant select on table public.video_jobs to authenticated with grant option" >/dev/null
P -c "set role authenticated; grant select on table public.video_jobs to chain_a" >/dev/null 2>&1
VC0=$(snap); P -v ON_ERROR_STOP=1 -f "$D/revoke.sql" >/dev/null 2>&1; RCC=$?; VC1=$(snap)
[ "$RCC" != 0 ] && [ "$VC0" = "$VC1" ] && ok "S36 a dependent grant (authenticated holds GRANT OPTION and granted onward) makes the draft's plain REVOKE fail with a dependency error; the single transaction rolls back and the ACL is unchanged (the draft never uses CASCADE; the operator must decide separately)" || bad "S36 rc=$RCC"
reset_acl
OUT=$(P -v ON_ERROR_STOP=1 -f "$ROOT/supabase/drafts/20261104_video_jobs_revoke_operator_checks.sql" 2>&1); RC=$?
NW=$(python3 - "$ROOT/supabase/drafts/20261104_video_jobs_revoke_operator_checks.sql" <<'PY'
import sys,re
t=re.sub(r"'[^']*'","''",re.sub(r'--[^\n]*','',open(sys.argv[1]).read()))
st=[x.strip() for x in t.split(';') if x.strip()]
print(sum(1 for x in st if x.split()[0].lower() not in ('select','with')))
PY
)
[ "$RC" = 0 ] && [ -n "$OUT" ] && [ "$NW" = 0 ] && ok "S34 the operator packet (Q1, Q1v, Q2-Q7) executes without error on the real schema and every statement starts with SELECT or WITH (non-read statements: $NW)" || bad "S34 rc=$RC nw=$NW $(echo "$OUT" | grep -m2 ERROR)"
python3 - "$ROOT" "$D/q3.sql" <<'PY'
import sys
t=open(sys.argv[1]+'/supabase/drafts/20261104_video_jobs_revoke_operator_checks.sql').read()
open(sys.argv[2],'w').write(t.split('-- Q3 ',1)[1].split('-- Q4',1)[0].split('\n',1)[1])
PY
P -F '|' -f "$D/q3.sql" > "$D/q3.out" 2>&1
ROWS=$(grep -c '^api_role_is_member_of|' "$D/q3.out"); UNIQ=$(grep '^api_role_is_member_of|' "$D/q3.out" | cut -d'|' -f2 | sort -u | wc -l | tr -d ' ')
HASBASE=$(grep -c '^api_role_is_member_of|chain_base' "$D/q3.out")
[ "$ROWS" = "$UNIQ" ] && [ "$HASBASE" = 1 ] && [ "$ROWS" -ge 3 ] && ok "S35 Q3 membership closure is de-duplicated: a diamond (authenticated -> chain_a, chain_b -> chain_base) reports chain_base exactly once ($ROWS rows, $UNIQ distinct roles); inherit_option is read version-agnostically" || { bad "S35 rows=$ROWS uniq=$UNIQ base=$HASBASE"; cat "$D/q3.out"; }
exit $FAIL
