/* «صرف حساب الطبيب» from reception (owner 2026-11-17). Server: public.clinic_reception_doctor_payout(action, payload, token).
 *  Today board doctor strip ([data-doctor-pay] slots from today-operations.js):
 *    orange «صرف الحساب»  : the doctor's day is done (no patient left, none owes money) and there is a payable amount
 *    «معلّق»              : request waiting for an approver (financial manager / general manager / super admin / granted account)
 *    orange «سلّم الحساب» : approved — hand the cash and print the receipt
 *    green «تم الصرف»     : handed today, nothing else payable or held
 *    orange «صرف جزئي»    : handed today but part of the doctor's account is still payable or held
 *  «حساب الطبيب» window: total computed by the dashboard (reception never types it), «التفاصيل» per invoice, request, print the
 *  cash receipt for the doctor's signature, «سلّمت الفلوس»; uploading the signed receipt is optional and can be done later.
 *  Approvers get a floating «صرف أطباء» badge with every pending request (approve / change the amount with a reason / reject).
 *  Nothing here moves money by itself: the server checks roles, maker-checker, the payable amount and the shift cash. */
(function (w, d) {
  "use strict";
  var BUCKET = "doctor-payout-receipts", cache = {}, approver = { known: false, is: false, items: [], last: 0, busy: false };
  function db() { return w.SSMPDDb && w.SSMPDDb.client; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function money(v) { return Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + " ج"; }
  function when(v) { return v ? new Date(v).toLocaleString("ar-EG-u-nu-latn", { timeZone: "Africa/Cairo", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""; }
  function uuid() { return w.crypto && w.crypto.randomUUID ? w.crypto.randomUUID() : String(Date.now()) + Math.random(); }
  function rpc(action, payload, token) {
    var c = db(); if (!c) return Promise.reject(Error("الاتصال غير متاح"));
    return Promise.resolve(c.rpc("clinic_reception_doctor_payout", { p_action: action, p_payload: payload || {}, p_token: token || null })).then(function (r) {
      if (r && r.error) throw Error(r.error.message || "تعذر التنفيذ"); return r ? r.data : null; });
  }
  function toast(msg, bad) { if (w.SSMPDToast) return w.SSMPDToast(msg, bad ? "error" : "success"); var t = d.createElement("div"); t.className = "dp-toast" + (bad ? " is-bad" : ""); t.setAttribute("role", "status"); t.textContent = msg; d.body.appendChild(t); setTimeout(function () { t.remove(); }, 3500); }

  /* ---------- doctor strip slots ---------- */
  function slotButton(row, finished) {
    var s = row && row.state;
    if (!row || !row.linked) return "";
    if (s === "pending") return '<button type="button" class="dp-pill is-pending" data-dp-open>معلّق</button>';
    if (s === "approved") return '<button type="button" class="dp-pill is-due" data-dp-open>سلّم الحساب</button>';
    if (s === "paid") return '<button type="button" class="dp-pill is-paid" data-dp-open>✓ تم الصرف</button>';
    if (s === "partial") return '<button type="button" class="dp-pill is-due" data-dp-open>صرف جزئي</button>';
    if (s === "ready") return '<button type="button" class="dp-pill is-due" data-dp-open>صرف الحساب</button>';
    return "";
  }
  function board(ws, day, force) {
    var k = ws + "|" + day, c = cache[k];
    if (c && !force && Date.now() - c.at < 30000) return c.p;
    var p = rpc("board", { workspace_id: ws, day: day }).then(function (r) { var by = {}; ((r && r.doctors) || []).forEach(function (x) { by[x.provider_id] = x; }); approver.known = true; approver.is = !!(r && r.approver); return by; });
    cache[k] = { at: Date.now(), p: p }; p.catch(function () { delete cache[k]; });
    return p;
  }
  function fill(section, force) {
    var ws = section.getAttribute("data-doctor-pay-workspace"), day = section.getAttribute("data-doctor-pay-day") || "";
    if (!ws || section.__dpBusy) return; section.__dpBusy = true;
    board(ws, day, force).then(function (by) {
      section.querySelectorAll("[data-doctor-pay]").forEach(function (slot) {
        var id = slot.getAttribute("data-doctor-pay"), row = by[id];
        slot.innerHTML = slotButton(row, slot.getAttribute("data-finished") === "1");
        var b = slot.querySelector("[data-dp-open]"); if (b) b.onclick = function (e) { e.preventDefault(); e.stopPropagation(); open(ws, id, day); };
      });
      section.__dpFilled = true;
    }).catch(function () {}).then(function () { section.__dpBusy = false; });
  }
  function scan(force) { d.querySelectorAll("[data-doctor-pay-workspace]").forEach(function (s) { if (force || !s.__dpFilled) fill(s, force); }); }
  function refreshAll() { cache = {}; scan(true); }

  /* ---------- «حساب الطبيب» window ---------- */
  function overlay(title) {
    var o = d.createElement("div"); o.className = "dp-backdrop"; o.setAttribute("data-dp-modal", "");
    o.innerHTML = '<div class="dp-modal" role="dialog" aria-modal="true" aria-labelledby="dp-title"><header><h2 id="dp-title"></h2><button type="button" class="dp-x" aria-label="إغلاق">×</button></header><div class="dp-body"><p role="status">جاري التحميل…</p></div></div>';
    o.querySelector("h2").textContent = title; d.body.appendChild(o);
    function close() { o.remove(); }
    o.querySelector(".dp-x").onclick = close; o.addEventListener("click", function (e) { if (e.target === o) close(); });
    o.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
    o.querySelector(".dp-x").focus();
    return { el: o, body: o.querySelector(".dp-body"), close: close };
  }
  function invoiceTable(list) {
    if (!list || !list.length) return '<p class="dp-muted">مفيش حالات مستحقة دلوقتي.</p>';
    return '<table class="dp-table"><thead><tr><th>الحالة</th><th>التاريخ</th><th>قيمة الفاتورة</th><th>أتعاب الطبيب</th></tr></thead><tbody>' + list.map(function (i) {
      return "<tr><td>" + esc(i.description) + ' <small class="dp-muted">' + esc(i.reference) + "</small></td><td>" + esc(when(i.created_at)) + "</td><td>" + money(i.amount) + "</td><td><strong>" + money(i.fee) + "</strong></td></tr>";
    }).join("") + "</tbody></table>";
  }
  function stateLine(r) {
    return { ready: "جاهز للصرف", pending: "معلّق — مستني اعتماد المدير المالي أو المدير العام أو السوبر أدمن", approved: "اتعتمد — سلّم الفلوس للدكتور واطبع الإيصال",
      paid: "تم الصرف", partial: "صرف جزئي — فيه جزء من حسابه لسه", nothing: "مفيش مبلغ مستحق دلوقتي", unlinked: "الدكتور مش مربوط بعقد أتعاب في الحسابات" }[r.state] || "";
  }
  /* «راجع قبل ما تطلب الصرف» (owner 2026-11-27, mig 20261127140000, help 329): every case with its price, what was removed first and the
     doctor share; «شيل الحالة» leaves a case for the next payout, «المبلغ» can only go LOWER, and any change needs a reason. The request
     still waits for the approver, who sees the change (reception_review). */
  function pct(fee, base) { return base > 0 ? Math.round(fee / base * 100) + "%" : ""; }
  function reviewHtml(r) {
    var list = r.invoices || [];
    return '<section class="dp-review" data-dp-review><h3 class="dp-h">راجع قبل ما تطلب الصرف</h3><div class="dp-rv-list">' + list.map(function (i) {
      var base = Number(i.amount) || 0, cut = Number(i.discount) || 0;
      return '<div class="dp-rv-row" data-dp-case="' + esc(i.invoice_id) + '" data-fee="' + esc(i.fee) + '"><span class="dp-rv-name">' + esc(i.description) + (i.patient ? " — " + esc(i.patient) : "") +
        '<small>' + esc(i.reference) + " · " + esc(when(i.created_at)) + "</small></span>" +
        '<span class="dp-rv-num">' + money(i.gross != null ? i.gross : base) + (cut > 0 ? '<small class="dp-neg">خصم <bdi dir="ltr">−' + money(cut) + "</bdi></small>" : "") + "</span>" +
        '<span class="dp-rv-num"><b>' + money(i.fee) + "</b><small>" + esc(pct(Number(i.fee), base)) + (base ? " من " + money(base) : "") + "</small></span>" +
        '<button type="button" class="btn btn-sm dp-rv-x" data-dp-drop>✕ شيل الحالة</button></div>';
    }).join("") + "</div>" +
      '<p class="dp-muted">الحالة اللي بتتشال مبتضيعش: بتفضل للدكتور وتظهر في الصرف الجاي.</p>' +
      '<div class="dp-facts"><span>المحسوب للحالات دي: <b data-dp-kept>' + money(r.payable) + "</b></span><span>محجوز لحد ما المرضى يدفعوا: <b>" + money(r.held) + "</b></span><span>اتصرف النهارده: <b>" + money(r.paid_today) + "</b></span></div>" +
      '<div class="dp-rv-ask"><label>المبلغ اللي هتطلبه<input type="number" min="0.01" step="0.01" inputmode="decimal" data-dp-amount value="' + esc(r.payable) + '"></label>' +
      '<label>السبب (إجباري لو شلت حالة أو قللت المبلغ)<input type="text" maxlength="300" data-dp-reason placeholder="مثلاً: الدكتور هيستلم الباقي بكرة"></label>' +
      '<p class="dp-muted">مينفعش أكتر من المحسوب. الطلب بيروح للي بيعتمد، وهو شايف التعديل والسبب.</p></div></section>';
  }
  function reviewNote(p) {
    var v = p && p.reception_review; if (!v) return "";
    return '<p class="dp-note dp-rv-note" data-dp-rv-note>الاستقبال عدّل الطلب: المحسوب ' + money(v.computed_full) + (v.removed && v.removed.length ? " — شال " + v.removed.length + " حالة (" + v.removed.map(function (x) { return esc(x.description || x.reference); }).join("، ") + ")" : "") +
      " — طلب " + money(v.requested_gross) + " · السبب: " + esc(v.note) + "</p>";
  }
  function open(ws, providerId, day) {
    var m = overlay("حساب الطبيب");
    function load() {
      return rpc("detail", { workspace_id: ws, provider_id: providerId, day: day }).then(function (r) { draw(r); }).catch(function (e) { m.body.innerHTML = '<p class="dp-error" role="alert">' + esc(e.message) + "</p>"; });
    }
    function draw(r) {
      m.el.querySelector("h2").textContent = "حساب الطبيب — " + (r.name || "");
      var cur = r.pending ? (r.payouts || []).find(function (p) { return p.id === r.pending.id; }) : r.approved ? (r.payouts || []).find(function (p) { return p.id === r.approved.id; }) : null;
      var html = '<section class="dp-total is-' + esc(r.state) + '"><span>المستحق للصرف دلوقتي</span><strong>' + money(r.payable) + "</strong><small>" + esc(stateLine(r)) + "</small></section>" +
        '<div class="dp-facts"><span>محجوز لحد ما المرضى يدفعوا: <b>' + money(r.held) + "</b></span><span>اتصرف النهارده: <b>" + money(r.paid_today) + "</b></span></div>" +
        '<details class="dp-details"><summary>التفاصيل (' + (r.invoices || []).length + " حالة)</summary>" + invoiceTable(r.invoices) + "</details>";
      var actions = "";
      if (r.state === "pending" && cur) actions += '<p class="dp-note">طلب ' + money(cur.gross) + " من " + esc(cur.requested_by) + " — " + esc(when(cur.created_at)) + "</p>" + reviewNote(cur) + (approver.is ? '<button type="button" class="btn" data-dp-approvals>افتح الاعتماد</button>' : "");
      else if (r.state === "approved" && cur) actions += '<p class="dp-note">اتعتمد ' + money(cur.gross) + " من " + esc(cur.reviewed_by) + (cur.adjust_note ? " — اتعدّل: " + esc(cur.adjust_note) : "") + '</p>' + reviewNote(cur) + '<button type="button" class="btn" data-dp-print="' + esc(cur.id) + '">اطبع إيصال الاستلام</button><button type="button" class="btn btn-primary dp-go" data-dp-hand="' + esc(cur.id) + '">سلّمت الفلوس للدكتور</button>';
      else if (Number(r.payable) > 0 && !r.pending) actions += reviewHtml(r) + '<button type="button" class="btn btn-primary dp-go" data-dp-request>اطلب صرف ' + money(r.payable) + "</button>";
      html += '<div class="dp-actions">' + actions + "</div>";
      var done = (r.payouts || []).filter(function (p) { return p.status === "approved"; });
      if (done.length) html += '<h3 class="dp-h">الصرف اللي اتعمل</h3><ul class="dp-list">' + done.map(function (p) {
        return '<li><div><b>' + money(p.gross) + "</b> · " + esc(when(p.reviewed_at)) + (p.handed_at ? ' · <span class="dp-ok">اتسلّم</span>' : ' · <span class="dp-warn">لسه ما اتسلّمش</span>') + "</div><div class=\"dp-row-actions\">" +
          '<button type="button" class="btn btn-sm" data-dp-print="' + esc(p.id) + '">طباعة الإيصال</button>' +
          (p.handed_at ? (p.receipt_path ? '<button type="button" class="btn btn-sm" data-dp-view="' + esc(p.receipt_path) + '">عرض الإيصال الممضي</button>' : '<label class="btn btn-sm dp-upload">رفع الإيصال الممضي (اختياري)<input type="file" accept="image/*,application/pdf" data-dp-upload="' + esc(p.id) + '" hidden></label>') : "") + "</div></li>";
      }).join("") + "</ul>";
      m.body.innerHTML = html;
      var by = function (sel, fn) { m.body.querySelectorAll(sel).forEach(function (b) { b.onclick = function () { fn(b); }; }); };
      var rv = m.body.querySelector("[data-dp-review]"), reqBtn = m.body.querySelector("[data-dp-request]"), reqKey = uuid();
      function kept() { var t = 0; if (rv) rv.querySelectorAll("[data-dp-case]").forEach(function (row) { if (!row.classList.contains("is-off")) t += Number(row.getAttribute("data-fee")) || 0; }); return Math.round(t * 100) / 100; }
      function sync() { if (!rv || !reqBtn) return; var k = kept(), a = rv.querySelector("[data-dp-amount]"), v = Number(a.value);
        rv.querySelector("[data-dp-kept]").textContent = money(k); if (!(v > 0) || v > k || a.__auto) { a.value = k; a.__auto = true; v = k; }
        reqBtn.textContent = "اطلب صرف " + money(v); reqBtn.disabled = !(k > 0); }
      if (rv) {
        rv.querySelectorAll("[data-dp-drop]").forEach(function (b) { b.onclick = function () { var row = b.closest("[data-dp-case]"), off = row.classList.toggle("is-off");
          b.textContent = off ? "↺ رجّعها" : "✕ شيل الحالة"; reqKey = uuid(); sync(); }; });
        var amt = rv.querySelector("[data-dp-amount]"); amt.__auto = true; amt.oninput = function () { amt.__auto = false; reqKey = uuid(); var v = Number(amt.value); if (v > 0 && v <= kept()) reqBtn.textContent = "اطلب صرف " + money(v); };
        amt.onchange = function () { var v = Number(amt.value), k = kept(); if (!(v > 0) || v > k) { toast("المبلغ لازم يكون أكبر من صفر ومش أكتر من " + money(k), true); amt.__auto = true; } sync(); };
        rv.querySelector("[data-dp-reason]").oninput = function () { reqKey = uuid(); };
      }
      function payload() {
        var pl = { workspace_id: ws, provider_id: providerId }; if (!rv) return pl;
        var rm = [], k = kept(), v = Number(rv.querySelector("[data-dp-amount]").value), why = rv.querySelector("[data-dp-reason]").value.trim();
        rv.querySelectorAll("[data-dp-case].is-off").forEach(function (row) { rm.push(row.getAttribute("data-dp-case")); });
        if (!(k > 0)) throw Error("شلت كل الحالات — رجّع حالة على الأقل");
        if (!(v > 0) || v > k) throw Error("المبلغ لازم يكون أكبر من صفر ومش أكتر من " + money(k));
        var lower = Math.round(v * 100) < Math.round(k * 100);
        if (rm.length || lower) { if (why.length < 3) throw Error("اكتب السبب — ليه شلت حالة أو قللت المبلغ"); pl.remove = rm; if (lower) pl.gross = Math.round(v * 100) / 100; pl.note = why; }
        return pl;
      }
      by("[data-dp-request]", function (b) {
        var pl; try { pl = payload(); } catch (e) { toast(e.message, true); return; }
        b.disabled = true; rpc("request", pl, reqKey).then(function () { toast("اتطلب الصرف وهو معلّق لحد الاعتماد"); refreshAll(); load(); }).catch(function (e) { b.disabled = false; toast(e.message, true); }); });
      by("[data-dp-hand]", function (b) {
        if (!w.confirm("اتأكد إن الدكتور استلم الفلوس ومضى على الإيصال؟")) return;
        b.disabled = true; rpc("handover", { id: b.getAttribute("data-dp-hand") }).then(function () { toast("تم الصرف"); refreshAll(); load(); }).catch(function (e) { b.disabled = false; toast(e.message, true); }); });
      by("[data-dp-print]", function (b) { var p = (r.payouts || []).find(function (x) { return x.id === b.getAttribute("data-dp-print"); }); if (p) printReceipt(p, r); });
      by("[data-dp-view]", function (b) { viewReceipt(b.getAttribute("data-dp-view")); });
      by("[data-dp-approvals]", function () { m.close(); approvals(); });
      m.body.querySelectorAll("[data-dp-upload]").forEach(function (inp) { inp.onchange = function () { upload(inp.getAttribute("data-dp-upload"), inp.files && inp.files[0]).then(load); }; });
    }
    load();
  }
  function upload(id, file) {
    if (!file) return Promise.resolve();
    if (file.size > 10 * 1024 * 1024) { toast("الملف أكبر من 10 ميجا", true); return Promise.resolve(); }
    var ext = (/\.([a-z0-9]{2,5})$/i.exec(file.name || "") || [, "jpg"])[1].toLowerCase(), path = id + "/receipt-" + Date.now() + "." + ext, c = db();
    return Promise.resolve(c.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined })).then(function (r) {
      if (r && r.error) throw Error(r.error.message); return rpc("receipt", { id: id, path: path });
    }).then(function () { toast("اترفع الإيصال"); }).catch(function (e) { toast("تعذر رفع الإيصال: " + e.message, true); });
  }
  function viewReceipt(path) {
    var c = db(); Promise.resolve(c.storage.from(BUCKET).createSignedUrl(path, 120)).then(function (r) { if (r.error) throw Error(r.error.message); w.open(r.data.signedUrl, "_blank", "noopener"); }).catch(function (e) { toast(e.message, true); });
  }
  function printReceipt(p, r) {
    /* owner 2026-11-19: letterhead look (docs/ui-references/PRINT-DOCUMENTS.md, mockup doctor-payout-receipt.html) */
    var win = w.open("", "_blank"); if (!win) { toast("اسمح بفتح النوافذ علشان تطبع", true); return; }
    var P = w.SSMPDPrint, list = p.invoices || [];
    var rows = list.map(function (i, n) { return "<tr><td>" + (n + 1) + '</td><td class="ltr">' + esc(i.reference) + '</td><td class="n">' + esc(i.description) + "</td><td>" + esc(i.basis || i.kind || "") + "</td><td>" + P.money(i.fee) + "</td></tr>"; });
    var body = P.title("إيصال استلام مستحقات طبيب", "رقم الصرف", p.reference) +
      P.meta([["الطبيب", r.name || p.doctor_name], ["القسم", r.department || p.department], ["التاريخ", P.stamp(p.reviewed_at || p.created_at), 1], ["طلبه", p.requested_by || p.created_by_name], ["اعتمده", p.reviewed_by], ["الخزينة", p.register_name]]) +
      P.table(["م", "الفاتورة", "الحالة / الخدمة", "البند", "المستحق"], rows, '<tr class="tot"><td colspan="4">إجمالي المصروف</td><td>' + P.money(p.gross) + "</td></tr>") +
      '<div class="sum"><div class="box"><h4>الصرف</h4>' + P.kv("المبلغ المستلم نقدًا", P.money(p.gross) + " ج.م", "big") + P.kv("المبلغ بالحروف", esc(P.words(p.gross))) + "</div>" +
      '<div class="box"><h4>إقرار</h4><p>استلمت أنا ' + esc(r.name || p.doctor_name || "") + " المبلغ ده قيمة أتعابي عن الحالات الموضحة.</p></div></div>" +
      P.sig([["توقيع الطبيب (المستلم)", "الاسم والتوقيع"], ["توقيع موظف الاستقبال", p.requested_by || ""], ["ختم المركز", ""]]) +
      '<div class="note">الأسعار بالجنيه المصري. كل بند مربوط بفاتورة الزيارة.</div>';
    P.open(P.documentHtml("إيصال صرف " + (p.reference || ""), list.length > 12 ? P.flow(body) : P.page(body)), win);
  }

  /* ---------- approvers ---------- */
  function approvals() {
    var m = overlay("طلبات صرف حسابات الأطباء");
    function load() { return rpc("pending_list", {}).then(function (r) { approver.items = (r && r.items) || []; badge(); draw(r || {}); }).catch(function (e) { m.body.innerHTML = '<p class="dp-error" role="alert">' + esc(e.message) + "</p>"; }); }
    function draw(r) {
      var items = approver.items;
      if (!items.length) { m.body.innerHTML = '<p class="dp-muted">مفيش طلبات معلّقة.</p>'; return; }
      m.body.innerHTML = items.map(function (p) {
        return '<article class="dp-card" data-dp-item="' + esc(p.id) + '"><header><h3>' + esc(p.doctor_name) + '</h3><strong>' + money(p.gross) + "</strong></header>" +
          '<p class="dp-muted">طلبه ' + esc(p.requested_by) + " — " + esc(when(p.created_at)) + "</p>" + reviewNote(p) +
          '<details class="dp-details"><summary>التفاصيل (' + (p.invoices || []).length + " حالة)</summary>" + invoiceTable(p.invoices) + "</details>" +
          '<div class="dp-approve"><label>المبلغ<input type="number" min="0.01" step="0.01" value="' + esc(p.gross) + '" data-dp-gross></label><label>ملاحظة / سبب التعديل أو الرفض<input type="text" maxlength="200" data-dp-note></label></div>' +
          '<div class="dp-actions"><button type="button" class="btn btn-primary dp-ok-btn" data-dp-approve>اعتماد الصرف</button><button type="button" class="btn dp-reject" data-dp-reject>رفض</button></div></article>';
      }).join("");
      m.body.querySelectorAll("[data-dp-item]").forEach(function (card) {
        var id = card.getAttribute("data-dp-item"), g = card.querySelector("[data-dp-gross]"), n = card.querySelector("[data-dp-note]");
        card.querySelector("[data-dp-approve]").onclick = function () {
          var b = this; b.disabled = true; var pl = { id: id, note: n.value };
          var item = items.find(function (x) { return x.id === id; }); if (Number(g.value) !== Number(item.gross)) pl.gross = Number(g.value);
          rpc("approve", pl).then(function () { toast("اتعتمد الصرف"); refreshAll(); load(); }).catch(function (e) { b.disabled = false; toast(e.message, true); });
        };
        card.querySelector("[data-dp-reject]").onclick = function () {
          var b = this; b.disabled = true;
          rpc("reject", { id: id, note: n.value }).then(function () { toast("اترفض الطلب"); refreshAll(); load(); }).catch(function (e) { b.disabled = false; toast(e.message, true); });
        };
      });
    }
    load();
  }
  function badge() {
    var el = d.querySelector("[data-dp-badge]"), n = approver.items.length;
    if (!approver.is || !n) { if (el) el.remove(); return; }
    if (!el) { el = d.createElement("button"); el.type = "button"; el.className = "dp-badge"; el.setAttribute("data-dp-badge", ""); el.onclick = approvals; d.body.appendChild(el); }
    el.innerHTML = '<span aria-hidden="true">₤</span> صرف أطباء <b>' + n + "</b>"; el.setAttribute("aria-label", n + " طلب صرف حساب طبيب مستني الاعتماد");
    place(el);
  }
  function place(el) {
    var top = w.innerHeight, H = w.innerHeight;
    Array.prototype.forEach.call(d.body.querySelectorAll("body *"), function (n) {
      if (n === el || el.contains(n) || n.closest("[data-dp-modal],[data-shift-reminder]")) return;
      var cs = w.getComputedStyle(n); if (cs.position !== "fixed" || cs.display === "none") return;
      var r = n.getBoundingClientRect(); if (!r.width || r.left > 160 || r.bottom < H - 320 || r.height > 200) return;
      top = Math.min(top, r.top);
    });
    el.style.bottom = (top < H ? Math.round(H - top + 12) : 20) + "px";
  }
  function pollApprovals() {
    var a = w.SSMPDAuth && w.SSMPDAuth.currentAdmin;
    if (!a || !db() || approver.busy || (approver.known && !approver.is && approver.admin === a.id) || Date.now() - approver.last < 60000) return;
    approver.busy = true; approver.last = Date.now(); approver.admin = a.id;
    rpc("pending_list", {}).then(function (r) { approver.known = true; approver.is = !!(r && r.approver); approver.items = (r && r.items) || []; badge(); })
      .catch(function () {}).then(function () { approver.busy = false; });
  }

  w.SSMPDDoctorPayout = { open: open, approvals: approvals, refresh: refreshAll, _scan: scan, _poll: function () { approver.last = 0; pollApprovals(); } };
  if (w.MutationObserver) new w.MutationObserver(function () { scan(false); }).observe(d.documentElement, { childList: true, subtree: true });
  w.setInterval(function () { scan(true); pollApprovals(); }, 60000);
  w.setTimeout(pollApprovals, 4000);
})(window, document);
