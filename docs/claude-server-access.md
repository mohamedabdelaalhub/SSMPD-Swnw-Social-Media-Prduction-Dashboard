# Claude scheduled tasks — reaching the database and the gateway (since 2026-11-10)

On 2026-11-10 22:55 UTC the whole system moved off Supabase cloud onto Swnw's own server (self-hosted Supabase,
public address `https://api.swnwclinics.com`). Owner decision: «عايز الاعتماد يبقي بالكامل علي السيرفر بتاعنا».

**The old cloud project `uuijfbpgvtdxgaosqpxo` (the "Supabase" MCP connector) is a paused fallback. NEVER use the
Supabase MCP tools for this project's data — reads are stale and anything written there is lost.**

## 1. One-time setup in each run
1. Attach the private infra repo with push access: `add_repo` owner `mohamedabdelaalhub`, repo `swnw-infra`, access `push`
   (the server is reached through its ops-bridge; nothing else in that repo is needed).
2. Use `scripts/claude-db.sh` from THIS repository (`bash scripts/claude-db.sh ...`).

## 2. SQL (replaces Supabase MCP `execute_sql`)
```bash
bash scripts/claude-db.sh sql "select count(*) from claude_design_requests where status='pending'" \
                              "select public.claude_alerts_data(65)"
```
- Prints `### 01`, `### 02`, … each followed by the rows as JSON (statements without rows print `[]`).
- One call = one round trip of about 30–90 seconds, so **put all the queries of a step in ONE call** (as many arguments as needed).
- Same rights as before (database owner): reads and the documented writes (`update claude_design_requests ...`,
  `chat_task_requests`, `claude_propose_ad_plan(...)`, `media_buyer_actions`). Nothing else.
- Results travel encrypted for a key that never leaves the run; never paste tokens or keys anywhere.
- Exit code ≠ 0 or a `bridge:` message = the call failed. Do not retry more than once; report it.

## 3. Gateway (replaces `https://uuijfbpgvtdxgaosqpxo.supabase.co/functions/v1/claude-automation`)
```bash
bash scripts/claude-db.sh token "design queue"      # 4-hour token saved to ~/.swnw-run-token, never printed
curl -s -X POST https://api.swnwclinics.com/functions/v1/claude-automation \
     -H "X-Run-Token: $(cat ~/.swnw-run-token)" -H 'content-type: application/json' -d '{"op":"rest",...}'
```
Everything else about the gateway (ops, allowed paths, uploads with `?op=upload_image`, `?op=tts`, …) is unchanged.
Use `curl` (Cloudflare refuses Python's default `urllib` User-Agent with "error code: 1010"; set a User-Agent if you use Python).
Never insert into `automation_run_tokens` yourself — always `claude-db.sh token`.
