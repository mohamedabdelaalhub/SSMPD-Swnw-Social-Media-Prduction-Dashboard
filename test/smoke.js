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
  ]
};

function matchFilters(row, filters) {
  return filters.every(([col, val, op]) => {
    if (op === "ilike") return String(row[col] == null ? "" : row[col]).toLowerCase() === String(val).toLowerCase();
    return row[col] === val;
  });
}

class FakeQuery {
  constructor(table) { this.table = table; this._filters = []; this._order = null; this._limit = null; this._single = false; this._maybeSingle = false; this._op = "select"; this._payload = null; }
  select() { return this; }
  eq(col, val) { this._filters.push([col, val]); return this; }
  is(col, val) { this._filters.push([col, val]); return this; }
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
  "config.js", "assets/js/db.js", "assets/js/roles.js", "assets/js/workflow.js",
  "assets/js/auth.js", "assets/js/drive.js", "assets/js/comments.js",
  "assets/js/render-summary.js", "assets/js/render-production.js", "assets/js/render-review.js",
  "assets/js/render-design.js", "assets/js/render-archive.js", "assets/js/render-admin.js",
  "assets/js/app.js"
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
  assert(rootEl.querySelectorAll(".tab-btn").length === 6, "كل الـ 6 تابات ظاهرة للسوبر أدمن");

  setTimeout(() => {
    const view = window.document.getElementById("view-container");
    assert(/الملخص العام/.test(view.innerHTML), "تاب الملخص العام هو الافتراضي واترسم");
    assert(/إجمالي المحتوى/.test(view.innerHTML), "مؤشرات إنتاج المحتوى ظاهرة");

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
        assert(rootEl.querySelectorAll(".kanban-col").length === 7, "٧ أعمدة Kanban ظاهرة في شاشة إدارة المحتوى");
        assert(/بوست تجريبي/.test(view.innerHTML), "المادة في مرحلة اختيار الفكرة ظاهرة في العمود الصحيح");
        assert(/سونو/.test(view.innerHTML) && /د\.دينا/.test(view.innerHTML), "بادچ تمييز سونو/د.دينا ظاهر في شاشة إدارة المحتوى");
        assert(/جاهز للنشر/.test(view.innerHTML), "سكشن \"جاهز للنشر\" ظاهر في شاشة إدارة المحتوى");
        assert(/بوست جاهز للنشر/.test(view.innerHTML), "المادة اللي في مرحلة جاهز للنشر ظاهرة في السكشن الجديد");
        assert(rootEl.querySelectorAll('[id^="ready-brand-"]').length >= 1, "دروب داون اختيار الصفحة ظاهر في سكشن جاهز للنشر");
        assert(rootEl.querySelectorAll('[id^="ready-platform-"]').length >= 1, "دروب داون اختيار المنصة ظاهر في سكشن جاهز للنشر");

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
