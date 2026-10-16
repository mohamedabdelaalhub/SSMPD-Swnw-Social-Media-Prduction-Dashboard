/* SSMPD — تقييم سريع لأداء المنشور (ناجح/عادي/ضعيف + سبب) من شاشة الأرشيف — بيغذّي ذاكرة التعلّم للمحتوى الجاي */
(function () {
  "use strict";
  var LABELS = { strong: "👍 ناجح", ok: "😐 عادي", weak: "👎 ضعيف" };
  var ROLES = ["page_manager", "approver", "general_manager", "super_admin"];
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function mount(host, item) {
    var admin = window.SSMPDAuth && window.SSMPDAuth.currentAdmin;
    if (!host || !item || !admin || ROLES.indexOf(admin.role) < 0) return;
    var state = { rating: "", reason: "", saved: false, error: "" };
    function draw() {
      host.innerHTML = '<div class="crt"><b>قيّم أداء المنشور</b><div class="crt-chips">' + Object.keys(LABELS).map(function (k) {
        return '<button type="button" class="crt-chip' + (state.rating === k ? " on " + k : "") + '" data-rate="' + k + '">' + LABELS[k] + '</button>';
      }).join("") + '</div>' + (state.rating ? '<div class="crt-reason"><input type="text" maxlength="400" placeholder="السبب في جملة (اختياري)" value="' + esc(state.reason) + '" data-reason><button type="button" class="btn sm" data-save>حفظ</button></div>' : "") +
        (state.saved ? '<small class="crt-ok">✓ اتحفظ</small>' : "") + (state.error ? '<small class="crt-err">' + esc(state.error) + '</small>' : "") + '</div>';
      host.querySelectorAll("[data-rate]").forEach(function (b) { b.onclick = function () { state.rating = b.getAttribute("data-rate"); state.saved = false; draw(); }; });
      var save = host.querySelector("[data-save]"), inp = host.querySelector("[data-reason]");
      if (inp) inp.oninput = function () { state.reason = inp.value; state.saved = false; };
      if (save) save.onclick = function () {
        save.disabled = true; state.error = "";
        window.SSMPDDb.setContentRating(item.id, state.rating, state.reason).then(function () { state.saved = true; draw(); }).catch(function (e) { state.error = (e && e.message) || "تعذر الحفظ"; draw(); });
      };
    }
    draw();
    window.SSMPDDb.getContentRating(item.id).then(function (r) { if (r) { state.rating = r.rating; state.reason = r.reason || ""; draw(); } }).catch(function () {});
  }
  window.SSMPDContentRating = { mount: mount };
})();
