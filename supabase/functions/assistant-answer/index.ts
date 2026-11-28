// «اسأل المساعد» — phase 1 answer (owner approved the UX5 mockup, 2026-11-28; server contract sent to UX5 + main chat 7).
// POST {question, screen, context} with the staff member's JWT →
//   {ok:true, steps[], help_article_id, help_title, open:{tab}|null, suggest_request, note}   or   {ok:false, reason:'cap'|'off'|'error', message}
// - Explains only: writes NOTHING except the usage counter (staff_assistant_usage_take as the user, _usage_record with the service key).
// - Answers from the dashboard help guide only (dashboard-help-data.js of the published site, cached in memory): the CACHED system
//   prompt is the rules + an index of every article; the user turn carries the few articles picked by keyword for this question.
// - Patient names / phones are dropped or masked here too before anything is sent (logic.ts redact); screenshots are not sent.
// - Model: claude-haiku-5-5 through _shared/llm.ts (structured output, low effort). Usage = tokens only, never the text.
// - Key: ANTHROPIC_API_KEY in the edge env (added by main chat 7 with the owner's approval) — never in a file.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { llmJson, type UsageRow } from "../_shared/llm.ts";
import { ANSWER_SCHEMA, MESSAGES, parseHelpData, pick, redact, redactText, shape, systemPrompt, type Answer, type Article } from "./logic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HELP_DATA_URL = Deno.env.get("ASSISTANT_HELP_DATA_URL")
  || "https://mohamedabdelaalhub.github.io/SSMPD-Swnw-Social-Media-Prduction-Dashboard/assets/js/dashboard-help-data.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

let help: { at: number; articles: Article[]; system: string } | null = null;
async function loadHelp(): Promise<{ articles: Article[]; system: string }> {
  if (help && Date.now() - help.at < 60 * 60 * 1000) return help;
  const res = await fetch(HELP_DATA_URL, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error("help data " + res.status);
  const articles = parseHelpData(await res.text());
  if (!articles.length) throw new Error("help data empty");
  help = { at: Date.now(), articles, system: systemPrompt(articles) };
  return help;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, reason: "error", message: MESSAGES.error }, 405);
  const auth = req.headers.get("Authorization");
  if (!auth) return json({ ok: false, reason: "error", message: "سجّل دخول الأول" }, 401);

  let body: { question?: string; screen?: string; context?: unknown };
  try { body = await req.json(); } catch { return json({ ok: false, reason: "error", message: "طلب غير مفهوم" }, 400); }
  const question = redactText(String(body.question || "").trim());
  if (question.length < 2) return json({ ok: false, reason: "error", message: "اكتب سؤالك" }, 400);
  const screen = String(body.screen || "").slice(0, 200);

  // as the user: active staff? assistant on? under today's cap? (reserves one question; no text stored)
  const user = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const take = await user.rpc("staff_assistant_usage_take");
  if (take.error) return json({ ok: false, reason: "error", message: "سجّل دخول الأول" }, 401);
  const t = take.data as { ok: boolean; reason?: "cap" | "off"; role?: string; roles?: string[] };
  if (!t.ok) return json({ ok: false, reason: t.reason || "cap", message: MESSAGES[t.reason || "cap"] });

  let h: { articles: Article[]; system: string };
  try { h = await loadHelp(); } catch { return json({ ok: false, reason: "error", message: MESSAGES.error }); }
  const chosen = pick(h.articles, question, screen, 4);

  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const record = async (row: UsageRow) => {
    try {
      await service.from("ai_usage_log").insert(row);
      await service.rpc("staff_assistant_usage_record", { p_input: row.input_tokens, p_output: row.output_tokens, p_cache_read: row.cache_read_tokens, p_cache_write: row.cache_write_tokens });
    } catch { /* usage logging never blocks the answer */ }
  };

  const input = JSON.stringify({
    role: t.role || "", roles: t.roles || [], screen, question,
    context: redact(body.context ?? {}),
    articles: chosen.map((a) => ({ id: a.id, title: a.title, tab: a.tab || "", meaning: a.meaning || "", steps: a.steps || [], reason: a.reason || "" })),
  });
  const r = await llmJson<Answer>({
    fn: "assistant-answer", system: h.system, input, schemaName: "assistant_answer", schema: ANSWER_SCHEMA as unknown as Record<string, unknown>,
    claudeModel: "claude-haiku-5-5", openaiModel: "gpt-5.6-sol", effort: "low", maxTokens: 1500, timeoutMs: 30000, retries: 1, record,
  });
  if (!r.ok) return json({ ok: false, reason: "error", message: MESSAGES.error });
  return json(shape(r.data, h.articles));
});
