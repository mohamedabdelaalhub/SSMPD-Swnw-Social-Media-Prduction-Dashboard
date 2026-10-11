/* اختبار دخان بـ jsdom — بدون متصفح حقيقي، Supabase مموّه بالكامل */
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function assert(cond, msg) {
  if (!cond) { console.error("❌ FAIL: " + msg); process.exitCode = 1; }
  else console.log("✓ " + msg);
}

// ---------- قاعدة بيانات مموّهة في الذاكرة ----------
const now = new Date().toISOString();
const ME = { id: "admin-1", user_id: "user-1", email: "mohamadmh32@gmail.com", name: "محمد عبدالعال", role: "super_admin", active: true, created_at: now };
const DESIGNER = { id: "admin-2", user_id: "user-2", email: "designer@test.com", name: "مصمم تجريبي", role: "designer", active: true, created_at: now };
// دعوة معلّقة — السوبر أدمن ضافها بالإيميل بس، لسه محدش عمل حساب بيها (user_id فاضي)
const PENDING = { id: "admin-3", user_id: null, email: "pending@test.com", name: "موظف جديد", role: "page_manager", active: true, created_at: now };
const GM = { id: "admin-4", user_id: "user-4", email: "gm@test.com", name: "مدير عام تجريبي", role: "general_manager", active: true, created_at: now };

const TABLES = {
  admins: [ME, DESIGNER, PENDING, GM],
  content_items: [
    { id: "c1", title: "بوست تجريبي", body: "نص تجريبي", stage: "idea_selection", created_by: ME.id, assigned_designer: null, design_file_url: null, design_received_at: null, brand: "sono", publish_platform: null, stage_history: [{ stage: "idea_selection", at: now }], published_url: null, published_by: null, published_at: null, created_at: now, updated_at: now },
    { id: "c2", title: "بوست منشور", body: "نص", stage: "published", created_by: ME.id, assigned_designer: DESIGNER.id, design_file_url: "https://drive.google.com/x", design_received_at: now, brand: "dr_dina", publish_platform: "instagram", stage_history: [{ stage: "idea_selection", at: now }, { stage: "published", at: now }], published_url: "https://instagram.com/p/x", published_by: ME.id, published_at: now, created_at: now, updated_at: now },
    { id: "c3", title: "بوست جاهز للنشر", body: "نص", stage: "ready_to_publish", created_by: ME.id, assigned_designer: DESIGNER.id, design_file_url: "https://drive.google.com/y", design_received_at: now, brand: "sono", publish_platform: null, stage_history: [{ stage: "idea_selection", at: now }, { stage: "ready_to_publish", at: now }], published_url: null, published_by: null, published_at: null, created_at: now, updated_at: now }
  ],
  comments: [],
  comment_reads: [],
  activity_log: [],
  weekly_social_metrics: [
    { id: "w1", week_start: "2026-08-10", reach: 1200, engagement_rate: 3.4, new_followers: 22, entered_by: ME.id, created_at: now }
  ],
  ad_campaigns: [
    { id: "ad1", campaign_name: "New Traffic Campaign", amount_spent: 1421.99, impressions: 83943, reach: 52634, results: 4992, result_indicator: "actions:link_click", cost_per_result: 0.28, link_clicks: 254, ctr: 5.95, reporting_start: "2025-01-01", reporting_end: "2026-08-02", imported_by: ME.id, created_at: now }
  ]
};

function matchFilters(row, filters) {
  return filters.every(([col, val, op]) => {
    if (op === "ilike") return String(row[col] == null ? "" : row[col]).toLowerCase() === String(val).toLowerCase();
    if (op === "neq") return row[col] !== val;
    if (op === "in") return (val || []).includes(row[col]);
    if (op === "gte") return row[col] != null && row[col] >= val;
    if (op === "lte") return row[col] != null && row[col] <= val;
    if (op === "gt") return row[col] != null && row[col] > val;
    if (op === "lt") return row[col] != null && row[col] < val;
    return row[col] === val;
  });
}

