# Shared loader (sourced by tests/real-schema-report.sh and tests/real-schema-fencing.sh) so both report the SAME fixture fidelity.
# Requires: P() psql wrapper, $D temp dir, $ROOT repo root. Produces "$D/files.tsv" (file<TAB>errors<TAB>first error or OK).
# Pass 1 applies every migration in filename order; files with errors are retried (up to 4 passes) because several same-day migrations depend on a
# later-sorting sibling (production applied them by hand in dependency order). Errors are counted from a captured stderr file (no early-exit pipes).
apply_file() { local f="$1" b first n; b=$(basename "$f"); P -f "$f" >/dev/null 2>"$D/e.txt"
  first=$(grep -m1 -E "ERROR" "$D/e.txt" | sed 's/^psql:[^ ]* //'); n=$(grep -c ERROR "$D/e.txt")
  grep -v "^${b}"$'\t' "$D/files.tsv" > "$D/files.new" || true; mv "$D/files.new" "$D/files.tsv"; printf '%s\t%s\t%s\n' "$b" "$n" "${first:-OK}" >> "$D/files.tsv"; }
load_real_schema() {
  P -v ON_ERROR_STOP=1 -f "$ROOT/tests/real-schema-stubs.sql" >/dev/null 2>&1 || { echo "stub load failed"; return 2; }
  P -f "$ROOT/supabase/setup.sql" >"$D/setup.out" 2>"$D/setup.err"
  : > "$D/files.tsv"
  for f in $(ls "$ROOT"/supabase/migrations/*.sql | sort); do apply_file "$f"; done
  P1_OK=$(awk -F'\t' '$3=="OK"' "$D/files.tsv" | wc -l | tr -d ' ')
  for pass in 1 2 3 4; do
    PROG=0
    for b in $(awk -F'\t' '$3!="OK"{print $1}' "$D/files.tsv" | sort); do
      apply_file "$ROOT/supabase/migrations/$b"; [ "$(awk -F'\t' -v x="$b" '$1==x{print $3}' "$D/files.tsv")" = OK ] && PROG=1
    done
    [ $PROG = 0 ] && break
  done
  TOTAL=$(wc -l < "$D/files.tsv" | tr -d ' '); OKN=$(awk -F'\t' '$3=="OK"' "$D/files.tsv" | wc -l | tr -d ' ')
}
