/* «تسليم تحصيل لزميل» (owner 2026-11-18). Server: public.clinic_finance_peer_handover(action, payload, token).
 *   openSend()  : the sender picks a colleague with an open shift and hands part of the collected cash, or ends the shift and hands all of it
 *                 (denomination count). Nothing moves until the colleague confirms.
 *   incoming    : polled every minute; the receiver sees «فلان عايز يسلّمك …», counts and presses «استلمت» (exact amount) or «رفض» (reason).
 * Entry points: the shift safe (reception-shift-reminder.js) and SSMPDPeerHandover.openSend().
 * Main treasury (20261122010000, owner «طبقه» 2026-11-21): when a main-treasury shift is open, 'options' returns `main` and the modal offers
 *   «الخزينة الرئيسية — <الاسم>» first. That choice does NOT use the peer path: it calls the existing clinic_finance_treasury_command
 *   ('end_shift' with the count, or 'transfer_request' for a part). The main custodian approves from «الخزائن والورديات». */
(function (w, d) {
  "use strict";
  var POLL_MS = 60000, DEN = ["200", "100", "50", "20", "10", "5", "1", "0.5", "0.25"], state = { busy: false, last: 0, seen: {}, nudged: {} };
  function rpc(action, payload, token) {
    var c = w.SSMPDDb && w.SSMPDDb.client; if (!c) return Promise.reject(Error("الاتصال مش جاهز"));
    return Promise.resolve(c.rpc("clinic_finance_peer_handover", { p_action: action, p_payload: payload || {}, p_token: token || null })).then(function (r) {
      if (r && r.error) throw Error(r.error.message || "تعذر التنفيذ"); return r ? r.data : null;
    });
  }
  function uuid() { return w.crypto && w.crypto.randomUUID ? w.crypto.randomUUID() : String(Date.now()) + Math.random(); }
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function money(v) { return Number(v || 0).toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 2 }) + " ج"; }
  function toast(m) { if (w.SSMPDToast) w.SSMPDToast.show(m); }
  function close(box) { if (box && box.parentNode) box.parentNode.removeChild(box); }
  function shell(title, body, attr) {
    var box = d.createElement("div"); box.className = "shift-reminder-backdrop peer-handover"; box.setAttribute(attr, "");
    box.innerHTML = '<div class="shift-reminder is-open" role="dialog" aria-modal="true"><h2></h2>' + body + '<p class="peer-status" role="status"></p></div>';
    box.querySelector("h2").textContent = title; d.body.appendChild(box);
    box.addEventListener("keydown", function (e) { if (e.key === "Escape") close(box); });
    return box;
  }
  function status(box, m) { box.querySelector(".peer-status").textContent = m || ""; }

  function openSend(opts) {
    opts = opts || {};
    if (d.querySelector("[data-peer-send]")) return Promise.resolve();
    return Promise.all([rpc("options"), rpc("inbox")]).then(function (r) {
      var o = r[0] || {}, mine = (r[1] && r[1].outgoing) || [];
      if (!o.shift) { var b0 = shell("تسليم تحصيل لزميل", '<p>لازم تكون فاتح وردية تحصيل علشان تسلّم منها.</p><div class="shift-reminder-actions"><button type="button" class="btn" data-peer-close>تمام</button></div>', "data-peer-send"); b0.querySelector("[data-peer-close]").onclick = function () { close(b0); }; return; }
      var cols = o.colleagues || [], main = o.main || null;
      var body = '<p>من وردية «' + esc(o.shift.register) + '» — الكاش المتاح للتسليم: <b>' + money(o.shift.available) + '</b>. الفلوس مش هتتنقل غير لما زميلك يعدّها ويدوس «استلمت».</p>' +
        (mine.length ? '<div class="peer-pending">' + mine.map(function (h) { return '<p>تسليم معلّق لـ ' + esc(h.to_name) + ': <b>' + money(h.amount) + '</b> <button type="button" class="btn" data-peer-cancel="' + esc(h.id) + '">إلغاء التسليم</button></p>'; }).join("") + '</div>' : '') +
        (main ? '' : '<p class="peer-main-off">وردية الخزينة الرئيسية مش مفتوحة دلوقتي، فمش هتظهر في القايمة. لو عايز تسلّم للرئيسية خلّي المسؤول يفتح ورديتها الأول.</p>') +
        (cols.length || main ? '<form data-peer-form class="peer-form"><label>سلّم لـ<select name="to" required><option value="">اختار زميلك أو الخزينة الرئيسية</option>' +
          (main ? '<option value="main">' + esc(main.register || 'الخزينة الرئيسية') + ' — ' + esc(main.name) + '</option>' : '') + cols.map(function (c) { return '<option value="' + esc(c.shift_id) + '">' + esc(c.name) + ' — ' + esc(c.register) + '</option>'; }).join("") + '</select></label>' +
          '<p class="peer-main-hint" data-peer-main-hint hidden>التسليم للخزينة الرئيسية بيروح لـ ' + esc(main ? main.name : '') + '، وهو اللي يعدّ ويضغط «استلمت النقد فعليًا — اعتماد» من «الخزائن والورديات». الفلوس بتفضل في عهدتك لحد ما يعتمد.</p>' +
          '<label class="peer-mode"><input type="radio" name="mode" value="part" checked> جزء من التحصيل (وأكمّل ورديتي)</label>' +
          '<label class="peer-mode"><input type="radio" name="mode" value="end"> إنهاء ورديتي وتسليم كل الكاش</label>' +
          '<label data-peer-amount>المبلغ<input name="amount" type="number" min="0.01" step="0.01" max="' + esc(o.shift.available) + '"></label>' +
          '<div data-peer-counts hidden><p>عدّ الكاش اللي معاك فئة فئة:</p><div class="fc-counts">' + DEN.map(function (n) { return '<label>فئة ' + n + '<input name="c' + n + '" type="number" min="0" step="1" value="0"></label>'; }).join("") + '</div><p data-peer-total></p></div>' +
          '<label>ملاحظة (اختياري)<input name="note" maxlength="500"></label>' +
          '<div class="shift-reminder-actions"><button type="submit" class="btn btn-primary">سلّم</button><button type="button" class="btn" data-peer-close>إلغاء</button></div></form>'
          : '<p>مفيش زميل فاتح وردية دلوقتي. زميلك لازم يفتح ورديته الأول.</p><div class="shift-reminder-actions"><button type="button" class="btn" data-peer-close>تمام</button></div>');
      var box = shell("تسليم تحصيل لزميل", body, "data-peer-send");
      Array.prototype.forEach.call(box.querySelectorAll("[data-peer-close]"), function (b) { b.onclick = function () { close(box); }; });
      Array.prototype.forEach.call(box.querySelectorAll("[data-peer-cancel]"), function (b) {
        b.onclick = function () { b.disabled = true; rpc("cancel", { id: b.getAttribute("data-peer-cancel") }, uuid()).then(function () { close(box); toast("اتلغى التسليم"); openSend(); }, function (e) { b.disabled = false; status(box, e.message); }); };
      });
      var f = box.querySelector("[data-peer-form]"); if (!f) return;
      function total() { return DEN.reduce(function (n, k) { return n + Number(k) * (Math.max(0, Math.floor(+f.elements["c" + k].value || 0))); }, 0); }
      function sync() {
        var end = f.elements.mode.value === "end"; f.querySelector("[data-peer-counts]").hidden = !end; f.querySelector("[data-peer-amount]").hidden = end;
        f.elements.amount.required = !end; f.querySelector("[data-peer-total]").textContent = "الإجمالي: " + money(total());
        f.querySelector("[data-peer-main-hint]").hidden = f.elements.to.value !== "main";
      }
      if (opts.to === "main" && main) f.elements.to.value = "main";   // opened from a «سلّم الكاش» nudge
      f.addEventListener("change", sync); f.addEventListener("input", sync); sync();
      var token = uuid();
      f.onsubmit = function (e) {
        e.preventDefault(); if (state.busy) return; var end = f.elements.mode.value === "end", p = { from_shift: o.shift.id, to_shift: f.elements.to.value, note: f.elements.note.value };
        if (end) { var counts = {}; DEN.forEach(function (k) { counts[k] = Math.max(0, Math.floor(+f.elements["c" + k].value || 0)); }); p.end_shift = true; p.counts = counts; if (!(total() > 0)) { status(box, "اكتب الكاش اللي معاك"); return; } }
        else p.amount = Number(f.elements.amount.value);
        state.busy = true; status(box, "جاري التسليم…");
        if (f.elements.to.value === "main") {
          var cmd = end ? ["end_shift", { shift_id: o.shift.id, counts: p.counts, note: p.note }]
            : ["transfer_request", { from_shift: o.shift.id, to_register: main.register_id, amount: p.amount, reference: "HO-" + new Date().toISOString().slice(0, 16).replace(/[-:T]/g, ""), reason: (p.note || "").trim().length >= 3 ? p.note.trim() : "تسليم تحصيل للخزينة الرئيسية" }];
          Promise.resolve(w.SSMPDDb.financeTreasuryCommand(cmd[0], cmd[1], token)).then(function (r) {
            close(box); toast("اتبعت للخزينة الرئيسية — مستني " + main.name + " يعدّ ويأكد الاستلام" + (end ? " (" + money(total()) + ")" : " (" + money(p.amount) + ")"));
            if (w.SSMPDShiftReminder) w.SSMPDShiftReminder.refresh();
          }, function (err) { status(box, (err && err.message) || "تعذر التسليم"); }).then(function () { state.busy = false; });
          return;
        }
        rpc("request", p, token).then(function (h) { close(box); toast("اتبعت لـ " + h.to_name + " — مستني يأكد الاستلام (" + money(h.amount) + ")"); if (w.SSMPDShiftReminder) w.SSMPDShiftReminder.refresh(); },
          function (err) { status(box, err.message); }).then(function () { state.busy = false; });
      };
    }).catch(function (e) { toast(e.message || "تعذر فتح التسليم"); });
  }

  function incoming(h) {
    if (d.querySelector("[data-peer-in]")) return;
    var box = shell("استلام تحصيل من زميل", '<p><b>' + esc(h.from_name) + '</b> عايز يسلّمك <b>' + money(h.amount) + '</b>' + (h.end_of_shift ? ' (نهاية ورديته)' : '') + '.' + (h.note ? ' ملاحظته: ' + esc(h.note) : '') + ' عدّ الفلوس واكتب المبلغ اللي استلمته.</p>' +
      '<form class="peer-form"><label>المبلغ اللي عدّيته<input name="counted" type="number" min="0" step="0.01" required></label><label>ملاحظة / سبب الرفض<input name="note" maxlength="500"></label>' +
      '<div class="shift-reminder-actions"><button type="submit" class="btn btn-primary">استلمت</button><button type="button" class="btn" data-peer-reject>رفض</button><button type="button" class="btn" data-peer-later>بعدين</button></div></form>', "data-peer-in");
    var f = box.querySelector("form");
    box.querySelector("[data-peer-later]").onclick = function () { state.seen[h.id] = Date.now(); close(box); };
    box.querySelector("[data-peer-reject]").onclick = function () {
      if ((f.elements.note.value || "").trim().length < 3) { status(box, "اكتب سبب الرفض في الملاحظة"); f.elements.note.focus(); return; }
      rpc("reject", { id: h.id, note: f.elements.note.value }, uuid()).then(function () { close(box); toast("اترفض التسليم والفلوس فضلت على زميلك"); }, function (e) { status(box, e.message); });
    };
    f.onsubmit = function (e) {
      e.preventDefault();
      rpc("accept", { id: h.id, counted: Number(f.elements.counted.value), note: f.elements.note.value }, uuid()).then(function () { close(box); toast("استلمت " + money(h.amount) + " وانضافوا على ورديتك"); if (w.SSMPDShiftReminder) w.SSMPDShiftReminder.refresh(); },
        function (err) { status(box, err.message); });
    };
  }

  function poll(force) {
    if (!(w.SSMPDAuth && w.SSMPDAuth.currentAdmin) || !(w.SSMPDDb && w.SSMPDDb.client)) return;
    if (!force && (Date.now() - state.last < POLL_MS || d.hidden)) return;
    state.last = Date.now();
    rpc("inbox", {}, null).then(function (r) {
      var list = (r && r.incoming) || [], next = list.find(function (h) { return !state.seen[h.id] || Date.now() - state.seen[h.id] > 5 * 60000; });
      if (next) incoming(next); else nudges();
    }).catch(function () {});
  }
  /* «سلّم الكاش» (20261122050000): the finance reviewer asked me to hand over; «سلّم دلوقتي» opens the handover with the main treasury chosen */
  function nudges() {
    if (d.querySelector("[data-peer-send],[data-peer-in],[data-peer-nudge]")) return;
    Promise.resolve(w.SSMPDDb.client.rpc("clinic_finance_my_handover_nudges", {})).then(function (r) {
      var list = (r && !r.error && r.data) || [], n = list.find(function (x) { return !state.nudged[x.id] || Date.now() - state.nudged[x.id] > 10 * 60000; });
      if (!n || d.querySelector("[data-peer-send],[data-peer-in],[data-peer-nudge]")) return;
      var box = shell("مطلوب منك تسلّم الكاش", '<p><b>' + esc(n.from_name) + '</b> طالب منك تسلّم كاش وردية «' + esc(n.register) + '» للخزينة الرئيسية.' + (n.note ? ' ملاحظته: ' + esc(n.note) : '') + '</p>' +
        '<div class="shift-reminder-actions"><button type="button" class="btn btn-primary" data-nudge-go>سلّم دلوقتي</button><button type="button" class="btn" data-nudge-later>بعدين</button></div>', "data-peer-nudge");
      box.querySelector("[data-nudge-later]").onclick = function () { state.nudged[n.id] = Date.now(); close(box); };
      box.querySelector("[data-nudge-go]").onclick = function () {
        close(box); state.nudged[n.id] = Date.now();
        Promise.resolve(w.SSMPDDb.client.rpc("clinic_finance_handover_nudge_seen", { p_id: n.id })).catch(function () {});
        openSend({ to: "main" });
      };
    }).catch(function () {});
  }
  w.SSMPDPeerHandover = { openSend: openSend, poll: function () { poll(true); } };
  w.setInterval(function () { poll(false); }, 15000);
  w.setTimeout(function () { poll(true); }, 4000);
})(window, document);
