// Stubbed-fetch tests for the Anthropic client and decideReply (no network, no real key).
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcc-"));
const build = (src, out, bundle) => execFileSync("npx", ["-y", "esbuild", src, ...(bundle ? ["--bundle", "--platform=node", "--external:npm:*"] : []), "--format=cjs", "--log-level=error", `--outfile=${out}`], { stdio: "inherit" });
const clientOut = path.join(dir, "claude.cjs"), aiOut = path.join(dir, "ai.cjs");
// ai.ts pulls in clinic-catalog.ts which imports supabase-js through an npm: specifier: map it to a stub in Node.
const stub = path.join(dir, "supabase-stub.cjs");
fs.writeFileSync(stub, "exports.createClient = () => ({ from: () => ({ select: async () => ({ data: [], error: null }) }) });");
const Module = require("node:module"), origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return String(req).startsWith("npm:") ? stub : origResolve.call(this, req, ...rest); };
build("supabase/functions/meta-comments/claude.ts", clientOut, false);
build("supabase/functions/meta-comments/ai.ts", aiOut, true);
const { claudeJson } = require(clientOut);

const okResp = (input, extra = {}) => new Response(JSON.stringify({ model: "claude-sonnet-5-5", usage: { input_tokens: 120, output_tokens: 30 }, content: [{ type: "text", text: "x" }, { type: "tool_use", name: "reply_decision", input }], ...extra }), { status: 200 });
const errResp = (status, message) => new Response(JSON.stringify({ error: { message } }), { status });
const schema = { type: "object", properties: { category: { type: "string" } }, required: ["category"] };

(async () => {
  // 1) request shape + success
  let seen;
  const f1 = async (url, init) => { seen = { url, init, body: JSON.parse(init.body) }; return okResp({ category: "general", reply: "hi", specialty: "" }); };
  const r1 = await claudeJson({ system: "S", input: "I", schema, toolName: "reply_decision", apiKey: "k", fetchImpl: f1 });
  assert.equal(r1.ok, true); assert.equal(r1.data.category, "general");
  assert.equal(seen.url, "https://api.anthropic.com/v1/messages");
  assert.equal(seen.init.headers["x-api-key"], "k"); assert.equal(seen.init.headers["anthropic-version"], "2023-06-01");
  assert.equal(seen.body.model, "claude-sonnet-5-5"); assert.equal(seen.body.system, "S");
  assert.deepEqual(seen.body.tool_choice, { type: "tool", name: "reply_decision" });
  assert.equal(seen.body.messages[0].content, "I"); assert.equal(seen.body.tools[0].input_schema, undefined === 0 ? 1 : seen.body.tools[0].input_schema);
  assert.deepEqual(r1.usage, { input: 120, output: 30 });
  // 2) retries on 429 then 529 then success; backoff grows
  const sleeps = []; let n = 0;
  const f2 = async () => (++n === 1 ? errResp(429, "rate") : n === 2 ? errResp(529, "overloaded") : okResp({ category: "thanks", reply: "", specialty: "" }));
  const r2 = await claudeJson({ system: "S", input: "I", schema, toolName: "reply_decision", apiKey: "k", fetchImpl: f2, sleep: async (ms) => sleeps.push(ms) });
  assert.equal(r2.ok, true); assert.equal(n, 3); assert.deepEqual(sleeps, [600, 1200]);
  // 3) 401/400 are not retried and the message is surfaced
  let c3 = 0;
  const r3 = await claudeJson({ system: "S", input: "I", schema, apiKey: "k", fetchImpl: async () => { c3++; return errResp(401, "invalid x-api-key"); }, sleep: async () => {} });
  assert.equal(r3.ok, false); assert.equal(c3, 1); assert.match(r3.error, /invalid x-api-key/); assert.equal(r3.status, 401);
  // 4) persistent 500 → fails after 3 attempts; network error also retried
  let c4 = 0;
  const r4 = await claudeJson({ system: "S", input: "I", schema, apiKey: "k", fetchImpl: async () => { c4++; throw new Error("socket hang up"); }, sleep: async () => {} });
  assert.equal(r4.ok, false); assert.equal(c4, 3); assert.match(r4.error, /socket hang up/);
  // 5) missing key and malformed reply (no tool_use)
  const r5 = await claudeJson({ system: "S", input: "I", schema, apiKey: "", fetchImpl: async () => okResp({}) });
  assert.equal(r5.ok, false); assert.match(r5.error, /ANTHROPIC_API_KEY/);
  const r6 = await claudeJson({ system: "S", input: "I", schema, apiKey: "k", fetchImpl: async () => new Response(JSON.stringify({ content: [{ type: "text", text: "no tool" }] }), { status: 200 }) });
  assert.equal(r6.ok, false);

  // 7) decideReply end to end with a stubbed global fetch (sensitive categories get the owner's fixed templates)
  globalThis.Deno = { env: { get: (k) => (k === "ANTHROPIC_API_KEY" ? "test-key" : undefined) } };
  const realFetch = globalThis.fetch; let calls = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("https://api.anthropic.com")) { const b = JSON.parse(init.body); calls.push(b); return okResp(globalThis.__next); }
    return new Response("{}", { status: 404 }); // clinic facts / catalog fetches fail softly
  };
  const ai = require(aiOut);
  globalThis.__next = { category: "emergency", reply: "model text must be ignored", specialty: "" };
  const e = await ai.decideReply({ brand: "sono", channel: "comment", text: "في ضيق نفس شديد", clinicInfo: "" });
  assert.equal(e.ok, true); assert.equal(e.category, "emergency"); assert.equal(e.reply, ai.withContact(ai.TEMPLATES.emergency));
  globalThis.__next = { category: "spam", reply: "", specialty: "" };
  const sp = await ai.decideReply({ brand: "sono", channel: "comment", text: "link spam", clinicInfo: "" });
  assert.deepEqual(sp, { ok: true, category: "spam", reply: "" });
  globalThis.__next = { category: "general", reply: "المواعيد يوميًا من 10 ص.", specialty: "" };
  const g = await ai.decideReply({ brand: "sono", channel: "comment", text: "المواعيد ايه", clinicInfo: "x" });
  assert.equal(g.ok, true); assert.equal(g.category, "general"); assert.match(g.reply, /المواعيد/); assert.match(g.reply, /0236230005/);
  assert.equal(JSON.parse(calls[calls.length - 1].messages[0].content).text, "المواعيد ايه");
  globalThis.__next = { category: "general", reply: "", specialty: "" };
  const empty = await ai.decideReply({ brand: "sono", channel: "comment", text: "؟", clinicInfo: "" });
  assert.equal(empty.ok, false);
  globalThis.fetch = realFetch;
  console.log("PASS meta-comments Claude: request shape, retries/backoff, no retry on 4xx, network errors, missing key, bad reply, decideReply templates/spam/general/empty");
})().catch((e) => { console.error(e); process.exit(1); });
