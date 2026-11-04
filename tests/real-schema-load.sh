#!/bin/bash
# Loads the repo's REAL supabase/setup.sql into a throwaway local PostgreSQL (stubs in tests/real-schema-stubs.sql) and reports load errors.
# Usage: PGBIN=/Library/PostgreSQL/18/bin tests/real-schema-load.sh [--keep]   (--keep leaves the cluster running and prints its socket dir/port)
set -uo pipefail
PGBIN="${PGBIN:-$(dirname "$(command -v postgres)")}"; ROOT="$(cd "$(dirname "$0")/.." && pwd)"
D="$(mktemp -d)"; PORT=$((20000 + RANDOM % 20000))
"$PGBIN/initdb" -D "$D/data" -U postgres --auth=trust >/dev/null
"$PGBIN/pg_ctl" -D "$D/data" -o "-p $PORT -k $D -c listen_addresses=''" -l "$D/log" -w start >/dev/null
"$PGBIN/createdb" -h "$D" -p "$PORT" -U postgres t
Q() { "$PGBIN/psql" -h "$D" -p "$PORT" -U postgres -d t -qtAX "$@"; }
Q -v ON_ERROR_STOP=1 -f "$ROOT/tests/real-schema-stubs.sql" >/dev/null || { echo "stub load failed"; exit 2; }
Q -f "$ROOT/supabase/setup.sql" >"$D/load.out" 2>"$D/load.err"
echo "setup.sql load: $(grep -c ERROR "$D/load.err") errors"; grep ERROR "$D/load.err" | sed 's/^psql:[^ ]* //' | sort | uniq -c | sort -rn | head -12
echo "video_jobs columns: $(Q -c "select count(*) from information_schema.columns where table_schema='public' and table_name='video_jobs'")"
if [ "${1:-}" = "--keep" ]; then echo "SOCK=$D PORT=$PORT PGBIN=$PGBIN"; else "$PGBIN/pg_ctl" -D "$D/data" -m immediate stop >/dev/null; rm -rf "$D"; fi
