/* Warning badge next to a patient file when the name printed in it differs from the patient's
 * record. Verdicts come from the clinic-server worker (local OCR; files never leave our servers).
 * Warning only — staff mark it reviewed; nothing is blocked. */
(function (w, d) {
  "use strict";
  var ATTRS = ["data-view-file", "data-view", "data-dl"];
  function client() { return w.SSMPDDb && w.SSMPDDb.client; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  function badge(row) {
    var b = d.createElement("span");
    b.className = "file-name-check-badge";
    b.setAttribute("data-file-name-check", row.file_id);
    b.innerHTML = "⚠️ الاسم في الملف" + (row.detected_name ? ": <b>" + esc(row.detected_name) + "</b>" : "") +
      " — مختلف عن اسم المريض. اتأكد إن الملف على المريض الصح. " +
      '<button type="button" class="btn ghost sm">تمت المراجعة</button>';
    b.querySelector("button").addEventListener("click", function (e) {
      e.stopPropagation();
      var note = w.prompt("ملاحظة المراجعة (اختياري):", "") ;
      if (note === null) return;
      client().rpc("patient_file_name_check_review", { p_file_id: row.file_id, p_note: note || null }).then(function (r) {
        if (r.error) throw r.error;
        results[row.file_id] = null; b.remove();
      }).catch(function (err) { w.alert("تعذر حفظ المراجعة: " + String((err && err.message) || err)); });
    });
    return b;
  }

  var results = {}, inflight = {};   // file_id -> open mismatch row | null
  function attach(el, row) {
    var host = el && el.parentNode;
    if (host && !host.querySelector('[data-file-name-check="' + row.file_id + '"]')) host.appendChild(badge(row));
  }
  function scan(root) {
    var c = client(); if (!c || !root.querySelectorAll) return;
    var btns = {};
    ATTRS.forEach(function (a) {
      root.querySelectorAll("[" + a + "]").forEach(function (el) {
        var id = el.getAttribute(a);
        if (/^[0-9a-f-]{36}$/i.test(id || "") && !btns[id]) btns[id] = el;
      });
    });
    var ask = [];
    Object.keys(btns).forEach(function (id) {
      if (id in results) { if (results[id]) attach(btns[id], results[id]); }
      else if (!inflight[id]) { inflight[id] = true; ask.push(id); }
    });
    if (!ask.length) return;
    c.from("patient_file_name_checks").select("file_id,detected_name,verdict,reviewed_at")
      .in("file_id", ask).eq("verdict", "mismatch").is("reviewed_at", null)
      .then(function (r) {
        if (r.error) throw r.error;
        ask.forEach(function (id) { results[id] = null; delete inflight[id]; });
        (r.data || []).forEach(function (row) { results[row.file_id] = row; attach(btns[row.file_id], row); });
      }).catch(function () { ask.forEach(function (id) { delete inflight[id]; }); });
  }

  var queued = false;
  function schedule() { if (queued) return; queued = true; (w.requestAnimationFrame || setTimeout)(function () { queued = false; scan(d.body); }); }
  function start() { scan(d.body); new MutationObserver(schedule).observe(d.body, { childList: true, subtree: true }); }
  w.SSMPDFileNameCheck = { scan: scan };
  if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", start); else start();
})(window, document);
