#!/bin/bash
# Review #127/#129: repo-derived exposure matrix. Loads the repo schema (same loader/fixture as the other real-schema tests, Supabase default privileges stubbed) and prints,
# per public table, the grants and the RLS policies that apply to anon/authenticated. Catalog metadata only; no rows. Output: TSV on stdout (set MATRIX_OUT to also keep it).
# This is REPO EVIDENCE of intended state (143 of 178 migrations apply fully in the fixture); live state must be confirmed with the operator packet. Usage: PGBIN=... tests/real-schema-exposure-matrix.sh
set -uo pipefail
PGBIN="${PGBIN:-$(dirname "$(command -v postgres)")}"; ROOT="$(cd "$(dirname "$0")/.." && pwd)"
D="$(mktemp -d)"; PORT=$((20000 + RANDOM % 20000))
trap '"$PGBIN/pg_ctl" -D "$D/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$D"' EXIT
"$PGBIN/initdb" -D "$D/data" -U postgres --auth=trust >/dev/null
"$PGBIN/pg_ctl" -D "$D/data" -o "-p $PORT -k $D -c listen_addresses=''" -l "$D/log" -w start >/dev/null
"$PGBIN/createdb" -h "$D" -p "$PORT" -U postgres t
P() { "$PGBIN/psql" -h "$D" -p "$PORT" -U postgres -d t -qtAX "$@"; }
. "$ROOT/tests/real-schema-lib.sh"
load_real_schema || { echo "stubs failed" >&2; exit 2; }
P -c "grant all on all tables in schema public to service_role; grant usage on schema public to anon, authenticated, service_role" >/dev/null
echo "# tables=$(P -c "select count(*) from pg_class where relnamespace='public'::regnamespace and relkind in ('r','p')") migrations_ok=$OKN/$TOTAL" >&2
OUTQ="select c.relname, c.relrowsecurity::int as rls,
 has_table_privilege('anon',c.oid,'SELECT')::int, has_table_privilege('anon',c.oid,'INSERT')::int, has_table_privilege('anon',c.oid,'UPDATE')::int, has_table_privilege('anon',c.oid,'DELETE')::int, has_table_privilege('anon',c.oid,'TRUNCATE')::int,
 has_table_privilege('authenticated',c.oid,'SELECT')::int, has_table_privilege('authenticated',c.oid,'INSERT')::int, has_table_privilege('authenticated',c.oid,'UPDATE')::int, has_table_privilege('authenticated',c.oid,'DELETE')::int, has_table_privilege('authenticated',c.oid,'TRUNCATE')::int,
 (select string_agg(distinct p.cmd,',' order by p.cmd) from pg_policies p where p.schemaname='public' and p.tablename=c.relname and (p.roles::text ~ '(authenticated|public)')) as auth_policy_cmds,
 (select string_agg(distinct p.cmd,',' order by p.cmd) from pg_policies p where p.schemaname='public' and p.tablename=c.relname and (p.roles::text ~ '(anon|public)')) as anon_policy_cmds
 from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','p') order by 1"
printf 'table\trls\ta_sel\ta_ins\ta_upd\ta_del\ta_trunc\tu_sel\tu_ins\tu_upd\tu_del\tu_trunc\tauth_policy_cmds\tanon_policy_cmds\n'
P -F $'\t' -c "$OUTQ" | tee "${MATRIX_OUT:-/dev/null}"
echo "# invoker functions in public that mention TRUNCATE: $(P -c "select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and not p.prosecdef and p.prosrc ~* '\\mtruncate\\M'")" >&2
echo "# definer functions mentioning TRUNCATE: $(P -c "select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.prosecdef and p.prosrc ~* '\\mtruncate\\M'")" >&2
