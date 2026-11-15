/* The staff patient page waits for the patient-files-list edge function, which is usually cold
 * (rarely used + the edge runtime evicts idle workers): ~1 s boot on the first click.
 * When a patient list is on screen, or the pointer approaches a patient row, send one cheap
 * HEAD request so the worker boots before the click. HEAD returns 405 at the top of the function:
 * no auth, no database, no patient data. At most once every 3 minutes. */
(function (w, d) {
  "use strict";
  var EVERY_MS = 3 * 60 * 1000, last = 0;
  function base() {
    var c = w.SSMPD_CONFIG && w.SSMPD_CONFIG.supabase;
    return c && c.url ? { url: c.url.replace(/\/+$/, "") + "/functions/v1/patient-files-list", key: c.anonKey } : null;
  }
  function warm() {
    var b = base(), now = Date.now();
    if (!b || now - last < EVERY_MS || !w.fetch) return false;
    last = now;
    try { w.fetch(b.url, { method: "HEAD", headers: { apikey: b.key }, cache: "no-store", keepalive: true }).catch(function () {}); } catch (e) { /* ignore */ }
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
