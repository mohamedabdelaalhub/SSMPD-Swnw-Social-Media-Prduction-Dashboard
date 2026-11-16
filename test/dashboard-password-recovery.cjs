// Reset link -> PASSWORD_RECOVERY: the dashboard must keep the recovery session until the new
// password is saved (live bug 2026-11-16: boot failure signed it out -> 'Auth session missing!').
// Harness copied from test/smoke.js (fake Supabase, real dashboard scripts).
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

const RECOVERY = { signOut: 0, updated: [] };
const fakeClient = {
  from(table) { return new FakeQuery(table); },
  auth: {
    getSession: () => Promise.resolve({ data: { session: { user: { id: ME.user_id, email: ME.email } } } }),
    signInWithPassword: () => Promise.resolve({ data: {}, error: null }),
    signUp: () => Promise.resolve({ data: {}, error: null }),
    signOut: () => { RECOVERY.signOut++; return Promise.resolve({ error: null }); },
    updateUser: (o) => { RECOVERY.updated.push(o); return Promise.resolve({ data: { user: {} }, error: null }); },
    onAuthStateChange: (cb) => { setTimeout(() => cb("PASSWORD_RECOVERY", { user: { id: ME.user_id } }), 50); return { data: { subscription: { unsubscribe() {} } } }; }
  },
  rpc(name) {
    const basic = TABLES.admins.map(a => ({ id: a.id, name: a.name, email: a.email, role: a.role, active: a.active }));
    const answers = { personal_home_snapshot:{generated_at:now,tasks:null,content:{approval:0,design:0,revision:0,publish:0,items:[]},supplies:[]}, personal_home_inbox:{notices:[],unread:0,limited:false}, list_admins_basic: basic, list_designers_all: basic.filter(a => a.role === "designer"), my_admin_id: ME.id, is_super: true, my_role: ME.role };
    return Promise.resolve({ data: name in answers ? answers[name] : [], error: null });
  },
  storage: { from() { return { upload: () => Promise.resolve({ data: {}, error: null }), createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://example.test/x" }, error: null }), remove: () => Promise.resolve({ data: [], error: null }) }; } },
  functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
  channel() { return { on() { return this; }, subscribe() { return this; } }; },
  removeChannel() {}
};

// ---------- jsdom ----------
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const dom = new JSDOM(html, { url: "https://example.test/#access_token=fake&type=recovery", runScripts: "outside-only", pretendToBeVisual: true });
const { window } = dom;
window.onerror = (msg, src, line, col, err) => { console.error("WINDOW ERROR:", msg, line, err && err.stack); process.exitCode = 1; };
process.on("unhandledRejection", (e) => { console.error("UNHANDLED:", e && e.stack || e); process.exitCode = 1; });

// نضحّي بمكتبة Supabase الحقيقية ونحقن نسخة مموّهة قبل تحميل db.js
// Use a fake configuration regardless of checkout contents; never load live config or external resources.
window.SSMPD_CONFIG = { supabase: { url: "https://supabase.test.invalid", anonKey: "fake-test-key" } };
window.supabase = { createClient: () => fakeClient };
// Edge functions answer with an empty, successful JSON (the smoke test checks the screens, not the functions).
window.fetch = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve({ ok: true }), text: () => Promise.resolve("{}"), blob: () => Promise.resolve(new window.Blob([])) });

// Load the dashboard scripts exactly as index.html does (same order), skipping CDN libraries.
const files = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1].split("?")[0])
  .filter(src => src !== "config.js" && !/^https?:/.test(src) && fs.existsSync(path.join(ROOT, src)));

files.forEach(f => {
  const code = fs.readFileSync(path.join(ROOT, f), "utf8");
  // Some files find their assets through document.currentScript.src, like a real <script> tag.
  Object.defineProperty(window.document, "currentScript", { configurable: true, get: () => ({ src: "https://example.test/" + f }) });
  window.eval(code + "\n//# sourceURL=" + f);
});

// شغّل bootstrap زي DOMContentLoaded
window.document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true, cancelable: true }));


// Make the normal dashboard boot fail, as it did live right after a reset link.
const realLoad = window.SSMPDAuth.loadCurrentAdmin;
window.SSMPDAuth.loadCurrentAdmin = () => Promise.reject(new Error("boom during boot"));
setTimeout(() => {
  const modal = window.document.getElementById("cp-save");
  assert(!!modal, "change-password modal opens from the reset link");
  assert(RECOVERY.signOut === 0, "the recovery session is NOT signed out while the modal is open");
  window.document.getElementById("cp-pass1").value = "NewPass12345";
  window.document.getElementById("cp-pass2").value = "NewPass12345";
  window.SSMPDAuth.loadCurrentAdmin = realLoad;
  modal.click();
  setTimeout(() => {
    assert(RECOVERY.updated.length === 1 && RECOVERY.updated[0].password === "NewPass12345", "new password saved with the recovery session");
    assert(RECOVERY.signOut === 0, "still no sign-out");
    assert(!!window.document.querySelector("#app-root .tab-btn, #app-root .personal-home"), "dashboard boots after the password is saved");
    console.log("✓ password recovery keeps its session, saves, then boots the dashboard");
    process.exit(process.exitCode || 0);
  }, 900);
}, 900);
