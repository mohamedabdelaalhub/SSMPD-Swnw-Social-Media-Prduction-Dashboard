/* «افتح وردية اليوم» (owner 2026-11-17): a reception / customer-service employee who punched in today, or whose shift start
 * has come, and who has no open reception cash shift of their own, gets a popup with one button that opens the
 * «فتح وردية» form (الاستقبال والخدمات ← العمليات ← الخزن والورديات). Server decides: public.clinic_reception_shift_reminder().
 * «بعدين» hides it for 20 minutes on this device. Read-only; nothing is opened without the employee pressing the button. */
(function (w, d) {
  "use strict";
  var ROLES = ["reception", "customer_service"], CHECK_MS = 5 * 60000, SNOOZE_MS = 20 * 60000;
  var last = 0, busy = false, shownFor = "";
  function me() { return w.SSMPDAuth && w.SSMPDAuth.currentAdmin; }
  function eligible(a) { return a && ROLES.indexOf(a.role) >= 0 && d.querySelector('[data-goto="reception_services"]'); }
  function snoozeKey(a) { return "ssmpd-shift-reminder-snooze:" + a.id; }
  function snoozed(a) { try { return +(w.localStorage.getItem(snoozeKey(a)) || 0) > Date.now(); } catch (_) { return false; } }
  function time(v) { return v ? new Date(v).toLocaleTimeString("ar-EG-u-nu-latn", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit" }) : ""; }
  function day(v) { return v ? new Date(v).toLocaleDateString("ar-EG-u-nu-latn", { timeZone: "Africa/Cairo", weekday: "long", day: "numeric", month: "long" }) : ""; }
  function text(r) {
    if (r.reason === "stale") return "عندك وردية لسه مفتوحة من " + day(r.stale_opened_at) + ". اقفلها وسلّم الكاش، وبعدين افتح وردية النهارده قبل ما تحصّل أي فلوس.";
    if (r.reason === "punched") return "إنت بصمت حضور الساعة " + time(r.first_in) + ". افتح وردية اليوم علشان تقدر تحصّل فلوس المرضى.";
    return "شيفتك بدأ الساعة " + time(r.exp_start) + ". افتح وردية اليوم علشان تقدر تحصّل فلوس المرضى.";
  }
  function close(box) { if (box && box.parentNode) box.parentNode.removeChild(box); }
  function show(a, r) {
    if (d.querySelector("[data-shift-reminder]")) return;
    var box = d.createElement("div");
    box.className = "shift-reminder-backdrop"; box.setAttribute("data-shift-reminder", "");
    box.innerHTML = '<div class="shift-reminder" role="dialog" aria-modal="true" aria-labelledby="shift-reminder-title">' +
      '<div class="shift-reminder-icon" aria-hidden="true">₤</div>' +
      '<h2 id="shift-reminder-title">افتح وردية اليوم</h2><p></p>' +
      '<div class="shift-reminder-actions"><button type="button" class="btn btn-primary" data-shift-open>' + (r.reason === "stale" ? "روح للورديات" : "فتح الوردية") + '</button>' +
      '<button type="button" class="btn" data-shift-later>بعدين</button></div></div>';
    box.querySelector("p").textContent = text(r);
    d.body.appendChild(box);
    var open = box.querySelector("[data-shift-open]"); open.focus();
    box.querySelector("[data-shift-later]").onclick = function () { try { w.localStorage.setItem(snoozeKey(a), String(Date.now() + SNOOZE_MS)); } catch (_) {} close(box); };
    box.addEventListener("keydown", function (e) { if (e.key === "Escape") box.querySelector("[data-shift-later]").click(); });
    open.onclick = function () {
      open.disabled = true;
      var api = w.SSMPDReception && w.SSMPDReception.openShiftOpen;
      Promise.resolve(api ? api(r.reason !== "stale") : Promise.reject(Error("شاشة الاستقبال مش متاحة"))).then(function () { close(box); })
        .catch(function (err) { open.disabled = false; box.querySelector("p").textContent = (err && err.message) || "تعذر فتح شاشة الورديات"; });
    };
  }
  function check(force) {
    var a = me();
    if (!eligible(a) || busy || snoozed(a)) return;
    if (!force && Date.now() - last < CHECK_MS && shownFor === a.id) return;
    var c = w.SSMPDDb && w.SSMPDDb.client; if (!c) return;
    busy = true; last = Date.now(); shownFor = a.id;
    Promise.resolve(c.rpc("clinic_reception_shift_reminder")).then(function (res) {
      if (res && !res.error && res.data && res.data.show && me() && me().id === a.id) show(a, res.data);
    }).catch(function () {}).then(function () { busy = false; });
  }
  w.SSMPDShiftReminder = { check: check };
  w.setInterval(function () { check(false); }, 30000);
  w.setTimeout(function () { check(true); }, 2500);
})(window, document);
