// Placeholder sender names ("User") are replaced by the profile name; failures are marked, not retried; no Graph write calls.
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "nm-")), "names.cjs");
execFileSync("npx", ["-y", "esbuild", "supabase/functions/meta-comments/names.ts", "--format=cjs", "--log-level=error", `--outfile=${out}`], { stdio: "inherit" });
const n = require(out);
(async () => {
  for (const g of ["User", "user", "Facebook User", "Instagram user", "مستخدم فيسبوك", "", null, undefined]) assert.equal(n.isGenericName(g), true, String(g));
  for (const g of ["منى أحمد", "Mona", "user_name22"]) assert.equal(n.isGenericName(g), false, g);
  const calls = [];
  const gget = async (p, q) => { calls.push([p, q.fields]); return p === "bad" ? { ok: false, data: {}, error: "(#100) no profile" } : p === "ig1" ? { ok: true, data: { username: "mona.ahmed" } } : p === "gen" ? { ok: true, data: { name: "Facebook User" } } : { ok: true, data: { name: "منى أحمد" } }; };
  const report = {};
  const resolve = n.makeNameResolver(gget, "T", report, "sono");
  assert.equal(await resolve("psid1", "facebook"), "منى أحمد");
  await resolve("psid1", "facebook"); assert.equal(calls.length, 1, "one profile read per sender per run");
  assert.equal(await resolve("ig1", "instagram"), "mona.ahmed");
  assert.equal(await resolve("gen", "facebook"), null, "a placeholder profile name is not accepted");
  assert.equal(await resolve("bad", "facebook"), null); assert.equal(report.nameErrors, 1); assert(report.nameErrorSample.includes("no profile"));
  // backfill: names found are written, failed senders are marked NAME_TRIED
  const updates = [];
  const q = { select() { return q; }, eq() { return q; }, not() { return q; }, or() { return q; }, order() { return q; }, limit: async () => ({ data: [
    { sender_id: "psid1", platform: "facebook" }, { sender_id: "psid1", platform: "facebook" }, { sender_id: "bad", platform: "facebook" }] }) };
  const db = { from() { return { select: () => q, update(v) { updates.push(v.sender_name); const u = { eq() { return u; }, or: async () => ({}) }; return u; } }; } };
  const r = await n.backfillSenderNames(db, "sono", (id, p) => resolve(id, p), 15);
  assert.deepEqual(r, { checked: 2, named: 1 }); assert.deepEqual(updates, ["منى أحمد", n.NAME_TRIED]);
  // UI: legacy placeholder rows show «عميل», not «User»
  const ui = fs.readFileSync("assets/js/render-comments.js", "utf8");
  assert(ui.includes("function custName") && !/lastCust\.sender_name \|\| /.test(ui) && !/m\.sender_name \|\| "عميل"/.test(ui), "inbox uses custName()");
  console.log("PASS meta-comments names: placeholder detection, one read per sender, backfill + failure marker, inbox shows عميل for placeholders");
})().catch((e) => { console.error(e); process.exit(1); });
