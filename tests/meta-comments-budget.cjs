// The comment sync must fit the ~1 minute the edge runtime allows: posts/replies read in parallel (bounded), permanent errors not retried
// every run, approved replies first, brands rotate, later stages skipped when the time budget is used.
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bd-"));
const b = (src, name) => { const out = path.join(dir, name + ".cjs"); execFileSync("npx", ["-y", "esbuild", src, "--bundle", "--format=cjs", "--log-level=error", `--outfile=${out}`], { stdio: "inherit" }); return require(out); };
const pool = b("supabase/functions/meta-comments/pool.ts", "pool"), fb = b("supabase/functions/meta-comments/fb-comments.ts", "fb");
(async () => {
  // mapPool: order kept, never more than `limit` in flight, really parallel
  let inflight = 0, peak = 0;
  const res = await pool.mapPool([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, async (x) => { inflight++; peak = Math.max(peak, inflight); await new Promise((r) => setTimeout(r, 20 - x)); inflight--; return x * 2; });
  assert.deepEqual(res, [2, 4, 6, 8, 10, 12, 14, 16, 18, 20]); assert.equal(peak, 3); assert.deepEqual(await pool.mapPool([], 5, async (x) => x), []);
  const t0 = Date.now(); await pool.mapPool(Array.from({ length: 10 }, (_, i) => i), 5, () => new Promise((r) => setTimeout(r, 40))); assert(Date.now() - t0 < 160, "10 x 40 ms with 5 in flight takes ~80 ms, not 400");
  assert.equal(pool.isPermanentGraphError("Unsupported get request. Object with ID '1820849849155219' does not exist, cannot be loaded due to missing permissions"), true);
  assert.equal(pool.isPermanentGraphError("Graph timeout after 20s"), false); assert.equal(pool.isPermanentGraphError("(#4) rate limit"), false); assert.equal(pool.isPermanentGraphError(undefined), false);
  // readFbThreads: replies in parallel (bounded to 4), order kept, a failing reply read does not drop the comment, permanent flag on a dead post
  let live = 0, maxLive = 0;
  const gget = async (p) => {
    if (p === "post/comments") return { ok: true, data: { data: Array.from({ length: 10 }, (_, i) => ({ id: "c" + i, message: "m" + i, comment_count: i === 0 ? 0 : 1 })) } };
    live++; maxLive = Math.max(maxLive, live); await new Promise((r) => setTimeout(r, 15)); live--;
    return p === "c3/comments" ? { ok: false, data: {}, error: "temporary" } : { ok: true, data: { data: [{ id: "r-" + p }] } };
  };
  const errors = [], t = await fb.readFbThreads(gget, "post", "T", errors, "dr_dina");
  assert.equal(t.ok, true); assert.deepEqual(t.threads.map((x) => x.comment.id), Array.from({ length: 10 }, (_, i) => "c" + i)); assert.equal(t.threads[0].replies.length, 0);
  assert.deepEqual(t.threads[2].replies, [{ id: "r-c2/comments" }]); assert.deepEqual(t.threads[3].replies, []); assert.deepEqual(errors, ["dr_dina facebook replies c3: temporary"]);
  assert(maxLive > 1 && maxLive <= 4, "replies in parallel, at most 4: " + maxLive);
  const dead = await fb.readFbThreads(async () => ({ ok: false, data: {}, error: "Unsupported get request. Object with ID '1820849849155219' does not exist" }), "dead", "T", [], "sono");
  assert.equal(dead.ok, false); assert.equal(dead.permanent, true);
  const flaky = await fb.readFbThreads(async () => ({ ok: false, data: {}, error: "Graph timeout after 20s" }), "slow", "T", [], "sono"); assert.equal(flaky.ok, false); assert.equal(flaky.permanent, false);
  // wiring in index.ts
  const idx = fs.readFileSync("supabase/functions/meta-comments/index.ts", "utf8"), run = idx.slice(idx.indexOf("async function runSync"));
  assert(/RUN_BUDGET_MS = Number\(Deno\.env\.get\("META_COMMENTS_BUDGET_MS"\)\) \|\| 40000/.test(idx), "soft budget 40 s, configurable");
  assert(run.includes("Math.floor(Date.now() / 300000) % all.length") && run.includes("all.slice(rot).concat(all.slice(0, rot))"), "brands rotate every 5 minutes");
  assert(run.indexOf('stage(report, "sendApproved"') < run.indexOf("budgeted(`${brand} syncBrand`"), "approved replies go first (not budgeted)");
  assert(run.includes("skipped ${name}: run time budget used") && (run.match(/await budgeted\(/g) || []).length >= 5, "later stages are budgeted");
  assert(idx.includes("mapPool(jobs, 5, async (job)") && idx.includes("if (t.permanent) out.permanentRef") && idx.includes("isPermanentGraphError(r.error)"), "posts read in parallel; permanent errors marked as read");
  assert(idx.includes("const PERMANENT = -2") && idx.includes("w.last_count === PERMANENT") && idx.includes("w.last_count = PERMANENT") && idx.includes("if (r.permanentRef) permanent.add"), "permanent failures are written to the watch table and skipped for 6 hours");
  console.log("PASS meta-comments budget: bounded parallel posts/replies keep order, permanent Graph errors not retried every run, approved replies first, brands rotate, stages skipped past the time budget.");
})().catch((e) => { console.error(e); process.exit(1); });
