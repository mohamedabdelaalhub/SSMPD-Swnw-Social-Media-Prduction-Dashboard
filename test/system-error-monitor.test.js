// اختبار مراقب الأخطاء: 401/403 جنب انقطاع = مؤقت، والتنبيه العائم للسوبر أدمن بس
const { JSDOM } = require("jsdom");
const fs = require("fs");
const assert = require("assert");
const src = fs.readFileSync(__dirname + "/../assets/js/system-error-monitor.js", "utf8");

function boot(role, responses) {
  const dom = new JSDOM("<!doctype html><body><div id='view-container'><h1>الليدز</h1></div></body>", { url: "https://dashboard.example/", runScripts: "outside-only" });
  const w = dom.window;
  let i = 0;
  w.fetch = () => { const r = responses[i++]; return r === "net" ? Promise.reject(new TypeError("Failed to fetch")) : Promise.resolve({ ok: r < 400, status: r }); };
  w.SSMPDAuth = { currentAdmin: role ? { role } : null };
  w.eval(src);
  return w;
}
(async () => {
  // 1) 403 حقيقي لسوبر أدمن بدون أي انقطاع → صلاحية + تنبيه عائم
  let w = boot("super_admin", [403]);
  await w.fetch("https://api.example/functions/v1/leads-list").catch(() => {});
  let e = w.SWNWErrorMonitor.getRecent()[0];
  assert.equal(e.title, "صلاحية غير كافية");
  assert.ok(e.technical.includes("/functions/v1/leads-list"));
  assert.ok(w.document.getElementById("swnw-error-diagnostic-hint"));
  assert.equal(w.SWNWErrorMonitor.getStatus().level, "orange");

  // 2) 403 وبعده انقطاع شبكة → الـ403 يتعاد تصنيفه كمؤقت والمؤشر مايفضلش برتقالي عشانه
  w = boot("super_admin", [403, "net", 200]);
  await w.fetch("https://api.example/functions/v1/leads-list").catch(() => {});
  await w.fetch("https://api.example/rest/v1/x").catch(() => {});
  let items = w.SWNWErrorMonitor.getRecent();
  const auth = items.find((x) => x.status === 403);
  assert.equal(auth.transient, true);
  assert.notEqual(auth.title, "صلاحية غير كافية");
  await w.fetch("https://api.example/rest/v1/x");
  assert.equal(w.SWNWErrorMonitor.getStatus().level, "green");

  // 3) 503 من الخادم ثم 401 → مؤقت، مش «الجلسة»/«صلاحية»
  w = boot("super_admin", [503, 401]);
  await w.fetch("https://api.example/functions/v1/a");
  await w.fetch("https://api.example/functions/v1/b");
  assert.equal(w.SWNWErrorMonitor.getRecent()[0].transient, true);

  // 4) موظف عادي: مفيش تنبيه عائم
  w = boot("reception", [403]);
  await w.fetch("https://api.example/functions/v1/leads-list");
  assert.equal(w.document.getElementById("swnw-error-diagnostic-hint"), null);

  // 5) نص «Method not allowed» مع كود 405 مايتصنفش صلاحية
  w = boot("super_admin", [405]);
  await w.fetch("https://api.example/functions/v1/x");
  assert.notEqual(w.SWNWErrorMonitor.getRecent()[0].title, "صلاحية غير كافية");
  w.SWNWErrorMonitor.record("toast", "Method not allowed", {});
  assert.notEqual(w.SWNWErrorMonitor.getRecent()[0].title, "صلاحية غير كافية");
  console.log("system-error-monitor tests: ok");
})().catch((err) => { console.error(err); process.exit(1); });
