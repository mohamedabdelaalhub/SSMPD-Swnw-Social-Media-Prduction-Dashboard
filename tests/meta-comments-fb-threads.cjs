// Stubbed-Graph test for the Facebook comment reader (no nested `comments` expansion, replies per comment, tolerant of failures).
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fbt-")), "fb.cjs");
execFileSync("npx", ["-y", "esbuild", "supabase/functions/meta-comments/fb-comments.ts", "--bundle", "--format=cjs", "--log-level=error", `--outfile=${out}`], { stdio: "inherit" });
const { readFbThreads, TOP_FIELDS, REPLY_FIELDS } = require(out);
(async () => {
  assert(!/comments[.{]/.test(TOP_FIELDS), "top-level fields must not use the removed nested comments expansion");
  assert(!/comments/.test(REPLY_FIELDS));
  const calls = [];
  const gget = async (p, params) => {
    calls.push([p, params.fields]);
    if (p === "post1/comments") return { ok: true, data: { data: [
      { id: "c1", message: "q1", comment_count: 2, from: { id: "u1" } },
      { id: "c2", message: "q2", comment_count: 0, from: { id: "u2" } },
      { id: "c3", message: "q3", comment_count: 1, from: { id: "u3" } } ] } };
    if (p === "c1/comments") return { ok: true, data: { data: [{ id: "r1", message: "a", from: { id: "page" } }, { id: "r2", message: "b", from: { id: "u1" } }] } };
    if (p === "c3/comments") return { ok: false, data: {}, error: "temporary" };
    return { ok: false, data: {}, error: "unexpected " + p };
  };
  const errors = [];
  const r = await readFbThreads(gget, "post1", "TOKEN", errors, "sono");
  assert.equal(r.ok, true);
  assert.deepEqual(r.threads.map((t) => [t.comment.id, t.replies.length]), [["c1", 2], ["c2", 0], ["c3", 0]]);
  assert.equal(calls.filter((c) => c[0] === "c2/comments").length, 0, "no replies request for comments without replies");
  assert.deepEqual(errors, ["sono facebook replies c3: temporary"]);
  // whole post failure → ok:false and the reason is reported
  const errs2 = [];
  const bad = await readFbThreads(async () => ({ ok: false, data: {}, error: "(#100) boom" }), "post2", "T", errs2, "sono");
  assert.equal(bad.ok, false); assert.deepEqual(errs2, ["sono facebook post2: (#100) boom"]);
  console.log("PASS meta-comments fb-comments: no nested expansion, replies per comment, partial failures tolerated, post failure reported");
})().catch((e) => { console.error(e); process.exit(1); });
