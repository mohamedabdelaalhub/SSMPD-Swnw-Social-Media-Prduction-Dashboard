/* «عقدي» — doctor side of the online contracts (own file; no edits to app.js / roles.js / finance files).
   A doctor is whoever has an admin account LINKED to a doctor code (HR: clinic_people.people.admin_id <-> doctor_key). The server answers only for the caller's own code.
   - adds «عقدي» to the user menu (with a count of waiting contracts) and one toast when something waits; opens a full-page overlay with:
       * the professional-responsibility declaration (consent) when a published one has not been accepted yet — it blocks NOTHING here (a notice shows if the owner set a start date), «لاحقًا» just closes it
       * each contract: the lawyer's text (versioned) + the generated schedule table, and «أوافق» / «أرفض مع سبب»
       * to accept (contract or declaration) the doctor SIGNS: draws with finger / pen / mouse on a canvas, OR uploads a PNG/JPEG signature image; it is shown under the text and stored with the acceptance
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

  var MAX_IMG = 300000;  // characters of the data URL we are willing to send (the server accepts up to 400000)
  function sigWidget(id) {
    return '<div class="mc-sig" data-mc-sig="' + esc(id) + '"><p class="fc-note">التوقيع: ارسم توقيعك بإصبعك أو بالقلم، أو ارفع صورة توقيعك.</p>' +
      '<div class="fc-actions"><button type="button" class="btn ghost sm" data-mc-sig-mode="draw">ارسم توقيعك</button><button type="button" class="btn ghost sm" data-mc-sig-mode="upload">ارفع صورة توقيع</button><button type="button" class="btn ghost sm" data-mc-sig-clear>مسح</button></div>' +
      '<canvas data-mc-canvas width="600" height="200" style="width:100%;max-width:420px;height:140px;border:1px dashed #888;border-radius:8px;background:#fff;touch-action:none;display:block;margin:6px 0"></canvas>' +
      '<div data-mc-upload hidden><input type="file" accept="image/png,image/jpeg" data-mc-file><img data-mc-upload-img alt="توقيع مرفوع" hidden style="max-width:360px;max-height:140px;background:#fff;border:1px solid #ccc;display:block;margin:6px 0"></div></div>';
  }
  function sigDone(kind, image) {
    return image ? '<p class="fc-note">توقيعك (' + (kind === 'uploaded' ? 'صورة مرفوعة' : 'رسم باليد') + '):</p><img data-mc-signed alt="توقيعك" style="max-width:360px;max-height:140px;background:#fff;border:1px solid #ccc" src="' + esc(image) + '">' : '';
  }
  function getSig(id) {
    var w = state.overlay && state.overlay.querySelector('[data-mc-sig="' + id + '"]'); if (!w) return null;
    if (w._mode === 'upload') return w._upload ? { kind: 'uploaded', image: w._upload } : null;
    if (!w._ink) return null;
    var img; try { img = w.querySelector('[data-mc-canvas]').toDataURL('image/png'); } catch (e) { return null; }
    return img && img.length <= MAX_IMG ? { kind: 'drawn', image: img } : null;
  }
  function setMode(w, mode) {
    w._mode = mode; w.querySelector('[data-mc-canvas]').style.display = mode === 'draw' ? 'block' : 'none';
    var up = w.querySelector('[data-mc-upload]'); if (mode === 'upload') up.removeAttribute('hidden'); else up.setAttribute('hidden', '');
  }
  function clearSig(w) {
    w._ink = false; w._upload = null; var cv = w.querySelector('[data-mc-canvas]'), cx = cv.getContext && cv.getContext('2d');
    if (cx) cx.clearRect(0, 0, cv.width, cv.height);
    var im = w.querySelector('[data-mc-upload-img]'); im.setAttribute('hidden', ''); im.removeAttribute('src'); var f = w.querySelector('[data-mc-file]'); if (f) f.value = '';
  }
  function shrink(data, cb) { // big phone photo -> scaled PNG (browser only; otherwise "too big")
    try {
      var im = new Image();
      im.onload = function () { try { var k = Math.min(1, 700 / im.width, 280 / im.height), c = document.createElement('canvas'); c.width = Math.max(1, Math.round(im.width * k)); c.height = Math.max(1, Math.round(im.height * k)); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); cb(c.toDataURL('image/png')); } catch (e) { cb(null); } };
      im.onerror = function () { cb(null); }; im.src = data;
    } catch (e) { cb(null); }
  }
  function initPads() {
    [].forEach.call(state.overlay ? state.overlay.querySelectorAll('[data-mc-sig]') : [], function (w) {
      if (w._ready) return; w._ready = true; setMode(w, 'draw'); w._ink = false;
      var cv = w.querySelector('[data-mc-canvas]'), down = false, last = null;
      function pos(e) { var r = cv.getBoundingClientRect(), sx = cv.width / (r.width || cv.width), sy = cv.height / (r.height || cv.height); return { x: ((e.clientX || 0) - r.left) * sx, y: ((e.clientY || 0) - r.top) * sy }; }
      function cx() { var c = cv.getContext && cv.getContext('2d'); if (c) { c.lineWidth = 3; c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = '#111'; } return c; }
      cv.addEventListener('pointerdown', function (e) { down = true; last = pos(e); var c = cx(); if (c) { c.beginPath(); c.moveTo(last.x, last.y); c.lineTo(last.x + 0.1, last.y + 0.1); c.stroke(); } w._ink = true; try { cv.setPointerCapture(e.pointerId); } catch (x) { /* optional */ } if (e.preventDefault) e.preventDefault(); });
      cv.addEventListener('pointermove', function (e) { if (!down) return; var p = pos(e), c = cx(); if (c) { c.beginPath(); c.moveTo(last.x, last.y); c.lineTo(p.x, p.y); c.stroke(); } last = p; if (e.preventDefault) e.preventDefault(); });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (n) { cv.addEventListener(n, function () { down = false; }); });
      var f = w.querySelector('[data-mc-file]');
      function accept(data) { w._upload = data; var im = w.querySelector('[data-mc-upload-img]'); im.src = data; im.removeAttribute('hidden'); line(''); }
      f.addEventListener('change', function () {
        var file = f.files && f.files[0]; if (!file) return;
        if (!/^image\/(png|jpeg)$/.test(file.type)) { line('الصورة لازم تكون PNG أو JPEG'); f.value = ''; return; }
        var fr = new FileReader();
        fr.onload = function () {
          var data = String(fr.result || '');
          if (data.length <= MAX_IMG) { accept(data); return; }
          shrink(data, function (small) { if (small && small.length <= MAX_IMG) accept(small); else { w._upload = null; line('صورة التوقيع كبيرة؛ استخدم صورة أصغر من 300 كيلوبايت'); } });
        };
        fr.readAsDataURL(file);
      });
    });
  }
  function enfNotice(i) {
    var e = i.enforcement || {}, c = i.compliance || {}, out = [];
    function one(rule, ok, label) { var r = e[rule]; if (!r || !r.start_date || ok) return; out.push(r.active ? label + ' — مطلوب الآن.' : label + ' — سيُشترط اعتبارًا من ' + r.start_date + '.'); }
    one('contract_signature', c.contract_ok, 'توقيع العقد'); one('consent', c.consent_ok, 'الإقرار بالمسؤولية المهنية');
    return out.length ? '<p class="fc-note" data-mc-enforce>' + out.map(esc).join(' ') + '</p>' : '';
  }

  function consentHtml(c) {
    if (!c) return '';
    if (c.accepted_at) return '<section class="mc-card" data-mc-consent="done"><h3>' + esc(c.title) + '</h3><p class="fc-note">وافقت على الإقرار (نسخة ' + esc(c.version) + ') بتاريخ ' + esc(day(c.accepted_at)) + '.</p>' + sigDone(c.signature_kind, c.signature_image) + '</section>';
    return '<section class="mc-card" data-mc-consent="open"><h3>' + esc(c.title) + ' — نسخة ' + esc(c.version) + '</h3><div class="mc-text" style="white-space:pre-wrap">' + esc(c.body) + '</div>' +
      '<p class="fc-note">الإقرار ده بيتعرض أول مرة (وكل ما تنزل نسخة جديدة). مش بيمنع أي شغل إلا لو الإدارة حددت تاريخ بداية (بيظهر لك فوق).</p>' + sigWidget('consent') +
      '<div class="fc-actions"><button type="button" class="btn" data-mc-consent-accept>أقر وأوافق</button><button type="button" class="btn ghost" data-mc-close>لاحقًا</button></div></section>';
  }
  function requestHtml(r) {
    var head = '<h3>عقد — مرجع ' + esc(r.reference) + ' <small>(نسخة النص ' + esc(r.template_version) + ')</small></h3>';
    var body = '<div class="mc-text" style="white-space:pre-wrap">' + esc(textOnly(r)) + '</div><h4>الشروط المالية</h4>' + scheduleTable(r.schedule);
    var foot;
    if (r.status === 'pending' && r.stale) foot = '<p class="fc-note" data-mc-stale>النص أو الشروط اتغيّرت بعد الإرسال. اطلب من الحسابات إعادة إرسال العقد.</p>';
    else if (r.status === 'pending') foot = sigWidget(r.id) + '<div class="fc-actions" data-mc-actions="' + esc(r.id) + '"><button type="button" class="btn" data-mc-accept="' + esc(r.id) + '">أوافق</button><button type="button" class="btn ghost" data-mc-reject="' + esc(r.id) + '">أرفض مع سبب</button></div>';
    else foot = '<p class="fc-note" data-mc-done>' + (r.status === 'accepted' ? 'وافقت على العقد بتاريخ ' + esc(day(r.decided_at)) : 'رفضت العقد بتاريخ ' + esc(day(r.decided_at)) + ' — السبب: ' + esc(r.reason || '')) + '</p>' + (r.status === 'accepted' ? sigDone(r.signature_kind, r.signature_image) : '');
    return '<section class="mc-card" data-mc-request="' + esc(r.id) + '" data-mc-status="' + esc(r.status) + '">' + head + '<span class="fc-st-badge">' + esc(STATUS[r.status] || r.status) + '</span>' + body + foot + '</section>';
  }
  function pageHtml() {
    var i = state.inbox || {};
    var list = (i.requests || []);
    return '<div class="modal" role="dialog" aria-modal="true" aria-label="عقدي" dir="rtl" style="max-width:860px;width:96vw;max-height:92vh;overflow:auto"><div class="modal-head"><h2>عقدي</h2><button type="button" class="modal-close" aria-label="إغلاق" data-mc-close>×</button></div>' +
      '<p role="status" data-mc-status-line></p>' + enfNotice(i) + consentHtml(i.consent) +
      (list.length ? list.map(requestHtml).join('') : '<p class="fc-empty">لا توجد عقود مرسلة إليك للتوقيع حتى الآن. هتوصلك إشعار هنا أول ما الحسابات ترسل لك عقدًا.</p>') + '</div>';
  }
  function line(msg) { var n = state.overlay && state.overlay.querySelector('[data-mc-status-line]'); if (n) n.textContent = msg || ''; }
  function close() { if (state.overlay) { state.overlay.remove(); state.overlay = null; } }
  function draw() {
    if (!state.overlay) return;
    state.overlay.innerHTML = pageHtml();
    state.overlay.onclick = onClick;
    initPads();
  }
  function reload() { return load().then(function () { draw(); updateBadge(); }); }
  function errText(e) { return (e && (e.message || e.details)) || 'تعذر تنفيذ العملية'; }

  function onClick(ev) {
    var t = ev.target && ev.target.closest ? ev.target.closest('button') : null; if (!t || state.busy) return;
    var id;
    if (t.hasAttribute('data-mc-close')) { close(); return; }
    var pad = t.closest('[data-mc-sig]');
    if (pad && t.hasAttribute('data-mc-sig-mode')) { setMode(pad, t.getAttribute('data-mc-sig-mode')); return; }
    if (pad && t.hasAttribute('data-mc-sig-clear')) { clearSig(pad); return; }
    if (t.hasAttribute('data-mc-consent-accept')) {
      var c = state.inbox.consent, sg = getSig('consent'); if (!sg) { line('وقّع الأول: ارسم توقيعك أو ارفع صورته'); return; }
      state.busy = true;
      rpc('doctor_consent_accept', { p_template: c.template_id, p_sha: c.sha256, p_user_agent: navigator.userAgent, p_sig_kind: sg.kind, p_sig_image: sg.image }).then(function () { toast('تم تسجيل موافقتك على الإقرار', 'success'); return reload(); }, function (e) { line(errText(e)); }).then(function () { state.busy = false; });
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
    var sg = accept ? getSig(id) : null; if (accept && !sg) { line('وقّع الأول: ارسم توقيعك أو ارفع صورته'); return; }
    state.busy = true;
    rpc('doctor_contract_decide', { p_request: id, p_accept: accept, p_reason: reason, p_sha: r.sha256, p_user_agent: navigator.userAgent, p_sig_kind: sg ? sg.kind : null, p_sig_image: sg ? sg.image : null }).then(function () { toast(accept ? 'تم تسجيل موافقتك على العقد' : 'تم تسجيل رفضك للعقد', 'success'); return reload(); }, function (e) { line(errText(e)); }).then(function () { state.busy = false; });
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
