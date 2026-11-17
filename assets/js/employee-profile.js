(function (w, d) {
  'use strict';
  // «ملف أداء الموظف»: one employee's attendance, lateness, tasks and evaluation as interactive charts (owner-approved mockup:
  // docs/ui-references/mockups/employee-profile.html). Opened from the live presence board and the attendance reports.
  // Data (all existing RPCs, nothing new on the server):
  //   hr_attendance_range(p_from, p_to)                 -> daily rows per person (HR managers)
  //   staff_comprehensive_performance(p_from, p_to, p_admin) -> score, band, dimensions[] (super admin / general manager / self)
  //   employee_task_performance('custom', from, to, admin)    -> task totals, one call per month for the trend
  //   staff_reviews (SSMPDDb.staffReviewHistory)        -> monthly 1..5 rating + note
  // A section the viewer may not read shows a quiet note instead of an error. Aggregation follows hr-attendance-reports.js:
  // leave and excused absences never count against the person; upcoming / unmapped days are skipped.
  var C = w.SSMPDAttCore, esc = function (v) { return C.esc(v); }, ico = function (n) { return C.ico(n); };
  var ST = { ok: ['في الميعاد', '#00B0BD'], late: ['متأخر', '#FF8800'], abs: ['غايب', '#FF0000'], leave: ['إجازة', '#525B6F'], off: ['مش مجدول', '#F1F4F8'] };
  var MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  var DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  var BANDS = { excellent: ['ممتاز', '#1E7A55', '#E4F3EC'], good: ['جيد', '#1E7A55', '#E4F3EC'], acceptable: ['مقبول', '#B5650F', '#FDF1DC'], poor: ['سيئ', '#B3261E', '#FBE9E5'], provisional: ['نتيجة مبدئية', '#5B6B84', '#EEF1F6'] };
  var NS = 'http://www.w3.org/2000/svg';

  // ---------- dates (Cairo calendar days as integers, like the reports) ----------
  function dnum(s) { var p = String(s).slice(0, 10).split('-'); return Math.floor(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 864e5); }
  function dstr(n) { return new Date(n * 864e5).toISOString().slice(0, 10); }
  function dobj(n) { return new Date(n * 864e5); }
  function today() { return dnum(C.dayOf(new Date().toISOString())); }
  function monthStart(n) { var o = dobj(n); return Math.floor(Date.UTC(o.getUTCFullYear(), o.getUTCMonth(), 1) / 864e5); }
  function monthEnd(n) { var o = dobj(n); return Math.floor(Date.UTC(o.getUTCFullYear(), o.getUTCMonth() + 1, 0) / 864e5); }
  function addMonths(n, k) { var o = dobj(n); return Math.floor(Date.UTC(o.getUTCFullYear(), o.getUTCMonth() + k, 1) / 864e5); }
  function mname(n) { var o = dobj(n); return MONTHS[o.getUTCMonth()] + ' ' + o.getUTCFullYear(); }
  function cairoIso(n, end) { return new Date((n + (end ? 1 : 0)) * 864e5 - 2 * 3600e3 - (end ? 1 : 0)).toISOString(); }
  function periodOf(key, t) {
    if (key === '30') return { from: t - 29, to: t, label: 'آخر 30 يوم' };
    if (key === '90') return { from: t - 89, to: t, label: 'آخر 3 شهور' };
    return { from: monthStart(t), to: t, label: mname(t) };
  }

  // ---------- small svg helpers ----------
  function el(n, a, p) { var e = d.createElementNS(NS, n); Object.keys(a || {}).forEach(function (k) { e.setAttribute(k, a[k]); }); if (p) p.appendChild(e); return e; }
  function txt(parent, x, y, s, anchor, style) { var t = el('text', { x: x, y: y, 'text-anchor': anchor || 'middle', direction: 'rtl', style: style || '' }, parent); t.textContent = s; return t; }
  function draw(path, ms, delay) { if (!path.getTotalLength) return; var L = path.getTotalLength(); path.style.strokeDasharray = L; path.style.strokeDashoffset = L; path.style.transition = 'stroke-dashoffset ' + ms + 'ms var(--ease-out,cubic-bezier(.22,1,.36,1)) ' + (delay || 0) + 'ms'; requestAnimationFrame(function () { requestAnimationFrame(function () { path.style.strokeDashoffset = 0; }); }); }

  function open(opt) {
    opt = opt || {};
    if (!opt.personId && !opt.adminId) return null;
    var U = w.SSMPDWorkforceUtils, DB = w.SSMPDDb, owner = w.SSMPDAuth && w.SSMPDAuth.currentAdmin && w.SSMPDAuth.currentAdmin.id;
    var state = { period: 'month', calMonth: null, data: null, serial: 0 };
    var dlg = d.createElement('dialog');
    dlg.className = 'epf-dlg att-hub'; dlg.setAttribute('aria-label', 'ملف أداء ' + (opt.name || 'الموظف')); dlg.dataset.employeeProfile = '';
    dlg.innerHTML = C.sprite() + '<div class="ep" data-ep-root></div>';
    d.body.appendChild(dlg);
    var root = dlg.querySelector('[data-ep-root]'), tip = d.createElement('div');
    tip.className = 'epf-tip'; tip.setAttribute('role', 'status'); dlg.appendChild(tip); // inside the modal: the top layer hides anything outside it
    function showTip(html, x, y) { tip.innerHTML = html; tip.classList.add('on'); var tw = tip.offsetWidth, th = tip.offsetHeight; tip.style.left = Math.min(Math.max(8, x - tw / 2), w.innerWidth - tw - 8) + 'px'; tip.style.top = Math.max(8, y - th - 12) + 'px'; }
    function hideTip() { tip.classList.remove('on'); }
    function close() { hideTip(); if (dlg.open && dlg.close) dlg.close(); dlg.remove(); }
    dlg.addEventListener('close', function () { if (dlg.isConnected) dlg.remove(); });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) close(); });
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');

    function rpc(name, args) { var c = DB && DB.client; if (!c) return Promise.reject(new Error('DB_UNAVAILABLE')); return Promise.resolve(c.rpc(name, args || {})).then(function (r) { if (r && r.error) throw r.error; return r ? r.data : null; }); }
    function soft(p) { return p.then(function (v) { return { ok: true, v: v }; }, function (e) { return { ok: false, e: e }; }); }

    function load() {
      var n = ++state.serial, t = today(), from = addMonths(monthStart(t), -5);
      root.innerHTML = head() + '<div class="epf-msg" role="status">جاري تحميل ملف الأداء…</div>';
      bindHead();
      var cur = periodOf(state.period, t), len = cur.to - cur.from + 1, prev = { from: cur.from - len, to: cur.from - 1 };
      var jobs = [soft(U && U.rpc ? U.rpc('hr_attendance_range', { p_from: dstr(Math.min(from, prev.from)), p_to: dstr(t) }) : rpc('hr_attendance_range', { p_from: dstr(Math.min(from, prev.from)), p_to: dstr(t) }))];
      if (opt.adminId) {
        jobs.push(soft(rpc('staff_comprehensive_performance', { p_from: cairoIso(cur.from), p_to: cairoIso(cur.to, true), p_admin: opt.adminId })));
        jobs.push(soft(rpc('staff_comprehensive_performance', { p_from: cairoIso(prev.from), p_to: cairoIso(prev.to, true), p_admin: opt.adminId })));
        jobs.push(soft(rpc('employee_task_performance', { p_period: 'custom', p_from: dstr(cur.from), p_to: dstr(cur.to), p_admin: opt.adminId })));
        for (var k = 5; k >= 0; k--) { var ms = addMonths(monthStart(t), -k); jobs.push(soft(rpc('employee_task_performance', { p_period: 'custom', p_from: dstr(ms), p_to: dstr(Math.min(monthEnd(ms), t)), p_admin: opt.adminId }))); }
        jobs.push(soft(DB && DB.staffReviewHistory ? Promise.resolve(DB.staffReviewHistory(opt.adminId)) : Promise.reject(new Error('NO_REVIEWS'))));
      }
      Promise.all(jobs).then(function (r) {
        if (n !== state.serial || !dlg.isConnected || (w.SSMPDAuth && w.SSMPDAuth.currentAdmin && w.SSMPDAuth.currentAdmin.id) !== owner) return;
        state.data = { t: t, cur: cur, prev: prev, att: r[0], perf: r[1], perfPrev: r[2], task: r[3], taskMonths: r.slice(4, 10), reviews: r[10] };
        render();
      });
    }

    // ---------- attendance aggregation (same rules as the reports) ----------
    function attRows() {
      var a = state.data.att; if (!a || !a.ok || !a.v) return null;
      var pid = opt.personId, by = {};
      (a.v.rows || []).forEach(function (r) { if (r.person_id === pid) by[r.day] = r; });
      return by;
    }
    function dayState(r) {
      if (!r) return 'off';
      var s = r.status; if (s === 'upcoming' || s === 'waiting' || s === 'unmapped') return 'off';
      if (s === 'leave' || (s === 'absent' && r.excused)) return 'leave';
      if (s === 'absent') return 'abs';
      return s === 'late' ? 'late' : 'ok';
    }
    function agg(by, from, to) {
      var o = { sched: 0, onTime: 0, late: 0, lateMin: 0, absent: 0, leave: 0, early: 0, inMin: 0, inN: 0 };
      for (var x = from; x <= to; x++) {
        var r = by[dstr(x)], s = dayState(r); if (s === 'off') continue;
        if (s === 'leave') { o.leave++; continue; }
        o.sched++; if (s === 'abs') { o.absent++; continue; }
        if (s === 'late') { o.late++; o.lateMin += r.late_min || 0; } else o.onTime++;
        if (r.early_leave_min > 0) o.early++;
        if (r.first_in) { var hm = C.clock(r.first_in).split(':'); o.inMin += (+hm[0]) * 60 + (+hm[1]); o.inN++; }
      }
      o.commit = o.sched ? Math.round(o.onTime / o.sched * 100) : null;
      return o;
    }
    function deptCommit(from, to) {
      var a = state.data.att; if (!a || !a.ok || !a.v) return null;
      var dept = opt.department ? C.dept(opt.department).id : null; if (!dept) return null;
      var ids = {}; (a.v.people || []).forEach(function (p) { if (p.id !== opt.personId && C.dept(p.department).id === dept) ids[p.id] = 1; });
      var sched = 0, ok = 0, lo = dstr(from), hi = dstr(to);
      (a.v.rows || []).forEach(function (r) { if (!ids[r.person_id] || r.day < lo || r.day > hi) return; var s = dayState(r); if (s === 'off' || s === 'leave') return; sched++; if (s === 'ok') ok++; });
      return sched ? Math.round(ok / sched * 100) : null;
    }

    // ---------- markup ----------
    function head() {
      var person = (opt.department ? '<span>' + esc(opt.department) + '</span>' : '') + (opt.role ? '<span>' + esc(opt.role) + '</span>' : '');
      return '<header class="epf-who"><span class="epf-ph" data-ep-photo>' + ico('user') + '</span><div class="epf-t"><small>ملف أداء الموظف</small><h2>' + esc(opt.name || '') + '</h2><div class="epf-chips">' + person + '</div></div>' +
        '<div class="epf-seg" role="group" aria-label="الفترة"><span class="ind"></span>' + [['month', 'الشهر الحالي'], ['30', 'آخر 30 يوم'], ['90', 'آخر 3 شهور']].map(function (p) { return '<button type="button" data-ep-period="' + p[0] + '" aria-pressed="' + (state.period === p[0]) + '">' + p[1] + '</button>'; }).join('') + '</div>' +
        '<button type="button" class="epf-x" data-ep-close aria-label="إغلاق">' + ico('x') + '</button></header>';
    }
    function bindHead() {
      root.querySelector('[data-ep-close]').onclick = close;
      root.querySelectorAll('[data-ep-period]').forEach(function (b) { b.onclick = function () { if (state.period === b.dataset.epPeriod) return; state.period = b.dataset.epPeriod; state.calMonth = null; load(); }; });
      var seg = root.querySelector('.epf-seg'), ind = seg.querySelector('.ind'), on = seg.querySelector('[aria-pressed=true]');
      requestAnimationFrame(function () { if (on && on.isConnected) { ind.style.left = on.offsetLeft + 'px'; ind.style.width = on.offsetWidth + 'px'; } });
      var ph = root.querySelector('[data-ep-photo]');
      if (opt.adminId && w.SSMPDStaffProfile && w.SSMPDStaffProfile.mount && ph) { try { var box = d.createElement('span'); box.className = 'epf-photo-mount'; ph.appendChild(box); w.SSMPDStaffProfile.mount(box, opt.adminId); } catch (e) { /* the icon stays */ } }
    }
    function note(t) { return '<div class="epf-note">' + ico('bulb') + '<span>' + t + '</span></div>'; }
    function denied(r) { return r && !r.ok && /42501|صلاحية|permission|يمكنك/i.test(String(r.e && (r.e.code || '') + ' ' + (r.e.message || r.e))); }

    function render() {
      var S = state.data, by = attRows(), cur = S.cur, prev = S.prev;
      var A = by ? agg(by, cur.from, cur.to) : null, AP = by ? agg(by, prev.from, prev.to) : null;
      var perf = S.perf && S.perf.ok ? S.perf.v : null, perfPrev = S.perfPrev && S.perfPrev.ok ? S.perfPrev.v : null;
      var task = S.task && S.task.ok ? S.task.v : null;
      var months = []; for (var k = 5; k >= 0; k--) months.push(addMonths(monthStart(S.t), -k));
      var mAtt = by ? months.map(function (m) { return agg(by, m, Math.min(monthEnd(m), S.t)); }) : null;
      var mTask = S.taskMonths.map(function (r) { var v = r && r.ok ? r.v : null; return v && v.timed ? Math.round(v.on_time / v.timed * 100) : null; });
      var h = head() + '<div class="epf-body">';

      // row 1: score + tiles
      h += '<div class="epf-g3">';
      if (perf && perf.score != null) {
        var band = BANDS[perf.provisional ? 'provisional' : perf.band] || BANDS.provisional, dl = perfPrev && perfPrev.score != null ? Math.round(perf.score - perfPrev.score) : null;
        var rv = S.reviews && S.reviews.ok && Array.isArray(S.reviews.v) && S.reviews.v[0] ? S.reviews.v[0] : null;
        h += '<article class="epf-card epf-score" data-ep-score><div class="epf-ring" data-ring="' + Math.round(perf.score) + '"><svg viewBox="0 0 132 132"><circle cx="66" cy="66" r="56" class="trk"/><circle cx="66" cy="66" r="56" class="arc" style="stroke:' + band[1] + '"/></svg><div class="v"><b data-count="' + Math.round(perf.score) + '">0</b><small>من 100</small></div></div>' +
          '<div class="epf-st"><span class="epf-band" style="color:' + band[1] + ';background:' + band[2] + '">' + band[0] + '</span>' +
          (dl != null ? '<div class="epf-delta ' + (dl >= 0 ? 'up' : 'down') + '">' + (dl ? (dl > 0 ? '▲ +' : '▼ ') + Math.abs(dl) + ' عن الفترة اللي قبلها' : 'ثابت عن الفترة اللي قبلها') + '</div>' : '') +
          (rv ? '<div class="epf-stars" aria-label="تقييم المدير ' + rv.rating + ' من 5">' + [1, 2, 3, 4, 5].map(function (i) { return '<i class="' + (i <= rv.rating ? 'on' : '') + '">★</i>'; }).join('') + '</div><p>تقييم المدير لشهر ' + esc(mname(dnum(rv.month))) + ': ' + rv.rating + ' من 5' + (rv.note ? '<br>«' + esc(rv.note) + '»' : '') + '</p>' : '<p>لا يوجد تقييم من المدير بعد</p>') + '</div></article>';
      } else h += '<article class="epf-card epf-score">' + note(denied(S.perf) ? 'التقييم الشامل يظهر للسوبر أدمن والمدير العام بس' : opt.adminId ? 'مفيش بيانات كفاية لحساب التقييم الشامل في الفترة دي' : 'الموظف ده مش مربوط بحساب على الداشبورد، فمفيش تقييم شامل له') + '</article>';
      function tile(lbl, val, unit, sub, cls, spark, col) { return '<div class="epf-tile" data-ep-tile><small>' + lbl + '</small><b>' + val + (unit ? '<em>' + unit + '</em>' : '') + '</b><i class="' + (cls || '') + '">' + sub + '</i>' + (spark ? '<svg class="epf-spark" data-spark="' + spark.join(',') + '" data-c="' + col + '" aria-hidden="true"></svg>' : '') + '</div>'; }
      function dd(c, p, goodDown, unit) { if (c == null || p == null) return ['', '']; var x = c - p; if (!x) return ['ثابت عن الفترة اللي قبلها', '']; return [(x > 0 ? '+' : '−') + Math.abs(x) + (unit || '') + ' عن الفترة اللي قبلها', (goodDown ? x < 0 : x > 0) ? 'up' : 'down']; }
      h += '<div class="epf-tiles epf-s2">';
      if (A) {
        var c1 = dd(A.commit, AP.commit, false, '٪'), c2 = dd(A.absent, AP.absent, true), c3 = dd(A.late, AP.late, true);
        h += tile('الالتزام بالمواعيد', A.commit == null ? '—' : A.commit, A.commit == null ? '' : '٪', c1[0] || (A.sched + ' يوم مجدول'), c1[1], mAtt.map(function (m) { return m.commit == null ? 0 : m.commit; }), '#00B0BD') +
          tile('أيام الغياب', A.absent, A.absent === 1 ? 'يوم' : 'أيام', c2[0] || ('من ' + A.sched + ' يوم مجدول'), c2[1], mAtt.map(function (m) { return m.absent; }), '#FF0000') +
          tile('مرات التأخير', A.late, A.lateMin ? '· ' + C.dur(A.lateMin) : '', c3[0] || 'في الفترة دي', c3[1], mAtt.map(function (m) { return m.late; }), '#FF8800');
      } else h += '<div class="epf-tile epf-wide">' + note(denied(S.att) ? 'بيانات الحضور تظهر لمديري الموارد البشرية بس' : 'تعذر تحميل بيانات الحضور') + '</div>';
      if (task && task.timed) h += tile('المهام في الميعاد', Math.round(task.on_time / task.timed * 100), '٪', task.on_time + ' من ' + task.timed + ' مهمة اتسلمت', '', mTask.map(function (v) { return v == null ? 0 : v; }), '#0F369D');
      else h += tile('المهام في الميعاد', '—', '', task ? 'مفيش مهام اتسلمت في الفترة دي' : denied(S.task) ? 'تظهر للسوبر أدمن والمدير العام' : 'غير متاح', '', null, '');
      h += '</div></div>';

      // row 2: calendar + distribution
      if (A) {
        var monthsInRange = []; for (var mm = monthStart(cur.from); mm <= cur.to; mm = addMonths(mm, 1)) monthsInRange.push(mm);
        if (state.calMonth == null || monthsInRange.indexOf(state.calMonth) < 0) state.calMonth = monthsInRange[monthsInRange.length - 1];
        var ci = monthsInRange.indexOf(state.calMonth);
        h += '<div class="epf-g3"><article class="epf-card epf-s2" data-ep-cal><div class="epf-ch"><h3>الحضور يوم بيوم<small>' + esc(mname(state.calMonth)) + ' · اقف أو دوس على أي يوم تشوف تفاصيله</small></h3><div class="epf-nav">' +
          (monthsInRange.length > 1 ? '<button type="button" data-ep-cal="-1" ' + (ci <= 0 ? 'disabled' : '') + ' aria-label="الشهر اللي قبله">' + ico('chev') + '</button><button type="button" data-ep-cal="1" ' + (ci >= monthsInRange.length - 1 ? 'disabled' : '') + ' aria-label="الشهر اللي بعده">' + ico('chev') + '</button>' : '') +
          '<button type="button" class="epf-link" data-ep-table>عرض كجدول</button></div></div><div class="epf-cal" data-cal></div><table class="epf-tbl" data-caltbl hidden><thead><tr><th>اليوم</th><th>الحالة</th><th>دخول</th><th>خروج</th><th>تأخير</th></tr></thead><tbody></tbody></table>' +
          '<div class="epf-legend">' + ['ok', 'late', 'abs', 'leave', 'off'].map(function (k) { return '<span><i style="background:' + ST[k][1] + '"></i>' + ST[k][0] + '</span>'; }).join('') + '</div></article>';
        var dc = deptCommit(cur.from, cur.to), tot = Math.max(1, A.sched + A.leave);
        h += '<article class="epf-card"><div class="epf-ch"><h3>توزيع الأيام<small>' + esc(cur.label) + ' · ' + A.sched + ' يوم مجدول</small></h3></div><div class="epf-meters">' +
          [['في الميعاد', A.onTime, '#00B0BD'], ['متأخر', A.late, '#FF8800'], ['غايب', A.absent, '#FF0000'], ['إجازة', A.leave, '#525B6F']].map(function (m) { return '<div class="epf-m"><div class="l"><b>' + m[0] + '</b><span>' + m[1] + ' ' + (m[1] === 1 ? 'يوم' : 'أيام') + '</span></div><div class="trk"><i data-w="' + Math.round(m[1] / tot * 100) + '" style="background:' + m[2] + '"></i></div></div>'; }).join('') + '</div>' +
          (dc != null && A.commit != null ? '<div class="epf-cmp"><small>مقارنة بزمايله في ' + esc(C.dept(opt.department).name) + '</small><div class="epf-m"><div class="l"><b>هو</b><span>' + A.commit + '٪ في الميعاد</span></div><div class="trk"><i data-w="' + A.commit + '" style="background:#00B0BD"></i></div></div><div class="epf-m"><div class="l"><b>متوسط القسم</b><span>' + dc + '٪</span></div><div class="trk"><i data-w="' + dc + '" style="background:#9AA5B8"></i></div></div></div>' : '') +
          '<div class="epf-tstat"><div><small>متوسط وقت الدخول</small><b>' + (A.inN ? C.hhmm(A.inMin / A.inN) : '—') + '</b></div><div><small>خروج بدري</small><b>' + A.early + '</b></div></div></article></div>';
        h += '<div class="epf-g3"><article class="epf-card epf-s2"><div class="epf-ch"><h3>الالتزام الأسبوعي<small>٪ الأيام اللي وصل فيها في الميعاد · آخر 12 أسبوع</small></h3></div><div class="epf-chart" dir="ltr" data-line></div><div class="epf-cap">الأسبوع ← الأحدث</div></article>' +
          '<article class="epf-card"><div class="epf-ch"><h3>دقايق التأخير<small>بالدقيقة · كل أسبوع · آخر 8 أسابيع</small></h3></div><div class="epf-chart" dir="ltr" data-bars></div><div class="epf-cap">الأسبوع ← الأحدث</div></article></div>';
      }

      // row 3: tasks + score dimensions
      h += '<div class="epf-g3"><article class="epf-card" data-ep-tasks><div class="epf-ch"><h3>المهام<small>' + esc(cur.label) + (task ? ' · ' + task.sample + ' مهمة' : '') + '</small></h3></div>';
      if (task && task.sample) {
        var lateDel = Math.max(0, (task.timed || 0) - (task.on_time || 0)), working = Math.max(0, task.sample - (task.done || 0) - (task.review || 0) - (task.late || 0));
        h += '<div class="epf-segbar" data-segbar="' + [task.on_time || 0, lateDel, task.late || 0, working].join(',') + '"></div><div class="epf-legend" data-seglegend></div><div class="epf-tstat"><div><small>أُعيدت للتعديل</small><b>' + (task.revision || 0) + '</b></div><div><small>متوقفة</small><b>' + (task.blocked || 0) + '</b></div></div>';
      } else h += note(task ? 'مفيش مهام في الفترة دي' : denied(S.task) ? 'المهام تظهر للسوبر أدمن والمدير العام بس' : 'المهام غير متاحة');
      h += '</article><article class="epf-card epf-s2"><div class="epf-ch"><h3>تفاصيل التقييم<small>الدرجة الشاملة = مجموع الأجزاء دي حسب وزن كل جزء</small></h3></div>';
      var dims = perf && Array.isArray(perf.dimensions) ? perf.dimensions.filter(function (x) { return x && x.counted !== false; }) : [];
      h += dims.length ? '<div class="epf-meters">' + dims.map(function (x) { var s = x.score == null ? null : Math.round(x.score); return '<div class="epf-m"><div class="l"><b>' + esc(x.label) + ' · وزن ' + esc(x.weight) + '٪</b><span>' + (s == null ? 'مفيش بيانات كفاية' : s + ' من 100') + '</span></div><div class="trk"><i data-w="' + (s || 0) + '" style="background:#0F369D"></i></div></div>'; }).join('') + '</div>' : note(perf ? 'مفيش أجزاء محسوبة في الفترة دي' : 'التفاصيل تظهر مع التقييم الشامل');
      h += '</article></div>';

      // row 4: notes from the evaluation (issues / improvement steps / feedback)
      if (perf && ((perf.issues || []).length || (perf.improvement_steps || []).length || (perf.feedback || []).length)) {
        var li = function (a) { return (a || []).slice(0, 4).map(function (x) { return '<li>' + esc(typeof x === 'string' ? x : x.text || x.label || x.message || '') + '</li>'; }).join(''); };
        h += '<article class="epf-card"><div class="epf-ch"><h3>ملاحظات الفترة</h3></div><div class="epf-notes">' +
          ((perf.feedback || []).length ? '<div class="n-good"><h4>' + ico('ok') + 'تعليقات</h4><ul>' + li(perf.feedback) + '</ul></div>' : '') +
          ((perf.issues || []).length ? '<div class="n-imp"><h4>' + ico('warn') + 'محتاج تحسين</h4><ul>' + li(perf.issues) + '</ul></div>' : '') +
          ((perf.improvement_steps || []).length ? '<div class="n-step"><h4>' + ico('up') + 'الخطوة الجاية</h4><ul>' + li(perf.improvement_steps) + '</ul></div>' : '') + '</div></article>';
      }
      root.innerHTML = h + '</div>';
      bindHead();
      paint(by, A);
    }

    // ---------- charts ----------
    function paint(by, A) {
      var S = state.data;
      root.querySelectorAll('[data-ring]').forEach(function (r) { var a = r.querySelector('.arc'); requestAnimationFrame(function () { a.style.strokeDashoffset = 351.9 * (1 - Math.max(0, Math.min(100, +r.dataset.ring)) / 100); }); });
      root.querySelectorAll('[data-count]').forEach(function (e) { var to = +e.dataset.count, t0 = performance.now(); (function f(t) { var p = Math.min(1, (t - t0) / 900); e.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(f); })(t0); });
      setTimeout(function () { root.querySelectorAll('[data-w]').forEach(function (i) { i.style.width = i.dataset.w + '%'; }); }, 120);
      root.querySelectorAll('[data-spark]').forEach(function (s) {
        var v = s.dataset.spark.split(',').map(Number), W = 92, H = 36, mn = Math.min.apply(null, v), mx = Math.max.apply(null, v), sp = mx - mn || 1; s.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
        var pts = v.map(function (y, i) { return [(i / (v.length - 1)) * W, H - 4 - ((y - mn) / sp) * (H - 8)]; });
        var p = el('polyline', { points: pts.map(function (q) { return q.join(','); }).join(' '), fill: 'none', stroke: s.dataset.c, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, s); draw(p, 900, 200);
        var l = pts[pts.length - 1]; el('circle', { cx: l[0], cy: l[1], r: 3.5, fill: s.dataset.c, stroke: '#fff', 'stroke-width': 2 }, s);
      });
      if (A && by) { calendar(by); line(by); bars(by); }
      var sb = root.querySelector('[data-segbar]');
      if (sb) {
        var v = sb.dataset.segbar.split(',').map(Number), tot = v.reduce(function (a, b) { return a + b; }, 0) || 1, lg = root.querySelector('[data-seglegend]'), names = [['في الميعاد', '#00B0BD'], ['اتسلمت متأخر', '#FF8800'], ['متأخرة دلوقتي', '#FF0000'], ['لسه في وقتها', '#9AA5B8']];
        v.forEach(function (n, i) {
          if (n) { var s = d.createElement('div'); s.style.flex = n; s.style.background = names[i][1]; if (i === 0 || i === 1 || i === 3) s.style.color = '#333'; s.style.animationDelay = (i * 120) + 'ms'; if (n / tot > .12) s.textContent = n; s.tabIndex = 0;
            var on = function () { var b = s.getBoundingClientRect(); showTip('<b>' + n + ' مهمة</b> · ' + Math.round(n / tot * 100) + '٪<br>' + names[i][0], b.left + b.width / 2, b.top); };
            s.addEventListener('pointerenter', on); s.addEventListener('focus', on); s.addEventListener('pointerleave', hideTip); s.addEventListener('blur', hideTip); sb.appendChild(s); }
          var l = d.createElement('span'); l.innerHTML = '<i style="background:' + names[i][1] + '"></i>'; l.appendChild(d.createTextNode(names[i][0] + ' ' + n)); lg.appendChild(l);
        });
      }
    }
    function calendar(by) {
      var cal = root.querySelector('[data-cal]'), tb = root.querySelector('[data-caltbl] tbody'), m = state.calMonth, end = monthEnd(m), t = state.data.t;
      DAYS.forEach(function (n) { var x = d.createElement('div'); x.className = 'dn'; x.textContent = n; cal.appendChild(x); });
      for (var e = 0; e < dobj(m).getUTCDay(); e++) { var b = d.createElement('div'); b.className = 'day e'; cal.appendChild(b); }
      for (var x = m, i = 0; x <= end; x++, i++) {
        (function (x, i) {
          var r = by[dstr(x)], s = x > t ? 'off' : dayState(r), c = d.createElement('div'), dn = dobj(x).getUTCDate();
          c.className = 'day st-' + s + (x > t ? ' future' : ''); c.style.animationDelay = (i * 14) + 'ms'; c.textContent = dn;
          if (s === 'abs') { var g = d.createElement('span'); g.className = 'g'; g.textContent = '✕'; c.appendChild(g); }
          if (s === 'late' && r.late_min) { var g2 = d.createElement('span'); g2.className = 'g'; g2.dir = 'rtl'; g2.textContent = r.late_min + ' د'; c.appendChild(g2); }
          var info = '<b>' + dn + ' ' + MONTHS[dobj(x).getUTCMonth()] + '</b><br>' + ST[s][0] + (r && r.first_in ? '<br>دخول ' + C.clock(r.first_in) + (r.last_out ? ' · خروج ' + C.clock(r.last_out) : '') : '') + (s === 'late' && r.late_min ? '<br>تأخير ' + C.dur(r.late_min) : '') + (r && r.template_name ? '<br>' + esc(r.template_name) : '');
          if (s !== 'off') { c.tabIndex = 0; var on = function () { var q = c.getBoundingClientRect(); showTip(info, q.left + q.width / 2, q.top); }; c.addEventListener('pointerenter', on); c.addEventListener('focus', on); c.addEventListener('click', on); c.addEventListener('pointerleave', hideTip); c.addEventListener('blur', hideTip);
            var tr = d.createElement('tr'); [dn + ' ' + MONTHS[dobj(x).getUTCMonth()], ST[s][0], r && r.first_in ? C.clock(r.first_in) : '—', r && r.last_out ? C.clock(r.last_out) : '—', s === 'late' && r.late_min ? C.dur(r.late_min) : '—'].forEach(function (v) { var td = d.createElement('td'); td.textContent = v; tr.appendChild(td); }); tb.appendChild(tr); }
          cal.appendChild(c);
        })(x, i);
      }
      root.querySelectorAll('[data-ep-cal]').forEach(function (b) { if (b.tagName === 'BUTTON') b.onclick = function () { state.calMonth = addMonths(state.calMonth, +b.dataset.epCal); render(); }; });
      var tg = root.querySelector('[data-ep-table]'); tg.onclick = function () { var tbl = root.querySelector('[data-caltbl]'), show = tbl.hidden; tbl.hidden = !show; cal.hidden = show; tg.textContent = show ? 'عرض كتقويم' : 'عرض كجدول'; };
    }
    function weeks(by, n) {
      var t = state.data.t, out = [];
      for (var k = n - 1; k >= 0; k--) { var to = t - k * 7, from = to - 6, a = agg(by, from, to); out.push({ from: from, to: to, a: a }); }
      return out;
    }
    function line(by) {
      var host = root.querySelector('[data-line]'), wk = weeks(by, 12), v = wk.map(function (x) { return x.a.commit; }), W = 720, H = 220, P = { t: 18, r: 14, b: 26, l: 34 };
      var have = v.filter(function (x) { return x != null; }); if (have.length < 2) { host.innerHTML = note('مفيش أسابيع كفاية لرسم الخط'); return; }
      var lo = Math.max(0, Math.floor((Math.min.apply(null, have) - 5) / 10) * 10), svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'الالتزام الأسبوعي' }, host);
      var x = function (i) { return P.l + (i / (v.length - 1)) * (W - P.l - P.r); }, y = function (p) { return P.t + (1 - (p - lo) / (100 - lo)) * (H - P.t - P.b); };
      var ax = el('g', { class: 'axis' }, svg); for (var g = lo; g <= 100; g += lo >= 60 ? 10 : 20) { el('line', { x1: P.l, x2: W - P.r, y1: y(g), y2: y(g), class: 'gl' }, ax); txt(ax, P.l - 8, y(g) + 4, String(g), 'end'); }
      v.forEach(function (_, i) { txt(ax, x(i), H - 6, String(i + 1)); });
      var path = '', area = '', started = false, first = null, last = null;
      v.forEach(function (p, i) { if (p == null) return; path += (started ? 'L' : 'M') + x(i) + ',' + y(p); if (!started) first = i; started = true; last = i; });
      el('path', { d: path + 'L' + x(last) + ',' + y(lo) + 'L' + x(first) + ',' + y(lo) + 'Z', fill: '#00B0BD', opacity: .1 }, svg);
      var ln = el('path', { d: path, fill: 'none', stroke: '#00B0BD', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg); draw(ln, 1300, 150);
      el('circle', { cx: x(last), cy: y(v[last]), r: 5, fill: '#00B0BD', stroke: '#fff', 'stroke-width': 2 }, svg); txt(svg, x(last), y(v[last]) - 12, v[last] + '٪', 'middle', 'font-size:12px;font-weight:700;fill:#16212E');
      var cross = el('line', { y1: P.t, y2: H - P.b, stroke: '#3B4656', 'stroke-width': 1, opacity: 0 }, svg), dot = el('circle', { r: 5, fill: '#00B0BD', stroke: '#fff', 'stroke-width': 2, opacity: 0 }, svg);
      var hit = el('rect', { x: P.l, y: P.t, width: W - P.l - P.r, height: H - P.t - P.b, fill: 'transparent', tabindex: 0 }, svg);
      function at(i) { var r = svg.getBoundingClientRect(); i = Math.max(0, Math.min(v.length - 1, i)); var p = v[i], wk2 = wk[i]; cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('opacity', .35);
        if (p != null) { dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(p)); dot.setAttribute('opacity', 1); } else dot.setAttribute('opacity', 0);
        showTip('<b>' + (p == null ? 'مفيش أيام مجدولة' : p + '٪') + '</b><br>' + dobj(wk2.from).getUTCDate() + ' ' + MONTHS[dobj(wk2.from).getUTCMonth()] + ' – ' + dobj(wk2.to).getUTCDate() + ' ' + MONTHS[dobj(wk2.to).getUTCMonth()] + (p != null ? '<br>' + wk2.a.onTime + ' من ' + wk2.a.sched + ' يوم' : ''), r.left + x(i) / W * r.width, r.top + (p == null ? P.t : y(p)) / H * r.height); }
      var cur = v.length - 1;
      hit.addEventListener('pointermove', function (e) { var r = svg.getBoundingClientRect(); cur = Math.round(((e.clientX - r.left) / r.width * W - P.l) / (W - P.l - P.r) * (v.length - 1)); at(cur); });
      hit.addEventListener('focus', function () { at(cur); }); hit.addEventListener('keydown', function (e) { if (e.key === 'ArrowLeft') at(cur = Math.max(0, cur - 1)); if (e.key === 'ArrowRight') at(cur = Math.min(v.length - 1, cur + 1)); });
      function off() { cross.setAttribute('opacity', 0); dot.setAttribute('opacity', 0); hideTip(); } hit.addEventListener('pointerleave', off); hit.addEventListener('blur', off);
    }
    function bars(by) {
      var host = root.querySelector('[data-bars]'), wk = weeks(by, 8), v = wk.map(function (x) { return x.a.lateMin; }), W = 340, H = 220, P = { t: 22, r: 8, b: 26, l: 32 }, n = v.length, bw = 22;
      var mx = Math.max(10, Math.ceil(Math.max.apply(null, v) / 10) * 10), svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'دقايق التأخير كل أسبوع' }, host), slot = (W - P.l - P.r) / n, y = function (m) { return P.t + (1 - m / mx) * (H - P.t - P.b); };
      var ax = el('g', { class: 'axis' }, svg); [0, mx / 2, mx].forEach(function (t) { el('line', { x1: P.l, x2: W - P.r, y1: y(t), y2: y(t), class: 'gl' }, ax); txt(ax, P.l - 6, y(t) + 4, String(Math.round(t)), 'end'); });
      v.forEach(function (m, i) {
        var cx = P.l + slot * (i + .5), h = y(0) - y(m), g = el('g', { tabindex: 0 }, svg), r4 = Math.min(4, h);
        var bar = el('path', { d: h > 0 ? 'M' + (cx - bw / 2) + ',' + y(0) + 'v' + (-(h - r4)) + 'q0,' + (-r4) + ' ' + r4 + ',' + (-r4) + 'h' + (bw - 2 * r4) + 'q' + r4 + ',0 ' + r4 + ',' + r4 + 'v' + (h - r4) + 'z' : '', fill: i >= n - 2 ? '#FF8800' : '#FFC98C' }, g);
        bar.style.transformOrigin = cx + 'px ' + y(0) + 'px'; bar.style.transform = 'scaleY(0)'; bar.style.transition = 'transform .8s cubic-bezier(.22,1,.36,1) ' + (i * 60) + 'ms'; requestAnimationFrame(function () { requestAnimationFrame(function () { bar.style.transform = 'scaleY(1)'; }); });
        el('rect', { x: cx - slot / 2, y: P.t, width: slot, height: H - P.t - P.b, fill: 'transparent' }, g); txt(g, cx, H - 6, String(i + 1), 'middle', 'font-size:11px;fill:#6B7483');
        if (i === n - 1 && m) txt(g, cx, y(m) - 6, m + ' د', 'middle', 'font-size:12px;font-weight:700;fill:#16212E');
        var on = function () { var r = svg.getBoundingClientRect(); bar.style.opacity = .82; showTip('<b>' + (m ? C.dur(m) : 'مفيش تأخير') + '</b><br>' + wk[i].a.late + ' مرة · ' + dobj(wk[i].from).getUTCDate() + ' ' + MONTHS[dobj(wk[i].from).getUTCMonth()] + ' – ' + dobj(wk[i].to).getUTCDate() + ' ' + MONTHS[dobj(wk[i].to).getUTCMonth()], r.left + cx / W * r.width, r.top + y(m) / H * r.height); };
        var off = function () { bar.style.opacity = 1; hideTip(); };
        g.addEventListener('pointerenter', on); g.addEventListener('focus', on); g.addEventListener('pointerleave', off); g.addEventListener('blur', off);
      });
    }

    load();
    return { close: close, root: root, dialog: dlg };
  }

  w.SSMPDEmployeeProfile = { open: open };
})(window, document);
