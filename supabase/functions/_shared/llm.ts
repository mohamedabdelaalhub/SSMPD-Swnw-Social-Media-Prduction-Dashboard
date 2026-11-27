// One place for the AI text calls of the edge functions: Claude (Anthropic Messages API) and OpenAI (Responses API) behind a switch,
// with automatic fallback to the other one, a one-line usage log (tokens, function, model; NEVER content) and a usage row in ai_usage_log.
//
// Owner decision (docs/OWNER-DECISIONS.md): all AI on Claude, OpenAI only as the backup. So: with no setting at all, Claude is the
// primary as soon as ANTHROPIC_API_KEY exists, otherwise OpenAI (nothing changes until the key is added). Explicit switch:
//   AI_PROVIDER=claude|openai            global (to hold a function on OpenAI set AI_PROVIDER_<FN>=openai)
//   AI_PROVIDER_<FN>=claude|openai       per function, FN upper-cased with non-letters as "_" (meta-comments -> AI_PROVIDER_META_COMMENTS)
//   AI_FALLBACK=off                      no automatic fallback to the other provider (default: on, only when the other key exists)
//   CLAUDE_MODEL_<FN>, CLAUDE_MODEL      Claude model override (otherwise the model the caller passes)
// Secrets: ANTHROPIC_API_KEY, OPENAI_API_KEY. Nothing here prints or stores a key or any prompt/answer text.
//
// Claude side: plain fetch to POST /v1/messages (no SDK, no OpenAI-compatible shim: edge CPU limits). JSON through structured outputs
// (output_config.format = json_schema), never a forced tool_choice (400 on Sonnet 5.5 / Opus 5.5). No temperature/top_p/prefill/thinking
// parameter (thinking is adaptive by default on these models). stop_reason "refusal" or "max_tokens" is a failure, never a guessed reply.
export type Provider = "claude" | "openai";
export type LlmUsage = { input: number; output: number; cache_read: number; cache_write: number };
export type LlmOk<T> = { ok: true; data: T; provider: Provider; model: string; usage: LlmUsage; fellBack: boolean };
export type LlmFail = { ok: false; error: string; kind: "no_key" | "http" | "refusal" | "truncated" | "bad_json" | "network" | "timeout"; provider: Provider };
export type LlmJsonOptions = {
  fn: string;                       // e.g. "meta-comments" (switch + usage log label)
  system: string;                   // stable instructions (cached on the Claude side)
  input: string;                    // the user turn (already a string/JSON, identical for both providers)
  schemaName: string;
  schema: Record<string, unknown>;  // strict JSON schema (additionalProperties:false + required)
  claudeModel: string;              // default model on the Claude side for this function
  openaiModel: string;              // model on the OpenAI side
  effort?: "low" | "medium" | "high"; // Claude only; chat-style replies use "low"
  maxTokens?: number;               // Claude max_tokens (default 3000)
  timeoutMs?: number;               // per attempt (default 40000)
  retries?: number;                 // Claude extra attempts on 429/5xx/529/network (default 2)
  env?: (name: string) => string | undefined;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  record?: (row: UsageRow) => void | Promise<void>; // test hook / custom sink
};
export type UsageRow = { fn: string; provider: Provider; model: string; ok: boolean; error_kind: string | null; input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number; ms: number; fallback: boolean };

export const CLAUDE_URL = "https://api.anthropic.com/v1/messages";
export const OPENAI_URL = "https://api.openai.com/v1/responses";
const denoEnv = (n: string) => { try { return (globalThis as any).Deno?.env?.get(n) ?? undefined; } catch { return undefined; } };
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const envKey = (fn: string) => fn.toUpperCase().replace(/[^A-Z0-9]+/g, "_");

export function providerFor(fn: string, env: (n: string) => string | undefined = denoEnv): Provider {
  const v = (env(`AI_PROVIDER_${envKey(fn)}`) || env("AI_PROVIDER") || "").trim().toLowerCase();
  if (v === "claude" || v === "openai") return v;
  return env("ANTHROPIC_API_KEY") ? "claude" : "openai"; // unset: Claude primary once its key exists
}

