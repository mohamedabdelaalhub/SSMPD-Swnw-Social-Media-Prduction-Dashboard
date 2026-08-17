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
        const store = TABLES[this.table];
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
window.fetch = () => Promise.resolve({ json: () => Promise.resolve({ ok: true }) });

const files = [
  "config.js", "assets/js/toast.js", "assets/js/db.js", "assets/js/roles.js", "assets/js/workflow.js",
  "assets/js/auth.js", "assets/js/drive.js", "assets/js/comments.js",
  "assets/js/render-summary.js", "assets/js/render-production.js", "assets/js/render-review.js",
  "assets/js/render-design.js", "assets/js/render-publish.js", "assets/js/render-archive.js",
  "assets/js/render-admin.js", "assets/js/app.js"
];

files.forEach(f => {
  const code = fs.readFileSync(path.join(ROOT, f), "utf8");
  window.eval(code);
});

// شغّل bootstrap زي DOMContentLoaded
window.document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true, cancelable: true }));

setTimeout(() => {
  const rootEl = window.document.getElementById("app-root");
  const text = rootEl.innerHTML;

  assert(/SSMPD/.test(text), "الشِل العام اترسم (لوجو SSMPD ظاهر)");
  assert(/سوبر أدمن/.test(text), "بادچ الدور ظاهر (سوبر أدمن)");
  // .tab-btn دلوقتي بتتكرر مرتين (شريط التابات العادي + نسخة جوه قائمة الموبايل المنسدلة الجديدة)
  assert(rootEl.querySelectorAll("#tabs-bar .tab-btn").length === 7, "كل الـ 7 تابات ظاهرة للسوبر أدمن (بما فيهم تاب النشر الجديد)");
  assert(rootEl.querySelectorAll("#mobile-menu .tab-btn").length === 7, "نسخة التابات جوه قائمة الموبايل المنسدلة كمان كاملة (٧)");
  assert(rootEl.querySelector(".menu-toggle") != null, "زرار القائمة المنسدلة (اسم+سهم) للموبايل ظاهر في الشِل");
  assert(rootEl.querySelector("#mobile-menu .mm-name") != null && rootEl.querySelector("#mobile-menu .mm-role") != null, "القائمة المنسدلة فيها الاسم والدور بالترتيب المطلوب");

  setTimeout(() => {
    const view = window.document.getElementById("view-container");
    assert(/الملخص العام/.test(view.innerHTML), "تاب الملخص العام هو الافتراضي واترسم");
    assert(/إجمالي المحتوى/.test(view.innerHTML), "مؤشرات إنتاج المحتوى ظاهرة");
    assert(/الإعلانات المدفوعة/.test(view.innerHTML), "سكشن الإعلانات المدفوعة ظاهر في الملخص العام");
    assert(/New Traffic Campaign/.test(view.innerHTML), "اسم الحملة المستوردة ظاهر في جدول الإعلانات المدفوعة");
    assert(/إجمالي المبلغ المُنفق/.test(view.innerHTML), "مؤشر إجمالي المبلغ المُنفق ظاهر");
    assert(!!window.document.getElementById("import-ads-btn"), "زرار استيراد تقرير حملات إعلانات ظاهر للسوبر أدمن");

    // اختبار التنقل لتاب الأرشيف
    const archiveBtn = [...rootEl.querySelectorAll(".tab-btn")].find(b => b.getAttribute("data-tab") === "archive");
    archiveBtn.click();

    setTimeout(() => {
      assert(/الأرشيف/.test(view.innerHTML), "تاب الأرشيف اترسم بعد الضغط");
      assert(/بوست منشور/.test(view.innerHTML), "المادة المنشورة ظاهرة في كالندر الأرشيف");

      // اختبار تاب الإدارة (Kanban)
      const reviewBtn = [...rootEl.querySelectorAll(".tab-btn")].find(b => b.getAttribute("data-tab") === "review");
      reviewBtn.click();
      setTimeout(() => {
        assert(rootEl.querySelectorAll(".kanban-col").length === 8, "٨ أعمدة Kanban ظاهرة في شاشة إدارة المحتوى (بعد إضافة مرحلة مجدولة للنشر)");
        assert(/بوست تجريبي/.test(view.innerHTML), "المادة في مرحلة اختيار الفكرة ظاهرة في العمود الصحيح");
        assert(/سونو/.test(view.innerHTML) && /د\.دينا/.test(view.innerHTML), "بادچ تمييز سونو/د.دينا ظاهر في شاشة إدارة المحتوى");
        assert(!/جاهز للنشر<\/h3>/.test(view.innerHTML), "سكشن \"جاهز للنشر\" القديم اتشال من شاشة إدارة المحتوى (اتنقل لتاب النشر)");

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

          // اختبار تاب النشر نفسه — المادة c3 (جاهزة للنشر) لازم تظهر بمحتواها وتصميمها المعتمد
          const publishBtn = [...rootEl.querySelectorAll(".tab-btn")].find(b => b.getAttribute("data-tab") === "publish");
          publishBtn.click();
          setTimeout(() => {
            assert(/النشر<\/h2>/.test(view.innerHTML), "تاب النشر اترسم");
            assert(/بوست جاهز للنشر/.test(view.innerHTML), "المادة الجاهزة للنشر (c3) ظاهرة في تاب النشر");
            assert(/فتح ملف التصميم المعتمد/.test(view.innerHTML), "لينك التصميم المعتمد ظاهر مع المادة");
            assert(!!window.document.getElementById("pb-brand-c3"), "دروب داون اختيار الصفحة ظاهر لمادة جاهزة للنشر");
            assert(!!window.document.getElementById("pb-platform-c3"), "دروب داون اختيار المنصة ظاهر لمادة جاهزة للنشر");
            assert(!!window.document.getElementById("pb-when-c3"), "خانة معاد النشر المجدول ظاهرة لمادة جاهزة للنشر");
            assert(!!window.document.querySelector('[data-schedule="c3"]'), "زرار \"جدولة\" ظاهر لمادة جاهزة للنشر");

            // محاكاة عملية جدولة كاملة
            const brandSel = window.document.getElementById("pb-brand-c3");
            brandSel.value = "sono";
            const platformSel = window.document.getElementById("pb-platform-c3");
            platformSel.value = "instagram";
            const whenInput = window.document.getElementById("pb-when-c3");
            whenInput.value = "2026-09-01T10:00";
            window.document.querySelector('[data-schedule="c3"]').click();

            setTimeout(() => {
              const c3 = TABLES.content_items.find(i => i.id === "c3");
              assert(c3.stage === "scheduled", "المادة c3 بقت في حالة \"مجدولة\" في قاعدة البيانات المموّهة بعد الجدولة");
              assert(!!c3.scheduled_publish_at, "معاد النشر المجدول اتسجّل على المادة");
              assert(!!window.document.querySelector('[data-confirm-publish="c3"]'), "زرار \"تأكيد النشر\" ظهر للمادة بعد ما بقت مجدولة");
              assert(!!window.document.querySelector('[data-cancel-schedule="c3"]'), "زرار \"إلغاء الجدولة\" ظهر للمادة بعد ما بقت مجدولة");

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
            }, 150);
          }, 150);
        }, 150);
      }, 150);
    }, 150);
  }, 150);
}, 150);
