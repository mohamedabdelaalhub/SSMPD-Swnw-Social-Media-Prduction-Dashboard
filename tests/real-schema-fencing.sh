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
[ "$(P -c "select string_agg(privilege_type,',') from information_schema.role_table_grants where table_schema='public' and table_name='video_jobs' and grantee='authenticated'")" = SELECT ] && [ -z "$(P -c "select 1 from information_schema.role_table_grants where table_schema='public' and table_name='video_jobs' and grantee='anon'")" ] && ok "S1 REAL grants: authenticated SELECT only, anon none (the guard's exemption assumption holds in the repo schema)" || bad "S1 grants"
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
exit $FAIL
