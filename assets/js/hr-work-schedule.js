/* HR — «مواعيد العمل والإجازات والراحات» (owner 2026-11-26 «طبقه», mockup docs/ui-references/mockups/hr-work-schedule.html).
   Read-only month calendar for ONE employee. No new RPC: templates + weekly days from hr_shifts_workspace, requests/balance from hr_workspace(p_month),
   punches from hr_attendance_range (past days only). Future days follow the CURRENT weekly schedule and say so.
   + «وردية اليوم السريعة» / «وردية حسب تواجد الطبيب» (owner 2026-11-27, mockup docs/ui-references/mockups/hr-flex-shifts.html):
   hr_day_shift('month') gives the day shifts (quick / doctor) and the doctor link; an empty day is a button that opens the quick-shift
   form (HR or the direct manager only, as the server says); HR sets «نوع الوردية» (fixed weekly / follows doctors) from the same window. */
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
    var st = { ym: today.slice(0, 7), ws: null, wsp: null, att: {}, reqs: [], people: [], me: null, loaded: false, err: '', serial: 0, sheet: null, ds: null, busy: false, msg: '', prov: null, fx: null };
    var dlg = d.createElement('dialog'); dlg.className = 'hws'; dlg.dataset.hws = pid; dlg.setAttribute('aria-label', 'مواعيد العمل والإجازات والراحات');
    d.body.appendChild(dlg);
    function close() { if (dlg.open && dlg.close) dlg.close(); dlg.remove(); }
    dlg.addEventListener('cancel', function (e) { e.preventDefault(); close(); });
    dlg.addEventListener('click', function (e) {
      if (e.target === dlg || e.target.closest('[data-hws-close]')) { close(); return; }
      var n = e.target.closest('[data-hws-nav]'); if (n) { shift(+n.dataset.hwsNav); return; }
      var s = e.target.closest('[data-hws-sheet]'); if (s) { st.sheet = s.dataset.hwsSheet; st.msg = ''; st.qf = null; if (st.sheet === 'flex') st.fx = null; draw(); return; }
      if (e.target.closest('[data-hws-sheet-x]')) { st.sheet = null; st.msg = ''; draw(); return; }
      if (e.target.closest('[data-hws-retry]')) { load(); return; }
      var a = e.target.closest('[data-hws-act]'); if (a && !st.busy) act(a.dataset.hwsAct, a);
    });
    dlg.addEventListener('change', function (e) { if (e.target.matches('[data-fx-add]') && e.target.value) { fxAdd(e.target.value); } });
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
      var ds = dayRows(s), flex = isFlexDay(s);
      if (row && row.status === 'leave') return { k: 'leave', row: row };
      if (ds.length) {
        var src = ds[0].source, span = ds.map(function (x) { return x.start + '–' + x.end; }).join(' · ');
        if (row && row.status === 'absent') return { k: 'absent', row: row, span: span, ds: ds, src: src };
        return { k: 'work', row: row, ds: ds, src: src, span: span, future: s > today, mission: row && row.status === 'mission' ? row.mission : null };
      }
      if (flex) return { k: 'nowork', off: offRow(s), rest: has && !days[dow] };
      if (row && row.status === 'mission') return { k: 'work', row: row, t: tpl(days && days[dow]), mission: row.mission };
      if (row && row.status === 'absent') return { k: 'absent', row: row, t: tpl(days && days[dow]) };
      if (has && !days[dow]) return { k: 'rest' };
      if (has) return { k: 'work', t: tpl(days[dow]), row: row, future: s > today };
      return { k: 'none' };
    }
    function dayRows(s) { return ((st.ds && st.ds.shifts) || []).filter(function (x) { return x.day === s && x.active; }); }
    function offRow(s) { return ((st.ds && st.ds.shifts) || []).filter(function (x) { return x.day === s && !x.active && x.source === 'doctor'; })[0] || null; }
    function isFlexDay(s) { return !!(st.ds && (st.ds.flex_days || []).indexOf(s) >= 0); }
    function addDays(s, n) { var t = new Date(s + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
    function canQuick(s) { if (!st.ds || !st.ds.can_quick) return false; if (s > addDays(today, 60)) return false; return s >= today || (st.ds.can_fix_past && s >= addDays(today, -3)); }
    function emptyDay(k) { return k.k === 'none' || k.k === 'rest' || k.k === 'nowork'; }
    function summary() {
      var c = { work: 0, rest: 0, leave: 0, late: 0 };
      monthDays().forEach(function (s) { var k = classify(s); if (k.k === 'work') c.work++; else if (k.k === 'rest' || k.k === 'absent') c.rest++; else if (k.k === 'leave') c.leave++; if (k.row && k.row.late_min > 0 && k.k === 'work') c.late++; });
      return c;
    }
    function cell(s) {
      var k = classify(s), n = +s.slice(8), dot = '';
      if (k.k === 'work' && !k.future && k.row) { if (k.row.late_min > 0) dot = '<i class="hws-dot late" title="تأخير"></i>'; else if (!k.row.first_in && s < today) dot = '<i class="hws-dot miss" title="بدون بصمة"></i>'; }
      if (k.k === 'absent') dot = '<i class="hws-dot miss" title="غياب"></i>';
      var add = emptyDay(k) && canQuick(s);
      var cls = 'hws-c ' + k.k + (k.src ? ' ' + k.src : '') + (add ? ' add' : '') + (k.future ? ' future' : '') + (s === today ? ' today' : '') + (st.sheet === 'day:' + s || st.sheet === 'quick:' + s ? ' sel' : '');
      return '<button type="button" class="' + cls + '" data-hws-sheet="' + (add ? 'quick:' : 'day:') + s + '" aria-label="' + esc(fdate(s)) + (add ? ' — أضف وردية لليوم ده' : '') + '"' + (add ? ' data-hws-add="' + s + '"' : '') + '><b>' + n + '</b>' + dot + (add ? '<i class="hws-plus" aria-hidden="true">+</i>' : '') + '</button>';
    }
    function grid() {
      var ds = monthDays(), lead = ORDER.indexOf(dowOf(ds[0])), h = ORDER.map(function (o) { return '<span>' + DOW[o].replace('ال', '') + '</span>'; }).join(''), cells = '';
      for (var i = 0; i < lead; i++) cells += '<span class="hws-c blank"></span>';
      ds.forEach(function (s) { cells += cell(s); });
      return '<div class="hws-head7" aria-hidden="true">' + h + '</div><div class="hws-grid" role="grid">' + cells + '</div>';
    }
    function legend() { return '<ul class="hws-leg"><li><i class="sw work"></i>عمل</li><li><i class="sw rest"></i>راحة أسبوعية</li><li><i class="sw leave"></i>إجازة</li><li><i class="sw pending"></i>طلب منتظر</li><li><i class="sw quick"></i>وردية اليوم</li><li><i class="sw doctor"></i>حسب الطبيب</li>' + (st.ds && st.ds.can_quick ? '<li><i class="sw add"></i>مفيش وردية — دوس لإضافة</li>' : '') + '<li><i class="hws-dot late"></i>تأخير</li><li><i class="hws-dot miss"></i>بدون بصمة / غياب</li></ul>'; }
    function sheetHtml() {
      var s = st.sheet; if (!s) return '';
      var body = '', title = '';
      if (s.indexOf('day:') === 0) {
        var day = s.slice(4), k = classify(day), r = k.row || {}; title = fdate(day) + ' — ' + DOW[dowOf(day)];
        if (k.k === 'work') {
          var t = k.t;
          body = '<dl><dt>المواعيد</dt><dd>' + (k.span ? '<bdi>' + esc(k.span) + '</bdi>' : t ? 'من <bdi>' + esc(short(t.start_time)) + '</bdi> إلى <bdi>' + esc(short(t.end_time)) + '</bdi>' : '—') + '</dd>';
          if (k.src === 'quick') body += '<dt>النوع</dt><dd>وردية لليوم ده بس' + (k.ds[0].extra ? ' — يوم إضافي' : '') + (k.ds[0].note ? ' · ' + esc(k.ds[0].note) : '') + '</dd>';
          if (k.src === 'doctor') body += '<dt>النوع</dt><dd>حسب تواجد الطبيب' + (k.ds[0].note ? ' · ' + esc(k.ds.map(function (x) { return x.note; }).join(' · ')) : '') + '</dd>';
          if (k.mission) body += '<dt>مهمة خارجية</dt><dd>' + esc(k.mission.place || '') + '</dd>';
          if (k.future) body += '</dl><p class="hws-note">حسب الجدول الحالي</p>';
          else body += '<dt>الحضور</dt><dd>' + (r.first_in ? '<bdi>' + clock(r.first_in) + '</bdi>' : 'لا توجد بصمة') + '</dd><dt>التأخير</dt><dd>' + (r.late_min > 0 ? '<bdi>' + r.late_min + '</bdi> دقيقة' : 'لا يوجد') + '</dd><dt>الانصراف</dt><dd>' + (r.last_out ? '<bdi>' + clock(r.last_out) + '</bdi>' : (r.first_in ? 'لا توجد بصمة انصراف' : '—')) + '</dd></dl>';
          if (k.src === 'quick' && st.ds && st.ds.can_quick && (day >= today || st.ds.can_fix_past)) body += '<div class="hws-acts"><button type="button" class="btn ghost" data-hws-act="qcancel" data-id="' + esc(k.ds[0].id) + '">إلغاء وردية اليوم ده</button></div>';
        } else if (k.k === 'nowork') body = '<p>' + (k.off ? 'الطبيب لغى اليوم ده — الوردية اتشالت.' : 'مفيش طبيب اليوم ده.') + ' مفيش شغل — مش بيتحسب غياب.</p>';
        else if (k.k === 'rest') body = '<p>راحة أسبوعية — مش بتتحسب غياب ولا بتتخصم من رصيد الإجازات.</p>';
        else if (k.k === 'absent') body = '<p>غياب' + (r.excused ? ' (بعذر)' : '') + ' في يوم كان عليه عمل فيه' + (k.t ? ' — <bdi>' + esc(short(k.t.start_time)) + '</bdi> إلى <bdi>' + esc(short(k.t.end_time)) + '</bdi>' : '') + '.</p>';
        else if (k.k === 'leave' || k.k === 'pending') body = leaveCard(k.req) || '<p>إجازة معتمدة.</p>';
        else body = '<p>مفيش جدول مسجل لليوم ده.</p>';
      } else if (s.indexOf('quick:') === 0) {
        var qd = s.slice(6), qk = classify(qd), qf = st.qf && st.qf.day === qd ? st.qf : { start: '09:00', end: '17:00', note: '', grace: 10, extra: true }; title = 'وردية يوم ' + DOW[dowOf(qd)] + ' ' + fdate(qd) + ' بس';
        body = (qk.k === 'nowork' ? '<p class="hws-note">' + (qk.off ? 'الطبيب لغى اليوم ده.' : 'مفيش طبيب اليوم ده.') + '</p>' : '') +
          '<div class="hws-form"><label>الوردية من الساعة<input type="time" name="q_start" value="' + esc(qf.start) + '" required></label><label>الوردية لحد الساعة<input type="time" name="q_end" value="' + esc(qf.end) + '" required></label>' +
          '<label class="wide">سبب الوردية (اختياري)<input type="text" name="q_note" maxlength="300" value="' + esc(qf.note) + '" placeholder="مثلاً: تغطية عيادة الأسنان"></label>' +
          (qk.k === 'rest' ? '<fieldset class="wide hws-extra"><legend>ده يوم إجازته الأسبوعية — يتحسب إزاي؟</legend><label><input type="radio" name="q_extra" value="1"' + (qf.extra !== false ? ' checked' : '') + '> يوم إضافي (بيتقبض زيادة)</label><label><input type="radio" name="q_extra" value="0"' + (qf.extra === false ? ' checked' : '') + '> يوم عادي</label></fieldset>' : '') +
          '<details class="wide hws-adv"><summary>خيارات متقدمة</summary><label>السماح قبل التأخير (دقيقة)<input type="number" name="q_grace" min="0" max="120" value="' + esc(qf.grace) + '"></label><p class="hws-note">لو «لحد الساعة» أصغر من «من الساعة» الوردية بتعدّي نص الليل.</p></details></div>' +
          '<p class="hws-note">بتتحسب زي أي وردية: البصمة، التأخير، «تشغيل اليوم»، قفل الريسبشن، والمرتب. لليوم ده بس ومش بتتكرر.</p>' +
          (st.msg ? '<p class="hws-msg err" role="alert">' + esc(st.msg) + '</p>' : '') +
          '<div class="hws-acts"><button type="button" class="btn btn-primary" data-hws-act="qsave" data-day="' + qd + '">احفظ وردية اليوم</button><button type="button" class="btn ghost" data-hws-sheet-x>إلغاء</button></div>';
      } else if (s === 'flex') {
        title = 'نوع وردية ' + (person.full_name || 'الموظف'); body = flexHtml();
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
    function val(n) { var x = dlg.querySelector('[name="' + n + '"]'); return x ? x.value : ''; }
    function done(m) { st.busy = false; st.msg = ''; if (w.SSMPDToast && w.SSMPDToast.show) w.SSMPDToast.show(m); }
    function fail(e) { st.busy = false; st.msg = (e && e.message) || 'تعذر الحفظ'; draw(); }
    function call(action, payload) { st.busy = true; return U().rpc('hr_day_shift', { p_action: action, p_payload: payload }); }
    function act(kind, el) {
      if (kind === 'qsave') {
        var ex = dlg.querySelector('[name=q_extra]:checked'), p = { person_id: pid, day: el.dataset.day, start: val('q_start'), end: val('q_end'), note: val('q_note'), grace: val('q_grace') };
        if (ex) p.extra = ex.value === '1';
        st.qf = { day: p.day, start: p.start, end: p.end, note: p.note, grace: p.grace, extra: ex ? p.extra : true };
        if (!p.start || !p.end) { st.msg = 'اكتب الوردية من الساعة ولحد الساعة'; draw(); return; }
        call('quick_save', p).then(function () { done('اتحفظت وردية يوم ' + fdate(p.day)); st.sheet = 'day:' + p.day; return load(); }).catch(fail);
      } else if (kind === 'qcancel') {
        if (!w.confirm('إلغاء وردية اليوم ده؟')) return;
        call('quick_cancel', { id: el.dataset.id }).then(function () { done('اتلغت الوردية'); return load(); }).catch(function (e) { st.busy = false; toast((e && e.message) || 'تعذر الإلغاء'); });
      } else if (kind === 'fx-mode') { fxCapture(); st.fx.mode = el.dataset.mode; st.fx.preview = null; st.msg = ''; draw(); }
      else if (kind === 'fx-rm') { fxCapture(); st.fx.ids = st.fx.ids.filter(function (x) { return x !== el.dataset.id; }); st.fx.preview = null; draw(); }
      else if (kind === 'fx-preview' || kind === 'fx-save') {
        var f = fxPayload(); if (!f) return;
        call(kind === 'fx-save' ? 'flex_save' : 'preview', f).then(function (r) {
          if (kind === 'fx-save') { done('اتحفظ نوع الوردية — حسب تواجد الطبيب'); st.sheet = null; return load(); }
          st.busy = false; st.msg = ''; st.fx.preview = r.days || []; draw();
        }).catch(fail);
      } else if (kind === 'fx-fixed') {
        if (!st.ds.flex) { st.sheet = null; draw(); return; }
        if (!w.confirm('ترجع لوردية ثابتة كل أسبوع من ' + fdate(val('fx_from') || today) + '؟')) return;
        call('flex_stop', { person_id: pid, from: val('fx_from') || today }).then(function () { done('رجعت الوردية الثابتة كل أسبوع'); st.sheet = null; return load(); }).catch(fail);
      }
    }
    function fxCapture() { if (!st.fx) return; [['before', 'fx_before'], ['after', 'fx_after'], ['from', 'fx_from'], ['dep', 'fx_dep']].forEach(function (k) { var x = dlg.querySelector('[name="' + k[1] + '"]'); if (x) st.fx[k[0]] = x.value; }); }
    function fxAdd(idv) { fxCapture(); if (st.fx.ids.indexOf(idv) < 0) st.fx.ids.push(idv); st.fx.preview = null; draw(); }
    function fxPayload() {
      fxCapture();
      var p = { person_id: pid, before_min: st.fx.before, after_min: st.fx.after, valid_from: st.fx.from || today, split_gap_min: val('fx_gap') || 120, grace: val('fx_grace') || 10 };
      if (st.fx.dep) p.department = st.fx.dep; p.provider_ids = st.fx.ids.slice();
      if (!p.provider_ids.length && !p.department) { st.msg = 'اختار طبيب واحد على الأقل أو قسم'; draw(); return null; }
      return p;
    }
    function flexHtml() {
      if (!st.prov) { U().rpc('hr_day_shift', { p_action: 'providers', p_payload: {} }).then(function (r) { st.prov = r || { doctors: [], departments: [] }; draw(); }).catch(function (e) { st.prov = { doctors: [], departments: [], err: (e && e.message) || 'تعذر تحميل الأطباء' }; draw(); }); return '<p class="hws-msg" role="status">جاري تحميل الأطباء…</p>'; }
      var fl = st.ds.flex;
      if (!st.fx) st.fx = { mode: fl ? 'doctor' : 'fixed', ids: fl ? (fl.provider_ids || []).slice() : [], dep: fl ? fl.department || '' : '', before: fl ? fl.before_min : 30, after: fl ? fl.after_min : 15, from: today, preview: null };
      var fx = st.fx, docs = st.prov.doctors || [], name = function (i) { var d0 = docs.filter(function (x) { return x.id === i; })[0]; return d0 ? d0.name : 'طبيب'; };
      var seg = '<div class="hws-seg" role="group" aria-label="نوع الوردية"><button type="button" data-hws-act="fx-mode" data-mode="fixed" class="' + (fx.mode === 'fixed' ? 'on' : '') + '" aria-pressed="' + (fx.mode === 'fixed') + '">ثابتة كل أسبوع</button><button type="button" data-hws-act="fx-mode" data-mode="doctor" class="' + (fx.mode === 'doctor' ? 'on' : '') + '" aria-pressed="' + (fx.mode === 'doctor') + '">حسب تواجد الطبيب</button></div>';
      if (st.prov.err) return seg + '<p class="hws-msg err" role="alert">' + esc(st.prov.err) + '</p>';
      if (fx.mode === 'fixed') return seg + '<p class="hws-note">' + (fl ? 'الموظف دلوقتي مربوط بالطبيب. لو رجعته لثابتة، بيرجع لجدوله الأسبوعي («تعديل جدول الورديات») من اليوم اللي تختاره.' : 'الوردية ثابتة كل أسبوع — بتتعدّل من «تعديل جدول الورديات».') + '</p>' +
        (fl ? '<div class="hws-form"><label>يرجع ثابت من يوم<input type="date" name="fx_from" value="' + esc(today) + '" min="' + esc(today) + '"></label></div>' + (st.msg ? '<p class="hws-msg err" role="alert">' + esc(st.msg) + '</p>' : '') + '<div class="hws-acts"><button type="button" class="btn btn-primary" data-hws-act="fx-fixed">رجّعها ثابتة كل أسبوع</button><button type="button" class="btn ghost" data-hws-sheet-x>إلغاء</button></div>' : '');
      var opts = '<option value="">+ أضف طبيب…</option>' + docs.filter(function (x) { return fx.ids.indexOf(x.id) < 0; }).map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.name) + (x.department ? ' — ' + esc(x.department) : '') + '</option>'; }).join('');
      var deps = '<option value="">— بدون —</option>' + (st.prov.departments || []).map(function (x) { return '<option value="' + esc(x) + '"' + (fx.dep === x ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('');
      var prev = fx.preview ? '<table class="hws-tbl"><thead><tr><th>اليوم</th><th>ورديتها</th><th>الأطباء</th></tr></thead><tbody>' + fx.preview.map(function (dd) {
          return '<tr><td>' + esc(DOW[dowOf(dd.day)] + ' ' + (+dd.day.slice(8))) + '</td><td class="tm">' + (dd.periods.length ? dd.periods.map(function (x) { return '<bdi>' + esc(x.start + '–' + x.end) + '</bdi>'; }).join(' · ') : '—') + '</td><td>' + (dd.periods.length ? esc(dd.periods.map(function (x) { return x.doctors; }).join(' · ')) : 'مفيش طبيب — مفيش شغل (مش غياب)') + '</td></tr>'; }).join('') + '</tbody></table>' : '';
      return seg + '<div class="hws-form"><label class="wide">الأطباء<select data-fx-add aria-label="أضف طبيب">' + opts + '</select></label>' +
        '<div class="wide hws-chipsel">' + (fx.ids.length ? fx.ids.map(function (i) { return '<span class="hws-chip">' + esc(name(i)) + '<button type="button" data-hws-act="fx-rm" data-id="' + esc(i) + '" aria-label="شيل ' + esc(name(i)) + '">✕</button></span>'; }).join('') : '<small>مفيش أطباء مختارين</small>') + '</div>' +
        '<label class="wide">أو قسم كامل<select name="fx_dep" aria-label="القسم">' + deps + '</select></label>' +
        '<label>تيجي قبل أول كشف بـ (دقيقة)<input type="number" name="fx_before" min="0" max="180" value="' + esc(fx.before) + '"></label><label>تمشي بعد آخر كشف بـ (دقيقة)<input type="number" name="fx_after" min="0" max="180" value="' + esc(fx.after) + '"></label>' +
        '<details class="wide hws-adv"><summary>خيارات متقدمة</summary><label>يبدأ من يوم<input type="date" name="fx_from" value="' + esc(fx.from || today) + '" min="' + esc(today) + '"></label><label>فرق أكبر من كده بين طبيبين = فترتين (دقيقة)<input type="number" name="fx_gap" min="30" max="600" value="' + esc(fl ? fl.split_gap_min : 120) + '"></label><label>السماح قبل التأخير (دقيقة)<input type="number" name="fx_grace" min="0" max="120" value="' + esc(fl ? fl.grace : 10) + '"></label></details></div>' +
        '<p class="hws-note">ورديتها كل يوم بتتحسب لوحدها من مواعيد الطبيب في جدول الحجز. اليوم اللي مفيهوش طبيب = مفيش شغل، ومش بيتحسب غياب.</p>' + prev +
        (st.msg ? '<p class="hws-msg err" role="alert">' + esc(st.msg) + '</p>' : '') +
        '<div class="hws-acts"><button type="button" class="btn btn-primary" data-hws-act="fx-save">احفظ</button><button type="button" class="btn ghost" data-hws-act="fx-preview">شوف الأسبوع الجاي</button><button type="button" class="btn ghost" data-hws-sheet-x>إلغاء</button></div>';
    }
    function draw() {
      var name = person.full_name || (st.me && st.me.full_name) || 'الموظف', head = '<header class="hws-top"><div><h2>مواعيد العمل والإجازات والراحات</h2><small>' + esc(name) + '</small></div><button type="button" class="hws-x" data-hws-close aria-label="إغلاق">' + X + '</button></header>';
      if (!st.loaded) { dlg.innerHTML = head + '<p class="hws-msg" role="status">جاري التحميل…</p>'; return; }
      if (st.err) { dlg.innerHTML = head + '<p class="hws-msg err" role="alert">' + esc(st.err) + '</p><button type="button" class="btn ghost" data-hws-retry>إعادة المحاولة</button>'; return; }
      var c = summary(), m = MONTHS[+st.ym.slice(5) - 1];
      dlg.innerHTML = head + '<div class="hws-bar"><button type="button" data-hws-nav="-1" aria-label="الشهر السابق">' + CH('prev') + '</button><b>' + m + ' <bdi>' + st.ym.slice(0, 4) + '</bdi></b><button type="button" data-hws-nav="1" aria-label="الشهر التالي">' + CH('next') + '</button></div>' +
        '<div class="hws-chips"><button type="button" data-hws-sheet="day:' + today + '" class="work"><b><bdi>' + c.work + '</bdi></b> يوم عمل</button><button type="button" data-hws-sheet="rest" class="rest"><b><bdi>' + c.rest + '</bdi></b> راحات وغياب</button><button type="button" data-hws-sheet="leave" class="leave"><b><bdi>' + c.leave + '</bdi></b> إجازات</button></div>' +
        (st.ds && (st.ds.can_flex || st.ds.flex) ? '<button type="button" class="hws-type" data-hws-sheet="flex"' + (st.ds.can_flex ? '' : ' disabled') + '>نوع الوردية: <b>' + (st.ds.flex ? 'حسب تواجد الطبيب' : 'ثابتة كل أسبوع') + '</b>' + (st.ds.flex ? ' <small>(' + esc((st.ds.flex.doctors || []).join('، ') || st.ds.flex.department || '') + ')</small>' : '') + '</button>' : '') +
        grid() + legend() + '<p class="hws-note">الأيام الجاية بتتعرض «حسب الجدول الحالي». الطلبات المعروضة هي طلبات الشهر ده بس.</p>' + sheetHtml();
    }
    function load() {
      var n = ++st.serial, first = st.ym + '-01', lastD = monthDays().slice(-1)[0], to = lastD > today ? today : lastD;
      st.loaded = false; st.err = ''; draw();
      var rpc = U().rpc;
      var jobs = [rpc('hr_shifts_workspace').catch(function () { return null; }), rpc('hr_workspace', { p_month: first }), first > today ? Promise.resolve(null) : rpc('hr_attendance_range', { p_from: first, p_to: to }).catch(function () { return null; }),
        rpc('hr_day_shift', { p_action: 'month', p_payload: { person_id: pid, from: first, to: lastD } }).catch(function () { return null; })];
      return Promise.all(jobs).then(function (r) {
        if (n !== st.serial || !dlg.isConnected) return;
        st.ws = r[0]; st.wsp = r[0] && (r[0].people || []).filter(function (p) { return p.id === pid; })[0] || null;
        var hw = r[1] || {}; st.people = hw.people || []; st.me = st.people.filter(function (p) { return p.id === pid; })[0] || null;
        st.reqs = (hw.requests || []).filter(function (x) { return x.person_id === pid; });
        st.att = {}; ((r[2] && r[2].rows) || []).forEach(function (x) { if (x.person_id === pid) st.att[x.day] = x; });
        st.ds = r[3] || null;
        st.loaded = true; draw();
      }).catch(function (e) { if (n !== st.serial || !dlg.isConnected) return; st.loaded = true; st.err = (e && e.message) || 'تعذر تحميل البيانات'; draw(); });
    }
    load();
    return dlg;
  }
  w.SSMPDHRWorkSchedule = { open: open };
})(window, document);
