/* «تشغيل اليوم» reviewer inbox (owner 2026-11-22 «طبق يلا», mockup docs/ui-references/mockups/today-reviewer-inbox.*).
   For super_admin / general_manager / financial_manager / accountant only, at the top of «تشغيل اليوم»:
     * «الخزينة الرئيسية» — balance, custodian, last count, «جرد الخزينة الرئيسية» (the existing SSMPDMainCount flow);
     * «ورديات مستنية استلام (N)» — closed shifts waiting for review (+ open ones, read-only) and cash handovers to the main treasury;
     * «طلبات مستنية موافقة (N)» — every pending approval the person may decide, with «اعتماد» / «رفض» / «تفاصيل».
   Data: public.clinic_review_inbox() (read-only, 20261122250000; each section follows its source's own permission). Decisions call the
   EXISTING review RPCs only (no new write path; maker ≠ checker is enforced by each RPC; own items show without «اعتماد»).
   A decided item disappears at once and the inbox refetches; it also refreshes every 60 seconds and when the page comes back. Empty
   sections are hidden; when nothing waits: «مفيش حاجة مستنياك ✓». The count shows as a badge on the «الاستقبال والخدمات» tab.
   Mount point: [data-review-inbox-host] inside the «تشغيل اليوم» root when present, else right after its top bar. */
