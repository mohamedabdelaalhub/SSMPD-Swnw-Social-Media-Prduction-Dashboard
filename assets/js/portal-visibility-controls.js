/* Patient-portal visibility control next to each visit / report / file in the patient archive.
 * Default: a record reaches the patient portal 24h after it is created. Doctor or archive staff
 * can show it now or hide it. Writes only through the set_patient_portal_visibility RPC, which
 * checks permission server-side; a refused change is reported and the select is reset. */
(function (w, d) {
  "use strict";
  var TARGETS = [
    ["data-edit-visit", "visit"], ["data-view-visit", "visit"],
    ["data-print-medical-report", "medical_report"], ["data-print-echo-report", "echo_report"],
    ["data-print-dental-report", "dental_report"], ["data-print-physio-report", "physio_report"],
    ["data-print-prescription", "prescription"], ["data-print-lab-request", "lab_request"],
    ["data-print-radiology-request", "radiology_request"], ["data-del-file", "patient_file"]
  ];
  var LABELS = { auto: "يظهر للمريض بعد 24 ساعة", approved: "معروض للمريض الآن", hidden: "مخفي عن المريض" };
  var cache = {}, pending = {};

  function client() { return w.SSMPDDb && w.SSMPDDb.client; }
  function key(type, id) { return type + ":" + id; }

  function loadStatuses(ids) {
    var c = client(), need = ids.filter(function (id) { return !(id in cache) && !pending[id]; });
    if (!c || !need.length) return Promise.resolve();
    need.forEach(function (id) { pending[id] = true; });
    return c.from("patient_portal_visibility").select("entity_type,entity_id,portal_status").in("entity_id", need)
      .then(function (r) {
        need.forEach(function (id) { cache[id] = cache[id] || {}; delete pending[id]; });
        (r.data || []).forEach(function (row) { cache[row.entity_id][row.entity_type] = row.portal_status; });
      }, function () { need.forEach(function (id) { delete pending[id]; }); });
  }

  function statusOf(type, id) {
    var s = cache[id] && cache[id][type];
    return s === "approved" || s === "hidden" ? s : (s === "internal" ? "hidden" : "auto");
  }

  function build(type, id) {
    var sel = d.createElement("select");
    sel.className = "portal-visibility-select";
    sel.setAttribute("data-portal-vis", key(type, id));
    sel.title = "الظهور في بوابة المريض";
    ["auto", "approved", "hidden"].forEach(function (v) {
      var o = d.createElement("option"); o.value = v; o.textContent = LABELS[v]; sel.appendChild(o);
    });
    sel.value = statusOf(type, id);
    sel.setAttribute("data-current", sel.value);
    sel.addEventListener("click", function (e) { e.stopPropagation(); });
    sel.addEventListener("change", function () {
      var next = sel.value, prev = sel.getAttribute("data-current");
      sel.disabled = true;
      client().rpc("set_patient_portal_visibility", { p_entity_type: type, p_entity_id: id, p_status: next })
        .then(function (r) {
          if (r.error) throw r.error;
          cache[id] = cache[id] || {};
          if (next === "auto") delete cache[id][type]; else cache[id][type] = next;
          sel.setAttribute("data-current", next);
        })
        .catch(function (e) {
          sel.value = prev;
          var msg = String((e && e.message) || e);
          w.alert(/NOT_ALLOWED|NOT_STAFF|42501/.test(msg) ? "مش مسموح لك تغيّر ظهور السجل ده في بوابة المريض." : "تعذر تغيير الظهور في البوابة: " + msg);
        })
        .then(function () { sel.disabled = false; });
    });
    return sel;
  }

  function scan(root) {
    if (!client()) return;
    var found = [];
    TARGETS.forEach(function (t) {
      (root.querySelectorAll ? root.querySelectorAll("[" + t[0] + "]") : []).forEach(function (btn) {
        var id = btn.getAttribute(t[0]);
        if (!/^[0-9a-f-]{36}$/i.test(id || "")) return;
        var parent = btn.parentNode;
        if (!parent || parent.querySelector('[data-portal-vis="' + key(t[1], id) + '"]')) return;
        if (found.some(function (f) { return f.btn.parentNode === parent && f.type === t[1] && f.id === id; })) return;
        found.push({ btn: btn, type: t[1], id: id });
      });
    });
    if (!found.length) return;
    found.forEach(function (f) {   // placeholder first so a second scan doesn't duplicate
      var sel = build(f.type, f.id); sel.disabled = true; f.btn.parentNode.insertBefore(sel, f.btn.nextSibling); f.sel = sel;
    });
    loadStatuses(found.map(function (f) { return f.id; })).then(function () {
      found.forEach(function (f) {
        f.sel.value = statusOf(f.type, f.id); f.sel.setAttribute("data-current", f.sel.value); f.sel.disabled = false;
      });
    });
  }

  var queued = false;
  function schedule() { if (queued) return; queued = true; (w.requestAnimationFrame || setTimeout)(function () { queued = false; scan(d.body); }); }
  function start() { scan(d.body); new MutationObserver(schedule).observe(d.body, { childList: true, subtree: true }); }
  w.SSMPDPortalVisibility = { scan: scan, _cache: cache };
  if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", start); else start();
})(window, document);