function usageRow(o: LlmJsonOptions, provider: Provider, model: string, ms: number, r: { ok: boolean; kind?: string; usage?: LlmUsage }, fallback: boolean): UsageRow {
  const u = r.usage || { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  return { fn: o.fn, provider, model, ok: r.ok, error_kind: r.ok ? null : (r.kind || "error"), input_tokens: u.input, output_tokens: u.output, cache_read_tokens: u.cache_read, cache_write_tokens: u.cache_write, ms, fallback };
}

// Best-effort sink: a console line (no content) and a row in public.ai_usage_log through PostgREST with the service key.
async function defaultRecord(row: UsageRow, env: (n: string) => string | undefined, doFetch: typeof fetch) {
  try { console.log(JSON.stringify({ ai: row.provider, fn: row.fn, model: row.model, ok: row.ok, in: row.input_tokens, out: row.output_tokens, cache_read: row.cache_read_tokens, ms: row.ms, fb: row.fallback, err: row.error_kind })); } catch { /* ignore */ }
  const url = env("SUPABASE_URL");
  let key = env("SUPABASE_SERVICE_ROLE_KEY") || "";
  try { const p = JSON.parse(env("SUPABASE_SECRET_KEYS") || "null"); if (typeof p?.default === "string" && p.default) key = p.default; } catch { /* legacy */ }
  if (!url || !key) return;
  try {
    const p = doFetch(`${url.replace(/\/$/, "")}/rest/v1/ai_usage_log`, {
      method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(row), signal: AbortSignal.timeout(4000)
    }).catch(() => {});
    (globalThis as any).EdgeRuntime?.waitUntil?.(p);
  } catch { /* ignore */ }
}

async function callClaude<T>(o: LlmJsonOptions, env: (n: string) => string | undefined, doFetch: typeof fetch, sleep: (ms: number) => Promise<void>): Promise<{ r: LlmOk<T> | LlmFail; model: string }> {
  const model = env(`CLAUDE_MODEL_${envKey(o.fn)}`) || env("CLAUDE_MODEL") || o.claudeModel;
  const key = env("ANTHROPIC_API_KEY");
  if (!key) return { r: { ok: false, error: "ANTHROPIC_API_KEY مش متظبط", kind: "no_key", provider: "claude" }, model };
  const body = JSON.stringify({
    model, max_tokens: o.maxTokens ?? 3000,
    system: [{ type: "text", text: o.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: o.input }],
    output_config: { effort: o.effort ?? "low", format: { type: "json_schema", schema: o.schema } }
  });
  const attempts = 1 + Math.max(0, o.retries ?? 2);
  let last: LlmFail = { ok: false, error: "تعذر الاتصال بـClaude", kind: "network", provider: "claude" };
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(600 * 2 ** (i - 1));
    let res: Response;
    try {
      res = await doFetch(CLAUDE_URL, { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body, signal: AbortSignal.timeout(o.timeoutMs ?? 40000) });
    } catch (e) {
      const timeout = ["TimeoutError", "AbortError"].includes((e as any)?.name);
      last = { ok: false, error: timeout ? "Claude timeout" : `Claude network error: ${String((e as any)?.message || e).slice(0, 120)}`, kind: timeout ? "timeout" : "network", provider: "claude" };
      continue;
    }
    const d: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      last = { ok: false, error: String(d?.error?.message || `Claude HTTP ${res.status}`).slice(0, 300), kind: "http", provider: "claude" };
      if (res.status === 429 || res.status === 408 || res.status === 409 || res.status >= 500) continue; // incl. 529 overloaded
      return { r: last, model };
    }
    const usage: LlmUsage = { input: Number(d?.usage?.input_tokens) || 0, output: Number(d?.usage?.output_tokens) || 0, cache_read: Number(d?.usage?.cache_read_input_tokens) || 0, cache_write: Number(d?.usage?.cache_creation_input_tokens) || 0 };
    if (d?.stop_reason === "refusal") return { r: { ok: false, error: "Claude رفض الطلب", kind: "refusal", provider: "claude" }, model: d?.model || model };
    if (d?.stop_reason === "max_tokens") return { r: { ok: false, error: "رد Claude اتقطع", kind: "truncated", provider: "claude" }, model: d?.model || model };
    const text = (d?.content || []).filter((b: any) => b?.type === "text").map((b: any) => String(b.text || "")).join("");
    let data: T;
    try { data = JSON.parse(text); } catch { return { r: { ok: false, error: "رد غير مفهوم من Claude", kind: "bad_json", provider: "claude" }, model: d?.model || model }; }
    return { r: { ok: true, data, provider: "claude", model: d?.model || model, usage, fellBack: false }, model: d?.model || model };
  }
  return { r: last, model };
}

