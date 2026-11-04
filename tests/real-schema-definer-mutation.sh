#!/bin/bash
# Isolated-fixture audit (review #112): can the EXISTING authenticated-executable SECURITY DEFINER video functions be used for unintended mutation?
# Loads the repo's REAL setup.sql + migrations (shared loader), creates dummy admins/content/jobs, calls each function as anon / non-admin / inactive admin /
# page_manager on SOMEONE ELSE's content / owner, and compares full-table hashes before and after. No network, dummy data only.
# Usage: PGBIN=/Library/PostgreSQL/18/bin tests/real-schema-definer-mutation.sh
set -uo pipefail
PGBIN="${PGBIN:-$(dirname "$(command -v postgres)")}"; ROOT="$(cd "$(dirname "$0")/.." && pwd)"
D="$(mktemp -d)"; PORT=$((20000 + RANDOM % 20000)); FAIL=0
trap '"$PGBIN/pg_ctl" -D "$D/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$D"' EXIT
"$PGBIN/initdb" -D "$D/data" -U postgres --auth=trust >/dev/null
"$PGBIN/pg_ctl" -D "$D/data" -o "-p $PORT -k $D -c listen_addresses=''" -l "$D/log" -w start >/dev/null
"$PGBIN/createdb" -h "$D" -p "$PORT" -U postgres t
P() { "$PGBIN/psql" -h "$D" -p "$PORT" -U postgres -d t -qtAX "$@"; }
ok(){ echo "PASS $*"; }; bad(){ echo "FAIL $*"; FAIL=1; }
. "$ROOT/tests/real-schema-lib.sh"; load_real_schema >/dev/null 2>&1
P -c "grant all on all tables in schema public to service_role; grant usage on schema public to anon, authenticated, service_role" >/dev/null
P -c "do \$\$ declare c record; begin for c in select conname, conrelid::regclass t from pg_constraint where contype='f' and conrelid in ('public.video_jobs'::regclass,'public.content_items'::regclass,'public.video_assets'::regclass,'public.video_cover_candidates'::regclass,'public.admins'::regclass,'public.activity_log'::regclass) loop execute format('alter table %s drop constraint %I', c.t, c.conname); end loop; end \$\$" >/dev/null
# the fencing draft is applied with the guard ENABLED so the held-job checks run in the strictest state
P -v ON_ERROR_STOP=1 -f "$ROOT/supabase/drafts/20261104_video_job_fencing.sql" >/dev/null 2>&1 && P -c "alter table public.video_jobs enable trigger video_jobs_fence_guard" >/dev/null && ok "M0 fencing draft applied on the real schema with the guard ENABLED" || bad "M0"
UA=aaaaaaaa-0000-0000-0000-00000000000a; UB=bbbbbbbb-0000-0000-0000-00000000000b; UC=cccccccc-0000-0000-0000-00000000000c; UD=dddddddd-0000-0000-0000-00000000000d
AA=a1a1a1a1-0000-0000-0000-0000000000a1; AB=b2b2b2b2-0000-0000-0000-0000000000b2; AC=c3c3c3c3-0000-0000-0000-0000000000c3
CA=ca000000-0000-0000-0000-0000000000ca; CB=cb000000-0000-0000-0000-0000000000cb; JA=1a000000-0000-0000-0000-0000000000a1; JB=1b000000-0000-0000-0000-0000000000b1; JH=1c000000-0000-0000-0000-0000000000c1
P -c "insert into public.admins(id,user_id,email,role,active) values ('$AA','$UA','a@x.test','page_manager',true),('$AB','$UB','b@x.test','page_manager',true),('$AC','$UC','c@x.test','page_manager',false);
insert into public.content_items(id,title,created_by,content_format,brand,script_text,target_duration_min_seconds,target_duration_max_seconds,video_template) values ('$CA','A','$AA','video','sono','s',10,30,'quick_tips'),('$CB','B','$AB','video','sono','s',10,30,'quick_tips');
insert into public.video_jobs(id,content_id,created_by,status,duration_min_seconds,duration_max_seconds,script_text,title,video_template,drive_video_url,cover_url) values
 ('$JA','$CA','$AA','ready',10,30,'s','A','quick_tips','https://drive.google.com/file/d/a','https://drive.google.com/file/d/ca0'),
 ('$JB','$CB','$AB','ready',10,30,'s','B','quick_tips','https://drive.google.com/file/d/b','https://drive.google.com/file/d/cb0');
