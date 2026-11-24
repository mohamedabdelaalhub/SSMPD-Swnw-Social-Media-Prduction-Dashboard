// Owner-only WhatsApp template requests (owner 2026-11-24): migration 20261124230000 on PGlite, whatsapp-sync pass-through,
// meta-comments routing behind a super_admin check, and the UI button/form/status list (hidden for everyone but the owner).
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("node:assert/strict"), ts = require("typescript");
const J = (x) => JSON.parse(JSON.stringify(x));
const SRC = "supabase/migrations/20261124230000_whatsapp_template_requests.sql";
async function migration() {
  const { PGlite } = require("@electric-sql/pglite"); const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table public.admins(id uuid primary key default gen_random_uuid(), name text, role text, active boolean default true);
    create table public.admin_extra_roles(admin_id uuid, role text);
    create schema ops_private;
    create table ops_private.whatsapp_templates(name text not null, language text not null, category text, body text not null default '', synced_at timestamptz not null default now(), primary key(name, language));`);
  await db.exec(fs.readFileSync(SRC, "utf8"));
  const q = async (sql, p = []) => (await db.query(sql, p)).rows[0];
  const owner = (await q(`insert into admins(name, role) values('المالك','super_admin') returning id`)).id;
  const recep = (await q(`insert into admins(name, role) values('منى','reception') returning id`)).id;
  const extra = (await q(`insert into admins(name, role) values('سارة','general_manager') returning id`)).id;
  await db.query(`insert into admin_extra_roles values($1,'super_admin')`, [extra]);
  const sub = async (adm, cat, body, slug = null) => (await q(`select public.whatsapp_template_submit($1,$2,$3,$4) r`, [adm, cat, body, slug])).r;
  const api = async (a, p) => (await q(`select public.whatsapp_template_api($1,$2::jsonb) r`, [a, JSON.stringify(p || {})])).r;
  const good = "أهلاً بحضرتك من مركز عيادات سونو التخصصية. حاولنا نتواصل معاك بخصوص طلب الحجز.";
  assert.equal((await sub(recep, "UTILITY", good)).ok, false, "reception refused"); assert.match((await sub(recep, "UTILITY", good)).error, /للمالك/);
  assert.equal((await sub(extra, "UTILITY", good + " 1")).ok, true, "extra super_admin role accepted");
  assert.match((await sub(owner, "OTHER", good)).error, /نوع القالب/);
  assert.match((await sub(owner, "UTILITY", "قصير")).error, /قصير/);
  assert.match((await sub(owner, "UTILITY", "ا".repeat(1025))).error, /1024/);
  assert.match((await sub(owner, "UTILITY", "أهلاً {{1}} بحضرتك في سونو")).error, /متغيرات/);
  assert.match((await sub(owner, "UTILITY", "كلمنا على 01012345678 دلوقتي")).error, /تليفون/);
  assert.match((await sub(owner, "UTILITY", "كلمنا على ٠١٠ ١٢٣ ٤٥٦ ٧٨ دلوقتي")).error, /تليفون/);
  assert.match((await sub(owner, "UTILITY", "ملف المريض P-2026-000001 جاهز")).error, /تليفون|ملفات/);
  assert.equal((await sub(owner, "UTILITY", "الموعد بعد 24 ساعة من دلوقتي إن شاء الله")).ok, true, "short numbers are fine");
  const r = await sub(owner, "MARKETING", good); assert.equal(r.ok, true); assert.match(r.name, /^sono_mar_\d{6}_[0-9a-f]{4}_ar$/);
  assert.match((await sub(owner, "MARKETING", good)).error, /متقدّم قبل كده/);
  const named = await sub(owner, "UTILITY", good + " شكراً", "followup_visit"); assert.equal(named.name, "sono_followup_visit_ar");
  let list = (await q(`select public.whatsapp_template_requests_list() r`)).r;
  assert.equal(list.length, 4); assert.equal(list[0].status, "QUEUED"); assert.equal(list[0].submitted_by, "المالك");
  // agent: lease once, ack PENDING, Meta statuses flip it (and the picker table)
  const lease = await api("lease", { limit: 10 }); assert.equal(lease.requests.length, 4); assert.deepEqual(Object.keys(lease.requests[0]).sort(), ["category", "id", "language", "name", "text"]);
  assert.equal((await api("lease", {})).requests.length, 0, "not handed out twice");
  assert.equal((await api("ack", { id: r.id, status: "PENDING", meta_id: "123" })).ok, true); assert.equal((await api("ack", { id: r.id, status: "PENDING" })).ok, false, "ack once");
  assert.equal((await api("ack", { id: named.id, status: "FAILED", error: "ميتا: اسم مكرر" })).ok, true);
  assert.equal((await api("ack", { id: lease.requests[0].id, status: "SENT" })).ok, false, "bad status");
  await api("ack", { id: lease.requests[1].id, status: "PENDING" });
  await api("sync", { statuses: [{ name: r.name, language: "ar", status: "APPROVED" }, { name: "someone_else", language: "ar", status: "APPROVED" }] });
  assert.deepEqual(J((await q(`select name from ops_private.whatsapp_templates`)).name), r.name, "approved template usable in the picker at once");
  assert.equal((await q(`select count(*)::int n from ops_private.whatsapp_templates`)).n, 1, "only our own requests touch the picker");
  await api("sync", { statuses: [{ name: r.name, language: "ar", status: "REJECTED", reason: "تصنيف غير مناسب" }] });
  list = (await q(`select public.whatsapp_template_requests_list() r`)).r; const rej = list.find((x) => x.id === r.id);
  assert.equal(rej.status, "REJECTED"); assert.equal(rej.reason, "تصنيف غير مناسب"); assert.equal((await q(`select count(*)::int n from ops_private.whatsapp_templates`)).n, 0, "rejected leaves the picker");
  assert.equal(list.find((x) => x.id === named.id).status, "FAILED");
  const audit = (await db.query(`select event from ops_private.whatsapp_template_audit order by id`)).rows.map((x) => x.event);
  assert(audit.includes("submitted") && audit.includes("ack:PENDING") && audit.includes("status:APPROVED") && audit.includes("status:REJECTED"), "audit trail");
  // stale lease -> queue; open too long -> failed
  const s1 = await sub(owner, "UTILITY", "تذكير بموعد حجزك القادم في سونو، رد علينا للتأكيد.");
  await api("lease", {}); await db.query(`update ops_private.whatsapp_template_requests set leased_at=now()-interval '3 minutes' where id=$1`, [s1.id]);
  assert.equal((await q(`select public.whatsapp_template_requests_list() r`)).r.find((x) => x.id === s1.id).status, "QUEUED", "stale lease goes back to the queue");
  await db.query(`update ops_private.whatsapp_template_requests set submitted_at=now()-interval '11 minutes' where id=$1`, [s1.id]);
  assert.equal((await q(`select public.whatsapp_template_requests_list() r`)).r.find((x) => x.id === s1.id).status, "FAILED");
  // rate limit: 10 per hour
  for (let i = 0; i < 12; i++) await sub(owner, "UTILITY", "نص قالب رقم " + "x".repeat(i + 1) + " لمركز سونو للتجربة فقط");
  assert.match((await sub(owner, "UTILITY", "نص آخر مختلف تماماً لمركز سونو للتجربة")).error, /قوالب كتير/);
  const grants = (await db.query(`select p.proname, has_function_privilege('authenticated',p.oid,'execute') a, has_function_privilege('anon',p.oid,'execute') n, has_function_privilege('service_role',p.oid,'execute') s from pg_proc p where proname like 'whatsapp_template%'`)).rows;
  assert.equal(grants.length, 4); for (const g of grants) { assert.equal(g.a, false, g.proname); assert.equal(g.n, false, g.proname); if (g.proname !== "whatsapp_template_sweep") assert.equal(g.s, true, g.proname); }
  assert.equal((await q(`select has_table_privilege('authenticated','ops_private.whatsapp_template_requests','select') x`)).x, false);
  await db.exec(fs.readFileSync("supabase/rollbacks/20261124230000_whatsapp_template_requests.rollback.sql", "utf8"));
  assert.equal((await q(`select count(*)::int n from pg_proc where proname like 'whatsapp_template%'`)).n, 0, "rollback clean");
}
function loadTs(file) { const js = ts.transpileModule(fs.readFileSync(file, "utf8").replace(/^import .*$/gm, ""), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const sb = { exports: {}, module: {}, crypto: { randomUUID: () => "u" }, JSON, Date, String, Number, Array, Promise, isNaN, RegExp }; sb.module.exports = sb.exports; vm.runInNewContext(js, sb); return sb.exports; }
async function edge() {
  const sync = loadTs("supabase/functions/whatsapp-sync/sync.ts"); const log = [];
  const db = { rpc: async (n, p) => { log.push([n, p]); return { data: { ok: true }, error: null }; }, from() { throw new Error("no table"); } };
  await sync.handle(db, { action: "template_lease", limit: 3 }); await sync.handle(db, { action: "template_ack", id: "i", status: "PENDING", meta_id: "9" }); await sync.handle(db, { action: "template_sync", statuses: [] });
  assert.deepEqual(J(log), [["whatsapp_template_api", { p_action: "lease", p_payload: { limit: 3 } }], ["whatsapp_template_api", { p_action: "ack", p_payload: { id: "i", status: "PENDING", meta_id: "9", error: null } }], ["whatsapp_template_api", { p_action: "sync", p_payload: { statuses: [] } }]]);
  const w = loadTs("supabase/functions/meta-comments/whatsapp.ts"); const calls = [];
  const d2 = { rpc: async (n, p) => { calls.push([n, p]); return { data: n === "whatsapp_template_requests_list" ? [{ name: "a" }] : { ok: true, id: "x", name: "sono_a_ar" }, error: null }; } };
  assert.equal(w.checkTemplateText("قصير"), "نص القالب قصير — اكتب جملة كاملة"); assert.match(w.checkTemplateText("اتصل على ٠١٠١٢٣٤٥٦٧٨ دلوقتي"), /تليفون/); assert.match(w.checkTemplateText("هلا {{1}} بيك في سونو"), /متغيرات/); assert.equal(w.checkTemplateText("الموعد بعد 24 ساعة إن شاء الله"), null);
  assert.equal((await w.submitTemplate(d2, { adminId: "A", category: "BAD", text: "نص طويل كفاية للتجربة" })).ok, false); assert.equal(calls.length, 0, "bad input never reaches the database");
  await w.submitTemplate(d2, { adminId: "A", category: "UTILITY", text: "  نص طويل كفاية للتجربة  " });
  assert.deepEqual(J(calls[0]), ["whatsapp_template_submit", { p_admin: "A", p_category: "UTILITY", p_body: "نص طويل كفاية للتجربة" }]);
  assert.deepEqual(J((await w.listTemplateRequests(d2)).requests), [{ name: "a" }]);
  const mc = fs.readFileSync("supabase/functions/meta-comments/index.ts", "utf8"), gate = mc.indexOf('["page_manager", "approver", "general_manager", "super_admin"]');
  const a = mc.indexOf('body.action === "wa_template_submit"'); assert(a > gate, "behind the staff role check"); assert(mc.slice(a, a + 260).includes('roles.includes("super_admin")') && mc.slice(a, a + 260).includes("403"), "super_admin only");
}
async function ui() {
  const { chromium } = require("playwright"); const exe = fs.existsSync("/opt/pw-browsers/chromium") ? { executablePath: "/opt/pw-browsers/chromium" } : {};
  const browser = await chromium.launch({ ...exe, args: ["--no-sandbox"] });
  try {
    for (const role of ["super_admin", "reception"]) for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } }), errors = []; page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/*", (r) => { const u = new URL(r.request().url()); if (u.origin === "https://wa.test") { if (u.pathname === "/") return r.fulfill({ contentType: "text/html", body: '<html lang="ar" dir="rtl"><main id="view-container" class="view"></main></html>' }); const f = path.resolve("." + u.pathname); if (f.startsWith(path.resolve("assets") + path.sep) && fs.existsSync(f)) return r.fulfill({ path: f }); } return r.abort(); });
      await page.goto("https://wa.test/"); for (const f of ["styles", "dashboard-theme", "comments-workspace"]) await page.addStyleTag({ url: "/assets/css/" + f + ".css" });
      await page.evaluate((role) => { window.calls = []; window.setInterval = () => 0; window.confirm = () => true; window.alerts = []; window.alert = (x) => alerts.push(x); window.toasts = []; window.SSMPDToast = { show: (x) => toasts.push(x) };
        const old = (h) => new Date(Date.now() - h * 3600e3).toISOString();
        window.fixtures = { social_messages: [{ id: "whatsapp:4", conversation_id: "whatsapp:201000000002", platform: "whatsapp", brand: "sono", sender_id: "201000000002", sender_name: "ميدو", is_page: false, message: "شكراً", status: "replied", sent_at: old(30), bot_state: "ai" }], social_comments: [], social_reply_templates: [], content_items: [], admins: [] };
        window.SSMPDAuth = { currentAdmin: { id: "A1", role } };
        window.SSMPDDb = { client: { from: (name) => { const q = { select() { return q; }, order() { return q; }, limit() { return q; }, eq() { return q; }, in() { return q; }, is() { return q; }, gte() { return q; }, maybeSingle() { return q; }, then(ok, bad) { return Promise.resolve({ data: fixtures[name] || [], error: null }).then(ok, bad); } }; return q; },
          rpc: async () => ({ data: true }), channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel() {},
          functions: { invoke: async (n, p) => { const b = p.body; calls.push(b); if (b.action === "list_templates") return { data: { ok: true, templates: [] } };
            if (b.action === "wa_template_submit") return { data: { ok: true, id: "r1", name: "sono_uti_261124_ab12_ar" } };
            if (b.action === "wa_template_requests") return { data: { ok: true, requests: [{ id: "r1", name: "sono_uti_261124_ab12_ar", category: "UTILITY", text: "أهلاً بحضرتك من سونو", status: "PENDING", submitted_by: "المالك", submitted_at: new Date().toISOString() }, { id: "r0", name: "sono_mar_261124_cd34_ar", category: "MARKETING", text: "نص قديم", status: "REJECTED", reason: "تصنيف غير مناسب", submitted_by: "المالك", submitted_at: new Date().toISOString() }] } };
            return { data: { ok: true } }; } } } }; }, role);
      await page.addScriptTag({ path: "assets/js/render-comments.js" }); await page.evaluate(() => SSMPDRenderComments.render(document.querySelector("main")));
      await page.waitForSelector('[data-section="messages"]'); await page.locator('[data-section="messages"]').click(); await page.waitForSelector(".cm-conv"); await page.locator(".cm-conv", { hasText: "ميدو" }).click(); await page.waitForSelector("[data-wa-load-tpl]");
      if (role !== "super_admin") { // rule 9: hidden for everyone but the owner
        assert.equal(await page.locator("[data-wa-new-tpl]").count(), 0); assert.equal(await page.locator("[data-wa-req-load]").count(), 0); assert.equal(await page.locator(".cm-tpl-admin").count(), 0);
        assert.deepEqual(errors, []); await page.close(); continue; }
      await page.locator("[data-wa-new-tpl]").click(); await page.waitForSelector("[data-wa-form]");
      assert.match(await page.locator(".cm-warn").innerText(), /بيانات مريض/);
      await page.locator("[data-wa-form-send]").click(); assert.match(await page.locator("[data-wa-form-err]").innerText(), /قصير/); assert.equal(await page.evaluate(() => calls.filter((c) => c.action === "wa_template_submit").length), 0, "client check blocks");
      await page.locator("[data-wa-form-text]").fill("كلمنا على 01012345678"); await page.locator("[data-wa-form-send]").click(); assert.match(await page.locator("[data-wa-form-err]").innerText(), /تليفون/);
      await page.locator("[data-wa-form-text]").fill("أهلاً بحضرتك من مركز سونو، حاولنا نتواصل معاك بخصوص حجزك."); assert.match(await page.locator("[data-wa-preview]").innerText(), /حاولنا نتواصل/);
      await page.locator('input[name="wa-cat"][value="MARKETING"]').check(); await page.locator('input[name="wa-cat"][value="UTILITY"]').check();
      await page.locator("[data-wa-form-send]").click(); await page.waitForSelector(".cm-req");
      assert.deepEqual(await page.evaluate(() => calls.find((c) => c.action === "wa_template_submit")), { action: "wa_template_submit", category: "UTILITY", text: "أهلاً بحضرتك من مركز سونو، حاولنا نتواصل معاك بخصوص حجزك." });
      assert.equal(await page.locator("[data-wa-form]").count(), 0, "form closes after submit"); assert(await page.evaluate(() => toasts.some((t) => /الطابور/.test(t))));
      assert.equal(await page.locator(".cm-req").count(), 2); assert.match(await page.locator(".cm-badge.st-PENDING").innerText(), /بانتظار مراجعة ميتا/); assert.match(await page.locator(".cm-req", { hasText: "cd34" }).innerText(), /مرفوض[\s\S]*تصنيف غير مناسب/);
      assert.equal(await page.locator("[data-wa-tpl]").count(), 0, "the picker offers approved templates only (none here)");
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no sideways scroll @" + width);
      assert(!/[٠-٩]/.test(await page.locator(".cm-wrap").innerText()), "English digits"); assert.deepEqual(errors, []); await page.close();
    }
  } finally { await browser.close(); }
}
(async () => { await migration(); await edge(); await ui();
  console.log("PASS WhatsApp template requests: migration (owner-only, text checks, name/dup/rate limit, lease/ack/sync, picker sync, audit, grants, rollback), whatsapp-sync + meta-comments routing behind super_admin, UI button hidden for reception and working for the owner at 1280+390."); })().catch((e) => { console.error(e); process.exit(1); });
