/* «حجوزات آلية» in «تشغيل اليوم» (owner 2026-11-22: «يبقي كارت واحد باسم حجوزات آلية، وفيها كروت: فيسبوك/انستجرام/واتساب/الموقع/بوابة
 * المرضى، كل كارت فيه عدد الحجوزات، ولما ندوس عليه يفتح الحجوزات اللي فيه وفيها تفاصيل التعدل وتغيير الحالة كاملة»).
 * Fills the [data-today-auto-host] panel (opened by the «حجوزات آلية» tile, today-shortcuts.js).
 * Sources for the selected day:
 *   - public.customer_bookings (mirror of Masa; WhatsApp / Messenger / Instagram / Facebook / website form) through
 *     clinic_reception_auto_booking('list') with reception's local decisions (20261122210000). Masa itself cannot be changed from
 *     here (the agent bridge has no cancel / reschedule / no-show), so a local decision shows «… على مسا كمان» until the mirror agrees.
 *   - clinic_reception_fallback 'list' (bookings taken while Masa was down; their actions stay in «الحجوزات الاحتياطية»).
 *   - patient-portal-booking staff_list (the existing portal requests screen is reused for its actions).
 * Arrival («سجّل وصوله») reuses the queue layer's agent registration (clinic_reception_queue 'agent_booking_register'). */
