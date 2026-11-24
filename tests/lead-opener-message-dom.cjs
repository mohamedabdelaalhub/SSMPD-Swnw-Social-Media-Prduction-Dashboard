// Ready opening messages in the lead modal (owner 2026-11-25): right text per lead (laser/physio), staff name filled, a Facebook-sourced
// name is NOT written into the message, copy + «افتح واتساب» work, nothing is sent (no RPC/function call), English digits.
const fs = require("fs"), path = require("path"), assert = require("node:assert/strict");
(async () => {
  const { chromium } = require("playwright"); const exe = fs.existsSync("/opt/pw-browsers/chromium") ? { executablePath: "/opt/pw-browsers/chromium" } : {};
  const browser = await chromium.launch({ ...exe, args: ["--no-sandbox"] });
  try {
    for (const role of ["customer_service", "reception"]) for (const width of [1280, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } }), errors = []; page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/*", (r) => { const u = new URL(r.request().url()); if (u.origin === "https://ld.test") { if (u.pathname === "/") return r.fulfill({ contentType: "text/html", body: '<html lang="ar" dir="rtl"><body><main id="view-container"></main></body></html>' }); const f = path.resolve("." + u.pathname); if (f.startsWith(path.resolve("assets") + path.sep) && fs.existsSync(f)) return r.fulfill({ path: f }); } return r.abort(); });
      await page.goto("https://ld.test/"); for (const f of ["styles", "dashboard-theme"]) await page.addStyleTag({ url: "/assets/css/" + f + ".css" });
      await page.evaluate((role) => {
        window.calls = []; window.opened = []; window.copied = []; window.toasts = []; window.SSMPDToast = { show: (x) => toasts.push(x) };
        window.open = (u, t, f) => { opened.push([u, t, f]); return null; };
        Object.defineProperty(navigator, "clipboard", { value: { writeText: (t) => { copied.push(t); return Promise.resolve(); } }, configurable: true });
        const leads = { L1: { id: "L1", customer_name: "منى أحمد", phone_raw: "01012345678", phone_normalized: "+201012345678", source: "facebook_form", current_status: "new", priority: "normal", patient_type: "new", interested_service: "cosmetic_laser", created_at: new Date().toISOString() },
          L2: { id: "L2", customer_name: "Mona Ahmed Ali", customer_name_source: "facebook", phone_raw: "01099998888", phone_normalized: "+201099998888", source: "messenger", current_status: "new", priority: "normal", patient_type: "new", interested_service: "physiotherapy", created_at: new Date().toISOString() },
          L3: { id: "L3", customer_name: "سارة", phone_raw: "abc", phone_normalized: null, source: "phone", current_status: "new", priority: "normal", patient_type: "new", created_at: new Date().toISOString() } };
        const q = (name) => { const st = {}; const o = { select() { return o; }, eq(k, v) { st[k] = v; return o; }, single() { return Promise.resolve({ data: leads[st.id], error: null }); }, order() { return o; }, limit() { return o; }, in() { return o; }, then(ok, bad) { return Promise.resolve({ data: [], error: null }).then(ok, bad); } }; return o; };
        window.SSMPDAuth = { currentAdmin: { id: "A1", name: "منى خدمة العملاء", role } };
        window.SSMPDDb = { client: { from: q, rpc: async (n) => { calls.push(n); return { data: null }; }, functions: { invoke: async (n) => { calls.push(n); return { data: {} }; } }, channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel() {} },
          listLeadAttempts: async () => [], listLeadStatusLog: async () => [], listLeadInvoices: async () => [], listEmployees: async () => [], listAdmins: async () => [] };
        window.SSMPDRoles = { hasRole: (a, r) => a.role === r, hasAnyRole: (a, rs) => rs.indexOf(a.role) !== -1, rolesOf: (a) => [a.role] };
      }, role);
      await page.addScriptTag({ path: "assets/js/render-leads.js" });
      for (const [id, kind, expectName, staffInText] of [["L1", "laser", "منى أحمد", true], ["L2", "physio", null, true]]) {
        await page.evaluate((id) => SSMPDRenderLeads.openLeadById(id), id); await page.waitForSelector("[data-opener]");
        assert.equal(await page.locator("#op-kind").inputValue(), kind, id + " kind");
        const t = await page.locator("#op-text").inputValue();
        assert(t.includes("معاك منى خدمة العملاء من مركز عيادات سونو التخصصية، فرع حدائق الأهرام"), "staff name filled");
        assert(!/\{staff\}|\[اسم الموظف\]/.test(t), "no placeholder left");
        if (expectName) assert(t.startsWith("أهلاً بحضرتك " + expectName), "name used when it is the customer's own"); else assert(t.startsWith("أهلاً بحضرتك،") && !t.includes("Mona"), "Facebook name is not written in the message");
        assert.equal(/إعلان الليزر/.test(t), kind === "laser"); assert.equal(/العلاج الطبيعي/.test(t), kind === "physio");
        await page.locator("#op-copy").click(); await page.waitForFunction(() => copied.length > 0); assert.equal(await page.evaluate(() => copied[copied.length - 1]), await page.locator("#op-text").inputValue()); assert(await page.evaluate(() => toasts.includes("اتنسخت الرسالة")));
        await page.locator("#op-text").fill("نص معدّل يدوي"); await page.locator("#op-wa").click();
        const op = await page.evaluate(() => opened[opened.length - 1]); assert.equal(op[0], "https://wa.me/" + (id === "L1" ? "201012345678" : "201099998888") + "?text=" + encodeURIComponent("نص معدّل يدوي")); assert.equal(op[2], "noopener");
        await page.locator("#op-kind").selectOption(kind === "laser" ? "physio" : "laser"); assert.notEqual(await page.locator("#op-text").inputValue(), "نص معدّل يدوي", "switching the type refills the text");
        if (id === "L2") assert.match(await page.locator("[data-opener]").innerText(), /اسأل العميل عن اسمه/);
        assert.equal(await page.evaluate(() => calls.length), 0, "nothing is sent from the dashboard");
        await page.locator(".modal-close").click();
      }
      await page.evaluate(() => SSMPDRenderLeads.openLeadById("L3")); await page.waitForSelector("[data-opener]");
      assert.equal(await page.locator("#op-wa").isDisabled(), true, "no valid phone -> no WhatsApp button"); assert.equal(await page.locator("#op-kind").inputValue(), "physio");
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "no sideways scroll @" + width);
      assert(!/[٠-٩]/.test(await page.locator("[data-opener]").innerText()), "English digits"); assert.deepEqual(errors, [], role + " " + width); await page.close();
    }
  } finally { await browser.close(); }
  console.log("PASS lead opener messages: laser/physio text per lead, staff name filled, Facebook-sourced name not written, copy + wa.me work, nothing sent, 2 roles x 2 widths.");
})().catch((e) => { console.error(e); process.exit(1); });
