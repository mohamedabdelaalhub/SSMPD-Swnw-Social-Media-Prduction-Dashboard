/* «سجل نشاط الاستقبال» (owner 2026-11-23 «طبقه», mockup docs/ui-references/mockups/reception-activity-log-*). A read-only
   section inside «الاستقبال والخدمات» for the general manager / super admin / financial manager: who did what (booking,
   rescheduling, cancel, visit, service, collection, correction request), a per-employee summary and a CSV export.
   Server: public.clinic_reception_activity (20261123010000). A payment that covered more than one visit shows
   «دفعة واحدة لـN زيارات» and its note, so the collections count vs the visits count is explained. */
(function (w, d) {
  'use strict';
  if (w.SSMPDReceptionActivity) return;
  var ROLES = ['super_admin', 'general_manager', 'financial_manager'];
  var KIND = { book: 'حجز', reschedule: 'تعديل ميعاد', cancel: 'إلغاء', visit: 'فتح زيارة', service: 'طلب خدمة', pay: 'تحصيل', void: 'طلب إلغاء / تصحيح' };
  var TONE = { visit: 'visit', pay: 'pay', void: 'void', cancel: 'void' };
  var METHOD = { cash: 'كاش', pos: 'فيزا', instapay: 'إنستا باي', bank: 'تحويل بنكي', wallet: 'محفظة' };
  var REQ = { refund: 'استرداد', credit_note: 'إشعار دائن', package_cancel: 'إلغاء باكج', claim_correction: 'تصحيح مطالبة' };
  var REQ_STATUS = { pending: 'مستني المراجعة', approved: 'اتوافق عليه', rejected: 'اترفض' };
  var PERIODS = [['0', 'النهارده'], ['2', 'آخر 3 أيام'], ['6', 'آخر 7 أيام'], ['29', 'آخر 30 يوم']];
  var PAGE = 50, CSV_MAX = 5000;
  var st = { ctx: null, period: '2', from: '', to: '', actor: '', provider: '', kind: '', q: '', rows: [], total: 0, summary: [], providers: [], busy: false, err: '' };

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v) { return Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 2 }); }
  function roles() { var a = w.SSMPDAuth && w.SSMPDAuth.currentAdmin; if (!a) return []; return w.SSMPDRoles && w.SSMPDRoles.rolesOf ? w.SSMPDRoles.rolesOf(a) : [a.role]; }
  function allowed() { var r = roles(); return ROLES.some(function (x) { return r.indexOf(x) !== -1; }); }
  function cairoDay(dt) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(dt || new Date()); }
  function shift(day, n) { var x = new Date(day + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
  function time(iso) { return new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)); }
  function shortDate(iso) { return new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'numeric' }).format(new Date(iso)); }
  function dayTitle(day) { var today = cairoDay(), label = day === today ? 'النهارده' : day === shift(today, -1) ? 'امبارح' : ''; var wd = new Date(day + 'T12:00:00Z').toLocaleDateString('ar-EG-u-nu-latn', { weekday: 'long', timeZone: 'UTC' }); var dm = day.slice(8, 10).replace(/^0/, '') + '/' + day.slice(5, 7).replace(/^0/, ''); return (label ? label + ' — ' : '') + wd + ' ' + dm; }
  function dm(day) { return day.slice(8, 10).replace(/^0/, '') + '/' + day.slice(5, 7).replace(/^0/, ''); }
  function range() { if (st.period === 'custom') return { from: st.from || cairoDay(), to: st.to || st.from || cairoDay() }; var to = cairoDay(); return { from: shift(to, -Number(st.period)), to: to }; }
  function rpc(filter) {
    var c = w.SSMPDDb && w.SSMPDDb.client; if (!c) return Promise.reject(new Error('تعذر الاتصال'));
    return Promise.resolve(c.rpc('clinic_reception_activity', { p_workspace: st.ctx.workspace, p_filter: filter })).then(function (r) { if (r && r.error) throw new Error(r.error.message || 'حصل خطأ'); return r.data; });
  }
  function filter(extra) { var r = range(), f = { from: r.from, to: r.to, limit: PAGE, offset: 0 }; if (st.actor) f.actor = st.actor; if (st.provider) f.provider = st.provider; if (st.kind) f.kind = st.kind; if (st.q) f.q = st.q; return Object.assign(f, extra || {}); }

  /* one line of text per action */
  function kindLabel(r) { if (r.kind === 'cancel' && r.action === 'no_show') return 'لم يحضر'; if (r.kind === 'book' && r.auto) return 'حجز تلقائي'; return KIND[r.kind] || r.action; }
  function multiText(r) { return Number(r.visits) > 1 ? 'دفعة واحدة لـ' + num(r.visits) + ' زيارات' + (r.cross_patient ? ' — لأكتر من مريض' : '') : ''; }
  function detail(r) {
    var p = [];
    if (r.patient) p.push(r.patient + (r.file_no ? ' · ' + r.file_no : ''));
    if (r.kind === 'book' && r.starts_at) p.push(shortDate(r.starts_at) + ' ' + time(r.starts_at));
    if (r.kind === 'reschedule' && r.starts_at) p.push('الميعاد بقى ' + shortDate(r.starts_at) + ' ' + time(r.starts_at));
    if (r.kind === 'visit' && r.visit_no != null) p.push('زيارة ' + r.visit_no);
    if (r.kind === 'service' && r.service) p.push(r.service);
    if (r.kind === 'pay') { if (r.method) p.push(METHOD[r.method] || r.method); var mt = multiText(r); if (mt) p.push(mt); }
    if (r.kind === 'void') { if (r.request_kind) p.push(REQ[r.request_kind] || r.request_kind); if (r.reason) p.push('السبب: ' + r.reason); if (r.request_status) p.push(REQ_STATUS[r.request_status] || r.request_status); }
    return p.join(' · ');
  }
  function amount(r) { if (r.amount == null) return ''; return (r.kind === 'void' ? '-' : '') + num(r.amount); }

  /* ---------- render ---------- */
  function filtersHtml() {
    var actors = st.summary.map(function (s) { return '<option value="' + esc(s.auto ? 'auto' : s.id) + '"' + ((s.auto ? 'auto' : s.id) === st.actor ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('');
    var provs = st.providers.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === st.provider ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('');
    var r = range();
    return '<div class="ral-filters">' +
      '<label class="ral-f">الموظف<select data-ral="actor"><option value="">كل الموظفين</option>' + actors + '</select></label>' +
      '<label class="ral-f">الدكتور<select data-ral="provider"><option value="">كل الدكاترة</option>' + provs + '</select></label>' +
      '<label class="ral-f">المريض<input type="search" data-ral="q" value="' + esc(st.q) + '" placeholder="الاسم أو رقم الملف"></label>' +
      '<div class="ral-f">من — إلى<span class="ral-dates"><input type="date" data-ral="from" value="' + esc(r.from) + '" aria-label="من"><input type="date" data-ral="to" value="' + esc(r.to) + '" aria-label="إلى"></span></div></div>' +
      '<div class="ral-seg"><span class="ral-lbl">الفترة</span>' + PERIODS.map(function (p) { return '<button type="button" class="ral-chip' + (st.period === p[0] ? ' on' : '') + '" data-ral-period="' + p[0] + '">' + p[1] + '</button>'; }).join('') + '</div>' +
      '<div class="ral-seg"><span class="ral-lbl">العملية</span><button type="button" class="ral-chip' + (!st.kind ? ' on' : '') + '" data-ral-kind="">الكل</button>' +
      Object.keys(KIND).map(function (k) { return '<button type="button" class="ral-chip' + (st.kind === k ? ' on' : '') + '" data-ral-kind="' + k + '">' + KIND[k] + '</button>'; }).join('') + '</div>';
  }
  function summaryHtml() {
    var staff = st.summary.filter(function (s) { return !s.auto; }), auto = st.summary.filter(function (s) { return s.auto; });
    if (!st.summary.length) return '';
    var tot = staff.reduce(function (a, s) { ['visits', 'bookings', 'services', 'changes', 'collections', 'amount', 'visits_paid'].forEach(function (k) { a[k] = (a[k] || 0) + Number(s[k] || 0); }); return a; }, {});
    function cells(s) {
      return '<td class="n" data-l="زيارات">' + num(s.visits) + '</td><td class="n" data-l="حجوزات">' + num(s.bookings) + '</td><td class="n" data-l="خدمات">' + num(s.services) + '</td>' +
        '<td class="n" data-l="إلغاء / تعديل">' + num(s.changes) + '</td><td class="n" data-l="تحصيلات">' + num(s.collections) +
        (Number(s.visits_paid) > Number(s.collections) ? '<small class="ral-why">غطّت ' + num(s.visits_paid) + ' زيارة</small>' : '') + '</td><td class="n" data-l="المبلغ المحصّل">' + num(s.amount) + '</td>';
    }
    var r = range();
    return '<section class="ral-card"><div class="ral-hd"><h4>ملخص الموظفين — ' + esc(r.from === r.to ? dayTitle(r.from) : 'من ' + dm(r.from) + ' لـ ' + dm(r.to)) + '</h4><span class="ral-sub">اضغط على اسم الموظف يفلتر السجل تحت عليه</span></div><div class="ral-tw"><table class="ral-sum"><thead><tr><th>الموظف</th><th>زيارات</th><th>حجوزات</th><th>خدمات</th><th>إلغاء / تعديل</th><th>تحصيلات</th><th>المبلغ المحصّل</th></tr></thead><tbody>' +
      staff.map(function (s) { return '<tr><td><button type="button" class="ral-name" data-ral-actor="' + esc(s.id) + '">' + esc(s.name) + '</button></td>' + cells(s) + '</tr>'; }).join('') +
      (staff.length > 1 ? '<tr class="tot"><td>إجمالي الموظفين</td>' + cells(tot) + '</tr>' : '') +
      auto.map(function (s) { return '<tr class="auto"><td><button type="button" class="ral-name" data-ral-actor="auto">' + esc(s.name) + ' (ماسا والواتساب والموقع)</button></td><td class="n" data-l="زيارات">—</td><td class="n" data-l="حجوزات">' + num(s.bookings) + '</td><td class="n" data-l="خدمات">—</td><td class="n" data-l="إلغاء / تعديل">' + num(s.changes) + '</td><td class="n" data-l="تحصيلات">—</td><td class="n" data-l="المبلغ المحصّل">—</td></tr>'; }).join('') +
      '</tbody></table></div></section>';
  }
  function rowHtml(r) {
    var mt = r.kind === 'pay' ? multiText(r) : '';
    return '<div class="ral-row" data-ral-row="' + esc(r.id) + '"><span class="t">' + esc(time(r.at)) + '</span><span class="who"><b>' + esc(r.actor || '') + '</b></span>' +
      '<span class="a"><span class="ral-act ' + (r.auto ? 'auto' : (TONE[r.kind] || '')) + '">' + esc(kindLabel(r)) + '</span></span>' +
      '<span class="det">' + esc(detail(r)) + (mt && r.note ? '<span class="ral-note' + (r.cross_patient ? ' x' : '') + '">' + esc(r.note) + '</span>' : '') + '</span>' +
      '<span class="doc">' + esc(r.provider || '') + '</span><span class="amt" dir="ltr">' + esc(amount(r)) + '</span></div>';
  }
  function logHtml() {
    var last = '', out = '';
    st.rows.forEach(function (r) { var day = cairoDay(new Date(r.at)); if (day !== last) { last = day; out += '<div class="ral-day">' + esc(dayTitle(day)) + '</div>'; } out += rowHtml(r); });
    return '<section class="ral-card"><div class="ral-hd"><h4>السجل — ' + num(st.total) + ' عملية</h4><span class="ral-sub">الأحدث فوق</span></div>' +
      (st.rows.length ? '<div class="ral-log">' + out + '</div>' : '<p class="ral-empty">مفيش عمليات في الفترة دي بالفلاتر دي.</p>') +
      (st.rows.length < st.total ? '<button type="button" class="btn ral-more" data-ral-more>اعرض أكتر</button>' : '') + '</section>';
  }
  function html() {
    return '<div class="ral" dir="rtl"><div class="ral-top"><h3>سجل نشاط الاستقبال</h3><button type="button" class="btn" data-ral-csv>تصدير Excel (CSV)</button></div>' +
      '<p class="ral-sub">للقراية بس — مين عمل إيه في الاستقبال، من غير أي تعديل.</p>' + filtersHtml() +
      (st.err ? '<p class="ral-err" role="alert">' + esc(st.err) + '</p>' : '') + (st.busy && !st.rows.length ? '<p class="ral-sub">جاري التحميل…</p>' : summaryHtml() + logHtml()) + '</div>';
  }
  function host() { return d.querySelector('[data-ral-root]'); }
  function paint() { var h = host(); if (!h) return; h.innerHTML = html(); }

  /* ---------- data ---------- */
  function load(more) {
    if (!st.ctx || !host()) return Promise.resolve();
    st.busy = true; st.err = ''; if (!more) paint();
    return rpc(filter({ offset: more ? st.rows.length : 0 })).then(function (v) {
      st.total = Number(v.total || 0); st.rows = more ? st.rows.concat(v.rows || []) : (v.rows || []);
      st.summary = v.summary || []; /* the server summary ignores the employee / operation filters */
      st.providers = v.providers || [];
    }).catch(function (e) { st.err = e.message || 'تعذر تحميل السجل'; }).then(function () { st.busy = false; paint(); });
  }
  function csvCell(v) { var s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function exportCsv() {
    return rpc(filter({ limit: CSV_MAX, offset: 0 })).then(function (v) {
      var head = ['اليوم', 'الوقت', 'الموظف', 'العملية', 'المريض', 'رقم الملف', 'الدكتور', 'التفاصيل', 'ملاحظة الدفعة', 'المبلغ'];
      var lines = [head.join(',')].concat((v.rows || []).map(function (r) {
        return [cairoDay(new Date(r.at)), time(r.at), r.actor, kindLabel(r), r.patient, r.file_no, r.provider, detail(r), r.kind === 'pay' && Number(r.visits) > 1 ? r.note : '', amount(r)].map(csvCell).join(',');
      }));
      var r = range(), blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }), a = d.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'reception-activity-' + r.from + '_' + r.to + '.csv'; d.body.appendChild(a); a.click(); a.remove();
      if (Number(v.total) > CSV_MAX && w.SSMPDToast) w.SSMPDToast.show('الملف فيه أول ' + num(CSV_MAX) + ' عملية بس — ضيّق الفترة', 'error');
    }).catch(function (e) { if (w.SSMPDToast) w.SSMPDToast.show(e.message || 'تعذر التصدير', 'error'); });
  }

  /* ---------- events ---------- */
  var qTimer = null;
  d.addEventListener('click', function (e) {
    var root = e.target.closest && e.target.closest('[data-ral-root]'); if (!root) return;
    var b = e.target.closest('[data-ral-period]'); if (b) { st.period = b.dataset.ralPeriod; load(); return; }
    b = e.target.closest('[data-ral-kind]'); if (b) { st.kind = b.dataset.ralKind; load(); return; }
    b = e.target.closest('[data-ral-actor]'); if (b) { st.actor = b.dataset.ralActor; load(); return; }
    if (e.target.closest('[data-ral-more]')) { load(true); return; }
    if (e.target.closest('[data-ral-csv]')) { exportCsv(); }
  });
  d.addEventListener('change', function (e) {
    var t = e.target; if (!t.closest || !t.closest('[data-ral-root]') || !t.dataset.ral) return;
    var k = t.dataset.ral;
    if (k === 'actor' || k === 'provider') { st[k] = t.value; load(); }
    else if (k === 'from' || k === 'to') { var r = range(); st.period = 'custom'; st.from = r.from; st.to = r.to; st[k] = t.value; if (st.to < st.from) st.to = st.from; load(); }
  });
  d.addEventListener('input', function (e) {
    var t = e.target; if (!t.closest || !t.closest('[data-ral-root]') || t.dataset.ral !== 'q') return;
    clearTimeout(qTimer); qTimer = setTimeout(function () { st.q = t.value.trim(); load().then(function () { var i = d.querySelector('[data-ral="q"]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }); }, 350);
  });

  /* ---------- reception section ---------- */
  function css() { if (d.querySelector('link[data-ral-css]')) return; var l = d.createElement('link'); l.rel = 'stylesheet'; l.href = 'assets/css/reception-activity-log.css?v=activity-log-20261123-1'; l.dataset.ralCss = '1'; d.head.appendChild(l); }
  function install() {
    var base = w.SSMPDReceptionModules; if (!base) { setTimeout(install, 150); return; }
    if (base.__ralWrapped) return;
    var wrapped = {}; Object.keys(base).forEach(function (k) { wrapped[k] = base[k]; });
    wrapped.sections = function (c) { var rows = base.sections ? base.sections(c) : []; if (allowed() && !rows.some(function (x) { return x[0] === 'activity'; })) rows = rows.concat([['activity', 'سجل نشاط الاستقبال', 'مين عمل إيه: حجوزات وزيارات وخدمات وتحصيلات وإلغاءات — للقراية بس.']]); return rows; };
    wrapped.panel = function (section, c) {
      if (section !== 'activity') return base.panel ? base.panel(section, c) : '';
      if (!allowed()) return '<p class="ral-err">السجل ده للمدير العام والمدير المالي بس.</p>';
      css(); if (!st.ctx || st.ctx.workspace !== c.workspace) { st.actor = ''; st.provider = ''; st.kind = ''; st.q = ''; st.rows = []; st.summary = []; }
      st.ctx = c; setTimeout(function () { load(); }, 0); return '<div data-ral-root></div>';
    };
    wrapped.__ralWrapped = true; w.SSMPDReceptionModules = wrapped;
  }
  w.SSMPDReceptionActivity = { load: load, _state: st, _detail: detail, _install: install };
  install();
})(window, document);