function openaiText(d: any): string {
  if (typeof d?.output_text === "string") return d.output_text;
  const parts: string[] = [];
  for (const item of d?.output || []) for (const c of item?.content || []) if (typeof c?.text === "string") parts.push(c.text);
  return parts.join("");
}

async function callOpenai<T>(o: LlmJsonOptions, env: (n: string) => string | undefined, doFetch: typeof fetch): Promise<{ r: LlmOk<T> | LlmFail; model: string }> {
  const model = o.openaiModel;
  const key = env("OPENAI_API_KEY");
  if (!key) return { r: { ok: false, error: "OPENAI_API_KEY مش متظبط", kind: "no_key", provider: "openai" }, model };
  let res: Response;
  try {
    res = await doFetch(OPENAI_URL, {
      method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ model, instructions: o.system, input: o.input, text: { format: { type: "json_schema", name: o.schemaName, strict: true, schema: o.schema } } }),
      signal: AbortSignal.timeout(o.timeoutMs ?? 40000)
    });
  } catch (e) {
    const timeout = ["TimeoutError", "AbortError"].includes((e as any)?.name);
    return { r: { ok: false, error: timeout ? "OpenAI timeout" : `OpenAI network error: ${String((e as any)?.message || e).slice(0, 120)}`, kind: timeout ? "timeout" : "network", provider: "openai" }, model };
  }
  const d: any = await res.json().catch(() => ({}));
  if (!res.ok) return { r: { ok: false, error: d?.error?.message || "تعذر كتابة الرد", kind: "http", provider: "openai" }, model };
  let data: T;
  try { data = JSON.parse(openaiText(d)); } catch { return { r: { ok: false, error: "رد غير مفهوم", kind: "bad_json", provider: "openai" }, model }; }
  const usage: LlmUsage = { input: Number(d?.usage?.input_tokens) || 0, output: Number(d?.usage?.output_tokens) || 0, cache_read: Number(d?.usage?.input_tokens_details?.cached_tokens) || 0, cache_write: 0 };
  return { r: { ok: true, data, provider: "openai", model: d?.model || model, usage, fellBack: false }, model: d?.model || model };
}

export async function llmJson<T = any>(o: LlmJsonOptions): Promise<LlmOk<T> | LlmFail> {
  const env = o.env ?? denoEnv, doFetch = o.fetchImpl ?? fetch, sleep = o.sleep ?? wait;
  const primary = providerFor(o.fn, env), other: Provider = primary === "claude" ? "openai" : "claude";
  const run = async (p: Provider, fellBack: boolean) => {
    const t0 = Date.now();
    const x = p === "claude" ? await callClaude<T>(o, env, doFetch, sleep) : await callOpenai<T>(o, env, doFetch);
    const row = usageRow(o, p, x.model, Date.now() - t0, { ok: x.r.ok, kind: x.r.ok ? undefined : x.r.kind, usage: x.r.ok ? x.r.usage : undefined }, fellBack);
    try { await (o.record ? o.record(row) : defaultRecord(row, env, doFetch)); } catch { /* ignore */ }
    return x.r;
  };
  const first = await run(primary, false);
  if (first.ok) return first;
  // Fallback to the other provider when it has a key (AI_FALLBACK=off disables). Never for "no key" on the other side.
  const otherKey = other === "claude" ? env("ANTHROPIC_API_KEY") : env("OPENAI_API_KEY");
  if ((env("AI_FALLBACK") || "").toLowerCase() === "off" || !otherKey) return first;
  const second = await run(other, true);
  if (second.ok) return { ...second, fellBack: true };
  return first; // report the primary's reason
}