(function (w, d) {
  'use strict';
  if (w.__SWNWTodayReviewInbox) return; w.__SWNWTodayReviewInbox = true;
  var ROLES = ['super_admin', 'general_manager', 'financial_manager', 'accountant'];
  var LOCALE = 'ar-EG-u-nu-latn', POLL = 60000;
  var state = { data: null, loading: false, at: 0, hidden: {}, open: {} }, timer = null, observer = null;

  var RX_KIND = { method_fix: 'تصحيح طريقة الدفع', service_void: 'إلغاء خدمة', credit_note: 'إشعار دائن', package_cancel: 'إيقاف باكج',
    refund: 'استرداد', doctor_payout: 'صرف أتعاب طبيب', supplier_payout: 'سداد مورد', expense: 'مصروف', fund: 'تغذية خزينة', waste: 'هالك',
    transfer_loss: 'فقد تحويل', claim_correction: 'تصحيح مطالبة', claim_submit: 'إعادة تقديم مطالبة', claim_contractual: 'تخفيض تعاقدي',
    claim_loss: 'خسارة ائتمان', claim_payment: 'تحصيل من جهة' };
  var FIN_KIND = { refund: 'استرداد', expense: 'مصروف', general_expense: 'مصروف عام', fund: 'تغذية خزينة', deposit: 'إيداع', opening: 'رصيد افتتاحي', void: 'إلغاء إيصال' };
  var BIZ_KIND = { employment: 'تعيين', payroll: 'مرتبات', salary_payment: 'صرف مرتبات', advance: 'سلفة', asset: 'أصل', depreciation: 'إهلاك',
    tax: 'ضريبة', tax_payment: 'سداد ضريبة', statutory_payment: 'سداد تأمينات' };
  var SUP_KIND = { supplier_payment: 'سداد مورد', supplier_refund: 'استرداد من مورد', supplier_return: 'مرتجع لمورد', patient_return: 'مرتجع من مريض' };

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(v) { var n = Number(v || 0); return n.toLocaleString(LOCALE, { maximumFractionDigits: 2 }); }
  function hm(v) { if (!v) return ''; var t = new Date(v); if (isNaN(t)) return ''; return t.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Cairo' }); }
  function when(v) {
    if (!v) return ''; var t = new Date(v); if (isNaN(t)) return '';
    var day = function (x) { return x.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' }); };
    return day(t) === day(new Date()) ? hm(v) : t.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', timeZone: 'Africa/Cairo' }) + ' ' + hm(v);
  }
  function uuid() { if (w.crypto && w.crypto.randomUUID) return w.crypto.randomUUID(); return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }); }
  function toast(m, bad) { if (w.SSMPDToast) { if (bad && w.SSMPDToast.error) w.SSMPDToast.error(m); else if (w.SSMPDToast.show) w.SSMPDToast.show(m, bad ? 'error' : 'success'); } }
  function client() { return w.SSMPDDb && w.SSMPDDb.client; }
  function rpc(name, args) {
    var c = client(); if (!c) return Promise.reject(new Error('مفيش اتصال'));
    return Promise.resolve(c.rpc(name, args || {})).then(function (r) { if (r && r.error) throw new Error(r.error.message || 'حصل خطأ'); return r ? r.data : null; });
  }
  function roles() { var a = w.SSMPDAuth && w.SSMPDAuth.currentAdmin; if (!a) return []; return w.SSMPDRoles && w.SSMPDRoles.rolesOf ? w.SSMPDRoles.rolesOf(a) : [a.role]; }
  function eligible() { var r = roles(); return ROLES.some(function (x) { return r.indexOf(x) !== -1; }); }
  function root() { var r = d.querySelector('[data-journey-root]'); if (!r || r.dataset.journeyMode === 'trial') return null; return r; }

  /* ---------- item model ---------- */
  function key(it) { return (it.source || it.group) + ':' + it.id; }
  function title(it) {
    switch (it.source) {
      case 'rx_request': return (it.visit_void ? 'الزيارة اتسجلت غلط' : (RX_KIND[it.kind] || it.kind));
      case 'rx_discount': return 'خصم ' + money(it.percent) + '%';
      case 'rx_cross_payment': return 'دفعة لأكتر من مريض';
      case 'fin_request': return FIN_KIND[it.kind] || it.kind;
      case 'doctor_payout': return 'مستحقات دكتور';
      case 'desk_payout': return 'صرف من الديسك';
      case 'business': return BIZ_KIND[it.kind] || it.kind;
      case 'booking_advance': return 'مقدم حجز';
      case 'supplier': return SUP_KIND[it.kind] || it.kind;
      default: return it.kind || 'طلب';
    }
  }
  function tone(it) { return ({ rx_request: 'v', rx_discount: 's', rx_cross_payment: 'p', doctor_payout: 'd', desk_payout: 'd', business: 'p', booking_advance: 'p', supplier: 's' })[it.source] || ''; }
  function subject(it) {
    var parts = [];
    if (it.visit_no != null) parts.push('زيارة ' + it.visit_no);
    if (it.source === 'rx_cross_payment' && it.patients && it.patients.length) parts.push(it.patients.join(' + '));
    else if (it.patient) parts.push(it.patient);
    if (it.doctor) parts.push(it.doctor);
    if (it.supplier) parts.push(it.supplier);
    if (it.service) parts.push(it.service);
    return parts.join(' · ') || title(it);
  }
  var EFFECT = {
    rx_request: 'الطلب بيتنفذ بقيود عكسية (مفيش حاجة بتتمسح)، وبيتسجل مين اعتمده والسبب.',
    service_void: 'الخدمة تتلغي، والمدفوع يرجع رصيد للمريض، وأتعاب الدكتور تتعكس — كله بقيود عكسية.',
    rx_discount: 'الخصم يتطبق على الخدمة قبل التحصيل.',
    rx_cross_payment: 'شخص واحد دفع عن زيارات أكتر من مريض بتحويل/إيصال واحد. المراجعة دي للاطلاع بس — مفيش فلوس بتتحرك.',
    fin_request: 'الطلب يترحّل في الحسابات بعد موافقتك.',
    doctor_payout: 'المبلغ يتصرف للدكتور ويتخصم من رصيده.',
    desk_payout: 'الاستقبال يصرف المبلغ للدكتور من كاش الوردية.',
    business: 'الطلب يتسجل ويترحّل في الحسابات.',
    booking_advance: 'المقدم يتأكد إنه وصل ويتسجل للمريض.',
    supplier: 'الحركة تترحّل في حساب المورد.',
    shift: 'الوردية تتقفل كمراجَعة، وأي فرق بيتسجل بسبب — من غير خصم تلقائي.',
    handover: 'المبلغ يتنقل من خزنة الوردية للخزينة الرئيسية (لازم تكون فاتح الخزينة الرئيسية باسمك).'
  };
  function verbOf(it, approve) { if (it.source === 'rx_cross_payment') return approve ? 'اطّلعت' : 'عليها ملاحظة'; return approve ? 'اعتماد' : 'رفض'; }
  function effect(it) { if (it.group === 'shift') return EFFECT.shift; if (it.group === 'handover') return EFFECT.handover; if (it.source === 'rx_request' && it.kind === 'service_void') return EFFECT.service_void; return EFFECT[it.source] || ''; }

  /* the existing RPC for each kind of decision */
  function decide(it, approve, note) {
    var tok = uuid();
    if (it.group === 'shift') {
      // Every shift (reception-opened too) is reviewed on its finance row: the live reception workspace refuses
      // clinic_reception_command 'shift_review' («استخدم النموذج الموجود في الحسابات…»), same as the accounts screen.
      return rpc('clinic_finance_review_shift', { p_shift: it.id, p_note: note });
    }
    if (it.group === 'handover') return rpc('clinic_finance_treasury_command', { p_action: 'transfer_review', p_payload: { id: it.id, approve: approve, note: note }, p_token: tok });
    switch (it.source) {
      case 'rx_request': return rpc('clinic_reception_command', { p_workspace: it.workspace_id, p_action: 'request_review', p_payload: { id: it.id, approve: approve, note: note }, p_token: tok });
      case 'rx_discount': return rpc('clinic_reception_command', { p_workspace: it.workspace_id, p_action: 'discount_review', p_payload: { id: it.id, approve: approve, note: note }, p_token: tok });
      case 'rx_cross_payment': return rpc('clinic_reception_command', { p_workspace: it.workspace_id, p_action: 'cross_payment_review', p_payload: { id: it.id, approve: approve, note: note }, p_token: tok });
      case 'fin_request': return rpc('clinic_finance_review_request', { p_id: it.id, p_approve: approve, p_note: note });
      case 'doctor_payout': return rpc('clinic_finance_doctor_command', { p_action: 'payout_review', p_payload: { id: it.id, approve: approve, note: note }, p_token: tok });
      case 'desk_payout': return rpc('clinic_reception_doctor_payout', { p_action: approve ? 'approve' : 'reject', p_payload: { id: it.id, note: note }, p_token: tok });
      case 'business': return rpc('clinic_finance_business_command', { p_action: 'review', p_payload: { id: it.id, approve: approve, note: note }, p_token: tok });
      case 'booking_advance': return rpc('clinic_booking_command', { p_action: 'verify', p_payload: { id: it.id, approve: approve, note: note }, p_token: tok });
      case 'supplier': return rpc('clinic_finance_supplier_command', { p_action: 'review', p_payload: { id: it.id, approve: approve, note: note }, p_token: tok });
    }
    return Promise.reject(new Error('نوع طلب غير معروف'));
  }

  /* ---------- render ---------- */
  function items(list, group) { return (list || []).map(function (x) { var o = Object.assign({}, x); o.group = group; return o; }).filter(function (x) { return !state.hidden[key(x)]; }); }
  function itemHtml(it) {
    var k = key(it), acts;
    if (it.group === 'shift') acts = it.mine ? '<span class="tri-mine">ورديتك — لازم حد تاني يستلمها</span>' : '<button type="button" class="btn tri-ok" data-tri-do="approve" data-tri-key="' + esc(k) + '">استلام</button>';
    else acts = (it.mine ? '<span class="tri-mine">' + (it.source === 'rx_cross_payment' ? 'تحصيلك — لازم حد تاني يراجعه' : 'طلبك — لازم حد تاني يعتمده') + '</span>' : '<button type="button" class="btn tri-ok" data-tri-do="approve" data-tri-key="' + esc(k) + '">' + verbOf(it, true) + '</button><button type="button" class="btn tri-no" data-tri-do="reject" data-tri-key="' + esc(k) + '">' + verbOf(it, false) + '</button>');
    acts += '<button type="button" class="btn" data-tri-details="' + esc(k) + '" aria-expanded="' + (state.open[k] ? 'true' : 'false') + '">تفاصيل</button>';
    var head, sub, why = '';
    if (it.group === 'shift') {
      var diff = Number(it.difference || 0);
      head = '<span class="tri-kind s">' + esc(it.register || 'خزنة') + '</span><b>وردية ' + esc(it.cashier || '') + '</b><span class="tri-amt">' + money(it.counted) + '</span>';
      sub = 'قفلت ' + esc(when(it.closed_at)) + ' · المعدود ' + money(it.counted) + ' · المتوقع ' + money(it.expected) + (diff ? ' · <span class="' + (diff < 0 ? 'tri-neg' : 'tri-pos') + '">' + (diff < 0 ? 'عجز ' : 'زيادة ') + money(Math.abs(diff)) + '</span>' : ' · مظبوط ✓');
    } else if (it.group === 'handover') {
      head = '<span class="tri-kind s">تسليم للرئيسية</span><b>' + esc(it.by || '') + '</b><span class="tri-amt">' + money(it.amount) + '</span>';
      sub = esc(when(it.at)) + (it.reason ? ' · ' + esc(it.reason) : '');
    } else {
      head = '<span class="tri-kind ' + tone(it) + '">' + esc(title(it)) + '</span><b>' + esc(subject(it)) + '</b><span class="tri-amt">' + money(it.amount) + '</span>';
      sub = '';
      why = '<div class="tri-why">' + (it.reason ? '«' + esc(it.reason) + '» — ' : '') + esc(it.by || '') + (it.at ? ' · ' + esc(when(it.at)) : '') + '</div>';
    }
    var details = state.open[k] ? '<div class="tri-details">' + esc(effect(it)) + (it.group === 'shift' && it.rpc === 'clinic_reception_command' ? ' (وردية استقبال)' : '') + '</div>' : '';
    return '<div class="tri-item" data-tri-item="' + esc(k) + '"><div class="tri-it">' + head + '</div>' + (sub ? '<div class="tri-sub">' + sub + '</div>' : '') + why + details + '<div class="tri-acts">' + acts + '</div></div>';
  }
  function treasuryHtml(t) {
    if (!t || !t.configured) return '';
    var c = t.count || {}, lc = c.last_count, sh = t.shift;
    var last = lc ? 'آخر جرد: ' + esc(when(lc.at)) + ' — ' + (Number(lc.difference || 0) === 0 ? 'مظبوط ✓' : (Number(lc.difference) < 0 ? 'عجز ' : 'زيادة ') + money(Math.abs(lc.difference))) : 'لسه ما اتعملش جرد';
    return '<section class="tri-card" data-tri-treasury><div class="tri-ch"><h3>الخزينة الرئيسية</h3>' + (sh && sh.custodian ? '<span class="tri-muted">مع: ' + esc(sh.custodian) + '</span>' : '') + '</div>' +
      '<div class="tri-tre"><div><div class="tri-big">' + money(t.balance) + '</div><div class="tri-muted">الرصيد دلوقتي (جنيه)</div></div>' +
      '<button type="button" class="btn btn-primary" data-tri-count>جرد الخزينة الرئيسية</button></div><div class="tri-muted">' + last + '</div></section>';
  }
  function html() {
    var v = state.data;
    if (!v || !v.visible) return '';
    var shifts = items(v.shifts, 'shift'), hand = items(v.handovers, 'handover'), reqs = items(v.requests, 'request');
    var openS = (v.open_shifts || []);
    var nShift = shifts.filter(function (x) { return !x.mine; }).length + hand.filter(function (x) { return !x.mine; }).length;
    var nReq = reqs.filter(function (x) { return !x.mine; }).length;
    var out = treasuryHtml(v.treasury);
    if (shifts.length || hand.length || openS.length) {
      out += '<section class="tri-card" data-tri-shifts><div class="tri-ch"><h3>ورديات مستنية استلام</h3>' + (nShift ? '<span class="tri-cnt">' + nShift + '</span>' : '') + '</div>' +
        shifts.map(itemHtml).join('') + hand.map(itemHtml).join('') +
        openS.map(function (s) { return '<div class="tri-item tri-ro"><div class="tri-it"><span class="tri-kind s">' + esc(s.register || 'خزنة') + '</span><b>وردية ' + esc(s.cashier || '') + '</b><span class="tri-amt">' + money(s.expected) + '</span></div><div class="tri-sub">مفتوحة من ' + esc(when(s.opened_at)) + ' · لسه ما اتسلمتش</div></div>'; }).join('') + '</section>';
    }
    if (reqs.length) out += '<section class="tri-card" data-tri-requests><div class="tri-ch"><h3>طلبات مستنية موافقة</h3>' + (nReq ? '<span class="tri-cnt">' + nReq + '</span>' : '') + '</div>' + reqs.map(itemHtml).join('') + '</section>';
    if (!nShift && !nReq && v.can_review) out += '<div class="tri-empty" data-tri-empty>مفيش حاجة مستنياك ✓</div>';
    return out;
  }
  function total() {
    var v = state.data; if (!v || !v.visible) return 0;
    return items(v.shifts, 'shift').concat(items(v.handovers, 'handover'), items(v.requests, 'request')).filter(function (x) { return !x.mine; }).length;
  }
  function all() { var v = state.data || {}; return items(v.shifts, 'shift').concat(items(v.handovers, 'handover'), items(v.requests, 'request')); }
  function find(k) { return all().filter(function (x) { return key(x) === k; })[0]; }

  function host(create) {
    var r = root(); if (!r) return null;
    var h = r.querySelector('[data-review-inbox]'); if (h || !create) return h;
    h = d.createElement('div'); h.className = 'tri'; h.setAttribute('data-review-inbox', ''); h.setAttribute('dir', 'rtl');
    var slot = r.querySelector('[data-review-inbox-host]'), top = r.querySelector('.journey-top');
    if (slot) slot.appendChild(h); else if (top && top.parentNode === r) r.insertBefore(h, top.nextSibling); else r.insertBefore(h, r.firstChild);
    return h;
  }
  function paint() {
    badge();
    if (!eligible()) return;
    var h = host(!!(state.data && state.data.visible)); if (!h) return;
    var markup = html();
    if (h.__tri === markup) return; h.__tri = markup; h.innerHTML = markup; h.hidden = !markup; wire(h);
  }
  function badge() {
    var btn = d.querySelector('#tabs-bar [data-tab="reception_services"], .tab-btn[data-tab="reception_services"]'); if (!btn) return;
    var b = btn.querySelector('[data-tri-badge]'), n = eligible() ? total() : 0;
    if (!n) { if (b) b.remove(); return; }
    if (!b) { b = d.createElement('span'); b.className = 'tri-badge'; b.setAttribute('data-tri-badge', ''); btn.appendChild(b); }
    if (b.textContent !== String(n)) { b.textContent = String(n); b.title = n + ' حاجة مستنية موافقتك'; }
  }

  /* Owner 2026-11-22 («لما يفتح التاب يروح علي المكان اللي عنه الإشعارات أوتوماتيك، لغاية ما نظبط الشكل»): a reviewer who opens
     «الاستقبال والخدمات» while something waits lands on «تشغيل اليوم» and the page scrolls to «اللي مستنيك». */
  var jump = 0;
  function reduced() { try { return w.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; } }
  function goInbox() {
    if (!jump || Date.now() - jump > 15000) { jump = 0; return; }
    var r = root();
    if (!r) { var s = d.querySelector('[data-rx-section="journey"]'); if (s && !s.__triJump) { s.__triJump = true; s.click(); } setTimeout(goInbox, 200); return; }
    var h = r.querySelector('[data-review-inbox]'); if (!h || h.hidden || !h.innerHTML) { setTimeout(goInbox, 200); return; }
    jump = 0;
    var top = r.querySelector('.journey-top'), bar = d.querySelector('.topbar'), off = (top && getComputedStyle(top).position === 'sticky' ? top.getBoundingClientRect().height : 0) + (bar ? bar.getBoundingClientRect().height : 0) + 8;
    try { w.scrollTo({ top: Math.max(0, h.getBoundingClientRect().top + (w.pageYOffset || 0) - off), behavior: reduced() ? 'auto' : 'smooth' }); } catch (_) { h.scrollIntoView(); }
    h.classList.add('tri-flash'); setTimeout(function () { h.classList.remove('tri-flash'); }, 2200);
  }
  d.addEventListener('click', function (e) {
    var t = e.target && e.target.closest && e.target.closest('#tabs-bar [data-tab="reception_services"], .tab-btn[data-tab="reception_services"]');
    if (!t || !eligible() || !total()) return;
    jump = Date.now(); d.querySelectorAll('[data-rx-section="journey"]').forEach(function (s) { s.__triJump = false; }); setTimeout(goInbox, 60);
  }, true);

  /* ---------- actions ---------- */
  function wire(h) {
    h.querySelectorAll('[data-tri-details]').forEach(function (b) { b.onclick = function () { var k = b.getAttribute('data-tri-details'); state.open[k] = !state.open[k]; h.__tri = null; paint(); }; });
    h.querySelectorAll('[data-tri-do]').forEach(function (b) { b.onclick = function () { var it = find(b.getAttribute('data-tri-key')); if (it) dialog(it, b.getAttribute('data-tri-do') === 'approve'); }; });
    var c = h.querySelector('[data-tri-count]'); if (c) c.onclick = countDialog;
  }
  function modal(inner) {
    var m = d.createElement('div'); m.className = 'tri-modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('dir', 'rtl');
    m.innerHTML = '<div class="tri-box">' + inner + '</div>';
    m.addEventListener('click', function (e) { if (e.target === m) m.remove(); });
    d.body.appendChild(m); return m;
  }
  function dialog(it, approve) {
    var verb = it.group === 'shift' ? 'استلام' : verbOf(it, approve);
    var m = modal('<h3>' + verb + ' — ' + esc(it.group === 'shift' ? 'وردية ' + (it.cashier || '') : it.group === 'handover' ? 'تسليم للرئيسية' : title(it)) + '</h3>' +
      '<p class="tri-muted">' + esc(it.group === 'request' ? subject(it) : (it.register || it.reference || '')) + ' · ' + money(it.amount != null ? it.amount : it.counted) + (it.by ? ' · ' + esc(it.by) : '') + '</p>' +
      (it.reason ? '<div class="tri-why">السبب: «' + esc(it.reason) + '»</div>' : '') +
      (approve ? '<p class="tri-note">اللي هيحصل: ' + esc(effect(it)) + '</p>' : '') +
      '<form data-tri-form><label>' + (it.source === 'rx_cross_payment' ? (approve ? 'تعليقك (إجباري)' : 'الملاحظة (إجباري)') : approve ? 'سبب القرار (إجباري)' : 'سبب الرفض (إجباري)') + '<input name="note" maxlength="300" required placeholder="مثلاً: راجعت الفاتورة"></label>' +
      '<p class="tri-err" data-tri-err hidden></p><div class="tri-acts"><button type="submit" class="btn ' + (approve ? 'tri-ok' : 'tri-no') + '">' + verb + '</button><button type="button" class="btn" data-tri-cancel>رجوع</button></div></form>');
    var f = m.querySelector('form'), err = m.querySelector('[data-tri-err]');
    m.querySelector('[data-tri-cancel]').onclick = function () { m.remove(); };
    f.onsubmit = function (e) {
      e.preventDefault(); var note = String(f.elements.note.value || '').trim();
      if (note.length < 3) { err.hidden = false; err.textContent = 'اكتب سبب القرار (3 حروف على الأقل)'; return; }
      var btn = f.querySelector('[type=submit]'); btn.disabled = true; err.hidden = true;
      decide(it, approve, note).then(function () {
        m.remove(); state.hidden[key(it)] = true; paint();
        toast(it.group === 'shift' ? 'اتسلمت الوردية ✓' : it.source === 'rx_cross_payment' ? (approve ? 'اتسجل إنك اطّلعت ✓' : 'اتسجلت الملاحظة ✓') : (approve ? 'اتعتمد ✓ — الطلب اتشال من القايمة' : 'اترفض — الطلب اتشال من القايمة'));
        load(true);
      }).catch(function (e2) { btn.disabled = false; err.hidden = false; err.textContent = e2.message || 'حصل خطأ'; });
    };
    setTimeout(function () { try { f.elements.note.focus(); } catch (_) {} }, 0);
  }
  function countDialog() {
    var M = w.SSMPDMainCount; if (!M || !M.mount) { toast('افتح «الحسابات» ← «الخزائن والورديات» للجرد', true); return; }
    var m = modal('<div class="tri-ch"><h3>جرد الخزينة الرئيسية</h3><button type="button" class="btn" data-tri-cancel>إغلاق</button></div><div data-tri-mc></div>');
    m.querySelector('[data-tri-cancel]').onclick = function () { m.remove(); load(true); };
    M.autoOpen = true; M.mount(m.querySelector('[data-tri-mc]'), { onDone: function () { m.remove(); load(true); } });
  }

  /* ---------- data ---------- */
  function load(force) {
    if (!eligible() || !client()) return Promise.resolve(null);
    if (state.loading || (!force && Date.now() - state.at < 5000)) return Promise.resolve(state.data);
    state.loading = true;
    return rpc('clinic_review_inbox').then(function (v) { state.data = v || null; state.at = Date.now(); state.hidden = {}; var h = host(false); if (h) h.__tri = null; paint(); return v; })
      .catch(function () { return null; }).then(function (v) { state.loading = false; return v; });
  }
  function onDom() {
    if (!eligible()) return;
    var r = root(); if (!r) { if (!state.loading && (!state.at || Date.now() - state.at > POLL)) load(); badge(); return; }
    if (!r.querySelector('[data-review-inbox]')) { if (state.data) paint(); if (Date.now() - state.at > 15000) load(); } else badge();
  }
  function start() {
    if (observer) return;
    observer = new MutationObserver(function () { onDom(); });
    observer.observe(d.documentElement, { childList: true, subtree: true });
    timer = setInterval(function () { if (!d.hidden) load(true); }, POLL);
    d.addEventListener('visibilitychange', function () { if (!d.hidden) load(true); });
    load(true);
  }
  w.SSMPDReviewInbox = { load: load, paint: paint, goInbox: function () { jump = Date.now(); goInbox(); }, _state: state, _decide: decide, stop: function () { if (observer) observer.disconnect(); if (timer) clearInterval(timer); observer = null; } };
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', start); else start();
})(window, document);
