// Stubbed test: one gentle reminder per stuck Messenger conversation (no phone), never twice, failures recorded.
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mfr-"));
const out = path.join(dir, "messages.cjs"), stub = path.join(dir, "supabase-stub.cjs");
fs.writeFileSync(stub, "exports.createClient = () => ({});");
execFileSync("npx", ["-y", "esbuild", "supabase/functions/meta-comments/messages.ts", "--bundle", "--platform=node", "--external:npm:*", "--format=cjs", "--log-level=error", `--outfile=${out}`], { stdio: "inherit" });
const Module = require("node:module"), orig = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return String(req).startsWith("npm:") ? stub : orig.call(this, req, ...rest); };
globalThis.Deno = { env: { get: () => undefined } };
const { sendFlowReminders } = require(out);

// chainable query-builder stub that records filters and the updates it receives
function makeDb(rows) {
  const log = { filters: [], updates: [] };
  const q = { select() { return q; }, eq(k, v) { log.filters.push(["eq", k, v]); return q; }, is(k, v) { log.filters.push(["is", k, v]); return q; },
    gte(k, v) { log.filters.push(["gte", k]); return q; }, lte(k, v) { log.filters.push(["lte", k]); return q; }, limit() { return Promise.resolve({ data: rows }); } };
  const db = { from() { return { select: () => q, update(v) { log.updates.push(v); return { eq: async () => ({}) }; } }; } };
  return { db, log };
}
(async () => {
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { const b = JSON.parse(init.body); sent.push({ url: String(url), b }); return new Response(JSON.stringify({ message_id: "m1" }), { status: 200 }); };
  const rows = [{ conversation_id: "c1", sender_id: "u1" }, { conversation_id: "c2", sender_id: null }, { conversation_id: "c3", sender_id: "u3" }];
  const { db, log } = makeDb(rows);
  const report = { errors: [] };
  await sendFlowReminders(db, "sono", "PAGE", "TOKEN", report);
  assert.equal(sent.length, 2, "no sender id → no message");
  assert(sent[0].url.includes("PAGE/messages"));
  assert.equal(sent[0].b.messaging_type, "RESPONSE"); assert.equal(sent[0].b.recipient.id, "u1");
  assert(sent[0].b.message.text.includes("رقم موبايلك"));
  assert.equal(report.flowReminders, 2); assert.equal(log.updates.length, 2); assert(log.updates.every((u) => u.reminded_at));
  const f = log.filters.map((x) => x.map(String).join(":"));
  for (const need of ["eq:brand:sono", "eq:stage:collecting", "is:phone:null", "is:reminded_at:null", "gte:updated_at", "lte:updated_at"]) assert(f.includes(need), "filter " + need);
  // Graph failure is recorded, and the conversation is still marked so it is never retried every 5 minutes
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "outside window" } }), { status: 400 });
  const r2 = { errors: [] }; const m2 = makeDb([{ conversation_id: "c9", sender_id: "u9" }]);
  await sendFlowReminders(m2.db, "sono", "PAGE", "TOKEN", r2);
  assert.deepEqual(r2.errors, ["sono flow reminder: outside window"]); assert.equal(m2.log.updates.length, 1); assert(!r2.flowReminders);
  globalThis.fetch = realFetch;
  console.log("PASS messenger flow reminders: one nudge per stuck conversation, right filters, failures recorded and not retried");
})().catch((e) => { console.error(e); process.exit(1); });
