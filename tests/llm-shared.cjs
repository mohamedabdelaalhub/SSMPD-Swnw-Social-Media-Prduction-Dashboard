// _shared/llm.ts: provider switch, Claude request shape (structured outputs, cached system, no forced tool_choice / sampling params),
// parsing with thinking blocks, retries, refusal/max_tokens/HTTP failures with automatic fallback, OpenAI request kept as before, usage rows without content.
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "llm-")), "llm.cjs");
execFileSync("npx", ["-y", "esbuild", "supabase/functions/_shared/llm.ts", "--bundle", "--format=cjs", "--log-level=error", `--outfile=${out}`], { stdio: "inherit" });
const L = require(out);
const SCHEMA = { type: "object", additionalProperties: false, required: ["category", "reply"], properties: { category: { type: "string", enum: ["general", "spam"] }, reply: { type: "string" } } };
const base = (extra = {}) => ({ fn: "meta-comments", system: "RULES TEXT", input: '{"text":"بكام الكشف؟"}', schemaName: "reply_decision", schema: SCHEMA, claudeModel: "claude-sonnet-5-5", openaiModel: "gpt-5.6-sol", sleep: async () => {}, ...extra });
const envOf = (o) => (n) => o[n];
const claudeBody = (text, extra = {}) => ({ id: "msg_1", model: "claude-sonnet-5-5", stop_reason: "end_turn", content: [{ type: "thinking", thinking: "", signature: "x" }, { type: "text", text }], usage: { input_tokens: 120, output_tokens: 40, cache_read_input_tokens: 3000, cache_creation_input_tokens: 0 }, ...extra });
const openaiBody = (text) => ({ model: "gpt-5.6-sol", output_text: text, usage: { input_tokens: 500, output_tokens: 60, input_tokens_details: { cached_tokens: 0 } } });
const res = (status, body) => ({ ok: status < 400, status, json: async () => body });
(async () => {
  // provider switch
  assert.equal(L.providerFor("meta-comments", envOf({})), "openai", "no key, no setting: OpenAI as today");
  assert.equal(L.providerFor("meta-comments", envOf({ OPENAI_API_KEY: "o" })), "openai");
  assert.equal(L.providerFor("meta-comments", envOf({ ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o" })), "claude", "owner decision: Claude primary once its key exists");
  assert.equal(L.providerFor("meta-comments", envOf({ ANTHROPIC_API_KEY: "a", AI_PROVIDER_META_COMMENTS: "openai" })), "openai", "can be held on OpenAI per function");
  assert.equal(L.providerFor("meta-comments", envOf({ AI_PROVIDER: "claude" })), "claude");
  assert.equal(L.providerFor("meta-comments", envOf({ AI_PROVIDER: "claude", AI_PROVIDER_META_COMMENTS: "openai" })), "openai", "per function wins");
  assert.equal(L.providerFor("meta-comments-review", envOf({ AI_PROVIDER_META_COMMENTS_REVIEW: "claude" })), "claude");
  assert.equal(L.providerFor("x", envOf({ AI_PROVIDER: "weird" })), "openai");
  // Claude path
  let calls = [], rows = [];
  const claudeFetch = (answer) => async (url, init) => { calls.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) }); return answer(); };
  let r = await L.llmJson(base({ env: envOf({ AI_PROVIDER: "claude", ANTHROPIC_API_KEY: "k-ant", OPENAI_API_KEY: "k-oa" }), record: (x) => rows.push(x),
    fetchImpl: claudeFetch(() => res(200, claudeBody('{"category":"general","reply":"أهلاً"}'))) }));
  assert.equal(r.ok, true); assert.deepEqual(r.data, { category: "general", reply: "أهلاً" }); assert.equal(r.provider, "claude"); assert.equal(r.fellBack, false);
  const c = calls[0]; assert.equal(c.url, "https://api.anthropic.com/v1/messages"); assert.equal(c.headers["x-api-key"], "k-ant"); assert.equal(c.headers["anthropic-version"], "2023-06-01");
  assert.equal(c.body.model, "claude-sonnet-5-5"); assert.deepEqual(c.body.system, [{ type: "text", text: "RULES TEXT", cache_control: { type: "ephemeral" } }]);
  assert.deepEqual(c.body.messages, [{ role: "user", content: '{"text":"بكام الكشف؟"}' }]); assert.deepEqual(c.body.output_config, { effort: "low", format: { type: "json_schema", schema: SCHEMA } });
  for (const bad of ["tool_choice", "tools", "temperature", "top_p", "top_k", "thinking", "budget_tokens"]) assert(!(bad in c.body), "no " + bad);
  assert.equal(rows.length, 1); assert.deepEqual(rows[0], { fn: "meta-comments", provider: "claude", model: "claude-sonnet-5-5", ok: true, error_kind: null, input_tokens: 120, output_tokens: 40, cache_read_tokens: 3000, cache_write_tokens: 0, ms: rows[0].ms, fallback: false });
  assert(!JSON.stringify(rows).includes("أهلاً") && !JSON.stringify(rows).includes("RULES"), "usage rows carry no content");
  // model override by env
  calls = []; await L.llmJson(base({ env: envOf({ AI_PROVIDER: "claude", ANTHROPIC_API_KEY: "k", CLAUDE_MODEL_META_COMMENTS: "claude-haiku-5-5" }), record: () => {}, fetchImpl: claudeFetch(() => res(200, claudeBody('{"category":"spam","reply":""}'))) }));
  assert.equal(calls[0].body.model, "claude-haiku-5-5");
  // 529 then success (retry with backoff), 400 is not retried
  calls = []; let n = 0;
  r = await L.llmJson(base({ env: envOf({ AI_PROVIDER: "claude", ANTHROPIC_API_KEY: "k" }), record: () => {}, fetchImpl: claudeFetch(() => (++n < 3 ? res(529, { error: { message: "Overloaded" } }) : res(200, claudeBody('{"category":"spam","reply":""}')))) }));
  assert.equal(r.ok, true); assert.equal(calls.length, 3);
  calls = []; r = await L.llmJson(base({ env: envOf({ AI_PROVIDER: "claude", ANTHROPIC_API_KEY: "k" }), record: () => {}, fetchImpl: claudeFetch(() => res(400, { error: { message: "bad schema" } })) }));
  assert.equal(r.ok, false); assert.equal(r.kind, "http"); assert.equal(calls.length, 1, "400 not retried"); assert.match(r.error, /bad schema/);
  // refusal / truncated / bad JSON -> failure, never a guessed reply; with an OpenAI key it falls back
  for (const [extra, kind] of [[{ stop_reason: "refusal", content: [] }, "refusal"], [{ stop_reason: "max_tokens" }, "truncated"]]) {
    rows = []; const seen = [];
    r = await L.llmJson(base({ env: envOf({ AI_PROVIDER: "claude", ANTHROPIC_API_KEY: "k", OPENAI_API_KEY: "o" }), record: (x) => rows.push(x),
      fetchImpl: async (url, init) => { seen.push(String(url)); return String(url).includes("anthropic") ? res(200, claudeBody('{"category":"general","reply":"x"}', extra)) : res(200, openaiBody('{"category":"general","reply":"من OpenAI"}')); } }));
    assert.equal(r.ok, true, kind); assert.equal(r.provider, "openai"); assert.equal(r.fellBack, true); assert.deepEqual(rows.map((x) => [x.provider, x.ok, x.error_kind, x.fallback]), [["claude", false, kind, false], ["openai", true, null, true]]);
  }
  r = await L.llmJson(base({ env: envOf({ AI_PROVIDER: "claude", ANTHROPIC_API_KEY: "k" }), record: () => {}, fetchImpl: async () => res(200, claudeBody("ليس JSON")) }));
  assert.equal(r.ok, false); assert.equal(r.kind, "bad_json");
  // no fallback when disabled or when the other key is missing; the primary's reason is reported
  r = await L.llmJson(base({ env: envOf({ AI_PROVIDER: "claude", ANTHROPIC_API_KEY: "k", OPENAI_API_KEY: "o", AI_FALLBACK: "off" }), record: () => {}, fetchImpl: async () => res(500, { error: { message: "boom" } }) }));
  assert.equal(r.ok, false); assert.match(r.error, /boom/);
  r = await L.llmJson(base({ env: envOf({ AI_PROVIDER: "claude" }), record: () => {}, fetchImpl: async () => { throw new Error("must not be called"); } }));
  assert.equal(r.ok, false); assert.equal(r.kind, "no_key"); assert.match(r.error, /ANTHROPIC_API_KEY/);
  // OpenAI path = the request the function sent before (Responses API, json_schema strict, instructions + input)
  calls = [];
  r = await L.llmJson(base({ env: envOf({ OPENAI_API_KEY: "k-oa" }), record: () => {}, fetchImpl: async (url, init) => { calls.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) }); return res(200, openaiBody('{"category":"general","reply":"رد"}')); } }));
  assert.equal(r.ok, true); assert.equal(r.provider, "openai"); assert.deepEqual(r.usage, { input: 500, output: 60, cache_read: 0, cache_write: 0 });
  assert.equal(calls[0].url, "https://api.openai.com/v1/responses"); assert.equal(calls[0].headers.Authorization, "Bearer k-oa");
  assert.deepEqual(calls[0].body, { model: "gpt-5.6-sol", instructions: "RULES TEXT", input: '{"text":"بكام الكشف؟"}', text: { format: { type: "json_schema", name: "reply_decision", strict: true, schema: SCHEMA } } });
  // OpenAI fails (credit out) and a Claude key exists -> Claude answers (this is the incident that stopped every reply on 22 Nov)
  r = await L.llmJson(base({ env: envOf({ AI_PROVIDER: "openai", OPENAI_API_KEY: "o", ANTHROPIC_API_KEY: "a" }), record: () => {}, fetchImpl: async (url) => (String(url).includes("openai") ? res(429, { error: { message: "insufficient_quota" } }) : res(200, claudeBody('{"category":"general","reply":"من Claude"}'))) }));
  assert.equal(r.ok, true); assert.equal(r.provider, "claude"); assert.equal(r.fellBack, true);
  // the DB usage sink: one POST to /rest/v1/ai_usage_log with the service key, row without content; failures ignored
  const posts = [];
  r = await L.llmJson(base({ env: envOf({ OPENAI_API_KEY: "o", SUPABASE_URL: "https://db.test/", SUPABASE_SECRET_KEYS: '{"default":"svc-key"}' }),
    fetchImpl: async (url, init) => { if (String(url).includes("ai_usage_log")) { posts.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) }); throw new Error("db down"); } return res(200, openaiBody('{"category":"general","reply":"x"}')); } }));
  assert.equal(r.ok, true); assert.equal(posts.length, 1); assert.equal(posts[0].url, "https://db.test/rest/v1/ai_usage_log"); assert.equal(posts[0].headers.Authorization, "Bearer svc-key");
  assert.deepEqual(Object.keys(posts[0].body).sort(), ["cache_read_tokens", "cache_write_tokens", "error_kind", "fallback", "fn", "input_tokens", "model", "ms", "ok", "output_tokens", "provider"]);
  // wiring: meta-comments uses the helper, no direct OpenAI call left there
  for (const f of ["ai.ts", "review.ts"]) { const t = fs.readFileSync("supabase/functions/meta-comments/" + f, "utf8"); assert(t.includes('from "../_shared/llm.ts"') && !t.includes("api.openai.com"), f); }
  console.log("PASS shared llm: provider switch (Claude primary once its key exists, else OpenAI), Claude structured-output request without forced tool_choice/sampling, cached system, retries, refusal/truncation/HTTP -> automatic fallback both ways, OpenAI request unchanged, usage rows without content.");
})().catch((e) => { console.error(e); process.exit(1); });
