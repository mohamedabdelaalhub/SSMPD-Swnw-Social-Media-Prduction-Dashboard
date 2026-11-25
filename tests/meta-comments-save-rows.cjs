// One bad comment must not lose the whole batch (observed: dr_dina post with 20 comments on Graph, none stored); stuck «sending» rows are released.
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cs-")), "cs.cjs");
execFileSync("npx", ["-y", "esbuild", "supabase/functions/meta-comments/comment-store.ts", "--bundle", "--format=cjs", "--log-level=error", `--outfile=${out}`], { stdio: "inherit" });
const cs = require(out);
(async () => {
  assert.equal(cs.cleanText("a\u0000b"), "ab"); assert.equal(cs.cleanText(null), "");
  const mk = (n, ref, extra = {}) => ({ id: "facebook:" + n, post_ref: ref, message: "m" + n, ...extra });
  const fakeDb = (bad) => { const stored = [], calls = [];
    return { stored, calls, from() { return { upsert: async (part) => { calls.push(part.length); if (part.some(bad)) return { error: { message: "invalid byte sequence" } }; stored.push(...part); return { error: null }; } }; } }; };
  // 1) healthy batch: one call, nothing failed
  let db = fakeDb(() => false), rep = { errors: [] }, rows = [mk(1, "P1"), mk(2, "P1"), mk(3, "P2")];
  let r = await cs.saveCommentRows(db, rows, rep, "dr_dina"); assert.equal(r.saved, 3); assert.equal(r.failedRefs.size, 0); assert.deepEqual(db.calls, [3]); assert.deepEqual(rep.errors, []);
  // 2) one poison row among 45: all the others are saved, only its post is left unmarked, the error names the row
  rows = []; for (let i = 0; i < 45; i++) rows.push(mk(i, i === 30 ? "BAD" : "P" + (i % 3), i === 30 ? { poison: true } : {}));
  db = fakeDb((x) => x.poison); rep = { errors: [] };
  r = await cs.saveCommentRows(db, rows, rep, "dr_dina"); assert.equal(r.saved, 44); assert.deepEqual([...r.failedRefs], ["BAD"]); assert.equal(db.stored.length, 44);
  assert.equal(rep.errors.length, 1); assert.match(rep.errors[0], /dr_dina save: batch failed \(invalid byte sequence\); saved 44\/45; unsaved e\.g\. facebook:30/);
  // 3) database down: bounded retries (60 singles max), every post stays unmarked, no endless calls
  rows = []; for (let i = 0; i < 200; i++) rows.push(mk(i, "P" + (i % 5)));
  db = fakeDb(() => true); rep = { errors: [] };
  r = await cs.saveCommentRows(db, rows, rep, "sono"); assert.equal(r.saved, 0); assert.equal(r.failedRefs.size, 5); assert(db.calls.length <= 1 + 10 + 60, "bounded calls: " + db.calls.length);
  // 4) nothing to save
  assert.deepEqual(await cs.saveCommentRows(fakeDb(() => false), [], { errors: [] }, "x"), { saved: 0, failedRefs: new Set() });
  // 5) stuck «sending» rows -> failed with a clear note, only old ones, never resent
  const q = {}; const upd = []; const chain = { update(v) { upd.push(["update", v]); return chain; }, eq(k, v) { upd.push(["eq", k, v]); return chain; }, lt(k, v) { upd.push(["lt", k, v]); return chain; }, then(ok) { return Promise.resolve({}).then(ok); } };
  await cs.releaseStuckSending({ from: (t) => { upd.push(["from", t]); return chain; } }, 15);
  assert.deepEqual(upd[0], ["from", "social_comments"]); assert.equal(upd[1][1].status, "failed"); assert.match(upd[1][1].last_error, /راجعه على فيسبوك/);
  assert.deepEqual(upd[2], ["eq", "status", "sending"]); assert.equal(upd[3][1], "updated_at"); assert(Date.now() - Date.parse(upd[3][2]) > 14 * 60e3 && Date.now() - Date.parse(upd[3][2]) < 16 * 60e3, "cutoff ~15 min");
  // 6) wiring in index.ts
  const idx = fs.readFileSync("supabase/functions/meta-comments/index.ts", "utf8");
  assert(idx.includes("saveCommentRows(db, rows, report, brand)") && !idx.includes("saveFailed") && idx.includes("releaseStuckSending(db)"), "index.ts uses the resilient save");
  assert(idx.includes("message: cleanText(c.message)") && idx.includes("message: cleanText(c.text)"), "NUL stripped from messages");
  console.log("PASS meta-comments save: poison row isolated (44/45 saved, only its post retried), bounded retries when DB is down, NUL stripped, stuck sending released.");
})().catch((e) => { console.error(e); process.exit(1); });
