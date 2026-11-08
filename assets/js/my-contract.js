/* «عقدي» — doctor side of the online contracts (own file; no edits to app.js / roles.js / finance files).
   A doctor is whoever has an admin account LINKED to a doctor code (HR: clinic_people.people.admin_id <-> doctor_key). The server answers only for the caller's own code.
   - adds «عقدي» to the user menu (with a count of waiting contracts) and one toast when something waits; opens a full-page overlay with:
       * the professional-responsibility declaration (consent) when a published one has not been accepted yet — it blocks NOTHING, «لاحقًا» just closes it
       * each contract: the lawyer's text (versioned) + the generated schedule table, and «أوافق» / «أرفض مع سبب»
   Nothing shows when the account is not linked or the migration is not applied. */
(function () {
  'use strict';
  if (window.SSMPDMyContract) return;
  var state = { admin: null, inbox: null, overlay: null, busy: false };
  var BASIS = { performed: 'عند تنفيذ الخدمة', collected: 'حسب التحصيل' }, SCOPE = { service: 'الخدمة دون بنود المستلزمات', invoice: 'إجمالي الفاتورة' };
  var DEDUCT = { none: 'بدون خصم', cost: 'خصم تكلفة المستلزمات', sale: 'خصم سعر بيع المستلزمات' };
  var STATUS = { pending: 'بانتظار موافقتك', accepted: 'وافقت', rejected: 'رفضت' };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function day(ts) { return ts ? String(ts).slice(0, 10) : ''; }
  function rpc(name, args) {
    var db = window.SSMPDDb, c = db && db.client;
    if (!c || typeof c.rpc !== 'function') return Promise.reject(new Error('no client'));
    return Promise.resolve(c.rpc(name, args || {})).then(function (r) { if (r && r.error) throw r.error; return r ? r.data : null; });
  }
  function toast(msg, kind) { if (window.SSMPDToast && window.SSMPDToast.show) window.SSMPDToast.show(msg, kind); }

  function fee(r) { return r.fee_kind === 'fixed' ? 'مبلغ ثابت ' + Number(r.fixed_amount).toLocaleString('en-US') + ' ج' : 'نسبة ' + Number(r.rate).toLocaleString('en-US') + '%'; }
  function scheduleTable(rows) {
    return '<div class="fc-table"><table class="simple"><thead><tr><th>الخدمة / القسم</th><th>الأتعاب</th><th>الفترة</th><th>الاستحقاق</th><th>الوعاء</th><th>خصم المستلزمات</th></tr></thead><tbody>' +
      (rows || []).map(function (r) { return '<tr><td>' + esc(r.service) + '</td><td>' + esc(fee(r)) + '</td><td>' + esc(r.valid_from + ' → ' + r.valid_to) + '</td><td>' + esc(BASIS[r.basis] || r.basis) + '</td><td>' + esc(SCOPE[r.base_scope] || r.base_scope) + '</td><td>' + esc(DEDUCT[r.deduction] || r.deduction) + '</td></tr>'; }).join('') + '</tbody></table></div>';
  }
  function textOnly(r) { var i = r.text.indexOf('\n\nجدول الشروط المالية'); return i < 0 ? r.text : r.text.slice(0, i); }

  function consentHtml(c) {
    if (!c) return '';
    if (c.accepted_at) return '<section class="mc-card" data-mc-consent="done"><h3>' + esc(c.title) + '</h3><p class="fc-note">وافقت على الإقرار (نسخة ' + esc(c.version) + ') بتاريخ ' + esc(day(c.accepted_at)) + '.</p></section>';
    return '<section class="mc-card" data-mc-consent="open"><h3>' + esc(c.title) + ' — نسخة ' + esc(c.version) + '</h3><div class="mc-text" style="white-space:pre-wrap">' + esc(c.body) + '</div>' +
      '<p class="fc-note">الإقرار ده بيتعرض أول مرة (وكل ما تنزل نسخة جديدة). مش بيمنع أي شغل حاليًا.</p>' +
      '<div class="fc-actions"><button type="button" class="btn" data-mc-consent-accept>أقر وأوافق</button><button type="button" class="btn ghost" data-mc-close>لاحقًا</button></div></section>';
  }
  function requestHtml(r) {
    var head = '<h3>عقد — مرجع ' + esc(r.reference) + ' <small>(نسخة النص ' + esc(r.template_version) + ')</small></h3>';
    var body = '<div class="mc-text" style="white-space:pre-wrap">' + esc(textOnly(r)) + '</div><h4>الشروط المالية</h4>' + scheduleTable(r.schedule);
    var foot;
    if (r.status === 'pending' && r.stale) foot = '<p class="fc-note" data-mc-stale>النص أو الشروط اتغيّرت بعد الإرسال. اطلب من الحسابات إعادة إرسال العقد.</p>';
    else if (r.status === 'pending') foot = '<div class="fc-actions" data-mc-actions="' + esc(r.id) + '"><button type="button" class="btn" data-mc-accept="' + esc(r.id) + '">أوافق</button><button type="button" class="btn ghost" data-mc-reject="' + esc(r.id) + '">أرفض مع سبب</button></div>';
    else foot = '<p class="fc-note" data-mc-done>' + (r.status === 'accepted' ? 'وافقت على العقد بتاريخ ' + esc(day(r.decided_at)) : 'رفضت العقد بتاريخ ' + esc(day(r.decided_at)) + ' — السبب: ' + esc(r.reason || '')) + '</p>';
    return '<section class="mc-card" data-mc-request="' + esc(r.id) + '" data-mc-status="' + esc(r.status) + '">' + head + '<span class="fc-st-badge">' + esc(STATUS[r.status] || r.status) + '</span>' + body + foot + '</section>';
  }
  function pageHtml() {
    var i = state.inbox || {};
    var list = (i.requests || []);
    return '<div class="modal" role="dialog" aria-modal="true" aria-label="عقدي" dir="rtl" style="max-width:860px;width:96vw;max-height:92vh;overflow:auto"><div class="modal-head"><h2>عقدي</h2><button type="button" class="modal-close" aria-label="إغلاق" data-mc-close>×</button></div>' +
      '<p role="status" data-mc-status-line></p>' + consentHtml(i.consent) +
      (list.length ? list.map(requestHtml).join('') : '<p class="fc-empty">لا توجد عقود مرسلة إليك للتوقيع حتى الآن. هتوصلك إشعار هنا أول ما الحسابات ترسل لك عقدًا.</p>') + '</div>';
  }
  function line(msg) { var n = state.overlay && state.overlay.querySelector('[data-mc-status-line]'); if (n) n.textContent = msg || ''; }
  function close() { if (state.overlay) { state.overlay.remove(); state.overlay = null; } }
  function draw() {
    if (!state.overlay) return;
    state.overlay.innerHTML = pageHtml();
    state.overlay.onclick = onClick;
  }
  function reload() { return load().then(function () { draw(); updateBadge(); }); }
  function errText(e) { return (e && (e.message || e.details)) || 'تعذر تنفيذ العملية'; }

  function onClick(ev) {
    var t = ev.target && ev.target.closest ? ev.target.closest('button') : null; if (!t || state.busy) return;
    var id;
    if (t.hasAttribute('data-mc-close')) { close(); return; }
    if (t.hasAttribute('data-mc-consent-accept')) {
      var c = state.inbox.consent; state.busy = true;
      rpc('doctor_consent_accept', { p_template: c.template_id, p_sha: c.sha256, p_user_agent: navigator.userAgent }).then(function () { toast('تم تسجيل موافقتك على الإقرار', 'success'); return reload(); }, function (e) { line(errText(e)); }).then(function () { state.busy = false; });
      return;
    }
    if ((id = t.getAttribute('data-mc-accept'))) { decide(id, true, null); return; }
    if ((id = t.getAttribute('data-mc-reject'))) {
      var box = state.overlay.querySelector('[data-mc-actions="' + id + '"]');
      box.innerHTML = '<label class="fc-field">سبب الرفض<textarea name="reason" rows="3" data-mc-reason minlength="3" required></textarea></label><button type="button" class="btn" data-mc-reject-send="' + esc(id) + '">تأكيد الرفض</button> <button type="button" class="btn ghost" data-mc-close>إغلاق</button>';
      return;
    }
    if ((id = t.getAttribute('data-mc-reject-send'))) {
      var reason = (state.overlay.querySelector('[data-mc-request="' + id + '"] [data-mc-reason]') || {}).value || '';
      if (reason.trim().length < 3) { line('اكتب سبب الرفض'); return; }
      decide(id, false, reason.trim());
    }
  }
  function decide(id, accept, reason) {
    var r = (state.inbox.requests || []).filter(function (x) { return x.id === id; })[0]; if (!r) return;
    state.busy = true;
    rpc('doctor_contract_decide', { p_request: id, p_accept: accept, p_reason: reason, p_sha: r.sha256, p_user_agent: navigator.userAgent }).then(function () { toast(accept ? 'تم تسجيل موافقتك على العقد' : 'تم تسجيل رفضك للعقد', 'success'); return reload(); }, function (e) { line(errText(e)); }).then(function () { state.busy = false; });
  }

  function load() {
    return rpc('doctor_contract_inbox').then(function (r) { state.inbox = r; return r; }, function () { state.inbox = null; return null; });
  }
  function open() {
    if (state.overlay) return;
    var o = document.createElement('div'); o.className = 'modal-backdrop mc-overlay'; o.setAttribute('data-my-contract', 'yes'); state.overlay = o; document.body.appendChild(o);
    o.onkeydown = function (e) { if (e.key === 'Escape') close(); };
    draw(); reload();
  }
  function pendingCount() { var i = state.inbox; if (!i || !i.linked) return 0; return Number(i.pending || 0) + (i.consent && !i.consent.accepted_at ? 1 : 0); }
  function updateBadge() {
    var menu = document.getElementById('user-dropdown'), btn = menu && menu.querySelector('[data-my-contract-entry]');
    if (!state.inbox || !state.inbox.linked) { if (btn) btn.remove(); return; }
    if (!menu) return;
    if (!btn) {
      btn = document.createElement('button'); btn.type = 'button'; btn.className = 'ud-item'; btn.setAttribute('data-my-contract-entry', 'yes');
      var first = menu.querySelector('.ud-item'); if (first && first.parentNode) first.parentNode.insertBefore(btn, first); else menu.appendChild(btn);
      btn.addEventListener('click', function (e) { e.stopPropagation(); open(); });
    }
    var n = pendingCount(); btn.textContent = 'عقدي' + (n ? ' (' + n + ')' : '');
  }
  function start(admin) {
    state.admin = admin.id || admin.email || 'x'; state.inbox = null;
    load().then(function (i) {
      updateBadge();
      var key = 'mycontract-toast:' + state.admin, n = pendingCount();
      if (i && i.linked && n && !window.__mcToasted) { window.__mcToasted = true; toast('عندك ' + n + ' بند في «عقدي» بانتظار موافقتك', 'info'); }
    });
  }
  function tick() {
    var a = window.SSMPDAuth && window.SSMPDAuth.currentAdmin;
    if (!a) { if (state.admin) { state.admin = null; state.inbox = null; window.__mcToasted = false; close(); } return; }
    var id = a.id || a.email || 'x';
    if (id !== state.admin) start(a);
    else if (state.inbox && state.inbox.linked && !document.querySelector('[data-my-contract-entry]')) updateBadge();
  }
  window.SSMPDMyContract = { open: open, reload: reload, _state: state, _tick: tick };
  if (!window.__mcNoPoll) setInterval(tick, 1500);
})();
