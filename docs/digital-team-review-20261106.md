# Digital Team review (read-only), 2026-11-06

Evidence: code of `digital-team-coordinator`, `digital-chat-reply`, `digital-agent-advice` (Edge Functions) and aggregate counts from production tables (no message text read).

## What works (verified from data)
- Five advisory agents (Sia, Hor, Hotep, Nefer, Maat) answered every owner test message (4/4 chat messages each, 1/1 dispatch each: `analysis_complete`). Answers are labelled `advisory`.
- Safety posture is correct: owner-only access, no write tools, `external_action_executed:false`, model output treated as data, bounded concurrency (2 at a time), handoff limited to one hop and only to the five advisory agents.
- The two non-advisory agents (Hapi, Claude Creative) are honestly marked `awaiting_runtime`; the UI shows a labelled simulation, never a fake delivery.

## Gaps and risks
1. **No runtime for Hapi and Claude Creative**: 4+4 chat messages and 1+1 dispatches are stuck at `awaiting_runtime` by design. Collaboration is therefore 5-agent advisory only; no agent can execute anything.
2. **Stale/missing context**: `digital_agent_reviews` has rows only for Hor, Maat, Nefer, last reviewed 2026-11-04. Sia and Hotep have none, so their answers rely on live aggregate snapshots or nothing.
3. **Collaboration depth**: one handoff hop, answer is appended but never synthesised. Nobody merges the opinions of several agents into one recommendation (Sia is the natural synthesiser).
4. **Model/cost dependency**: all agents call OpenAI via `OPENAI_API_KEY` (default `gpt-4.1-mini`); owner decision on the key is still open. Without it every agent returns `blocked`.
5. **Efficiency**: each chat turn re-reads 22 messages and 14 instructions per agent and sends them to the model; with 7 agents a broadcast is 7 model calls per message. Acceptable at current volume (4 messages) but should be rate-limited before staff use.

## Recommended next steps (not executed: they need model/secret decisions)
- Make Sia synthesise a one-paragraph consensus after a multi-agent broadcast.
- Schedule the metrics review for all five advisory agents (daily), so context is never older than 24h.
- Decide the model-key policy (keep OpenAI vs a zero-cost alternative) before enabling staff access.
- Give Hapi/Claude Creative a real runtime or hide them from the broadcast list to avoid dead-end threads.
