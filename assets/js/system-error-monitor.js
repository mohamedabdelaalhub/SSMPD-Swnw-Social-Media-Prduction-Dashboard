/* SWNW — lightweight client-side error monitor for System Diagnostics */
(function () {
  "use strict";
  if (window.__SWNWSystemErrorMonitor) return;
  window.__SWNWSystemErrorMonitor = true;

  var STORAGE_KEY = "swnw_system_errors_v1";
  var MAX_ITEMS = 20;
  var lastAction = null;
  var lastFingerprint = "";
  var lastFingerprintAt = 0;

  function cleanText(value, max) {
    var s = String(value == null ? "" : value);
    s = s.replace(/eyJ[A-Za-z0-9_\-.]{20,}/g, "[token-hidden]");
    s = s.replace(/([?&](?:apikey|api_key|token|access_token|refresh_token|key|secret)=)[^&#\s]+/ig, "$1[hidden]");
    s = s.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig, "[email-hidden]");
    s = s.replace(/https?:\/\/([^\s/?#]+)([^\s?#]*)[^\s]*/ig, function (_, host, path) { return "https://" + host + (path || ""); });
    s = s.replace(/\s+/g, " ").trim();
    return s.slice(0, max || 260);
  }

  function load() {
    try {
      var parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) { return []; }
  }

  function save(items) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS))); } catch (_) {}
  }

  function currentPage() {
    var candidates = [
      document.querySelector("#view-container h1"),
      document.querySelector("#view-container h2"),
      document.querySelector("main h1"),
      document.querySelector("main h2")
    ].filter(Boolean);
    return cleanText(candidates.length ? candidates[0].textContent : document.title, 90) || "الداشبورد";
  }

  function classify(message, meta) {
    var m = String(message || "");
    var lower = m.toLowerCase();
    var status = meta && meta.status;
    if (/failed to fetch|networkerror|network request failed|load failed|fetch failed/.test(lower)) {
      return { title: "مشكلة اتصال", simple: "الجهاز لم يستطع الوصول إلى الخدمة المطلوبة.", solution: "افتح تشخيص النظام. لو Supabase فقط هو المتعطل، جرّب شبكة أخرى أو أوقف VPN/Content Filter ثم أعد المحاولة." };
    }
    if (/timeout|timed out|aborterror/.test(lower)) {
      return { title: "الاتصال استغرق وقتًا طويلًا", simple: "الطلب لم يكتمل في الوقت المتوقع.", solution: "أعد المحاولة مرة واحدة. لو تكرر، شغّل تشخيص النظام وافحص سرعة الشبكة والخدمة المتأثرة." };
    }
    if (status === 401 || /unauthorized|jwt|session.*expired|invalid.*token/.test(lower)) {
      return { title: "الجلسة تحتاج تجديد", simple: "النظام لم يعتبر الجلسة الحالية صالحة لتنفيذ العملية.", solution: "حدّث الصفحة وسجّل الدخول من جديد. لو تكرر الخطأ، أرسل تقرير التشخيص للإدارة." };
    }
    if (status === 403 || /forbidden|permission|row.level|rls|not allowed|access denied/.test(lower)) {
      return { title: "صلاحية غير كافية", simple: "الحساب الحالي لا يملك صلاحية تنفيذ هذه العملية.", solution: "راجع الصلاحية المطلوبة مع المسؤول. لا تكرر المحاولة قبل منح الصلاحية أو تغيير الدور." };
    }
    if (status === 404 || /not found|does not exist/.test(lower)) {
      return { title: "العنصر غير موجود", simple: "البيانات أو المسار المطلوب لم يعد موجودًا أو لم يتم تحميله.", solution: "حدّث الصفحة وابحث عن العنصر من جديد. لو استمر، أرسل تقرير التشخيص." };
    }
    if (status === 409 || /duplicate|unique constraint|already exists/.test(lower)) {
      return { title: "بيانات مكررة", simple: "النظام رفض إنشاء سجل مكرر لبيانات موجودة بالفعل.", solution: "ابحث عن السجل الموجود وعدّله بدل إنشاء نسخة جديدة." };
    }
    if (status === 429 || /rate limit|too many requests/.test(lower)) {
      return { title: "طلبات كثيرة في وقت قصير", simple: "الخدمة طلبت تقليل عدد المحاولات مؤقتًا.", solution: "انتظر قليلًا ثم أعد المحاولة مرة واحدة. لو استمر، راجع استهلاك الخدمة." };
    }
    if ((status && status >= 500) || /internal server|service unavailable|bad gateway|gateway timeout/.test(lower)) {
      return { title: "عطل مؤقت بالخادم", simple: "الخادم استقبل الطلب لكنه لم يستطع إكماله.", solution: "أعد المحاولة بعد تحديث الصفحة. لو تكرر، شغّل تشخيص النظام وأرسل التقرير للإدارة." };
    }
    if (/cannot read|undefined|null is not|is not a function|typeerror|referenceerror/.test(lower)) {
      return { title: "خطأ في واجهة الداشبورد", simple: "جزء من الواجهة حاول استخدام بيانات أو وظيفة غير جاهزة.", solution: "حدّث الصفحة وجرب نفس الخطوة مرة أخرى. لو تكرر بنفس الزر، أرسل تقرير التشخيص لتحديد الملف المسؤول." };
    }
    return { title: "خطأ أثناء تنفيذ العملية", simple: "العملية لم تكتمل كما هو متوقع.", solution: "أعد المحاولة مرة واحدة. لو تكرر، افتح تشخيص النظام وأرسل التقرير مع اسم الزر الذي كنت تستخدمه." };
  }

  function showHint(entry) {
    var old = document.getElementById("swnw-error-diagnostic-hint");
    if (old) old.remove();
    var box = document.createElement("button");
    box.id = "swnw-error-diagnostic-hint";
    box.type = "button";
    box.textContent = "🩺 " + entry.title + " — عرض الحل";
    box.style.cssText = "position:fixed;z-index:2147483000;left:16px;bottom:16px;max-width:min(420px,calc(100vw - 32px));padding:11px 14px;border:1px solid #f0b4ae;border-radius:12px;background:#fff7f6;color:#8f261d;font:700 13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Tahoma,Arial,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.12);cursor:pointer;";
    box.onclick = function () { window.open("system-diagnostics.html#recent-errors", "_blank", "noopener,noreferrer"); };
    document.body.appendChild(box);
    setTimeout(function () { if (box.isConnected) box.remove(); }, 9000);
  }

  function record(kind, message, meta) {
    var safeMessage = cleanText(message, 320);
    if (!safeMessage) return;
    meta = meta || {};
    var cls = classify(safeMessage, meta);
    var action = lastAction && Date.now() - lastAction.ts < 12000 ? lastAction.label : "";
    var fingerprint = kind + "|" + safeMessage + "|" + action + "|" + (meta.status || "");
    var now = Date.now();
    if (fingerprint === lastFingerprint && now - lastFingerprintAt < 5000) return;
    lastFingerprint = fingerprint; lastFingerprintAt = now;

    var entry = {
      id: "e" + now + Math.random().toString(36).slice(2, 7),
      ts: new Date(now).toISOString(),
      kind: cleanText(kind, 40),
      title: cls.title,
      simple: cls.simple,
      solution: cls.solution,
      action: cleanText(action, 100),
      page: currentPage(),
      technical: safeMessage,
      status: meta.status || null,
      endpoint: meta.endpoint ? cleanText(meta.endpoint, 160) : ""
    };
    var items = load();
    items.unshift(entry);
    save(items);
    if (document.body) showHint(entry);
    try { window.dispatchEvent(new CustomEvent("swnw:diagnostic-error", { detail: entry })); } catch (_) {}
  }

  function actionLabel(el) {
    if (!el) return "";
    var label = el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || el.value || "";
    return cleanText(label, 100);
  }

  document.addEventListener("click", function (event) {
    var el = event.target && event.target.closest ? event.target.closest("button,a,[role='button'],input[type='submit']") : null;
    if (!el) return;
    var label = actionLabel(el);
    if (label) lastAction = { label: label, ts: Date.now() };
  }, true);

  window.addEventListener("error", function (event) {
    var message = event && (event.message || (event.error && event.error.message));
    if (message) record("javascript", message, {});
  });

  window.addEventListener("unhandledrejection", function (event) {
    var reason = event && event.reason;
    record("promise", reason && reason.message ? reason.message : reason, {});
  });

  if (window.fetch && !window.fetch.__swnwErrorMonitorWrapped) {
    var nativeFetch = window.fetch;
    var wrappedFetch = function (input, init) {
      var method = (init && init.method) || "GET";
      var endpoint = "";
      try { var u = new URL(typeof input === "string" ? input : input.url, location.href); endpoint = u.origin + u.pathname; } catch (_) {}
      return nativeFetch.apply(this, arguments).then(function (res) {
        if (res && !res.ok && res.status >= 400) record("http", "HTTP " + res.status + " أثناء " + method, { status: res.status, endpoint: endpoint });
        return res;
      }).catch(function (err) {
        record("network", err && err.message ? err.message : err, { endpoint: endpoint });
        throw err;
      });
    };
    wrappedFetch.__swnwErrorMonitorWrapped = true;
    window.fetch = wrappedFetch;
  }

  function patchToast() {
    var T = window.SSMPDToast;
    if (!T || typeof T.show !== "function" || T.show.__swnwErrorMonitorWrapped) return false;
    var original = T.show;
    var wrapped = function (message, type) {
      if (String(type || "").toLowerCase() === "error") record("toast", message, {});
      return original.apply(this, arguments);
    };
    wrapped.__swnwErrorMonitorWrapped = true;
    T.show = wrapped;
    return true;
  }

  var tries = 0;
  (function waitToast() {
    tries += 1;
    if (patchToast() || tries >= 24) return;
    setTimeout(waitToast, 250);
  })();

  window.SWNWErrorMonitor = {
    getRecent: function () { return load(); },
    clear: function () { try { localStorage.removeItem(STORAGE_KEY); } catch (_) {} },
    record: record,
    storageKey: STORAGE_KEY
  };
})();
