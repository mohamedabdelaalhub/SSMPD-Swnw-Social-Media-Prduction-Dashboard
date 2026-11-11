# Claude scheduled tasks — reaching the database and the gateway (since 2026-11-10)

On 2026-11-10 22:55 UTC the whole system moved off Supabase cloud onto Swnw's own server (self-hosted Supabase,
public address `https://api.swnwclinics.com`). Scheduled Claude sessions cannot reach the server directly and cannot
attach other repositories, so they use a **mailbox** (owner approved 2026-11-11).

**The old cloud project `uuijfbpgvtdxgaosqpxo` (the "Supabase" MCP connector) is a paused copy. Use its `execute_sql`
ONLY to run the mailbox statements printed by `scripts/claude-db.sh`. Never read or write any other table there —
reads are stale and writes are lost.**

## SQL
```bash
bash scripts/claude-db.sh request sql "select count(*) from claude_design_requests where status='pending'" \
                                      "select public.claude_alerts_data(65)"
```
1. The command prints ONE SQL statement. Run it exactly as printed with the Supabase MCP tool `execute_sql`
   on project `uuijfbpgvtdxgaosqpxo`. It returns `{"id": "<uuid>"}`.
2. `bash scripts/claude-db.sh wait <id>` prints `### 01`, `### 02`, … each followed by the rows as JSON
   (statements without rows print `[]`). Usually 10–30 seconds.
- Put all the queries of a step into ONE request (up to 25). Same rights as before the move (reads and the documented
  writes such as `update claude_design_requests ...`, `chat_task_requests`, `claude_propose_ad_plan(...)`).
- Answers travel encrypted for a key that never leaves the run. A `mailbox:` error = failed; retry once at most, then report.

## Gateway
```bash
bash scripts/claude-db.sh request token "design queue"   # run the printed statement with execute_sql -> id
bash scripts/claude-db.sh wait <id>                       # 4-hour token saved to ~/.swnw-run-token, never printed
curl -s -A claude-task -X POST https://api.swnwclinics.com/functions/v1/claude-automation \
     -H "X-Run-Token: $(cat ~/.swnw-run-token)" -H 'content-type: application/json' -d '{"op":"rest",...}'
```
Everything else about the gateway (ops, allowed paths, uploads with `?op=upload_image`, `?op=tts`, …) is unchanged.
Use `curl` with a User-Agent (Cloudflare refuses Python's default `urllib` agent with "error code: 1010").
Never insert into `automation_run_tokens` yourself, never use add_repo/swnw-infra (not available to scheduled runs).
