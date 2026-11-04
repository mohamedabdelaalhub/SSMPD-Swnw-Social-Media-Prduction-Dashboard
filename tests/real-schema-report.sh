#!/bin/bash
# Reproducible fidelity report for the offline real-schema fixture: loads stubs + setup.sql + every migration (each file separately) into a throwaway
# PostgreSQL and attributes every failing file to its FIRST error, classified as STUB-ONLY (missing Supabase-managed schema/extension/object) or
# APP-DEPENDENCY (needs an app object that an earlier failed statement should have created) or VIDEO-RELEVANT (file or error mentions video/claim/worker).
# Usage: PGBIN=/Library/PostgreSQL/18/bin tests/real-schema-report.sh [--list]
set -uo pipefail
PGBIN="${PGBIN:-$(dirname "$(command -v postgres)")}"; ROOT="$(cd "$(dirname "$0")/.." && pwd)"
D="$(mktemp -d)"; PORT=$((20000 + RANDOM % 20000))
trap '"$PGBIN/pg_ctl" -D "$D/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$D"' EXIT
"$PGBIN/initdb" -D "$D/data" -U postgres --auth=trust >/dev/null
"$PGBIN/pg_ctl" -D "$D/data" -o "-p $PORT -k $D -c listen_addresses=''" -l "$D/log" -w start >/dev/null
"$PGBIN/createdb" -h "$D" -p "$PORT" -U postgres t
P() { "$PGBIN/psql" -h "$D" -p "$PORT" -U postgres -d t -qtAX "$@"; }
. "$ROOT/tests/real-schema-lib.sh"
load_real_schema || exit 2
echo "setup.sql: $(grep -c ERROR "$D/setup.err") errors; first causes:"; grep ERROR "$D/setup.err" | grep -v "transaction is aborted" | sed 's/^psql:[^ ]* //' | head -5
echo "setup.sql errors by line region (first 8 distinct ERROR+LINE):"; grep -B0 -A0 -E "ERROR|LINE" "$D/setup.err" | grep -E "^psql:" | sed -E 's#^psql:[^:]*:([0-9]+): (ERROR: *.{0,70}).*#  line \1: \2#' | head -8; echo "setup.sql ERROR lines mentioning video: $(grep ERROR "$D/setup.err" | grep -ci video) (NOTICE lines from idempotent drop-if-exists are not counted)"
echo "first pass (filename order): $P1_OK files OK; after dependency-retry passes: $OKN OK"
classify() { case "$1" in
  OK) echo OK;;
  *'schema "cron"'*|*'schema "net"'*|*'schema "vault"'*|*'schema "supabase_functions"'*|*'schema "realtime"'*|*'schema "graphql'*|*'schema "pgsodium"'*|*'extension'*|*'"pg_cron"'*|*'"pg_net"'*) echo STUB-ONLY;;
  *'schema "'*'does not exist'*) echo STUB-ONLY;;
  *'does not exist'*) echo APP-DEPENDENCY;;
  *) echo OTHER;; esac; }
echo "migrations: $TOTAL files, $OKN apply with 0 errors, $((TOTAL-OKN)) have errors"
while IFS=$'\t' read -r b n first; do echo "$(classify "$first")"; done < "$D/files.tsv" | sort | uniq -c | sed 's/^/  class /'
echo "-- video-related migrations (file name matches video|claim|worker|cover|studio|storyboard):"
grep -iE "video|claim|worker|cover|studio|storyboard" "$D/files.tsv" | while IFS=$'\t' read -r b n first; do echo "  $(classify "$first") | $b | errors=$n | $first" | cut -c1-200; done
echo "-- FAILING migrations that reference video_jobs (fixture gaps that could matter for this review):"; awk -F'\t' '$3!="OK"{print $1}' "$D/files.tsv" | while read -r b; do grep -q "video_jobs" "$ROOT/supabase/migrations/$b" && echo "  $b: $(awk -F'\t' -v x="$b" '$1==x{print $3}' "$D/files.tsv" | cut -c1-110)"; done
[ "${1:-}" = "--list" ] && { echo "-- all failing files:"; awk -F'\t' '$3!="OK"' "$D/files.tsv" | while IFS=$'\t' read -r b n first; do echo "  $(classify "$first") | $b | $first" | cut -c1-170; done; }
echo "-- statements of video_jobs final shape present? media_mode check: $(P -c "select pg_get_constraintdef(oid) from pg_constraint where conname='video_jobs_media_mode_check'" | grep -c studio_storyboard) (1 = latest migration applied); claim versions: $(P -c "select count(*) from pg_proc where proname='claim_next_video_job'")"
