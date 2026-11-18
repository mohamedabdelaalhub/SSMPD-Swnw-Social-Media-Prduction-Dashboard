/* «الساعات الإضافية» (owner 2026-11-18). Server: public.hr_overtime(action, payload).
 *  Everyone: «طلب ساعات عمل إضافية» (day, minutes, reason, optional task) + my requests.
 *  Direct manager / HR: requests waiting for them (task expected minutes, approved minutes, reason for more than +20%).
 *  Direct manager / HR: monthly report — every stay after the shift: recorded vs counted, reason / task, approver,
 *  «بدون إذن» flag, and employees with repeated unapproved stays (HR decides; nothing is deducted automatically).
 *  Super admin / general manager: «صرف الأوفر تايم» switch (off = hours shown, not paid), task tolerance, alert thresholds. */
(function (w, d) {
  "use strict";
  var state = { month: "", data: null, el: null };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function today() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
  function hm(v) { return v ? new Date(v).toLocaleTimeString("ar-EG-u-nu-latn", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit" }) : "—"; }
  function mins(n) { n = Number(n || 0); var h = Math.floor(n / 60), m = n % 60; return (h ? h + " س " : "") + (m || !h ? m + " د" : ""); }
  var ST = { pending: "مستني الموافقة", approved: "اتوافق", rejected: "اترفض", cancelled: "اتلغى" };
  function rpc(a, p) {
    var c = w.SSMPDDb && w.SSMPDDb.client; if (!c) return Promise.reject(Error("الاتصال غير متاح"));
    return Promise.resolve(c.rpc("hr_overtime", { p_action: a, p_payload: p || {} })).then(function (r) { if (r && r.error) throw Error(r.error.message || "تعذر التنفيذ"); return r.data; });
  }
  function msg(text, bad) { var n = state.el && state.el.querySelector("[data-ot-msg]"); if (n) { n.textContent = text; n.className = "ot-msg" + (bad ? " is-bad" : " is-ok"); n.hidden = !text; } }
  function load() {
    if (!state.el) return;
    return rpc("workspace", { month: state.month + "-01" }).then(function (r) { state.data = r; draw(); }).catch(function (e) { state.el.innerHTML = '<p class="ot-msg is-bad" role="alert">' + esc(e.message) + "</p>"; });
  }
  function draw() {
    var r = state.data, el = state.el, html = '<div class="ot"><p class="ot-msg" data-ot-msg role="status" hidden></p>';
    html += '<p class="ot-lead">الوقت بعد نهاية شيفتك بيتحسب ساعات إضافية <b>بس لو فيه طلب اتوافق عليه</b> من مديرك المباشر أو الموارد البشرية، ولحد آخر ميعاد دكتور في اليوم. صرف الأوفر تايم دلوقتي: <b class="' + (r.settings.pay_enabled ? "ot-on" : "ot-off") + '">' + (r.settings.pay_enabled ? "شغال" : "مقفول (الساعات بتظهر ومش بتتصرف)") + "</b>.</p>";
    // request form
    var forOthers = (r.people || []).filter(function (p) { return p.id !== r.me_person; });
    html += '<section class="ot-card"><h3>طلب ساعات عمل إضافية</h3><form data-ot-form class="ot-form">' +
      (forOthers.length ? '<label>الموظف<select name="person_id">' + (r.me_person ? '<option value="">أنا</option>' : "") + forOthers.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + "</option>"; }).join("") + "</select></label>" : "") +
      '<label>اليوم<input type="date" name="day" value="' + today() + '" required></label>' +
      '<label>المدة بالدقايق<input type="number" name="minutes" min="5" max="720" step="5" required></label>' +
      '<label>المهمة (اختياري)<select name="task_id"><option value="">بدون مهمة</option>' + (r.my_tasks || []).map(function (t) { return '<option value="' + esc(t.id) + '">' + esc(t.title) + "</option>"; }).join("") + "</select></label>" +
      '<label class="ot-wide">السبب<input name="reason" maxlength="500" required placeholder="ليه محتاج تقعد بعد الشيفت؟"></label>' +
      '<button type="submit" class="btn btn-primary">إرسال الطلب</button></form></section>';
    // mine
    if ((r.mine || []).length) html += '<section class="ot-card"><h3>طلباتي</h3><table class="ot-table"><thead><tr><th>اليوم</th><th>المدة</th><th>السبب / المهمة</th><th>الحالة</th><th></th></tr></thead><tbody>' + r.mine.map(function (q) {
      return "<tr><td>" + esc(q.day) + "</td><td>" + mins(q.minutes) + (q.approved_minutes != null ? ' <small>(اتوافق ' + mins(q.approved_minutes) + ")</small>" : "") + "</td><td>" + esc(q.reason) + (q.task_title ? ' <small>— مهمة: ' + esc(q.task_title) + "</small>" : "") + '</td><td><span class="ot-st is-' + esc(q.status) + '">' + esc(ST[q.status] || q.status) + "</span>" + (q.review_note ? ' <small>' + esc(q.review_note) + "</small>" : "") + "</td><td>" + (q.status === "pending" ? '<button type="button" class="btn btn-sm" data-ot-cancel="' + esc(q.id) + '">إلغاء</button>' : "") + "</td></tr>";
    }).join("") + "</tbody></table></section>";
    // to review
    if ((r.to_review || []).length) html += '<section class="ot-card ot-review"><h3>طلبات مستنية موافقتك (' + r.to_review.length + ")</h3>" + r.to_review.map(function (q) {
      return '<article class="ot-item" data-ot-item="' + esc(q.id) + '"><header><b>' + esc(q.person_name) + "</b> · " + esc(q.day) + " · طالب " + mins(q.minutes) + "</header><p>" + esc(q.reason) + "</p>" +
        (q.task_title ? '<p class="ot-task">المهمة: <b>' + esc(q.task_title) + "</b>" + (q.task_description ? "<br><small>" + esc(q.task_description) + "</small>" : "") + "</p>" : "") +
        '<div class="ot-form">' + (q.task_id ? '<label>الوقت المتوقع للمهمة (دقايق)<input type="number" min="1" max="720" data-ot-exp required></label>' : "") +
        '<label>الدقايق المعتمدة<input type="number" min="0" max="720" value="' + esc(q.minutes) + '" data-ot-min></label>' +
        '<label class="ot-wide">سبب الزيادة عن المتوقع + ' + esc(r.settings.task_tolerance_pct) + '٪ (لو فيه)<input data-ot-extra maxlength="300"></label>' +
        '<label class="ot-wide">ملاحظة / سبب الرفض<input data-ot-note maxlength="300"></label></div>' +
        '<div class="ot-actions"><button type="button" class="btn btn-primary" data-ot-approve>موافقة</button><button type="button" class="btn ot-reject" data-ot-reject>رفض</button></div></article>';
    }).join("") + "</section>";
    // report
    if (r.is_hr || (r.report || []).length) {
      var by = {}; (r.report || []).forEach(function (x) { var b = by[x.person_id] = by[x.person_id] || { name: x.name, counted: 0, recorded: 0, flags: 0 }; b.counted += x.counted_min; b.recorded += x.capped_min; if (x.flag) b.flags++; });
      html += '<section class="ot-card"><div class="ot-head"><h3>تقرير الساعات الإضافية</h3><label>شهر التقرير<input type="month" data-ot-month value="' + esc(state.month) + '"></label></div>';
      if ((r.repeaters || []).length) html += '<p class="ot-alert" role="alert">قعدوا بعد الشيفت من غير إذن ' + esc(r.settings.repeat_count) + ' مرات أو أكتر الشهر ده: ' + r.repeaters.map(function (x) { return "<b>" + esc(x.name) + "</b> (" + x.times + ")"; }).join("، ") + ' — القرار للموارد البشرية، مفيش خصم أوتوماتيك.</p>';
      var keys = Object.keys(by);
      html += keys.length ? '<table class="ot-table ot-sum"><thead><tr><th>الموظف</th><th>بعد الشيفت (لحد آخر دكتور)</th><th>المحسوب</th><th>مرات بدون إذن</th></tr></thead><tbody>' + keys.map(function (k) { var b = by[k]; return "<tr><td>" + esc(b.name) + "</td><td>" + mins(b.recorded) + "</td><td><b>" + mins(b.counted) + "</b></td><td>" + (b.flags ? '<span class="ot-flag">' + b.flags + "</span>" : "0") + "</td></tr>"; }).join("") + "</tbody></table>" : '<p class="ot-muted">مفيش حد قعد بعد الشيفت في الشهر ده.</p>';
      if ((r.report || []).length) html += '<details class="ot-details"><summary>التفاصيل يوم بيوم</summary><table class="ot-table"><thead><tr><th>الموظف</th><th>اليوم</th><th>نهاية الشيفت</th><th>انصرف</th><th>آخر دكتور</th><th>بعد الشيفت</th><th>المحسوب</th><th>السبب / المهمة / الموافقة</th></tr></thead><tbody>' + r.report.map(function (x) {
        var q = (x.requests || []).map(function (z) { return '<div><span class="ot-st is-' + esc(z.status) + '">' + esc(ST[z.status] || z.status) + "</span> " + esc(z.reason) + (z.task_title ? " — مهمة: <b>" + esc(z.task_title) + "</b>" + (z.task_description ? " <small>(" + esc(z.task_description) + ")</small>" : "") : "") + (z.expected_minutes ? " · المتوقع " + mins(z.expected_minutes) : "") + (z.approved_minutes != null ? " · المعتمد " + mins(z.approved_minutes) : "") + (z.extra_reason ? " · سبب الزيادة: " + esc(z.extra_reason) : "") + (z.reviewed_by ? " · " + esc(z.reviewed_by) : "") + "</div>"; }).join("");
        return "<tr" + (x.flag ? ' class="is-flag"' : "") + "><td>" + esc(x.name) + "</td><td>" + esc(x.day) + "</td><td>" + hm(x.scheduled_end) + "</td><td>" + hm(x.actual_end) + "</td><td>" + hm(x.close_at) + "</td><td>" + mins(x.capped_min) + (x.recorded_min > x.capped_min ? ' <small>(' + mins(x.recorded_min) + " لحد الانصراف)</small>" : "") + "</td><td><b>" + mins(x.counted_min) + "</b></td><td>" + (q || '<span class="ot-flag">بدون إذن</span>') + "</td></tr>";
      }).join("") + "</tbody></table></details>";
      html += "</section>";
    }
    // settings
    if (r.can_settings) html += '<section class="ot-card"><h3>إعدادات الساعات الإضافية</h3><div class="ot-form">' +
      '<label class="ot-switch"><input type="checkbox" data-ot-pay ' + (r.settings.pay_enabled ? "checked" : "") + '> صرف الأوفر تايم في المرتب</label>' +
      '<label>سماح المهمة ٪<input type="number" min="0" max="200" data-ot-tol value="' + esc(r.settings.task_tolerance_pct) + '"></label>' +
      '<label>تنبيه لو قعد بدون إذن أكتر من (دقيقة)<input type="number" min="5" max="600" data-ot-alert value="' + esc(r.settings.alert_minutes) + '"></label>' +
      '<label>عدد المرات في الشهر علشان يتعلّم للموارد البشرية<input type="number" min="1" max="31" data-ot-rep value="' + esc(r.settings.repeat_count) + '"></label>' +
      '<button type="button" class="btn" data-ot-save-settings>حفظ الإعدادات</button></div></section>';
    el.innerHTML = html + "</div>";
    wire();
  }
  function wire() {
    var el = state.el, f = el.querySelector("[data-ot-form]");
    if (f) f.onsubmit = function (e) {
      e.preventDefault(); var b = f.querySelector("[type=submit]"); b.disabled = true;
      var E = f.elements, v = { day: E.day.value, minutes: Number(E.minutes.value), reason: E.reason.value, task_id: E.task_id.value || null };
      if (E.person_id && E.person_id.value) v.person_id = E.person_id.value;
      rpc("request", v).then(function () { return load(); }).then(function () { msg("اتبعت الطلب وهو مستني الموافقة"); }).catch(function (er) { b.disabled = false; msg(er.message, true); });
    };
    el.querySelectorAll("[data-ot-cancel]").forEach(function (b) { b.onclick = function () { rpc("cancel", { id: b.getAttribute("data-ot-cancel") }).then(load).catch(function (er) { msg(er.message, true); }); }; });
    el.querySelectorAll("[data-ot-item]").forEach(function (card) {
      var id = card.getAttribute("data-ot-item"), val = function (s) { var n = card.querySelector(s); return n ? n.value : ""; };
      card.querySelector("[data-ot-approve]").onclick = function () {
        var b = this; b.disabled = true;
        rpc("review", { id: id, approve: true, approved_minutes: val("[data-ot-min]") === "" ? null : Number(val("[data-ot-min]")), expected_minutes: val("[data-ot-exp]") === "" ? null : Number(val("[data-ot-exp]")), extra_reason: val("[data-ot-extra]"), note: val("[data-ot-note]") })
          .then(function () { return load(); }).then(function () { msg("اتوافق على الطلب"); }).catch(function (er) { b.disabled = false; msg(er.message, true); });
      };
      card.querySelector("[data-ot-reject]").onclick = function () {
        var b = this; b.disabled = true;
        rpc("review", { id: id, approve: false, note: val("[data-ot-note]") }).then(function () { return load(); }).then(function () { msg("اترفض الطلب"); }).catch(function (er) { b.disabled = false; msg(er.message, true); });
      };
    });
    var m = el.querySelector("[data-ot-month]"); if (m) m.onchange = function () { if (m.value) { state.month = m.value; load(); } };
    var s = el.querySelector("[data-ot-save-settings]");
    if (s) s.onclick = function () {
      var q = function (x) { return el.querySelector(x); };
      rpc("settings", { pay_enabled: q("[data-ot-pay]").checked, task_tolerance_pct: Number(q("[data-ot-tol]").value), alert_minutes: Number(q("[data-ot-alert]").value), repeat_count: Number(q("[data-ot-rep]").value) })
        .then(function () { return load(); }).then(function () { msg("اتحفظت الإعدادات"); }).catch(function (er) { msg(er.message, true); });
    };
  }
  function mount(host, active) {
    if (!host) return;
    var box = host.querySelector("[data-hr-overtime]"); if (!box) { box = d.createElement("div"); box.setAttribute("data-hr-overtime", ""); host.appendChild(box); }
    state.el = box; if (!state.month) state.month = today().slice(0, 7);
    if (active) load();
  }
  w.SSMPDHROvertime = { mount: mount, reload: load };
})(window, document);