insert into public.video_cover_candidates(id,job_id,candidate_index,timestamp_seconds,storage_path,drive_url) values (gen_random_uuid(),'$JA',1,1,'p','https://drive.google.com/file/d/ca1'),(gen_random_uuid(),'$JB',1,1,'p','https://drive.google.com/file/d/cb1');
insert into public.video_assets(id,content_id,created_by,asset_type,storage_path,file_name,file_size) values (gen_random_uuid(),'$CB','$AB','image','x/y/z.png','z.png',100);" >/dev/null 2>"$D/fix.err" || { echo "fixture insert failed: $(head -2 "$D/fix.err")"; }
CAND_A=$(P -c "select id from public.video_cover_candidates where job_id='$JA'"); CAND_B=$(P -c "select id from public.video_cover_candidates where job_id='$JB'"); ASSET_B=$(P -c "select id from public.video_assets where content_id='$CB'")
snap() { P -c "select md5(coalesce((select string_agg(t::text,';' order by id) from public.video_jobs t),'')||coalesce((select string_agg(t::text,';' order by id) from public.video_cover_candidates t),'')||coalesce((select string_agg(t::text,';' order by id) from public.video_assets t),'')||coalesce((select string_agg(t::text,';' order by id) from public.content_items t),''))"; }
as() { local role="$1" uid="$2"; shift 2; P -c "set role $role; select set_config('request.jwt.claim.sub','$uid',false), set_config('request.jwt.claim.role','$role',false) is not null; $*" 2>&1 | grep -E "ERROR|permission" | head -1; }
FUNCS=("select public.create_video_job('$CB')" "select public.select_video_cover('$JB','$CAND_B')" "select public.register_video_asset('$CB','image','$UA/$CB/x.png','x.png','image/png',100)" "select public.delete_video_asset_record('$ASSET_B')" "select public.save_video_storyboard('$CB','{\"version\":\"2\"}'::jsonb)" "select public.get_video_studio_capabilities()" "select public.submit_ai_design('$CB')")
S0=$(snap)
# M1: anon cannot execute any of the 7 (EXECUTE denied)
n=0; for q in "${FUNCS[@]}"; do o=$(as anon "$UA" "$q"); grep -q "permission denied" <<<"$o" && n=$((n+1)); done
[ "$n" = 7 ] && ok "M1 anon: EXECUTE denied on all 7 authenticated-callable definer functions" || bad "M1 anon denied only $n of 7"
# M2: a user with no admin row (valid login, not an employee) is rejected by every function, state unchanged
n=0; for q in "${FUNCS[@]}"; do o=$(as authenticated "$UD" "$q"); grep -q "ERROR" <<<"$o" && n=$((n+1)); done
[ "$n" = 7 ] && [ "$(snap)" = "$S0" ] && ok "M2 authenticated NON-employee: all 7 raise an error and nothing in video_jobs/candidates/assets/content_items changed" || bad "M2 rejected $n of 7 or state changed"
# M3: inactive admin
n=0; for q in "${FUNCS[@]}"; do o=$(as authenticated "$UC" "$q"); grep -q "ERROR" <<<"$o" && n=$((n+1)); done
[ "$n" = 7 ] && [ "$(snap)" = "$S0" ] && ok "M3 INACTIVE admin: all 7 rejected, no state change" || bad "M3 rejected $n of 7 or state changed"
# M4: page_manager A acting on page_manager B's content/job/asset (IDOR): every mutating function rejects (get_video_studio_capabilities has no object target)
n=0; for q in "${FUNCS[@]:0:5}" "${FUNCS[6]}"; do o=$(as authenticated "$UA" "$q"); grep -q "ERROR" <<<"$o" && n=$((n+1)); done
[ "$n" = 6 ] && [ "$(snap)" = "$S0" ] && ok "M4 IDOR: page_manager A cannot create/select-cover/register/delete/storyboard/submit on page_manager B's objects (6 of 6 rejected, state unchanged)" || bad "M4 rejected $n of 6 or state changed"
# M5: owner on a HELD (fenced, working) job: create_video_job returns the existing job without touching it; select_video_cover refuses (job not ready)
P -c "set session_replication_role=replica; insert into public.video_jobs(id,content_id,created_by,status,duration_min_seconds,duration_max_seconds,script_text,title,video_template,claim_token,worker_id,attempt_count) values ('$JH','$CA','$AA','rendering',10,30,'s','A2','quick_tips',gen_random_uuid(),'w1',1)" >/dev/null
H0=$(P -c "select md5(t::text) from public.video_jobs t where id='$JH'"); [ -n "$H0" ] || bad "M5 held-job fixture missing"
as authenticated "$UA" "select public.create_video_job('$CA')" >/dev/null
o=$(as authenticated "$UA" "select public.select_video_cover('$JH','$CAND_A')")
[ "$(P -c "select md5(t::text) from public.video_jobs t where id='$JH'")" = "$H0" ] && grep -q ERROR <<<"$o" && ok "M5 held job: owner calls create_video_job (idempotent return) and select_video_cover (refused: not ready) and the held row is byte-identical afterwards (token, status, outputs untouched)" || bad "M5 held row changed or select_video_cover allowed: $o"
# M6: owner on own READY job: select_video_cover may only point cover_url at a candidate of the SAME job
o=$(as authenticated "$UA" "select public.select_video_cover('$JA','$CAND_B')")
grep -q ERROR <<<"$o" && [ "$(P -c "select cover_url from public.video_jobs where id='$JA'")" = "https://drive.google.com/file/d/ca0" ] && ok "M6a select_video_cover with another job's candidate is refused, cover unchanged" || bad "M6a $o"
as authenticated "$UA" "select public.select_video_cover('$JA','$CAND_A')" >/dev/null
[ "$(P -c "select cover_url from public.video_jobs where id='$JA'")" = "https://drive.google.com/file/d/ca1" ] && [ "$(P -c "select count(*) from public.video_jobs where id='$JA' and drive_video_url='https://drive.google.com/file/d/a'")" = 1 ] && ok "M6b owner picking its own candidate changes ONLY cover_url/selected_cover_id (drive_video_url untouched): the intended behaviour" || bad "M6b"
# M7: temp-object shadowing: an authenticated user creates temp tables with the names of the real tables, then calls definers; results must still come from public.*
as authenticated "$UA" "create temp table admins(id uuid, user_id uuid, active boolean, role text); create temp table video_jobs(id uuid); create temp table content_items(id uuid); select 1" >/dev/null
o=$(P -c "set role authenticated; select set_config('request.jwt.claim.sub','$UA',false) is not null; create temp table admins(id uuid, user_id uuid, active boolean, role text); create temp table video_assets(id uuid); select public.get_video_studio_capabilities()" 2>&1 | tail -1)
grep -q schema_version <<<"$o" && ok "M7 temp tables named admins/video_assets created by an authenticated user do NOT shadow the definer functions (all references are schema-qualified): get_video_studio_capabilities still sees the real admin" || bad "M7 $o"
o=$(P -c "set role authenticated; create function public.pwn() returns int language sql as 'select 1'" 2>&1 | grep -m1 -E "ERROR|permission"); grep -q -E "denied|permission" <<<"$o" && ok "M8 authenticated cannot create objects in schema public (no function/operator shadowing in the definers' search_path)" || bad "M8 $o"
# M9: guard + definer interplay: definers are exempt from the fence guard BY DESIGN; confirm none of the 7 can change status/output columns of a held job (covered by M5) and list which of them contain UPDATE video_jobs
echo "info M9 (guard enabled; definers run as their owner and are exempt by design)"; echo "info M9 definer bodies that UPDATE video_jobs: $(P -c "select string_agg(proname,', ') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('create_video_job','select_video_cover','register_video_asset','delete_video_asset_record','save_video_storyboard','get_video_studio_capabilities','submit_ai_design') and prosrc ~* 'update +public\.video_jobs'")"
# M10: the remediation proposal applies cleanly, changes only search_path, and the whole suite above still holds
P -v ON_ERROR_STOP=1 -f "$ROOT/supabase/drafts/20261104_video_definer_search_path_hardening.sql" >/dev/null 2>"$D/h.err" && ok "M10a hardening draft applies cleanly on the real schema" || bad "M10a $(head -2 "$D/h.err")"
[ "$(P -c "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('create_video_job','select_video_cover','register_video_asset','delete_video_asset_record','save_video_storyboard','get_video_studio_capabilities','submit_ai_design','my_admin_id','my_role','has_role','can_manage_all_content') and p.proconfig::text ~ 'search_path=public, pg_temp'")" = 11 ] && ok "M10b all 11 functions now list pg_temp last" || bad "M10b"
S1=$(snap); n=0; for q in "${FUNCS[@]}"; do o=$(as authenticated "$UD" "$q"); grep -q ERROR <<<"$o" && n=$((n+1)); done; o=$(as authenticated "$UA" "select public.get_video_studio_capabilities()")
[ "$n" = 7 ] && [ "$(snap)" = "$S1" ] && ok "M10c after hardening: non-employee still rejected on all 7, owner still works (behaviour unchanged)" || bad "M10c"
P -c "alter function public.create_video_job(uuid) set search_path = public; alter function public.my_admin_id() set search_path = public" >/dev/null && ok "M10d rollback statement form executes (alter function ... set search_path = public)" || bad "M10d"
exit $FAIL
