// Approved replies are sent in parallel (bounded), no new row is claimed after the time budget (it stays approved), a failed post is recorded.
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sd-")), "cs.cjs");
execFileSync("npx", ["-y", "esbuild", "supabase/functions/meta-comments/comment-store.ts", "--bundle", "--format=cjs", "--log-level=error", `--outfile=${out}`], { stdio: "inherit" });
const cs = require(out);
function fakeDb(n, extra = {}) {
  const rows = Array.from({ length: n }, (_, i) => ({ id: "facebook:" + i, brand: i % 2 ? "dr_dina" : "sono", platform: "facebook", platform_comment_id: "c" + i, parent_comment_id: null, final_reply: "رد " + i, status: "approved", ...extra }));
  const log = [];
  return { rows, log, from() {
    const st = { filters: {} }; const api = {
      select(cols) { if (st.update) { st.claim = true; } return api; },
      eq(k, v) { st.filters[k] = v; return api; }, limit() { return api; },
      update(v) { st.update = v; return api; },
      then(ok, bad) {
        let res;
        if (st.update) {
          const r = rows.find((x) => x.id === st.filters.id);
          if (st.claim) { if (r && r.status === st.filters.status) { Object.assign(r, st.update); log.push(["claim", r.id]); res = { data: [{ id: r.id }] }; } else res = { data: [] }; }
          else { Object.assign(r, st.update); log.push([st.update.status, r.id]); res = {}; }
        } else res = { data: rows.filter((x) => x.status === "approved").slice(0, 20) };
        return Promise.resolve(res).then(ok, bad);
      } }; return api; } };
}
const deps = (delay, fail = () => false, track = {}) => ({ pageToken: (b) => (b === "none" ? null : "TOK-" + b), withContact: (t) => t + " [contact]",
  gpost: async (p, params) => { track.live = (track.live || 0) + 1; track.peak = Math.max(track.peak || 0, track.live); await new Promise((r) => setTimeout(r, delay)); track.live--; track.calls = (track.calls || []).concat([[p, params.message]]); return fail(p) ? { ok: false, data: {}, error: "(#10) denied" } : { ok: true, data: { id: "posted-" + p } }; } });
(async () => {
  // 1) 8 replies, 50 ms each: parallel (peak <= 4), all sent, much faster than sequential, contact block added, row states right
  let db = fakeDb(8), rep = { errors: [], sent: 0 }, track = {}, t0 = Date.now();
  await cs.sendApprovedComments(db, rep, deps(50, () => false, track));
  assert.equal(rep.sent, 8); assert.deepEqual(rep.errors, []); assert(track.peak > 1 && track.peak <= 4, "peak " + track.peak); assert(Date.now() - t0 < 300, "8 x 50 ms sequentially would be 400 ms");
  assert(db.rows.every((r) => r.status === "replied" && r.final_reply.endsWith("[contact]") && r.reply_platform_id.startsWith("posted-")));
  assert(track.calls.every(([p, m]) => /^c\d\/comments$/.test(p) && m.endsWith("[contact]")), "posts to the comment's own thread");
  // 2) time budget: rows not yet claimed stay approved (not lost), claimed ones are finished
  db = fakeDb(12); rep = { errors: [], sent: 0 }; let clock = 0;
  await cs.sendApprovedComments(db, rep, deps(10), { budgetMs: 100, concurrency: 1, now: () => (clock += 30) });
  const done = db.rows.filter((r) => r.status === "replied").length, left = db.rows.filter((r) => r.status === "approved").length;
  assert(done >= 1 && left >= 1 && done + left === 12, `done ${done} left ${left}`); assert(db.rows.every((r) => r.status !== "sending"), "nothing left half-way");
  // 3) a failed post is recorded with the error, others still go
  db = fakeDb(4); rep = { errors: [], sent: 0 };
  await cs.sendApprovedComments(db, rep, deps(5, (p) => p === "c2/comments"));
  assert.equal(rep.sent, 3); assert.deepEqual(rep.errors, ["send facebook:2: (#10) denied"]); const bad = db.rows.find((r) => r.id === "facebook:2"); assert.equal(bad.status, "failed"); assert.equal(bad.last_error, "(#10) denied");
  // 4) no page token -> failed with a clear reason, never posted
  db = fakeDb(1, { brand: "none" }); rep = { errors: [], sent: 0 }; track = {};
  await cs.sendApprovedComments(db, rep, deps(1, () => false, track)); assert.equal(db.rows[0].status, "failed"); assert.equal(db.rows[0].last_error, "no page token"); assert.equal(track.calls, undefined);
  // 5) a single manual send ignores the budget
  db = fakeDb(3); rep = { errors: [], sent: 0 }; await cs.sendApprovedComments(db, rep, deps(1), { onlyId: "facebook:1", budgetMs: -1 });
  const idx = fs.readFileSync("supabase/functions/meta-comments/index.ts", "utf8");
  assert(idx.includes("sendApprovedComments(db, report, { pageToken, gpost, withContact }, { onlyId })") && idx.includes("releaseStuckSending(db)"), "index.ts wiring");
  console.log("PASS meta-comments send: approved replies in parallel (<=4), time budget leaves the rest approved, failures recorded, no token -> failed, manual send unbudgeted.");
})().catch((e) => { console.error(e); process.exit(1); });