class FakeQuery {
  constructor(table) { this.table = table; this._filters = []; this._order = null; this._limit = null; this._single = false; this._maybeSingle = false; this._op = "select"; this._payload = null; }
  select() { return this; }
  eq(col, val) { this._filters.push([col, val]); return this; }
  is(col, val) { this._filters.push([col, val]); return this; }
  neq(col, val) { this._filters.push([col, val, "neq"]); return this; }
  ilike(col, val) { this._filters.push([col, val, "ilike"]); return this; }
  in(col, val) { this._filters.push([col, val, "in"]); return this; }
  gte(col, val) { this._filters.push([col, val, "gte"]); return this; }
  lte(col, val) { this._filters.push([col, val, "lte"]); return this; }
  gt(col, val) { this._filters.push([col, val, "gt"]); return this; }
  lt(col, val) { this._filters.push([col, val, "lt"]); return this; }
  // Filters the smoke test does not need to model precisely.
  not() { return this; } or() { return this; } contains() { return this; } overlaps() { return this; } filter() { return this; } like() { return this; } textSearch() { return this; }
  range(from, to) { this._limit = to - from + 1; return this; }
  order(col, opts) { this._order = { col, asc: !opts || opts.ascending !== false }; return this; }
  limit(n) { this._limit = n; return this; }
  single() { this._single = true; return this; }
  maybeSingle() { this._maybeSingle = true; return this; }
  insert(row) { this._op = "insert"; this._payload = row; return this; }
  update(patch) { this._op = "update"; this._payload = patch; return this; }
  delete() { this._op = "delete"; return this; }
  upsert(row, opts) { this._op = "upsert"; this._payload = row; this._upsertOpts = opts || {}; return this; }
  _exec() {
    return new Promise((resolve) => {
      try {
        // Tables the fixture doesn't fill (leads, patients, Meta Ads…) start empty.
        const store = TABLES[this.table] || (TABLES[this.table] = []);
        let result;
        if (this._op === "insert") {
          const row = Object.assign({ id: "gen-" + Math.random().toString(36).slice(2), created_at: now, updated_at: now }, this._payload);
          store.push(row);
          result = this._single ? row : [row];
        } else if (this._op === "update") {
          const rows = store.filter(r => matchFilters(r, this._filters));
          rows.forEach(r => Object.assign(r, this._payload, { updated_at: now }));
          result = this._single ? rows[0] : rows;
        } else if (this._op === "delete") {
          const rows = store.filter(r => matchFilters(r, this._filters));
          rows.forEach(r => { const i = store.indexOf(r); if (i > -1) store.splice(i, 1); });
          result = rows;
        } else if (this._op === "upsert") {
          const keyCols = ((this._upsertOpts && this._upsertOpts.onConflict) || "id").split(",").map(s => s.trim());
          let row = store.find(r => keyCols.every(k => r[k] === this._payload[k]));
          if (row) Object.assign(row, this._payload);
          else { row = Object.assign({ id: "gen-" + Math.random().toString(36).slice(2), created_at: now }, this._payload); store.push(row); }
          result = row;
        } else {
          let rows = store.filter(r => matchFilters(r, this._filters));
          if (this._order) rows = rows.slice().sort((a, b) => (a[this._order.col] > b[this._order.col] ? 1 : -1) * (this._order.asc ? 1 : -1));
          if (this._limit) rows = rows.slice(0, this._limit);
          if (this._single) result = rows[0];
          else if (this._maybeSingle) result = rows[0] || null;
          else result = rows;
        }
        resolve({ data: result, error: null });
      } catch (e) {
        resolve({ data: null, error: e });
      }
    });
  }
  then(onFulfilled, onRejected) { return this._exec().then(onFulfilled, onRejected); }
  catch(onRejected) { return this._exec().catch(onRejected); }
}

