/* The staff patient page waits for the patient-files-list edge function, which is usually cold
 * (rarely used + the edge runtime evicts idle workers): ~1 s boot on the first click.
 * When a patient list is on screen, or the pointer approaches a patient row, send one cheap
 * OPTIONS request so the worker boots before the click. The function answers OPTIONS (204) at the
 * very top, before auth and before any database query: no patient data, and no error (a HEAD
 * answered 405 and the error monitor showed it to staff as a failed operation, owner 2026-11-20).
 * At most once every 3 minutes. */
(function (w, d) {
  "use strict";
  var EVERY_MS = 3 * 60 * 1000, last = 0;
  function base() {
    var c = w.SSMPD_CONFIG && w.SSMPD_CONFIG.supabase;
    return c && c.url ? { url: c.url.replace(/\/+$/, "") + "/functions/v1/patient-files-list", key: c.anonKey } : null;
  }
  // The edge router requires a user JWT for this function, so the OPTIONS carries the signed-in
  // staff member's token (no session -> no request).
  function sessionToken() {
    var c = w.SSMPDDb && w.SSMPDDb.client;
    if (!c || !c.auth || !c.auth.getSession) return Promise.resolve(null);
    return c.auth.getSession().then(function (r) { return r && r.data && r.data.session && r.data.session.access_token || null; }, function () { return null; });
  }
  function warm() {
    var b = base(), now = Date.now();
    if (!b || now - last < EVERY_MS || !w.fetch) return false;
    last = now;
    sessionToken().then(function (token) {
      if (!token) { last = 0; return; }
      return w.fetch(b.url, { method: "OPTIONS", headers: { apikey: b.key, Authorization: "Bearer " + token }, cache: "no-store", keepalive: true });
    }).catch(function () {});
    return true;
  }
  function hasPatientRows() { return !!d.querySelector("[data-open],[data-pick]"); }
  var queued = false;
  function check() { if (queued) return; queued = true; setTimeout(function () { queued = false; if (hasPatientRows()) warm(); }, 300); }
  function start() {
    check();
    new MutationObserver(check).observe(d.body, { childList: true, subtree: true });
    d.addEventListener("pointerover", function (e) { if (e.target && e.target.closest && e.target.closest("[data-open],[data-pick]")) warm(); }, { passive: true });
  }
  w.SSMPDPatientFilesPrewarm = { warm: warm, _reset: function () { last = 0; } };
  if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", start); else start();
})(window, document);
