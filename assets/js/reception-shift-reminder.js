/* «افتح وردية اليوم» (owner 2026-11-17). Server: public.clinic_reception_shift_reminder() → state for the signed-in account:
 *   need_open : popup «افتح وردية اليوم» every 5 minutes until the shift is opened; «بعدين» shrinks it into a floating
 *               orange safe (closed, its door keeps opening) at the bottom-left, above the other floating buttons.
 *   open      : green open safe (the employee's reception cash shift is open).
 *   close_due : yellow safe whose door keeps closing — shift time over / punched out / left open from an earlier day.
 *   hidden    : nothing (punched out or shift closed; it comes back at the next scheduled shift).
 * Buttons only navigate (SSMPDReception.openShiftOpen); nothing is opened or closed without the employee's own action. */
(function (w, d) {
  "use strict";
  var ROLES = ["reception", "customer_service"], POLL_MS = 60000, SNOOZE_MS = 5 * 60000;
  var state = { admin: "", data: null, busy: false, last: 0 };
  function me() { return w.SSMPDAuth && w.SSMPDAuth.currentAdmin; }
  function eligible(a) { return a && ROLES.indexOf(a.role) >= 0 && d.querySelector('[data-goto="reception_services"]'); }
  function key(a) { return "ssmpd-shift-reminder-snooze:" + a.id; }
  function snoozed(a) { try { return +(w.localStorage.getItem(key(a)) || 0) > Date.now(); } catch (_) { return false; } }
  function snooze(a) { try { w.localStorage.setItem(key(a), String(Date.now() + SNOOZE_MS)); } catch (_) {} }
  function time(v) { return v ? new Date(v).toLocaleTimeString("ar-EG-u-nu-latn", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit" }) : ""; }
  function day(v) { return v ? new Date(v).toLocaleDateString("ar-EG-u-nu-latn", { timeZone: "Africa/Cairo", weekday: "long", day: "numeric", month: "long" }) : ""; }
  var SAFE = '<svg class="safe-ico" viewBox="0 0 32 32" aria-hidden="true" focusable="false">' +
    '<rect x="3" y="4" width="26" height="22" rx="3.5" class="safe-body"/><rect x="6" y="26" width="5" height="3" rx="1" class="safe-body"/><rect x="21" y="26" width="5" height="3" rx="1" class="safe-body"/>' +
    '<rect x="6.5" y="7.5" width="19" height="15" rx="1.5" class="safe-inside"/><circle cx="16" cy="15" r="3" class="safe-coin"/>' +
    '<g class="safe-door"><rect x="6.5" y="7.5" width="19" height="15" rx="1.5" class="safe-door-face"/><circle cx="16" cy="15" r="3.6" class="safe-dial"/><path d="M16 11.4v1.6M16 17v1.6M12.4 15h1.6M18 15h1.6" class="safe-dial"/><rect x="22" y="12.5" width="1.6" height="5" rx=".8" class="safe-handle"/></g></svg>';
  var COPY = {
    need_open: { title: "افتح وردية اليوم", fab: "افتح وردية اليوم", btn: "فتح الوردية", form: true },
    open: { fab: "ورديتك مفتوحة — اضغط لعرض الورديات" },
    close_due: { title: "اقفل ورديتك", fab: "اقفل الوردية", btn: "روح للورديات", form: false }
  };
  function text(r) {
    if (r.state === "close_due") {
      if (r.reason === "stale") return "عندك وردية لسه مفتوحة من " + day(r.opened_at) + ". اقفلها وسلّم الكاش، وبعدين افتح وردية النهارده.";
      if (r.reason === "punched_out") return "إنت بصمت انصراف وورديتك لسه مفتوحة. اقفل الوردية واكتب الكاش اللي معاك.";
      return "شيفتك خلص الساعة " + time(r.exp_end) + " وورديتك لسه مفتوحة. اقفل الوردية واكتب الكاش اللي معاك.";
    }
    if (r.reason === "punched") return "إنت بصمت حضور الساعة " + time(r.first_in) + ". افتح وردية اليوم علشان تقدر تحصّل فلوس المرضى.";
    return "شيفتك بدأ الساعة " + time(r.exp_start) + ". افتح وردية اليوم علشان تقدر تحصّل فلوس المرضى.";
  }
  function remove(sel) { var n = d.querySelector(sel); if (n && n.parentNode) n.parentNode.removeChild(n); }
  function go(openForm) {
    var api = w.SSMPDReception && w.SSMPDReception.openShiftOpen;
    return Promise.resolve(api ? api(openForm) : Promise.reject(Error("شاشة الاستقبال مش متاحة")));
  }
  /* sits above whatever floating buttons are already at the bottom-left */
  function placeFab(fab) {
    var top = w.innerHeight, H = w.innerHeight;
    Array.prototype.forEach.call(d.body.querySelectorAll("body *"), function (n) {
      if (n === fab || fab.contains(n) || n.closest("[data-shift-reminder]")) return;
      var cs = w.getComputedStyle(n); if (cs.position !== "fixed" || cs.display === "none" || cs.visibility === "hidden") return;
      var r = n.getBoundingClientRect(); if (!r.width || !r.height || r.left > 140 || r.bottom < H - 260 || r.height > 200) return;
      top = Math.min(top, r.top);
    });
    fab.style.bottom = (top < H ? Math.round(H - top + 12) : 20) + "px";
  }
  function popup(a, r) {
    if (d.querySelector("[data-shift-reminder]")) return;
    var c = COPY[r.state], box = d.createElement("div");
    box.className = "shift-reminder-backdrop"; box.setAttribute("data-shift-reminder", "");
    box.innerHTML = '<div class="shift-reminder is-' + r.state + '" role="dialog" aria-modal="true" aria-labelledby="shift-reminder-title">' +
      '<div class="shift-reminder-icon">' + SAFE + '</div><h2 id="shift-reminder-title"></h2><p></p>' +
      '<div class="shift-reminder-actions"><button type="button" class="btn btn-primary" data-shift-open></button><button type="button" class="btn" data-shift-later>بعدين</button></div></div>';
    box.querySelector("h2").textContent = c.title; box.querySelector("p").textContent = text(r);
    var open = box.querySelector("[data-shift-open]"); open.textContent = c.btn;
    d.body.appendChild(box); open.focus(); fab(a, state.data);
    function later() { if (r.state === "need_open") snooze(a); remove("[data-shift-reminder]"); fab(a, state.data); }
    box.querySelector("[data-shift-later]").onclick = later;
    box.addEventListener("keydown", function (e) { if (e.key === "Escape") later(); });
    open.onclick = function () {
      open.disabled = true;
      go(c.form).then(function () { if (r.state === "need_open") snooze(a); remove("[data-shift-reminder]"); fab(a, state.data); })
        .catch(function (err) { open.disabled = false; box.querySelector("p").textContent = (err && err.message) || "تعذر فتح شاشة الورديات"; });
    };
  }
  function fab(a, r) {
    var el = d.querySelector("[data-shift-fab]");
    if (!r || r.state === "hidden" || !COPY[r.state] || d.querySelector("[data-shift-reminder]")) { if (el) el.parentNode.removeChild(el); return; }
    if (!el) { el = d.createElement("button"); el.type = "button"; el.setAttribute("data-shift-fab", ""); el.innerHTML = SAFE; d.body.appendChild(el); }
    el.className = "shift-fab is-" + r.state;
    el.setAttribute("aria-label", COPY[r.state].fab); el.title = COPY[r.state].fab;
    el.onclick = function () { if (r.state === "open") go(false).catch(function () {}); else popup(a, r); };
    placeFab(el);
  }
  function apply(a, r) {
    state.data = r;
    if (!r || r.state === "hidden") { remove("[data-shift-reminder]"); fab(a, null); return; }
    var pop = d.querySelector("[data-shift-reminder] .shift-reminder");
    if (pop && !pop.classList.contains("is-" + r.state)) remove("[data-shift-reminder]");
    if (r.state === "need_open" && !snoozed(a)) popup(a, r);
    fab(a, r);
  }
  function check(force) {
    var a = me();
    if (!eligible(a)) { if (state.admin) { remove("[data-shift-reminder]"); fab(null, null); state.admin = ""; } return; }
    if (state.busy) return;
    if (!force && state.admin === a.id && Date.now() - state.last < POLL_MS) {
      if (state.data && state.data.state === "need_open" && !snoozed(a)) popup(a, state.data);
      return;
    }
    var c = w.SSMPDDb && w.SSMPDDb.client; if (!c) return;
    state.busy = true; state.last = Date.now(); state.admin = a.id;
    Promise.resolve(c.rpc("clinic_reception_shift_reminder")).then(function (res) {
      if (res && !res.error && me() && me().id === a.id) apply(a, res.data || null);
    }).catch(function () {}).then(function () { state.busy = false; });
  }
  w.SSMPDShiftReminder = { check: check, refresh: function () { check(true); } };
  w.setInterval(function () { check(false); }, 15000);
  w.setTimeout(function () { check(true); }, 2500);
})(window, document);
