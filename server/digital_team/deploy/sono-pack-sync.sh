#!/usr/bin/env bash
# Build the Sono knowledge pack for the CURRENT live release and swap it in atomically.
# Idempotent. Needs read access only: the release id file, a git clone of the dashboard repo, the builder script.
#   SONO_RELEASE_FILE  file whose first token is the live release id (default /opt/swnw-data/dashboard-parallel/CURRENT)
#   SONO_PACK_REPO     git clone of the dashboard repo (default /var/lib/swnw-team-chat/pack-src)
#   SONO_PACK_ROOT     where packs live; the gateway reads $SONO_PACK_ROOT/knowledge (default /var/lib/swnw-team-chat)
#   SONO_PACK_BUILDER  builder script (default /usr/local/lib/swnw-sono/build-sono-knowledge.py)
#   SONO_PACK_FETCH    1 = git fetch origin first (default 1; tests set 0)
set -euo pipefail
REL_FILE="${SONO_RELEASE_FILE:-/opt/swnw-data/dashboard-parallel/CURRENT}"
REPO="${SONO_PACK_REPO:-/var/lib/swnw-team-chat/pack-src}"
ROOT="${SONO_PACK_ROOT:-/var/lib/swnw-team-chat}"
BUILDER="${SONO_PACK_BUILDER:-/usr/local/lib/swnw-sono/build-sono-knowledge.py}"
KEEP=3
die() { echo "sono-pack-sync: $*" >&2; exit 1; }

id="$(head -c 64 "$REL_FILE" 2>/dev/null | tr -d ' \n\r' || true)"
[[ "$id" =~ ^[0-9a-f]{7,40}$ ]] || die "invalid or unreadable release id in $REL_FILE"
out="$ROOT/knowledge-${id:0:12}"
if [ -f "$out/manifest.json" ]; then
  [ "$(readlink "$ROOT/knowledge" 2>/dev/null || true)" = "knowledge-${id:0:12}" ] || { ln -sfn "knowledge-${id:0:12}" "$ROOT/knowledge.new"; mv -Tf "$ROOT/knowledge.new" "$ROOT/knowledge"; echo "relinked $id"; }
  echo "pack for $id already current"; exit 0
fi
[ -d "$REPO/.git" ] || [ -f "$REPO/HEAD" ] || die "no git repo at $REPO"
[ "${SONO_PACK_FETCH:-1}" = 1 ] && git -C "$REPO" fetch --quiet origin
sha="$(git -C "$REPO" rev-parse --verify --quiet "${id}^{commit}")" || die "release commit $id not found in $REPO"
tmp="$(mktemp -d "$ROOT/.pack-tmp.XXXXXX")"; trap 'rm -rf "$tmp"' EXIT
mkdir "$tmp/src"; git -C "$REPO" archive "$sha" | tar -x -C "$tmp/src"
python3 "$BUILDER" --repo "$tmp/src" --out "$tmp/pack" --sha "$sha" >/dev/null
python3 - "$tmp/pack/manifest.json" "$sha" <<'PY' || die "built manifest does not match the release commit"
import json,sys
m=json.load(open(sys.argv[1])); sys.exit(0 if m.get('commit_sha')==sys.argv[2] else 1)
PY
mv "$tmp/pack" "$out"
ln -sfn "knowledge-${id:0:12}" "$ROOT/knowledge.new"; mv -Tf "$ROOT/knowledge.new" "$ROOT/knowledge"
# keep the newest $KEEP packs (never the live one)
ls -1dt "$ROOT"/knowledge-* 2>/dev/null | tail -n +$((KEEP+1)) | while read -r old; do [ "$old" = "$out" ] || rm -rf "$old"; done
echo "built pack for $sha"
