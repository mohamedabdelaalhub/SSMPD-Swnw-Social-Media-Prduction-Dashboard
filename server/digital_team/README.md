# Swnw server conversations

Implementation and deployment gates: [handoff](../../docs/CODEX-DIGITAL-TEAM-HANDOFF.md).

Python 3.11+ standard library. No dependency install, API key purchase, schema change, general RPC proxy, or shell-from-message endpoint. Uses existing dashboard authentication and the installed Codex account. Disabled until configured by the connected operator.

## Local isolated verification

```sh
python3 -m unittest discover -s tests -p 'test_digital_team_*.py'
node tests/digital-team-server-chat.cjs
node tests/digital-team-delegated-navigation.cjs
```

These tests use synthetic identities, SQLite temporary directories and a fake stdio subprocess. They do not establish a real Codex inference or a Contabo deployment. Browser QA is prepared separately in `scripts/check-digital-team-server-layout.cjs` and requires a browser-capable executor.

## HTTP contract

Same-origin `/api/digital-team` prefix; existing Supabase access token in Authorization header. JSON only for POST. Never expose backend app-server stdio/WebSocket or an API that forwards arbitrary Codex methods to a browser.

| Route | Method | Purpose |
| --- | --- | --- |
| `/bootstrap` | GET | Verified current identity and allowed agents |
| `/users` | GET | Approved participant directory |
| `/grants` | GET / POST | Owner-only per-agent access grants |
| `/rooms` | GET / POST | List authorized rooms / create room |
| `/rooms/{id}/messages` | GET / POST | Visibility-fenced history / idempotent send |
| `/rooms/{id}/members` | GET / POST | Membership listing / authorized changes |
| `/rooms/{id}/cancel/{job}` | POST | Cancel own request or owner's room request |
| `/rooms/{id}/attachments` | POST | Owner only: upload one file as JSON `{name,mime?,data(base64)}`; returns an id to pass as `attachments:[id]` on send |

Initial task messages create pending owner requests only. Other engines are explicitly unconnected in this gateway; their pre-existing dashboard flows stay unchanged.

## Attachments (owner only)

- Allowlist **by content** (magic bytes), not by name/declared type: png, jpg, webp, pdf, and UTF-8 txt/csv/md. SVG/HTML/archives/executables are rejected. Max 700 KB per file (keeps the base64 JSON body under the proxy's 1 MB default, so no nginx change), 3 files per message, 12 pending uploads, 512 MB total.
- Stored under `<state>/uploads/` (the gateway data dir, never a web root) with random names, mode 0600, never served back and never executed. Unsent uploads are purged after 1 h. Filenames are only metadata.
- Engines: Codex gets images as `localImage` and text files inlined; PDFs are refused with a clear Arabic message. Claude gets images and PDFs as base64 content blocks (`--input-format stream-json`, tools stay disabled) and text inlined. File text is framed as data, not instructions.
- Owner export lists attachment names/types/sizes per message (file contents are not exported).
- Do not upload patient identifiers; files are sent to the AI provider.

## Claude Code read-only code access (optional)

Set `SWNW_CHAT_CODE_DIR` to a snapshot built by `deploy/make-code-snapshot.sh <repo> <ref> <dir>` (text source only: no secrets, `.env`,
`CLAUDE.md`, binaries, data dumps, symlinks or git history; refuses to publish if secret-like content is found). With it set, the Claude
engine gets only `Read`/`Grep`/`Glob`. Two independent gates keep every call inside the snapshot: a `PreToolUse` hook (`read_gate.py`,
blocks BEFORE the tool runs, fails closed) and a stream check in `runtime.py` that stops the run on any other tool, any outside path or
more than 30 calls. The CLI permission flags alone do NOT confine reads (verified), which is why the hook exists. Unset the variable to
return to the no-tools chat. Refresh the snapshot after each dashboard release.