const fakeClient = {
  from(table) { return new FakeQuery(table); },
  auth: {
    getSession: () => Promise.resolve({ data: { session: { user: { id: ME.user_id, email: ME.email } } } }),
    signInWithPassword: () => Promise.resolve({ data: {}, error: null }),
    signUp: () => Promise.resolve({ data: {}, error: null }),
    signOut: () => Promise.resolve({ error: null }),
    onAuthStateChange: () => {}
  },
  rpc(name) {
    const basic = TABLES.admins.map(a => ({ id: a.id, name: a.name, email: a.email, role: a.role, active: a.active }));
    const answers = { list_admins_basic: basic, list_designers_all: basic.filter(a => a.role === "designer"), my_admin_id: ME.id, is_super: true, my_role: ME.role };
    return Promise.resolve({ data: name in answers ? answers[name] : [], error: null });
  },
  storage: { from() { return { upload: () => Promise.resolve({ data: {}, error: null }), createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://example.test/x" }, error: null }), remove: () => Promise.resolve({ data: [], error: null }) }; } },
  functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
  channel() { return { on() { return this; }, subscribe() { return this; } }; },
  removeChannel() {}
};

// ---------- jsdom ----------
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const dom = new JSDOM(html, { url: "https://example.test/", runScripts: "outside-only", resources: "usable" });
const { window } = dom;
window.onerror = (msg, src, line, col, err) => { console.error("WINDOW ERROR:", msg, line, err && err.stack); };
process.on("unhandledRejection", (e) => console.error("UNHANDLED:", e && e.stack || e));

// نضحّي بمكتبة Supabase الحقيقية ونحقن نسخة مموّهة قبل تحميل db.js
window.supabase = { createClient: () => fakeClient };
// Edge functions answer with an empty, successful JSON (the smoke test checks the screens, not the functions).
window.fetch = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve({ ok: true }), text: () => Promise.resolve("{}"), blob: () => Promise.resolve(new window.Blob([])) });

// Load the dashboard scripts exactly as index.html does (same order), skipping CDN libraries.
const files = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1].split("?")[0])
  .filter(src => !/^https?:/.test(src) && fs.existsSync(path.join(ROOT, src)));

files.forEach(f => {
  const code = fs.readFileSync(path.join(ROOT, f), "utf8");
  // Some files find their assets through document.currentScript.src, like a real <script> tag.
  Object.defineProperty(window.document, "currentScript", { configurable: true, get: () => ({ src: "https://example.test/" + f }) });
  try { window.eval(code + "\n//# sourceURL=" + f); } catch (e) { console.error("LOAD ERROR in " + f + ": " + e.message); }
});

// شغّل bootstrap زي DOMContentLoaded
window.document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true, cancelable: true }));