(function () {
  'use strict';
  if (window.__SWNWTodayAutoBookings) return;
  window.__SWNWTodayAutoBookings = true;
  var SRC = [['whatsapp', 'واتساب', 'و'], ['facebook', 'فيسبوك', 'ف'], ['instagram', 'انستجرام', 'ا'], ['website', 'الموقع', 'م'], ['portal', 'بوابة المرضى', 'ب']];
  var FB = { pending: 'مستني يتسجل على مسا', replayed: 'اتسجل على مسا', conflict: '⚠ مسا رفض الميعاد', cancel_pending: 'اتلغى — مستني مسا', cancelled: 'ملغي' };
  var EFF = { confirmed: 'مؤكد', no_answer: 'مردّش', arrived: 'وصل', no_show: 'لم يحضر', cancelled: 'ملغي', rescheduled: 'ميعاد جديد' };
  var REASONS = [['patient_excused', 'المريض اعتذر'], ['no_answer', 'مردّش أكتر من مرة'], ['doctor_absent', 'الدكتور مش موجود'], ['duplicate', 'حجز مكرر'], ['other', 'أخرى']];
  var st = { key: '', open: '', data: null, loading: false, error: '', gen: 0 }, timer = null;
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v) { return Number(v || 0).toLocaleString('en-US'); }
  function ops() { return window.SSMPDTodayOps; }
  function ctx() { return ops() && ops().context(); }
  function ws() { var c = ctx(); return c && c.workspace; }
  function day() { return ops() ? ops().day() : ''; }
  function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date()); }
  function client() { return window.SSMPDDb && window.SSMPDDb.client; }
  function host() { var r = document.querySelector('[data-journey-root]'); return r && r.dataset.journeyMode !== 'trial' ? r.querySelector('[data-today-auto-host]') : null; }
  function toast(m, k) { if (window.SSMPDToast && window.SSMPDToast.show) window.SSMPDToast.show(m, k || 'success'); }
  function rpc(name, args) { return Promise.resolve(client().rpc(name, args)).then(function (r) { if (r && r.error) throw r.error; return r && r.data; }); }
  function call(action, payload) { return rpc('clinic_reception_auto_booking', { p_workspace: ws(), p_action: action, p_payload: payload || {} }); }
  function sourceOf(b) {
    var ch = b.channel || 'whatsapp';
    if (ch === 'website' || (ch === 'other' && /^web:/.test(String(b.wa_id || '')))) return 'website';
    if (ch === 'messenger' || ch === 'facebook') return 'facebook';
    if (ch === 'instagram') return 'instagram';
    return 'whatsapp';
  }
  function looksTest(b) {
    if (b.not_test || b.local_status === 'void_test') return false;
    var name = String(b.name_override || b.customer_name || ''), phone = String(b.phone_override || b.phone || '');
    return /تجرب|تجريب|اختبار|test/i.test(name) || phone === '01000000000';
  }
  function eff(b) {
    if (b.registered) return 'arrived';
    if (b.local_status === 'cancelled' || b.local_status === 'no_show') return b.local_status;
    if (b.status === 'cancelled' || b.status === 'no_show' || b.status === 'arrived' || b.status === 'completed') return b.status === 'completed' ? 'arrived' : b.status;
    if (b.local_status === 'rescheduled') return 'rescheduled';
    return Number(b.tries || 0) > 0 ? 'no_answer' : 'confirmed';
  }
  function masaNote(b) {
    if ((b.local_status === 'cancelled') && b.status !== 'cancelled') return 'اتلغى عندنا ولسه شغال على مسا — الغيه على مسا كمان';
    if ((b.local_status === 'no_show') && b.status !== 'no_show' && b.status !== 'cancelled') return 'اتسجل «لم يحضر» عندنا — سجّله على مسا كمان';
    if (b.local_status === 'rescheduled' && (String(b.appointment_date) !== String(b.new_date) || String(b.appointment_time || '').slice(0, 5) !== String(b.new_time || ''))) return 'الميعاد الجديد ' + b.new_date + ' ' + b.new_time + ' — غيّره على مسا كمان';
    return '';
  }
  function load(force) {
    var h = host(), w = ws(), d = day(); if (!h || !w || !client()) return Promise.resolve();
    var key = w + ':' + d; if (st.loading || (!force && st.key === key && st.data)) { paint(); return Promise.resolve(); }
    if (st.key !== key) { st.data = null; st.open = st.key ? st.open : ''; }
    st.key = key; st.loading = true; st.error = ''; var gen = ++st.gen; paint();
    var c = client();
    var portal = c.functions && typeof c.functions.invoke === 'function' ? Promise.resolve(c.functions.invoke('patient-portal-booking', { body: { op: 'staff_list' } })).then(function (r) { var x = r && !r.error && r.data; return x && (x.requests || x.rows || x.items) || (Array.isArray(x) ? x : []); }, function () { return []; }) : Promise.resolve([]);
    return Promise.all([
      call('list', { date: d }),
      rpc('clinic_reception_fallback', { p_workspace: w, p_action: 'list', p_payload: {} }).then(function (x) { return (x && x.bookings) || []; }, function () { return []; }),
      portal
    ]).then(function (r) {
      if (gen !== st.gen) return;
      st.data = { mirror: (r[0] && r[0].bookings) || [], canManage: !!(r[0] && r[0].can_manage), fallback: (r[1] || []).filter(function (b) { return b.appointment_date === d; }), portal: (r[2] || []).filter(function (p) { return (p.requested_date || p.appointment_date) === d; }) };
      st.loading = false; paint();
    }).catch(function (e) { if (gen !== st.gen) return; st.loading = false; st.error = (e && e.message) || 'تعذر تحميل الحجوزات الآلية'; paint(); });
  }
  function bySource(key) {
    var dta = st.data || { mirror: [], fallback: [], portal: [] };
    if (key === 'portal') return { mirror: [], fallback: [], portal: dta.portal.filter(function (p) { return !/cancel/.test(String(p.status || '')); }) };
    return {
      mirror: dta.mirror.filter(function (b) { return sourceOf(b) === key && b.local_status !== 'void_test'; }),
      fallback: dta.fallback.filter(function (b) { return (b.source || 'whatsapp') === key && b.status !== 'cancelled'; }),
      portal: []
    };
  }
  function activeCount(g) { return g.mirror.filter(function (b) { var e = eff(b); return e !== 'cancelled'; }).length + g.fallback.length + g.portal.length; }
  function needCount(g) {
    var t = today();
    return g.mirror.filter(function (b) { var e = eff(b); return looksTest(b) || masaNote(b) || (day() === t && !b.registered && !looksTest(b) && (e === 'confirmed' || e === 'no_answer')); }).length +
      g.fallback.filter(function (b) { return b.status === 'pending' || b.status === 'conflict' || b.status === 'cancel_pending'; }).length +
      g.portal.filter(function (p) { return p.status === 'pending' || p.status === 'slot_unavailable'; }).length;
  }
  function subLine(g) {
    var t = today(), parts = [], reg = g.mirror.filter(function (b) { var e = eff(b); return day() === t && !b.registered && !looksTest(b) && (e === 'confirmed' || e === 'no_answer'); }).length;
    var fbw = g.fallback.filter(function (b) { return b.status === 'pending' || b.status === 'conflict' || b.status === 'cancel_pending'; }).length, pw = g.portal.filter(function (p) { return p.status === 'pending' || p.status === 'slot_unavailable'; }).length;
    if (fbw) parts.push(num(fbw) + ' مستني مسا'); if (pw) parts.push(num(pw) + ' مستني تأكيد');
    var na = g.mirror.filter(function (b) { return eff(b) === 'no_answer'; }).length, tests = g.mirror.filter(looksTest).length, masa = g.mirror.filter(function (b) { return masaNote(b); }).length;
    if (reg) parts.push(num(reg) + ' محتاج تسجيل وصول'); if (na) parts.push(num(na) + ' مردّش'); if (masa) parts.push(num(masa) + ' لسه على مسا'); if (tests) parts.push('شكله حجز تجريبي');
    if (!parts.length) parts.push(activeCount(g) ? 'مفيش حاجة مستنية' : 'مفيش حجوزات');
    return parts.join(' · ');
  }
  function sourcesHtml() {
    var total = 0, html = SRC.map(function (s) {
      var g = bySource(s[0]), n = activeCount(g), need = needCount(g); total += n;
      return '<button type="button" class="tds-src' + (need ? ' is-att' : '') + '" data-tab-src="' + s[0] + '"><span class="tds-ic tds-ic-' + s[0] + '" aria-hidden="true">' + s[2] + '</span><span class="tds-src-n">' + num(n) + '</span><span class="tds-src-l">' + esc(s[1]) + '</span><span class="tds-src-sub">' + esc(subLine(g)) + '</span></button>';
    }).join('');
    return { html: '<div class="tds-srcgrid">' + html + '</div><p class="tds-hint">العدد = حجوزات اليوم ده من المصدر (مش ملغية). الأيام التانية من سهم التاريخ فوق.</p>', total: total };
  }
  function seg(b) {
    var e = eff(b), canReg = day() === today() && !b.registered && b.provider_id && e !== 'cancelled' && e !== 'no_show';
    var items = [['confirm', 'مؤكد', e === 'confirmed' || e === 'rescheduled'], ['no_answer', 'مردّش', e === 'no_answer'], ['arrive', 'وصل', e === 'arrived'], ['no_show', 'لم يحضر', e === 'no_show'], ['cancel', 'ملغي', e === 'cancelled']];
    if (b.registered) return '<p class="tds-ok">اتسجل وصوله ✓ — كمّل من الجدول</p>';
    return '<div class="tds-lbl">الحالة</div><div class="tds-seg" role="group" aria-label="حالة الحجز">' + items.map(function (x) {
      var dis = x[0] === 'arrive' && !canReg;
      return '<button type="button" class="' + (x[2] ? 'is-on' : '') + (x[0] === 'cancel' ? ' is-r' : '') + '" data-tab-act="' + x[0] + '" data-id="' + esc(b.id) + '" aria-pressed="' + x[2] + '"' + (dis ? ' disabled title="' + (b.provider_id ? 'تسجيل الوصول لحجوزات النهارده بس' : 'الدكتور مش مربوط بمسا') + '"' : '') + '>' + x[1] + '</button>';
    }).join('') + '</div>';
  }
  function mirrorCard(b) {
    var name = b.name_override || b.customer_name || '—', phone = b.phone_override || b.phone || '', e = eff(b), note = masaNote(b), test = looksTest(b);
    var t = String(b.appointment_time || '').slice(0, 5);
    var chip = '<span class="tds-stc tds-stc-' + e + '">' + esc(EFF[e] || e) + (e === 'no_answer' ? ' ×' + num(b.tries) : '') + '</span>';
    var acts = test ? ((st.data.canManage ? '<button type="button" class="btn btn-danger-soft sm" data-tab-act="test_void" data-id="' + esc(b.id) + '">احذف الحجز التجريبي</button>' : '') + '<button type="button" class="btn sm" data-tab-act="not_test" data-id="' + esc(b.id) + '">مش تجريبي</button>') :
      (b.registered ? '' : '<button type="button" class="btn sm" data-tab-act="reschedule" data-id="' + esc(b.id) + '">تعديل الميعاد</button><button type="button" class="btn sm" data-tab-act="edit" data-id="' + esc(b.id) + '">تعديل البيانات</button>');
    return '<article class="tds-bk' + (test ? ' is-test' : '') + '" data-tab-bk="' + esc(b.id) + '"><div class="tds-bk-top"><span class="tds-tm" dir="ltr">' + esc(t || '—') + '</span>' + (test ? '<span class="tds-testtag">شكله حجز تجريبي</span>' : '') + chip + '</div>' +
      '<div class="tds-who"><b>' + esc(name) + '</b><span>' + esc(b.doctor_name || '') + (b.specialty_name ? ' · ' + esc(b.specialty_name) : '') + (phone ? ' · <bdi dir="ltr">' + esc(phone) + '</bdi>' : '') + '</span></div>' +
      (Number(b.tries || 0) && b.last_try_at ? '<div class="tds-tries">آخر محاولة اتصال: <span dir="ltr">' + esc(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(b.last_try_at))) + '</span>' + (b.last_try_by ? ' — ' + esc(b.last_try_by) : '') + '</div>' : '') +
      (b.reason && (b.local_status === 'cancelled' || b.local_status === 'no_show') ? '<div class="tds-why">السبب: ' + esc(b.reason) + '</div>' : '') +
      (note ? '<div class="tds-masa" role="note">⚠ ' + esc(note) + '</div>' : '') +
      (test ? '' : seg(b)) + (acts ? '<div class="tds-acts">' + acts + '</div>' : '') + '</article>';
  }
  function fallbackCard(b) {
    return '<article class="tds-bk"><div class="tds-bk-top"><span class="tds-tm" dir="ltr">' + esc(String(b.appointment_time || '').slice(0, 5)) + '</span><span class="tds-stc">' + esc(FB[b.status] || b.status || '') + '</span></div><div class="tds-who"><b>' + esc(b.customer_name || b.patient_name || '—') + '</b><span>' + esc(b.doctor_name || '') + (b.phone ? ' · <bdi dir="ltr">' + esc(b.phone) + '</bdi>' : '') + '</span></div><p class="tds-hint">اتحجز وقت ما مسا كان واقف — إجراءاته من «المواعيد ← الحجوزات الاحتياطية».</p></article>';
  }
  function listHtml(key) {
    var s = SRC.filter(function (x) { return x[0] === key; })[0], g = bySource(key);
    var head = '<div class="tds-listhead"><button type="button" class="tds-back" data-tab-back aria-label="رجوع للمصادر">→</button><span class="tds-src-chip tds-ic-' + key + '">' + esc(s[1]) + '</span><b>حجوزات اليوم</b> <small>(' + num(activeCount(g)) + ')</small></div>';
    if (key === 'portal') return head + '<div data-tab-portal></div>';
    var rows = g.mirror.map(mirrorCard).join('') + g.fallback.map(fallbackCard).join('');
    return head + (rows || '<p class="journey-empty">مفيش حجوزات من المصدر ده في اليوم ده.</p>');
  }
  function paint() {
    var h = host(); if (!h) return;
    if (h.querySelector('.rx-modal')) return;
    var inner;
    if (!st.data) inner = st.error ? '<p class="journey-error">' + esc(st.error) + '</p>' : '<p class="journey-loading">جاري التحميل…</p>';
    var src = st.data ? sourcesHtml() : { html: '', total: 0 };
    if (st.data) inner = st.open ? listHtml(st.open) : src.html;
    var att = 0; if (st.data) SRC.forEach(function (s) { att += needCount(bySource(s[0])); });
    h.dataset.tdsCount = String(src.total); h.dataset.tdsAttention = String(att);
    var html = '<div class="journey-section-head"><h3>حجوزات آلية <small>(' + num(src.total) + ')</small></h3></div>' + inner;
    var keep = h.querySelector('[data-tds-close]');
    h.innerHTML = html;
    if (keep) { var hd = h.querySelector('.journey-section-head'); if (hd) hd.appendChild(keep); }
    if (st.open === 'portal') { var ph = h.querySelector('[data-tab-portal]'); if (ph && window.SSMPDPortalBookingRequests && window.SSMPDPortalBookingRequests.render) window.SSMPDPortalBookingRequests.render(ph); else if (ph) ph.innerHTML = '<p class="journey-empty">شاشة طلبات البوابة مش متاحة لحسابك.</p>'; }
  }
  function find(id) { return ((st.data && st.data.mirror) || []).filter(function (b) { return b.id === id; })[0]; }
  function run(action, payload, ok) {
    return call(action, payload).then(function () { if (ok) toast(ok); return load(true); });
  }
  function act(a, id) {
    var b = find(id), c = ctx(); if (!b) return;
    var name = b.name_override || b.customer_name || '';
    if (a === 'confirm') { if (eff(b) === 'confirmed') return; run('confirm', { id: id }, 'رجع «مؤكد»').catch(err); return; }
    if (a === 'no_answer') { run('no_answer', { id: id }, 'اتسجلت محاولة اتصال (مردّش)').catch(err); return; }
    if (a === 'not_test') { run('not_test', { id: id }, 'اتشال علامة «تجريبي»').catch(err); return; }
    if (a === 'arrive') { if (window.SSMPDTodayQueue) { window.SSMPDTodayQueue.register(Object.assign({}, b, { customer_name: name, phone: b.phone_override || b.phone })); watchRegister(); } return; }
    if (!c || !c.modal) return;
    var when = '<p class="tds-hint">' + esc(name) + ' · ' + esc(b.doctor_name || '') + ' · <span dir="ltr">' + esc(b.appointment_date) + ' ' + esc(String(b.appointment_time || '').slice(0, 5)) + '</span></p>';
    if (a === 'cancel') {
      c.modal('إلغاء الحجز — ' + name, when + '<fieldset class="tds-reasons"><legend>السبب</legend>' + REASONS.map(function (r, i) { return '<label><input type="radio" name="reason_kind" value="' + r[0] + '"' + (i ? '' : ' required') + '> ' + r[1] + '</label>'; }).join('') + '</fieldset><label>ملاحظة (اختياري)<input name="note" maxlength="200" placeholder="مثلاً: هيكلمنا الأسبوع الجاي"></label><p class="tds-masa">الحجز ده متسجل على مسا. الإلغاء هنا بيتسجل في الداشبورد — ولازم يتلغي على مسا كمان (هيفضل ظاهر تنبيه لحد ما يتلغي هناك).</p>',
        function (v) { return call('cancel', { id: id, reason_kind: v.reason_kind, note: v.note }); }, function () { toast('اتلغى في الداشبورد'); return load(true); }, { danger: true, ok: 'إلغاء الحجز', cancel: 'رجوع' });
      return;
    }
    if (a === 'no_show') {
      c.modal('لم يحضر — ' + name, when + '<label>ملاحظة (اختياري)<input name="note" maxlength="200"></label><p class="tds-masa">بيتسجل «لم يحضر» في الداشبورد — سجّله على مسا كمان.</p>',
        function (v) { return call('no_show', { id: id, note: v.note }); }, function () { toast('اتسجل «لم يحضر»'); return load(true); }, { ok: 'لم يحضر', cancel: 'رجوع' });
      return;
    }
    if (a === 'reschedule') {
      c.modal('تعديل الميعاد — ' + name, when + '<label>اليوم<input type="date" name="date" required min="' + today() + '" value="' + esc(b.new_date || b.appointment_date) + '"></label><label>الساعة<input type="time" name="time" required value="' + esc(b.new_time || String(b.appointment_time || '').slice(0, 5)) + '"></label><label>ملاحظة (اختياري)<input name="note" maxlength="200"></label><p class="tds-masa">الميعاد الجديد بيتسجل في الداشبورد — غيّره على مسا كمان (هيفضل ظاهر تنبيه لحد ما يتغير هناك).</p>',
        function (v) { return call('reschedule', { id: id, date: v.date, time: v.time, note: v.note }); }, function () { toast('اتسجل الميعاد الجديد'); return load(true); }, { ok: 'حفظ الميعاد', cancel: 'رجوع' });
      return;
    }
    if (a === 'edit') {
      c.modal('تعديل البيانات', '<label>الاسم<input name="name" maxlength="120" value="' + esc(b.name_override || b.customer_name || '') + '"></label><label>الموبايل<input name="phone" inputmode="numeric" dir="ltr" maxlength="11" pattern="01[0-9]{9}" value="' + esc(b.phone_override || b.phone || '') + '"></label><p class="tds-hint">التعديل بيظهر هنا وبيتستخدم في البحث عن ملف المريض وقت تسجيل الوصول.</p>',
        function (v) { return call('edit', { id: id, name: v.name, phone: v.phone }); }, function () { toast('اتحفظت البيانات'); return load(true); }, { ok: 'حفظ', cancel: 'رجوع' });
      return;
    }
    if (a === 'test_void') {
      c.modal('احذف الحجز التجريبي', when + '<p>الحجز هيختفي من «حجوزات آلية» (مش بيتمسح — بيتسجل مين شاله وامتى).</p><label>ملاحظة (اختياري)<input name="note" maxlength="200" value="حجز تجريبي"></label>',
        function (v) { return call('test_void', { id: id, note: v.note }); }, function () { toast('اتشال الحجز التجريبي'); return load(true); }, { danger: true, ok: 'احذف', cancel: 'رجوع' });
    }
  }
  function err(e) { toast((e && e.message) || 'تعذر تنفيذ الإجراء', 'error'); }
  function watchRegister() { var n = 0, t = setInterval(function () { n++; if (!document.querySelector('[data-qr-agmodal]') || n > 600) { clearInterval(t); load(true); } }, 500); }
  document.addEventListener('click', function (e) {
    var h = host(); if (!h || !h.contains(e.target)) return;
    var s = e.target.closest('[data-tab-src]'); if (s) { e.preventDefault(); st.open = s.dataset.tabSrc; paint(); h.scrollTop = 0; return; }
    if (e.target.closest('[data-tab-back]')) { e.preventDefault(); st.open = ''; paint(); return; }
    var a = e.target.closest('[data-tab-act]'); if (a && !a.disabled) { e.preventDefault(); act(a.dataset.tabAct, a.dataset.id); }
  });
  document.addEventListener('change', function (e) { if (e.target && e.target.matches && e.target.matches('[data-journey-day]')) setTimeout(function () { st.open = ''; load(true); }, 150); });
  function tick() {
    var h = host(); if (!h) return;
    if (!h.firstChild || !st.data || st.key !== ws() + ':' + day()) { load(false); return; }
    if (!h.querySelector('.tds-srcgrid, .tds-listhead, .journey-error, .journey-loading')) paint();
  }
  var obs = new MutationObserver(function () { if (!timer) timer = setTimeout(function () { timer = null; tick(); }, 80); });
  function start() { obs.observe(document.body, { childList: true, subtree: true }); setInterval(function () { if (!document.hidden && host()) load(true); }, 60000); tick(); }
  window.SSMPDTodayAuto = { refresh: function () { return load(true); }, _state: st };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
