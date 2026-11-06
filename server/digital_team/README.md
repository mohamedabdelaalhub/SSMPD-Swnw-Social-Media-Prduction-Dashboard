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

Initial task messages create pending owner requests only. Other engines are explicitly unconnected in this gateway; their pre-existing dashboard flows stay unchanged.
