// A hanging Graph call must not stall the sync run; the run leaves a trace; brands are not starved by another brand's message sync.
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gr-"));
const b = (src, name) => { const out = path.join(dir, name + ".cjs"); execFileSync("npx", ["-y", "esbuild", src, "--format=cjs", "--log-level=error", `--outfile=${out}`], { stdio: "inherit" }); return require(out); };
const g = b("supabase/functions/meta-comments/graph.ts", "graph"), rl = b("supabase/functions/meta-comments/run-log.ts", "runlog");
const keepAlive = setInterval(() => {}, 1000); // AbortSignal.timeout timers are unref'd
(async () => {
  const realFetch = global.fetch;
  // hang until aborted
  global.fetch = (url, init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "TimeoutError"; rej(e); }));
  let t0 = Date.now(), r = await g.gget("123/comments", { fields: "id", access_token: "T" }, 60);
  assert.equal(r.ok, false); assert.match(r.error, /Graph timeout/); assert(Date.now() - t0 < 2000, "returns quickly");
  r = await g.gpost("1/comments", { message: "x", access_token: "T" }, 60); assert.match(r.error, /Graph timeout/);
  r = await g.gpostJson("1/messages", "T", { a: 1 }, 60); assert.match(r.error, /Graph timeout/);
  assert(!JSON.stringify(r).includes("access_token"), "no token in the error");
  global.fetch = async () => { throw new TypeError("fetch failed"); };
  r = await g.gget("1", {}); assert.equal(r.ok, false); assert.match(r.error, /Graph request failed: fetch failed/);
  let seen; global.fetch = async (url, init) => { seen = String(url); return { ok: true, json: async () => ({ data: [1] }) }; };
  r = await g.gget("1/comments", { a: "b" }); assert.equal(r.ok, true); assert.deepEqual(r.data, { data: [1] }); assert(seen.startsWith("https://graph.facebook.com/v26.0/1/comments?a=b"));
  global.fetch = async () => ({ ok: false, json: async () => ({ error: { message: "(#10) denied" } }) });
  r = await g.gget("1", {}); assert.equal(r.ok, false); assert.equal(r.error, "(#10) denied");
  global.fetch = realFetch;
  // run log
  const rows = []; let clock = 1000; const now = () => (clock += 10);
  const db = { from: () => ({ upsert: async (row) => { rows.push(row); return {}; } }) };
  const log = rl.createRunLog(db, now), report = { errors: ["a".repeat(500)], seen: 3, sent: 1, checked: 2 };
  await log.run("dr_dina syncBrand", report, async () => { throw new Error("boom"); });
  await log.run("sendApproved", report, async () => {});
  assert.equal(rows.length, 4); assert.deepEqual(rows.map((x) => x.value.phase + ":" + x.value.stage), ["start:dr_dina syncBrand", "done:dr_dina syncBrand", "start:sendApproved", "done:sendApproved"]);
  assert.equal(rows[0].key, "comments_last_run"); const last = rows[3].value; assert.deepEqual(Object.keys(last.timings_ms), ["dr_dina syncBrand", "sendApproved"]);
  assert(report.errors.some((e) => /dr_dina syncBrand threw: boom/.test(e)), "stage error recorded"); assert(last.errors.every((e) => e.length <= 240), "errors clipped"); assert.equal(last.seen, 3);
  // sub-step marker: keeps the stage fields, adds step + timing (+ memory when Deno is there), and never breaks the run
  const rows2 = []; const log2 = rl.createRunLog({ from: () => ({ upsert: async (row) => { rows2.push(row); return {}; } }) }, now);
  await log2.run("dr_dina syncBrand", { errors: [], seen: 1 }, async () => { await log2.step("fb-posts 42"); await log2.step("jobs 7"); });
  const steps = rows2.map((x) => x.value.step || "-"); assert.deepEqual(steps, ["-", "fb-posts 42", "jobs 7", "-"], "start, two steps, done");
  assert.equal(rows2[2].value.stage, "dr_dina syncBrand"); assert.equal(rows2[2].value.phase, "start"); assert.equal(rows2[2].value.seen, 1); assert(rows2[2].value.step_at && rows2[2].value.step_elapsed_ms >= 0);
  const bad = rl.createRunLog({ from: () => ({ upsert: async () => { throw new Error("db down"); } }) }, now);
  await bad.run("x", { errors: [] }, async () => {}); // tracing never breaks the run
  // order inside runSync
  const idx = fs.readFileSync("supabase/functions/meta-comments/index.ts", "utf8"), run = idx.slice(idx.indexOf("async function runSync"));
  const p = (s) => run.indexOf(s);
  assert(p('"sendApproved"') > 0 && p('"sendApproved"') < p("syncBrand(db, brand, cfg, list, report)") && p("syncBrand(db, brand, cfg, list, report)") < p('"autoReply"') && p('"autoReply"') < p('"autopilotComments"') && p('"autopilotComments"') < p('"sendApproved (autopilot)"') && p('"sendApproved (autopilot)"') < p("syncMessages(db, brand"), "approved replies -> comments of all brands -> comment replies (autoReply/autopilot + send) -> heavy message sync last");
  const msg = fs.readFileSync("supabase/functions/meta-comments/messages.ts", "utf8");
  assert(msg.includes('from "./graph.ts"') && !/await fetch\(/.test(msg), "messages.ts uses the timeout helpers");
  assert(!/await fetch\(u\.toString\(\)\)/.test(idx) && idx.includes('from "./graph.ts"'), "index.ts uses the timeout helpers");
  clearInterval(keepAlive); console.log("PASS meta-comments graph/run log: Graph timeout returns quickly (no token leaked), network errors reported, run trace written per stage (errors clipped, never breaks the run), comments of all brands run before messages.");
})().catch((e) => { console.error(e); process.exit(1); });
