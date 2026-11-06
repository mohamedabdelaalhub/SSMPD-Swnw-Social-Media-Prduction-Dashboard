#!/usr/bin/env bash
# Builds the read-only dashboard source snapshot that Claude Code (team chat) may read.
# Usage: make-code-snapshot.sh <git-repo> <ref> <target-dir>
# Text source only: no secrets, no .env, no instructions files, no binaries, no data dumps, no git history.
set -euo pipefail
repo=$(cd "${1:?repo}" && pwd); ref=${2:-origin/main}; target=${3:?target dir}
tmp=$(mktemp -d "${target%/}.new.XXXXXX")
trap 'chmod -R u+w "$tmp" 2>/dev/null; rm -rf "$tmp"' EXIT
git -C "$repo" archive "$ref" | tar -x -C "$tmp"
cd "$tmp"
rm -rf .git .github .claude .env* security_backups Secrets secrets node_modules
rm -f CLAUDE.md AGENTS.md supabase/meta_ads_backfill_data.sql
find . -type f \( -iname '*.env*' -o -iname '*.pem' -o -iname '*.key' -o -iname '*.p12' -o -iname '*.sqlite*' -o -iname '*.db' \
  -o -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.webp' -o -iname '*.gif' -o -iname '*.ico' -o -iname '*.pdf' \
  -o -iname '*.mp4' -o -iname '*.mov' -o -iname '*.zip' -o -iname '*.woff*' -o -iname '*.ttf' -o -iname '*.csv' -o -iname '*.xlsx' \) -delete
find . -type f -size +600k -delete
find . -type l -delete
# Real secrets must never be here: refuse to publish if anything looks like one (public anon JWTs are expected in html/js).
if grep -rIlE -e '-----BEGIN [A-Z ]*PRIVATE KEY-----[A-Za-z0-9+/=[:space:]]{100,}' -e 'sbp_[a-f0-9]{30,}' -e 'sk-ant-[A-Za-z0-9_-]{20,}' -e 'ghp_[A-Za-z0-9]{30,}' .; then
  echo 'secret-like content found; snapshot refused' >&2; exit 1
fi
date -u +"%Y-%m-%dT%H:%M:%SZ $ref $(git -C "$repo" rev-parse "$ref")" > SNAPSHOT-INFO.txt
find . -type d -exec chmod 0555 {} + ; find . -type f -exec chmod 0444 {} +
if [ -e "$target" ]; then chmod -R u+w "$target"; mv "$target" "$target.old.$$"; fi
mv "$tmp" "$target"; trap - EXIT
[ -e "$target.old.$$" ] && { chmod -R u+w "$target.old.$$"; rm -rf "$target.old.$$"; }
echo "snapshot ready: $target ($(find "$target" -type f | wc -l) files)"
