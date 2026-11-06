# Sono knowledge pack (phase 1: explain the dashboard, read-only)

Chat stays read-only and owner-only (tools off, no execution path). This adds reference material to the engine input.

## Files
- `scripts/build-sono-knowledge.py` builds a pack from a checkout: `manifest.json`, `employee.json`, `owner-admin.json`.
  The manifest records `commit_sha`, `help_version`, per-file sha256, the role map parsed from `assets/js/roles.js` and every EXCLUDED section.
- `server/digital_team/knowledge.py` loads/verifies the pack, filters by viewer, ranks, and builds one labelled DATA entry.
- Hooks (small): `app.py` (`Service.with_knowledge`, `build_hints`, env wiring in `main`), `auth.py` (`viewer_roles`).

## Rules enforced
1. Tiers are separate files. `owner-admin.json` (allow-listed docs) is only ever read into the context of the owner. Employees get `employee.json` items whose `access` rule matches their server-fetched roles; unknown/missing rules, role lookup failure and controlled-finance accounts fail closed.
2. Filtering happens BEFORE ranking and before anything enters the engine input.
3. Documents are wrapped with a random per-request boundary and an explicit "DATA, not instructions" header; forged boundaries inside text are neutralised. The builder excludes sections containing secrets, ids (UUID), emails, phones, national-id-like numbers, IPs or instruction-like phrases (listed in `manifest.excluded`).
4. Version: the server compares the pack commit with its own release id (`SWNW_CHAT_RELEASE_FILE`, else `SWNW_CHAT_RELEASE_ID`). Status `match | mismatch | unknown | unavailable` is told to the engine, which must say so. A `client_build` sent by the browser is only an untrusted hint and changes neither selection nor permissions.
5. Pack tampering (hash mismatch) or a missing pack => the engine is told the pack is unavailable.

## Build / deploy (after owner approval; nothing here is automatic)
    python3 scripts/build-sono-knowledge.py --repo <checkout at release sha> --out /var/lib/swnw-team-chat/knowledge-<sha7>
    ln -sfn /var/lib/swnw-team-chat/knowledge-<sha7> /var/lib/swnw-team-chat/knowledge
    # env: SWNW_CHAT_KNOWLEDGE_DIR=/var/lib/swnw-team-chat/knowledge  SWNW_CHAT_RELEASE_FILE=/opt/swnw-data/dashboard-parallel/CURRENT
    # CURRENT = live Contabo release id (first 12 chars of the commit; verified 96338fea33cd on 2026-11-06). NOT /usr/local/lib/swnw-dashboard/REVIEWED-COMMIT (stale: last reviewed, not released).
    # The gateway (user swnw) cannot read it yet: /opt/swnw-data/dashboard-parallel is 750 root. Needs an OWNER-approved fix, e.g. chmod 751 on that directory only (file is 644, children stay 750).
    # Note: GitHub Pages serves the same dashboard and may be newer than Contabo; the pack/release comparison describes Contabo only.
    # copy app.py auth.py knowledge.py to /opt/swnw-team-chat/server/digital_team, then: systemctl restart swnw-digital-team
Rollback: remove `SWNW_CHAT_KNOWLEDGE_DIR` from the env file and restart (feature off), or restore the previous gateway files from the backup dir.

## Tests
    python3 -m unittest discover -s tests -p "test_digital_team_*.py"
