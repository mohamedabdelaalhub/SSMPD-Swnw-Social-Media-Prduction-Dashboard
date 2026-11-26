/* HR — «مواعيد العمل والإجازات والراحات» (owner 2026-11-26 «طبقه», mockup docs/ui-references/mockups/hr-work-schedule.html).
   Read-only month calendar for ONE employee. No new RPC: templates + weekly days from hr_shifts_workspace, requests/balance from hr_workspace(p_month),
   punches from hr_attendance_range (past days only). Future days follow the CURRENT weekly schedule and say so. */
(function (w, d) {
  'use strict';
  var U = function () { return w.SSMPDWorkforceUtils; };
  var MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  var DOW = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  var ORDER = [6, 0, 1, 2, 3, 4, 5]; // Saturday first
  var LEAVE = { annual: 'سنوية', sick: 'مرضية', casual: 'عارضة', excused: 'بعذر', birth: 'وضع', unpaid: 'بدون مرتب' };
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function p2(n) { return String(n).padStart(2, '0'); }
  function ymd(y, m, dd) { return y + '-' + p2(m) + '-' + p2(dd); }
  function dowOf(s) { return new Date(s + 'T12:00:00Z').getUTCDay(); }
  function cairoToday() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
  function clock(iso) { return iso ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)) : ''; }
  function fdate(s) { var t = String(s || '').slice(0, 10); if (!t) return '—'; var x = t.split('-'); return +x[2] + ' ' + MONTHS[+x[1] - 1] + ' ' + x[0]; }
  function fstamp(s) { if (!s) return '—'; var day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(s)); return fdate(day) + ' ' + clock(s); }
  function short(t) { return String(t || '').slice(0, 5); }
  function toast(m) { if (w.SSMPDToast && w.SSMPDToast.show) w.SSMPDToast.show(m, 'error'); }
  var X = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>';
  var CH = function (dir) { return '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="' + (dir === 'prev' ? 'M9 6l6 6-6 6' : 'M15 6l-6 6 6 6') + '" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>'; };

  function open(person) {
    var old = d.querySelector('[data-hws]'); if (old) old.remove();
    var pid = person.id, today = cairoToday();
    var st = { ym: today.slice(0, 7), ws: null, wsp: null, att: {}, reqs: [], people: [], me: null, loaded: false, err: '', serial: 0, sheet: null };
    var dlg = d.createElement('dialog'); dlg.className = 'hws'; dlg.dataset.hws = pid; dlg.setAttribute('aria-label', 'مواعيد العمل والإجازات والراحات');
    d.body.appendChild(dlg);
    function close() { if (dlg.open && dlg.close) dlg.close(); dlg.remove(); }
    dlg.addEventListener('cancel', function (e) { e.preventDefault(); close(); });
    dlg.addEventListener('click', function (e) {
      if (e.target === dlg || e.target.closest('[data-hws-close]')) { close(); return; }
      var n = e.target.closest('[data-hws-nav]'); if (n) { shift(+n.dataset.hwsNav); return; }
      var s = e.target.closest('[data-hws-sheet]'); if (s) { st.sheet = s.dataset.hwsSheet; draw(); return; }
      if (e.target.closest('[data-hws-sheet-x]')) { st.sheet = null; draw(); return; }
      if (e.target.closest('[data-hws-retry]')) load();
    });
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');

    function shift(n) { var x = st.ym.split('-'), t = new Date(Date.UTC(+x[0], +x[1] - 1 + n, 1)); st.ym = t.getUTCFullYear() + '-' + p2(t.getUTCMonth() + 1); st.sheet = null; load(); }
    function tpl(id) { return st.ws && (st.ws.templates || []).filter(function (t) { return t.id === id; })[0]; }
    function monthDays() { var x = st.ym.split('-'), n = new Date(Date.UTC(+x[0], +x[1], 0)).getUTCDate(), out = []; for (var i = 1; i <= n; i++) out.push(ymd(x[0], x[1], i)); return out; }
    function reviewer(id) { if (!id) return '—'; var p = st.people.filter(function (x) { return x.id === id || x.admin_id === id; })[0]; return p ? p.full_name : 'مسؤول الموارد البشرية'; }
    function leaveOn(s, status) { return st.reqs.filter(function (r) { return r.kind === 'leave' && r.status === status && r.from_date <= s && s <= r.to_date; })[0]; }

    /* what one day is: work / rest / leave / pending / absent / none */
    function classify(s) {
      var lv = leaveOn(s, 'approved'); if (lv) return { k: 'leave', req: lv };
      var pend = leaveOn(s, 'pending'); if (pend) return { k: 'pending', req: pend };
      var row = st.att[s], dow = dowOf(s), days = st.wsp && st.wsp.days, has = days && Object.prototype.hasOwnProperty.call(days, dow);
      if (row && row.status === 'leave') return { k: 'leave', row: row };
      if (row && row.status === 'mission') return { k: 'work', row: row, t: tpl(days && days[dow]), mission: row.mission };
      if (row && row.status === 'absent') return { k: 'absent', row: row, t: tpl(days && days[dow]) };
      if (has && !days[dow]) return { k: 'rest' };
      if (has) return { k: 'work', t: tpl(days[dow]), row: row, future: s > today };
      return { k: 'none' };
    }
    function summary() {
      var c = { work: 0, rest: 0, leave: 0, late: 0 };
      monthDays().forEach(function (s) { var k = classify(s); if (k.k === 'work') c.work++; else if (k.k === 'rest' || k.k === 'absent') c.rest++; else if (k.k === 'leave') c.leave++; if (k.row && k.row.late_min > 0 && k.k === 'work') c.late++; });
      return c;
    }
    function cell(s) {
      var k = classify(s), n = +s.slice(8), dot = '';
      if (k.k === 'work' && !k.future && k.row) { if (k.row.late_min > 0) dot = '<i class="hws-dot late" title="تأخير"></i>'; else if (!k.row.first_in && s < today) dot = '<i class="hws-dot miss" title="بدون بصمة"></i>'; }
      if (k.k === 'absent') dot = '<i class="hws-dot miss" title="غياب"></i>';
      var cls = 'hws-c ' + k.k + (k.future ? ' future' : '') + (s === today ? ' today' : '') + (st.sheet === 'day:' + s ? ' sel' : '');
      return '<button type="button" class="' + cls + '" data-hws-sheet="day:' + s + '" aria-label="' + esc(fdate(s)) + '"><b>' + n + '</b>' + dot + '</button>';
    }
    function grid() {
      var ds = monthDays(), lead = ORDER.indexOf(dowOf(ds[0])), h = ORDER.map(function (o) { return '<span>' + DOW[o].replace('ال', '') + '</span>'; }).join(''), cells = '';
      for (var i = 0; i < lead; i++) cells += '<span class="hws-c blank"></span>';
      ds.forEach(function (s) { cells += cell(s); });
      return '<div class="hws-head7" aria-hidden="true">' + h + '</div><div class="hws-grid" role="grid">' + cells + '</div>';
    }
    function legend() { return '<ul class="hws-leg"><li><i class="sw work"></i>عمل</li><li><i class="sw rest"></i>راحة أسبوعية</li><li><i class="sw leave"></i>إجازة</li><li><i class="sw pending"></i>طلب منتظر</li><li><i class="hws-dot late"></i>تأخير</li><li><i class="hws-dot miss"></i>بدون بصمة / غياب</li></ul>'; }
    function sheetHtml() {
      var s = st.sheet; if (!s) return '';
      var body = '', title = '';
      if (s.indexOf('day:') === 0) {
        var day = s.slice(4), k = classify(day), r = k.row || {}; title = fdate(day) + ' — ' + DOW[dowOf(day)];
        if (k.k === 'work') {
          var t = k.t;
          body = '<dl><dt>المواعيد</dt><dd>' + (t ? 'من <bdi>' + esc(short(t.start_time)) + '</bdi> إلى <bdi>' + esc(short(t.end_time)) + '</bdi>' : '—') + '</dd>';
          if (k.mission) body += '<dt>مهمة خارجية</dt><dd>' + esc(k.mission.place || '') + '</dd>';
          if (k.future) body += '</dl><p class="hws-note">حسب الجدول الحالي</p>';
          else body += '<dt>الحضور</dt><dd>' + (r.first_in ? '<bdi>' + clock(r.first_in) + '</bdi>' : 'لا توجد بصمة') + '</dd><dt>التأخير</dt><dd>' + (r.late_min > 0 ? '<bdi>' + r.late_min + '</bdi> دقيقة' : 'لا يوجد') + '</dd><dt>الانصراف</dt><dd>' + (r.last_out ? '<bdi>' + clock(r.last_out) + '</bdi>' : (r.first_in ? 'لا توجد بصمة انصراف' : '—')) + '</dd></dl>';
        } else if (k.k === 'rest') body = '<p>راحة أسبوعية — مش بتتحسب غياب ولا بتتخصم من رصيد الإجازات.</p>';
        else if (k.k === 'absent') body = '<p>غياب' + (r.excused ? ' (بعذر)' : '') + ' في يوم كان عليه عمل فيه' + (k.t ? ' — <bdi>' + esc(short(k.t.start_time)) + '</bdi> إلى <bdi>' + esc(short(k.t.end_time)) + '</bdi>' : '') + '.</p>';
        else if (k.k === 'leave' || k.k === 'pending') body = leaveCard(k.req) || '<p>إجازة معتمدة.</p>';
        else body = '<p>مفيش جدول مسجل لليوم ده.</p>';
      } else if (s === 'rest') {
        title = 'الراحات والغياب — ' + MONTHS[+st.ym.slice(5) - 1] + ' ' + st.ym.slice(0, 4);
        var rows = monthDays().map(function (x) { return [x, classify(x)]; }).filter(function (a) { return a[1].k === 'rest' || a[1].k === 'absent' || (a[1].k === 'work' && a[1].row && a[1].row.late_min > 0); });
        body = rows.length ? '<ul class="hws-list">' + rows.map(function (a) { var k = a[1]; return '<li><span>' + esc(fdate(a[0])) + ' — ' + DOW[dowOf(a[0])] + '</span><em class="' + (k.k === 'rest' ? 'r' : k.k === 'absent' ? 'a' : 'l') + '">' + (k.k === 'rest' ? 'راحة أسبوعية' : k.k === 'absent' ? 'غياب' : 'تأخير <bdi>' + k.row.late_min + '</bdi> د') + '</em></li>'; }).join('') + '</ul>' : '<p>مفيش راحات أو غياب في الشهر ده.</p>';
      } else {
        title = 'الإجازات — ' + MONTHS[+st.ym.slice(5) - 1] + ' ' + st.ym.slice(0, 4);
        var lv = st.reqs.filter(function (r) { return r.kind === 'leave'; });
        body = '<div class="hws-bal"><small>رصيد الإجازات المتبقي</small><b><bdi>' + (st.me && st.me.leave_balance != null ? esc(st.me.leave_balance) : '—') + '</bdi> يوم</b></div>' +
          (lv.length ? lv.map(function (r) { return '<div class="hws-lv">' + leaveCard(r) + '</div>'; }).join('') : '<p>مفيش طلبات إجازة في الشهر ده.</p>');
      }
      return '<section class="hws-sheet" data-hws-panel aria-label="' + esc(title) + '"><header><h3>' + esc(title) + '</h3><button type="button" class="hws-x" data-hws-sheet-x aria-label="إغلاق التفاصيل">' + X + '</button></header>' + body + '</section>';
    }
    function leaveCard(r) {
      if (!r) return '';
      var days = Math.round((new Date(r.to_date) - new Date(r.from_date)) / 864e5) + 1, status = { approved: 'معتمد', pending: 'منتظر الاعتماد', rejected: 'مرفوض' }[r.status] || r.status;
      return '<dl><dt>النوع</dt><dd>إجازة ' + esc(LEAVE[r.leave_type] || r.leave_type || '') + ' — ' + esc(status) + '</dd><dt>المدة</dt><dd><bdi>' + days + '</bdi> يوم (من ' + esc(fdate(r.from_date)) + ' إلى ' + esc(fdate(r.to_date)) + ')</dd>' +
        '<dt>الرصيد المتبقي</dt><dd><bdi>' + (st.me && st.me.leave_balance != null ? esc(st.me.leave_balance) : '—') + '</bdi> يوم</dd><dt>تاريخ الطلب</dt><dd>' + esc(fstamp(r.created_at)) + '</dd>' +
        (r.status === 'pending' ? '' : '<dt>اعتمده</dt><dd>' + esc(reviewer(r.reviewed_by)) + (r.reviewed_at ? ' — ' + esc(fstamp(r.reviewed_at)) : '') + '</dd>') + (r.review_note ? '<dt>ملاحظة</dt><dd>' + esc(r.review_note) + '</dd>' : '') + '</dl>';
    }
    function draw() {
      var name = person.full_name || (st.me && st.me.full_name) || 'الموظف', head = '<header class="hws-top"><div><h2>مواعيد العمل والإجازات والراحات</h2><small>' + esc(name) + '</small></div><button type="button" class="hws-x" data-hws-close aria-label="إغلاق">' + X + '</button></header>';
      if (!st.loaded) { dlg.innerHTML = head + '<p class="hws-msg" role="status">جاري التحميل…</p>'; return; }
      if (st.err) { dlg.innerHTML = head + '<p class="hws-msg err" role="alert">' + esc(st.err) + '</p><button type="button" class="btn ghost" data-hws-retry>إعادة المحاولة</button>'; return; }
      var c = summary(), m = MONTHS[+st.ym.slice(5) - 1];
      dlg.innerHTML = head + '<div class="hws-bar"><button type="button" data-hws-nav="-1" aria-label="الشهر السابق">' + CH('prev') + '</button><b>' + m + ' <bdi>' + st.ym.slice(0, 4) + '</bdi></b><button type="button" data-hws-nav="1" aria-label="الشهر التالي">' + CH('next') + '</button></div>' +
        '<div class="hws-chips"><button type="button" data-hws-sheet="day:' + today + '" class="work"><b><bdi>' + c.work + '</bdi></b> يوم عمل</button><button type="button" data-hws-sheet="rest" class="rest"><b><bdi>' + c.rest + '</bdi></b> راحات وغياب</button><button type="button" data-hws-sheet="leave" class="leave"><b><bdi>' + c.leave + '</bdi></b> إجازات</button></div>' +
        grid() + legend() + '<p class="hws-note">الأيام الجاية بتتعرض «حسب الجدول الحالي». الطلبات المعروضة هي طلبات الشهر ده بس.</p>' + sheetHtml();
    }
    function load() {
      var n = ++st.serial, first = st.ym + '-01', lastD = monthDays().slice(-1)[0], to = lastD > today ? today : lastD;
      st.loaded = false; st.err = ''; draw();
      var rpc = U().rpc;
      var jobs = [rpc('hr_shifts_workspace').catch(function () { return null; }), rpc('hr_workspace', { p_month: first }), first > today ? Promise.resolve(null) : rpc('hr_attendance_range', { p_from: first, p_to: to }).catch(function () { return null; })];
      return Promise.all(jobs).then(function (r) {
        if (n !== st.serial || !dlg.isConnected) return;
        st.ws = r[0]; st.wsp = r[0] && (r[0].people || []).filter(function (p) { return p.id === pid; })[0] || null;
        var hw = r[1] || {}; st.people = hw.people || []; st.me = st.people.filter(function (p) { return p.id === pid; })[0] || null;
        st.reqs = (hw.requests || []).filter(function (x) { return x.person_id === pid; });
        st.att = {}; ((r[2] && r[2].rows) || []).forEach(function (x) { if (x.person_id === pid) st.att[x.day] = x; });
        st.loaded = true; draw();
      }).catch(function (e) { if (n !== st.serial || !dlg.isConnected) return; st.loaded = true; st.err = (e && e.message) || 'تعذر تحميل البيانات'; draw(); });
    }
    load();
    return dlg;
  }
  w.SSMPDHRWorkSchedule = { open: open };
})(window, document);
