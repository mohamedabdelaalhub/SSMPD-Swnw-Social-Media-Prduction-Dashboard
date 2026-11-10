#!/bin/bash
# Claude scheduled tasks -> Swnw main database on swnw-vps (self-hosted Supabase, live since 2026-11-10 22:55 UTC).
# The old Supabase cloud project (uuijfbpgvtdxgaosqpxo, the "Supabase" MCP connector) is a paused fallback:
# NEVER read from or write to it — anything written there is lost.
#
#   claude-db.sh sql "<query 1>" ["<query 2>" ...]   all queries in ONE round trip (~1-2 min); prints "### 01" + JSON rows per query
#   claude-db.sh token "<note>"                      4-hour run token for https://api.swnwclinics.com/functions/v1/claude-automation,
#                                                    saved to ~/.swnw-run-token (0600) and never printed: use
#                                                    curl -H "X-Run-Token: $(cat ~/.swnw-run-token)" ...
# Works through the ops-bridge of the private repo mohamedabdelaalhub/swnw-infra (attach it first: add_repo access "push").
# Results travel encrypted for a one-time key that never leaves this session (the bridge commits its output to git).
set -euo pipefail
REPO=${SWNW_INFRA_URL:-https://github.com/mohamedabdelaalhub/swnw-infra}
W=${SWNW_BRIDGE_DIR:-/tmp/swnw-bridge}; K=${SWNW_BRIDGE_KEY:-/tmp/swnw-claude-key.pem}
mode=${1:?usage: claude-db.sh sql "<query>"... | token "<note>"}; shift
case "$mode" in sql|token) ;; *) echo "usage: claude-db.sh sql \"<query>\"... | token \"<note>\"" >&2; exit 2;; esac
[ "$mode" = token ] || [ $# -ge 1 ] || { echo "sql: give at least one query" >&2; exit 2; }
[ -f "$K" ] || (umask 077; openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out "$K" 2>/dev/null)
[ -d "$W/.git" ] || git clone -q --depth 5 --branch ops-bridge --single-branch "$REPO" "$W"
cd "$W"
git config user.name >/dev/null || git config user.name "Claude"
git config user.email >/dev/null || git config user.email "noreply@anthropic.com"
git fetch -q origin ops-bridge && git reset -q --hard FETCH_HEAD
id="claude-$mode-$(date -u +%Y%m%d%H%M%S)-$(openssl rand -hex 3)"
d="EOF_$(openssl rand -hex 8)"
{
  echo "set -u; PK=\$(mktemp); Q=\$(mktemp -d); trap 'rm -rf \"\$PK\" \"\$Q\"' EXIT"
  echo "cat > \"\$PK\" <<'$d'"; openssl pkey -in "$K" -pubout; echo "$d"
  if [ "$mode" = token ]; then
    note=$(printf %s "${1:-claude task}" | tr -cd 'A-Za-z0-9 ._-' | cut -c1-60); [ -n "$note" ] || note="claude task"
    echo "~/claude-work/bin/swnw-run-token '$note' < \"\$PK\""
  else
    n=0; for q in "$@"; do n=$((n+1)); printf 'cat > "$Q/%02d.sql" <<'"'"'%s'"'"'\n%s\n%s\n' "$n" "$d" "$q" "$d"; done
    echo "~/claude-work/bin/swnw-sealed \"\$PK\" sh -c 'for f in \"\$1\"/*.sql; do echo \"### \$(basename \"\$f\" .sql)\"; ~/claude-work/bin/swnw-sql -f \"\$f\" 2>&1; echo; done' _ \"\$Q\""
  fi
} > "requests/$id.sh"
git add "requests/$id.sh" && git commit -qm "request $id"
for i in 1 2 3 4 5; do git push -q origin HEAD:ops-bridge 2>/dev/null && break; [ $i = 5 ] && { echo "bridge: push failed" >&2; exit 1; }
  sleep $((2**i)); git fetch -q origin ops-bridge && git rebase -q FETCH_HEAD; done
log=""
for i in $(seq 1 64); do sleep 15; git fetch -q origin ops-bridge || continue
  if git cat-file -e "FETCH_HEAD:results/$id.log" 2>/dev/null; then log=$(git show "FETCH_HEAD:results/$id.log"); break; fi; done
[ -n "$log" ] || { echo "bridge: no answer for $id after 16 min (is the server up? results/_heartbeat)" >&2; exit 1; }
dec() { base64 -d | openssl pkeyutl -decrypt -inkey "$K" -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256; }
if [ "$mode" = token ]; then
  c=$(printf '%s\n' "$log" | grep -E '^[A-Za-z0-9+/=]{300,}$' | head -1)
  [ -n "$c" ] || { printf '%s\n' "$log" | grep -v '^#' >&2; echo "token: mint failed" >&2; exit 1; }
  t=$(printf %s "$c" | dec); [[ "$t" =~ ^[0-9a-f-]{36}$ ]] || { echo "token: decrypt failed" >&2; exit 1; }
  (umask 077; printf %s "$t" > ~/.swnw-run-token); echo "run token saved to ~/.swnw-run-token (valid 4 h)"
else
  k=$(printf '%s\n' "$log" | sed -n 's/^SEALED-KEY //p'); data=$(printf '%s\n' "$log" | sed -n 's/^SEALED-DATA //p')
  rc=$(printf '%s\n' "$log" | sed -n 's/^SEALED-RC //p')
  [ -n "$k" ] && [ -n "$data" ] || { printf '%s\n' "$log" >&2; exit 1; }
  printf %s "$k" | dec > "$K.aes"; printf %s "$data" | base64 -d | openssl enc -d -aes-256-cbc -pbkdf2 -pass file:"$K.aes"; rm -f "$K.aes"
  exit "${rc:-1}"
fi
