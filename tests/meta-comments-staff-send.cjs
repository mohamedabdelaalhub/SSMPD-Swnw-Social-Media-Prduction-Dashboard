// Staff send problems must be explained, not hidden behind «تعذر إرسال الرسالة»; the role lookup tolerates duplicate admin rows; the Instagram
// conversations call has a short timeout and a cooldown; comment replies run before the heavy message sync.
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-"));
const out = path.join(dir, "cooldown.cjs");
execFileSync("npx", ["-y", "esbuild", "supabase/functions/meta-comments/cooldown.ts", "--bundle", "--format=cjs", "--log-level=error", `--outfile=${out}`], { stdio: "inherit" });
const cd = require(out);
async function unit() {
  const store = {}; let clock = 1_000_000;
  const db = { from: () => { const st = {}; const api = { select() { return api; }, eq(k, v) { st.key = v; return api; }, maybeSingle: async () => ({ data: store[st.key] ? { value: store[st.key] } : null }), upsert: async (row) => { store[row.key] = row.value; return {}; } }; return api; } };
  const now = () => clock;
  assert.equal(await cd.isCoolingDown(db, "sono:instagram-messages", now), false);
  await cd.startCooldown(db, "sono:instagram-messages", 30, "Graph timeout after 10s", now);
  assert.equal(await cd.isCoolingDown(db, "sono:instagram-messages", now), true); assert.equal(await cd.isCoolingDown(db, "dr_dina:instagram-messages", now), false, "per brand");
  clock += 29 * 60e3; assert.equal(await cd.isCoolingDown(db, "sono:instagram-messages", now), true);
  clock += 2 * 60e3; assert.equal(await cd.isCoolingDown(db, "sono:instagram-messages", now), false, "over after 30 minutes");
  assert.equal(await cd.isCoolingDown({ from: () => { throw new Error("db down"); } }, "x"), false, "a failing read never blocks the run");
  const msg = fs.readFileSync("supabase/functions/meta-comments/messages.ts", "utf8");
  assert(msg.includes("isCoolingDown(db, `${brand}:instagram-messages`)") && msg.includes("ig ? 10000 : 20000") && msg.includes("startCooldown(db, `${brand}:instagram-messages`, 30"), "IG conversations: 10 s + 30 min cooldown after a timeout");
  const idx = fs.readFileSync("supabase/functions/meta-comments/index.ts", "utf8");
  assert(idx.includes('.eq("active", true).order("created_at", { ascending: true }).limit(5)') && !/\.eq\("active", true\)\.maybeSingle\(\);\n\s+const \{ data: extra \}/.test(idx) && idx.includes('.in("admin_id", (adminRows || []).map'), "role lookup: all active admin rows, no maybeSingle");
  assert(idx.includes('const roles = admin ? [...(adminRows || []).map((a: any) => a.role), ...(extra'), "roles = union of the rows' roles and extra roles");
}
async function ui() {
  const { chromium } = require("playwright"); const exe = fs.existsSync("/opt/pw-browsers/chromium") ? { executablePath: "/opt/pw-browsers/chromium" } : {};
  const browser = await chromium.launch({ ...exe, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }), errors = []; page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", (r) => { const u = new URL(r.request().url()); if (u.origin === "https://ss.test") { if (u.pathname === "/") return r.fulfill({ contentType: "text/html", body: '<html lang="ar" dir="rtl"><main id="view-container" class="view"></main></html>' }); const f = path.resolve("." + u.pathname); if (f.startsWith(path.resolve("assets") + path.sep) && fs.existsSync(f)) return r.fulfill({ path: f }); } return r.abort(); });
    await page.goto("https://ss.test/"); for (const f of ["styles", "dashboard-theme", "comments-workspace"]) await page.addStyleTag({ url: "/assets/css/" + f + ".css" });
    await page.evaluate(() => {
      window.alerts = []; window.alert = (x) => alerts.push(x); window.confirm = () => true; window.setInterval = () => 0; window.mode = "ok"; window.calls = 0;
      const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
      window.fixtures = { social_messages: [{ id: "facebook:1", conversation_id: "fbconv", conversation_url: "https://www.facebook.com/x", platform: "facebook", brand: "sono", sender_id: "U1", sender_name: "منى أحمد", is_page: false, message: "بكام الكشف؟", status: "new", sent_at: ago(30) }], social_comments: [], social_reply_templates: [], content_items: [], admins: [] };
      window.SSMPDAuth = { currentAdmin: { id: "A1", role: "page_manager" } };
      const http = (status, body) => ({ data: null, error: { name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code", context: { status, json: async () => { if (body === undefined) throw new Error("no json"); return body; } } } });
      const answers = { forbidden: () => http(403, { ok: false, error: "FORBIDDEN" }), auth: () => http(401, { ok: false, error: "AUTH_REQUIRED" }), network: () => ({ data: null, error: { name: "FunctionsFetchError", message: "Failed to send a request to the Edge Function" } }),
        boom: () => http(500, { ok: false, error: "MISCONFIGURED" }), nojson: () => http(502), meta: () => ({ data: { ok: false, error: "ميتا رفضت الإرسال: (#10) denied" }, error: null }) };
      window.SSMPDDb = { client: { from: (name) => { const q = { select() { return q; }, order() { return q; }, limit() { return q; }, eq() { return q; }, in() { return q; }, is() { return q; }, gte() { return q; }, maybeSingle() { return q; }, then(ok, bad) { return Promise.resolve({ data: fixtures[name] || [], error: null }).then(ok, bad); } }; return q; },
        rpc: async () => ({ data: true }), channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel() {},
        functions: { invoke: async (n, p) => { calls++; if (p.body.action === "send_message") return answers[mode](); return { data: { ok: true, text: "x" } }; } } } };
    });
    await page.addScriptTag({ path: "assets/js/render-comments.js" }); await page.evaluate(() => SSMPDRenderComments.render(document.querySelector("main")));
    await page.waitForSelector('[data-section="messages"]'); await page.locator('[data-section="messages"]').click(); await page.waitForSelector(".cm-conv"); await page.locator(".cm-conv", { hasText: "منى أحمد" }).click(); await page.waitForSelector("[data-msend]");
    const cases = [["forbidden", /مالوش صلاحية/], ["auth", /الجلسة انتهت/], ["network", /مفيش اتصال بالسيرفر/], ["boom", /^MISCONFIGURED$/], ["nojson", /تعذر إرسال الرسالة \(كود 502\)/], ["meta", /ميتا رفضت الإرسال/]];
    for (const [mode, re] of cases) {
      await page.evaluate((m) => { window.mode = m; window.alerts.length = 0; }, mode);
      await page.locator(".cm-chat-pane .cm-input").fill("أهلاً بحضرتك"); await page.locator("[data-msend]").click();
      await page.waitForFunction(() => alerts.length === 1); const text = await page.evaluate(() => alerts[0]); assert.match(text, re, mode + ": " + text);
      assert.equal(await page.locator("[data-msend]").isDisabled(), false, mode + ": button usable again");
    }
    assert(!/[٠-٩]/.test(await page.locator(".cm-wrap").innerText()), "English digits"); assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}
(async () => { await unit(); await ui();
  console.log("PASS staff send: real reasons shown (403 permission, 401 session, network, 5xx with/without body, Meta refusal), role lookup tolerates duplicate rows, IG conversations 10 s + 30 min cooldown."); })().catch((e) => { console.error(e); process.exit(1); });
