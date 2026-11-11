#!/bin/bash
# Claude scheduled tasks -> Swnw production database on our server (since the 2026-11-10 move off Supabase cloud).
# Scheduled sessions cannot reach the server directly, so requests go through a mailbox (owner approved 2026-11-11):
#   1) bash claude-db.sh request sql "<query 1>" ["<query 2>" ...]   (or: request token "<note>")
#      -> prints ONE SQL statement. Run it EXACTLY as printed with the Supabase MCP tool execute_sql on project
#         uuijfbpgvtdxgaosqpxo (the mailbox lives there; NEVER read or write any other table of that old project).
#         It returns {"id": "<uuid>"}.
#   2) bash claude-db.sh wait <id>
#      -> sql: prints "### 01", "### 02", ... each followed by the rows as JSON (statements without rows -> [])
#      -> token: saves a 4-hour gateway run token to ~/.swnw-run-token (never printed); then
#         curl -H "X-Run-Token: $(cat ~/.swnw-run-token)" https://api.swnwclinics.com/functions/v1/claude-automation ...
# Answers are encrypted for a one-time key that never leaves this session. One round trip ~10-30 s; put all the
# queries of a step into ONE request (up to 25).
set -euo pipefail
K=${SWNW_BRIDGE_KEY:-/tmp/swnw-claude-key.pem}
[ -f "$K" ] || (umask 077; openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out "$K" 2>/dev/null)
cmd=${1:-}; shift || true
case "$cmd" in
  request)
    kind=${1:?request sql|token}; shift
    PUB=$(openssl pkey -in "$K" -pubout)
    python3 -I - "$kind" "$PUB" "$@" <<'PY'
import json, os, sys
kind, pub, args = sys.argv[1], sys.argv[2], sys.argv[3:]
def lit(s):
    t = 'q' + os.urandom(5).hex()
    return '$%s$%s$%s$' % (t, s, t)
if kind == 'sql':
    if not args: sys.exit('request sql: give at least one query')
    print("insert into public.ops_mailbox(kind, queries, pubkey) values ('sql', %s::jsonb, %s) returning id;" % (lit(json.dumps(args, ensure_ascii=False)), lit(pub)))
elif kind == 'token':
    note = ''.join(c for c in (args[0] if args else 'claude task') if c.isalnum() or c in ' ._-')[:60] or 'claude task'
    print("insert into public.ops_mailbox(kind, note, pubkey) values ('token', %s, %s) returning id;" % (lit(note), lit(pub)))
else: sys.exit('request sql|token')
PY
    ;;
  wait)
    id=${1:?wait <id>}; [[ "$id" =~ ^[0-9a-f-]{36}$ ]] || { echo "bad id" >&2; exit 2; }
    body=""
    for i in $(seq 1 60); do
      body=$(curl -s -m 20 -A "swnw-claude-db/2" "https://files.swnwclinics.com/p/ops/$id.txt" -w '\n%{http_code}' || true)
      code=${body##*$'\n'}; body=${body%$'\n'*}
      [ "$code" = "200" ] && break; body=""; sleep 5
    done
    [ -n "$body" ] || { echo "mailbox: no answer for $id after 5 min (server down?)" >&2; exit 1; }
    case "$body" in ERROR*) echo "mailbox: $body" >&2; exit 1;; esac
    dec() { base64 -d | openssl pkeyutl -decrypt -inkey "$K" -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256; }
    if [[ "$body" == TOKEN* ]]; then
      t=$(printf %s "${body#TOKEN }" | tr -d '\n' | dec); [[ "$t" =~ ^[0-9a-f-]{36}$ ]] || { echo "token: decrypt failed" >&2; exit 1; }
      (umask 077; printf %s "$t" > ~/.swnw-run-token); echo "run token saved to ~/.swnw-run-token (valid 4 h)"
    else
      k=$(printf '%s\n' "$body" | sed -n 's/^SEALED-KEY //p'); data=$(printf '%s\n' "$body" | sed -n 's/^SEALED-DATA //p')
      rc=$(printf '%s\n' "$body" | sed -n 's/^SEALED-RC //p')
      printf %s "$k" | dec > "$K.aes"; printf %s "$data" | base64 -d | openssl enc -d -aes-256-cbc -pbkdf2 -pass file:"$K.aes"; rm -f "$K.aes"
      exit "${rc:-1}"
    fi ;;
  *) echo "usage: claude-db.sh request sql \"<query>\"... | request token \"<note>\" | wait <id>" >&2; exit 2;;
esac
