// Anthropic Messages API client for the edge functions: plain fetch (no SDK), JSON output through a forced tool call,
// retries with backoff on 429/5xx/529/network errors, and a one-line usage log. Secret: ANTHROPIC_API_KEY.
// Moved here from OpenAI on 2026-11-24 (the OpenAI account ran out of credit and stopped every automatic reply).
export const CLAUDE_URL = "https://api.anthropic.com/v1/messages";
export const REPLY_MODEL = "claude-sonnet-5-5";

export type ClaudeOk<T> = { ok: true; data: T; model: string; usage: { input: number; output: number } };
export type ClaudeFail = { ok: false; error: string; status?: number };

export type ClaudeJsonOptions = {
  system: string;
  input: string;
  schema: Record<string, unknown>;
  toolName?: string;
  toolDescription?: string;
  model?: string;
  maxTokens?: number;
  retries?: number;       // extra attempts after the first (default 2)
  baseDelayMs?: number;   // backoff base (default 600)
  timeoutMs?: number;     // per attempt (default 45000)
  apiKey?: string;        // default: ANTHROPIC_API_KEY
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  label?: string;         // for the usage log
};

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const retryable = (status: number) => status === 429 || status === 408 || status === 409 || status >= 500;

export async function claudeJson<T = any>(o: ClaudeJsonOptions): Promise<ClaudeOk<T> | ClaudeFail> {
  const apiKey = o.apiKey ?? (typeof Deno !== "undefined" ? Deno.env.get("ANTHROPIC_API_KEY") : undefined);
  if (!apiKey) return { ok: false, error: "ANTHROPIC_API_KEY مش متظبط" };
  const doFetch = o.fetchImpl ?? fetch, sleep = o.sleep ?? wait;
  const tool = o.toolName || "reply";
  const model = o.model || REPLY_MODEL;
  const body = JSON.stringify({
    model, max_tokens: o.maxTokens ?? 1500, system: o.system,
    messages: [{ role: "user", content: o.input }],
    tools: [{ name: tool, description: o.toolDescription || "Return the result as structured JSON.", input_schema: o.schema }],
    tool_choice: { type: "tool", name: tool }
  });
  const attempts = 1 + Math.max(0, o.retries ?? 2);
  let last: ClaudeFail = { ok: false, error: "تعذر الاتصال بـClaude" };
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep((o.baseDelayMs ?? 600) * 2 ** (i - 1));
    let res: Response;
    try {
      res = await doFetch(CLAUDE_URL, {
        method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body, signal: AbortSignal.timeout(o.timeoutMs ?? 45000)
      });
    } catch (e) { last = { ok: false, error: `Claude network error: ${String((e as any)?.message || e).slice(0, 160)}` }; continue; }
    const d: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      last = { ok: false, status: res.status, error: String(d?.error?.message || `Claude HTTP ${res.status}`).slice(0, 300) };
      if (retryable(res.status)) continue;
      return last;
    }
    const block = (d?.content || []).find((b: any) => b?.type === "tool_use" && b?.name === tool);
    if (!block || typeof block.input !== "object" || block.input === null) return { ok: false, error: "رد غير مفهوم من Claude" };
    const usage = { input: Number(d?.usage?.input_tokens) || 0, output: Number(d?.usage?.output_tokens) || 0 };
    console.log(JSON.stringify({ ai: "claude", label: o.label || tool, model: d?.model || model, input_tokens: usage.input, output_tokens: usage.output }));
    return { ok: true, data: block.input as T, model: d?.model || model, usage };
  }
  return last;
}
