#!/usr/bin/env bash
# Builds the read-only dashboard source snapshot that Claude Code (team chat) may read.
# Usage: make-code-snapshot.sh <git-repo> <ref> <target-dir> [<infra-repo> [<infra-ref>]]
# The optional infra repo contributes markdown docs only (as infra-docs/), never its scripts, configs or instruction files.
# Text source only: no secrets, no .env, no instructions files, no binaries, no data dumps, no git history.
set -euo pipefail
repo=$(cd "${1:?repo}" && pwd); ref=${2:-origin/main}; target=${3:?target dir}
infra=${4:-}; infra_ref=${5:-HEAD}
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
if [ -n "$infra" ]; then
  infra=$(cd "$infra" && pwd); mkdir infra-docs
  git -C "$infra" archive "$infra_ref" -- $(git -C "$infra" ls-tree -r --name-only "$infra_ref" | grep -E '\.md$' | grep -vE '(^|/)(CLAUDE|AGENTS)\.md$|^evidence/') | tar -x -C infra-docs
  find infra-docs -type f ! -name '*.md' -delete
  if grep -rIlEi -e '(password|passwd|secret|token|api[_-]?key)["'"'"' ]*[:=]["'"'"' ]*[A-Za-z0-9/+_-]{16,}' infra-docs; then
    echo 'secret-like content in infra docs; snapshot refused' >&2; exit 1
  fi
fi
find . -type l -delete
# Real secrets must never be here: refuse to publish if anything looks like one (public anon JWTs are expected in html/js).
if grep -rIlE -e '-----BEGIN [A-Z ]*PRIVATE KEY-----[A-Za-z0-9+/=[:space:]]{100,}' -e 'sbp_[a-f0-9]{30,}' -e 'sk-ant-[A-Za-z0-9_-]{20,}' -e 'ghp_[A-Za-z0-9]{30,}' .; then
  echo 'secret-like content found; snapshot refused' >&2; exit 1
fi
date -u +"%Y-%m-%dT%H:%M:%SZ dashboard=$(git -C "$repo" rev-parse "$ref")${infra:+ infra=$(git -C "$infra" rev-parse "$infra_ref")}" > SNAPSHOT-INFO.txt
find . -type d -exec chmod 0555 {} + ; find . -type f -exec chmod 0444 {} +
if [ -e "$target" ]; then chmod -R u+w "$target"; mv "$target" "$target.old.$$"; fi
mv "$tmp" "$target"; trap - EXIT
[ -e "$target.old.$$" ] && { chmod -R u+w "$target.old.$$"; rm -rf "$target.old.$$"; }
echo "snapshot ready: $target ($(find "$target" -type f | wc -l) files)"