setTimeout(() => {
  const rootEl = window.document.getElementById("app-root");
  const text = rootEl.innerHTML;

  assert(rootEl.querySelector('#user-dropdown [data-goto="summary"]').textContent.trim() === "إنتاج المحتوى", "اسم إنتاج المحتوى ظاهر في القائمة");
  assert(/سوبر أدمن/.test(text), "بادچ الدور ظاهر (سوبر أدمن)");
  // أرشيف المرضى/إدارة الليدز/لوحة التحكم بقوا تابات القائمة المنسدلة فقط —
  // مش مكررين في شريط التابات العادي ولا قائمة الموبايل القديمة (بالظبط زي
  // ما طلب المستخدم: مكان واحد بس هو القائمة المنسدلة)
  const SOCIAL_TABS = "summary,production,review,design,publish,comments,performance,archive,metaads,mediabuyer";
  assert([...rootEl.querySelectorAll("#tabs-bar .tab-btn")].map(b => b.getAttribute("data-tab")).join() === SOCIAL_TABS, "تابات السوشيال العشرة بس ظاهرة في الشريط العادي (من غير أرشيف المرضى/الليدز/لوحة التحكم)");
  assert(rootEl.querySelectorAll("#mobile-menu .tab-btn").length === 10, "نفس التابات العشرة في قائمة الموبايل");
  assert(!/data-tab="patients"/.test(rootEl.querySelector("#tabs-bar").innerHTML), "أرشيف المرضى مش موجود في شريط التابات العادي");
  assert(!/data-tab="leads"/.test(rootEl.querySelector("#tabs-bar").innerHTML), "إدارة الليدز مش موجودة في شريط التابات العادي");
  assert(rootEl.querySelector('#user-dropdown [data-goto="patients"]') != null, "أرشيف المرضى موجود في القائمة المنسدلة");
  assert(rootEl.querySelector('#user-dropdown [data-goto="leads"]') != null, "إدارة الليدز موجودة في القائمة المنسدلة");
  assert(rootEl.querySelector('#user-dropdown [data-goto="admin"]') != null, "لوحة التحكم موجودة في القائمة المنسدلة");
  assert(rootEl.querySelector(".menu-toggle") != null, "زرار القائمة المنسدلة (اسم+سهم) للموبايل ظاهر في الشِل");
  assert(rootEl.querySelector("#mobile-menu .mm-name") != null && rootEl.querySelector("#mobile-menu .mm-role") != null, "القائمة المنسدلة فيها الاسم والدور بالترتيب المطلوب");

  setTimeout(() => {
    // The screen container is replaced on every tab switch, so always read the current one.
    const V = () => window.document.getElementById("view-container") || { innerHTML: "" };
    const view = V();
    assert(/الملخص العام/.test(V().innerHTML), "تاب الملخص العام هو الافتراضي واترسم");
    assert(/إجمالي المحتوى/.test(V().innerHTML), "مؤشرات إنتاج المحتوى ظاهرة");
    assert(/الإعلانات المدفوعة/.test(V().innerHTML), "سكشن الإعلانات المدفوعة ظاهر في الملخص العام");
    assert(/New Traffic Campaign/.test(V().innerHTML), "اسم الحملة المستوردة ظاهر في جدول الإعلانات المدفوعة");
    assert(/إجمالي المبلغ المُنفق/.test(V().innerHTML), "مؤشر إجمالي المبلغ المُنفق ظاهر");
    assert(!!window.document.getElementById("import-ads-btn"), "زرار استيراد تقرير حملات إعلانات ظاهر للسوبر أدمن");

    // اختبار التنقل لتاب الأرشيف
    const archiveBtn = [...rootEl.querySelectorAll(".tab-btn")].find(b => b.getAttribute("data-tab") === "archive");
    archiveBtn.click();

    setTimeout(() => {
      assert(!!window.document.getElementById("arch-prev") && !!window.document.getElementById("arch-next"), "تاب الأرشيف (الكالندر الشهري) اترسم بعد الضغط");
      assert(/بوست منشور/.test(V().innerHTML), "المادة المنشورة ظاهرة في كالندر الأرشيف");

      // اختبار تاب الإدارة (Kanban)
      const reviewBtn = [...rootEl.querySelectorAll(".tab-btn")].find(b => b.getAttribute("data-tab") === "review");
      reviewBtn.click();
      setTimeout(() => {
        assert(rootEl.querySelectorAll(".kanban-col").length === 8, "٨ أعمدة Kanban ظاهرة في شاشة إدارة المحتوى (بعد إضافة مرحلة مجدولة للنشر)");
        assert(/بوست تجريبي/.test(V().innerHTML), "المادة في مرحلة اختيار الفكرة ظاهرة في العمود الصحيح");
        assert(/سونو/.test(V().innerHTML) && /د\.دينا/.test(V().innerHTML), "بادچ تمييز سونو/د.دينا ظاهر في شاشة إدارة المحتوى");
        assert(!/جاهز للنشر<\/h3>/.test(V().innerHTML), "سكشن \"جاهز للنشر\" القديم اتشال من شاشة إدارة المحتوى (اتنقل لتاب النشر)");

        // تعديل/حذف المادة — السوبر أدمن لازم يشوف زرار "تعديل" و"حذف" في مودال المراجعة
        const firstCard = rootEl.querySelector(".kanban-card[data-id]");
        if (firstCard) firstCard.click();
        setTimeout(() => {
          assert(!!window.document.querySelector('[data-edit-item]'), "زرار \"تعديل\" ظاهر للسوبر أدمن في مودال المراجعة");
          assert(!!window.document.querySelector('[data-delete-item]'), "زرار \"حذف\" ظاهر للسوبر أدمن في مودال المراجعة");
          const closeBtn = window.document.querySelector(".modal-close");
          if (closeBtn) closeBtn.click();

          // دور "مدير عام" الجديد — يشوف كل التابات ما عدا تاب المستخدمين، وله كل صلاحيات المحتوى
          const RolesMod = window.SSMPDRoles;
          assert(RolesMod.canSeeTab("general_manager", "review") && RolesMod.canSeeTab("general_manager", "design") &&
            RolesMod.canSeeTab("general_manager", "production") && RolesMod.canSeeTab("general_manager", "archive") &&
            RolesMod.canSeeTab("general_manager", "summary"), "المدير العام يشوف كل التابات الوظيفية");
          assert(!RolesMod.canSeeTab("general_manager", "admin"), "المدير العام ممنوع من تاب المستخدمين");
          assert(RolesMod.canApprove("general_manager") && RolesMod.canDesign("general_manager") && RolesMod.canCreateContent("general_manager"),
            "المدير العام له صلاحيات الاعتماد/التصميم/إنشاء المحتوى زي السوبر أدمن");

          // تاب النشر الجديد — المصمم ممنوع، والباقي (موظف صفحات/مسؤول اعتماد/مدير عام/سوبر أدمن) مسموح
          assert(!RolesMod.canSeeTab("designer", "publish"), "المصمم ممنوع من تاب النشر (زي ما طلب المستخدم بالظبط)");
          assert(RolesMod.canSeeTab("page_manager", "publish"), "موظف الصفحات يشوف تاب النشر");
          assert(RolesMod.canSeeTab("approver", "publish"), "مسؤول الاعتماد يشوف تاب النشر");
          assert(RolesMod.canSeeTab("general_manager", "publish"), "المدير العام يشوف تاب النشر");
          assert(RolesMod.canSeeTab("super_admin", "publish"), "السوبر أدمن يشوف تاب النشر");

          // تعدد الأدوار: مستخدم روله الأساسي customer_service ومعاه رول إضافي
          // reception (زي مثال المستخدم بالظبط) لازم يشوف صلاحيات الاتنين مع بعض
          const multiRoleAdmin = { role: "customer_service", roles: ["customer_service", "reception"] };
          assert(RolesMod.hasRole(multiRoleAdmin, "reception"), "hasRole بتلاقي الرول الإضافي");
          assert(RolesMod.hasAnyRole(multiRoleAdmin, ["reception", "designer"]), "hasAnyRole بتشتغل مع رول إضافي واحد بس من القائمة");
          assert(RolesMod.canSeeTab(multiRoleAdmin, "leads"), "مستخدم متعدد الأدوار (خدمة عملاء + استقبال) يشوف تاب الليدز");
          assert(!RolesMod.hasRole(multiRoleAdmin, "designer"), "hasRole بترجع false لرول مش موجود عند المستخدم");
          const singleRoleFallback = { role: "designer" }; // من غير .roles خالص — توافق قديم
          assert(RolesMod.hasRole(singleRoleFallback, "designer") && !RolesMod.hasRole(singleRoleFallback, "approver"),
            "لو مفيش .roles أصلاً، rolesOf بترجع [role] بس (توافق قديم)");

          // اختبار تاب النشر نفسه — المادة c3 (جاهزة للنشر) لازم تظهر بمحتواها وتصميمها المعتمد
          const publishBtn = [...rootEl.querySelectorAll(".tab-btn")].find(b => b.getAttribute("data-tab") === "publish");
          publishBtn.click();
          setTimeout(() => {
            assert(/النشر<\/h2>/.test(V().innerHTML), "تاب النشر اترسم");
            assert(!!window.document.querySelector(".pbd-grid, .empty-state") && /كروت الأيام/.test(V().innerHTML), "كروت الأيام هي العرض الأساسي لتاب النشر");
            window.document.getElementById("pb-view-list").click(); // باقي اختبارات الكروت (الجدولة) بتشتغل من عرض القائمة
            assert(/بوست جاهز للنشر/.test(V().innerHTML), "المادة الجاهزة للنشر (c3) ظاهرة في تاب النشر");
            assert(!!window.document.querySelector('[data-publication-preview="c3"]'), "معاينة البوست (النص + التصميم المعتمد) ظاهرة مع المادة");
            assert(!!window.document.getElementById("pb-brand-c3"), "دروب داون اختيار الصفحة ظاهر لمادة جاهزة للنشر");
            assert(!!window.document.getElementById("pb-platform-c3"), "دروب داون اختيار المنصة ظاهر لمادة جاهزة للنشر");
            assert(!!window.document.getElementById("pb-when-c3"), "خانة معاد النشر المجدول ظاهرة لمادة جاهزة للنشر");
            assert(!!window.document.querySelector('[data-schedule="c3"]'), "زرار \"جدولة\" ظاهر لمادة جاهزة للنشر");

            // محاكاة عملية جدولة كاملة
            const brandSel = window.document.getElementById("pb-brand-c3");
            brandSel.value = "sono";
            // المنصات بقت checkboxes، والجدولة بتفتح معاينة لازم تتأكد قبل الحفظ
            const instagram = window.document.getElementById("pb-platform-c3-instagram");
            if (instagram) instagram.checked = true;
            const whenInput = window.document.getElementById("pb-when-c3");
            whenInput.value = "2026-12-01T10:00";
            window.document.querySelector('[data-schedule="c3"]').click();

            setTimeout(() => {
            const confirmPreview = window.document.querySelector("[data-continue]");
            assert(!!confirmPreview, "معاينة \"تأكيد الجدولة\" ظهرت قبل الحفظ");
            if (confirmPreview) confirmPreview.click();

            setTimeout(() => {
              const c3 = TABLES.content_items.find(i => i.id === "c3");
              assert(c3.stage === "scheduled", "المادة c3 بقت في حالة \"مجدولة\" في قاعدة البيانات المموّهة بعد الجدولة");
              assert(!!c3.scheduled_publish_at, "معاد النشر المجدول اتسجّل على المادة");
              assert((TABLES.meta_publish_jobs || []).some(j => j.content_id === "c3"), "اتعمل job نشر تلقائي لانستجرام للمادة المجدولة");
              assert(!!window.document.querySelector('[data-cancel-schedule="c3"]'), "زرار \"إلغاء الجدولة\" ظهر للمادة بعد ما بقت مجدولة (حتى والنشر التلقائي مستني)");

              // موظف جديد اتضاف بالإيميل بس من السوبر أدمن (دعوة معلّقة user_id=null)،
              // وبعدين عمل حساب لأول مرة — لازم يترّبط تلقائياً بصف الدعوة المعلّقة (claimInvite)
              window.SSMPDAuth.loadCurrentAdmin("user-3", "PENDING@Test.com").then((claimed) => {
                assert(claimed && claimed.user_id === "user-3", "الدعوة المعلّقة اترّبطت تلقائياً بالحساب الجديد بعد التسجيل (claimInvite)");
                assert(claimed.role === "page_manager", "دور الموظف اتحفظ صح بعد الربط");

                console.log(process.exitCode ? "\n--- في أخطاء فوق ---" : "\n✅ كل اختبارات الدخان عدّت بنجاح");
                process.exit(process.exitCode || 0);
              }).catch((e) => {
                assert(false, "ربط الدعوة المعلّقة اتنفذ من غير أخطاء: " + e.message);
                console.log("\n--- في أخطاء فوق ---");
                process.exit(1);
              });
            }, 700);
            }, 700);
          }, 700);
        }, 700);
      }, 700);
    }, 700);
  }, 700);
}, 700);
