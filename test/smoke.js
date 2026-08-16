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

const TABLES = {
  admins: [ME, DESIGNER],
  content_items: [
    { id: "c1", title: "بوست تجريبي", body: "نص تجريبي", stage: "idea_selection", created_by: ME.id, assigned_designer: null, design_file_url: null, published_url: null, published_by: null, published_at: null, created_at: now, updated_at: now },
    { id: "c2", title: "بوست منشور", body: "نص", stage: "published", created_by: ME.id, assigned_designer: DESIGNER.id, design_file_url: "https://drive.google.com/x", published_url: "https://instagram.com/p/x", published_by: ME.id, published_at: now, created_at: now, updated_at: now }
  ],
  comments: [],
  activity_log: [],
  weekly_social_metrics: [
    { id: "w1", week_start: "2026-08-10", reach: 1200, engagement_rate: 3.4, new_followers: 22, entered_by: ME.id, created_at: now }
  ]
};

function matchFilters(row, filters) {
  return filters.every(([col, val]) => row[col] === val);
}

class FakeQuery {
  constructor(table) { this.table = table; this._filters = []; this._order = null; this._limit = null; this._single = false; this._maybeSingle = false; this._op = "select"; this._payload = null; }
  select() { return this; }
  eq(col, val) { this._filters.push([col, val]); return this; }
  order(col, opts) { this._order = { col, asc: !opts || opts.ascending !== false }; return this; }
  limit(n) { this._limit = n; return this; }
  single() { this._single = true; return this; }
  maybeSingle() { this._maybeSingle = true; return this; }
  insert(row) { this._op = "insert"; this._payload = row; return this; }
  update(patch) { this._op = "update"; this._payload = patch; return this; }
  delete() { this._op = "delete"; return this; }
  upsert(row) { this._op = "upsert"; this._payload = row; return this; }
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
          const key = this._payload.week_start;
          let row = store.find(r => r.week_start === key);
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

        console.log(process.exitCode ? "\n--- في أخطاء فوق ---" : "\n✅ كل اختبارات الدخان عدّت بنجاح");
      }, 150);
    }, 150);
  }, 150);
}, 150);
