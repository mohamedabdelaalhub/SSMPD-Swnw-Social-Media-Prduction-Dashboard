(function (w) {
  'use strict';
  // Attendance reports («التقارير»): lateness / absence / commitment over a period, compared with the previous equal period.
  // Data = hr_attendance_range(p_from, p_to) (migration 20261113110000): one row per scheduled person per day with the same verdicts as the live board.
  // All aggregation is client-side. Mounted by hr-attendance-hub.js as the third inner tab. No salary data is used (no financial-impact estimate).
  var C = w.SSMPDAttCore, esc = C.esc, ico = C.ico, initials = C.initials;
  var DOW = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  var MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  var MAX_DAYS = 366, HEAT_DAYS = 90, PRELOAD = 180;
  var PERIODS = [['today', 'اليوم'], ['week', 'هذا الأسبوع'], ['month', 'هذا الشهر'], ['last', 'الشهر الماضي'], ['90', 'آخر 90 يوم'], ['all', 'الفترة كلها'], ['custom', 'مخصص']];
  var saved = null; // keeps the chosen filters while the user hops between the hub tabs

  function parse(s) { var p = String(s).split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 12)); }
  function fmt(d) { return d.toISOString().slice(0, 10); }
  function addDays(s, n) { var d = parse(s); d.setUTCDate(d.getUTCDate() + n); return fmt(d); }
  function diffDays(a, b) { return Math.round((parse(a) - parse(b)) / 864e5); }
  function safeColor(c) { return /^#[0-9A-Fa-f]{6}$/.test(c || '') ? c : '#0F369D'; }

  function mount(shell, active, ctx) {
    if (!shell || !active) return;
    var U = w.SSMPDWorkforceUtils, owner = w.SSMPDAuth && w.SSMPDAuth.currentAdmin && w.SSMPDAuth.currentAdmin.id;
    var S = saved || { period: 'month', dept: 'all', q: '', metric: 'late', type: 'all', from: -29, to: 0, sort: 'lateMin', dir: -1, group: 'day', tbl: 'sum', by: 'dept', compare: true, showAll: false };
    saved = S;
    var host = document.createElement('div'); host.dataset.hrReports = ''; shell.append(host);
    var D = null, byKey = {}, loLoaded = 0, serial = 0, memo = {};
    function live() { return host.isConnected && w.SSMPDAuth.currentAdmin && w.SSMPDAuth.currentAdmin.id === owner; }
    function toast(m, kind) { if (w.SSMPDToast) w.SSMPDToast.show(m, kind); }
    function dstr(i) { return memo[i] || (memo[i] = addDays(D.today, i)); }
    function dobj(i) { return parse(dstr(i)); }
    function dlabel(i) { var d = dobj(i); return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()]; }

    // ---------- data ----------
    function todayStr() { return D ? D.today : C.dayOf(new Date().toISOString()); }
    function periodRange(p) {
      var t = parse(todayStr()), dow = (t.getUTCDay() + 1) % 7, dm = t.getUTCDate();
      if (p === 'today') return [0, 0]; if (p === 'week') return [-dow, 0]; if (p === 'month') return [-(dm - 1), 0];
      if (p === 'last') { var prevLen = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 0)).getUTCDate(); return [-(dm - 1) - prevLen, -dm]; }
      if (p === '90') return [-89, 0]; if (p === 'all') return [-(MAX_DAYS - 1), 0];
      return [Math.max(-(MAX_DAYS - 1), Math.min(0, S.from)), Math.max(-(MAX_DAYS - 1), Math.min(0, S.to))];
    }
    function index(data) {
      byKey = {}; memo = {};
      (data.rows || []).forEach(function (r) { byKey[r.person_id + '|' + r.day] = r; });
    }
    // The first fetch needs the server's "today"; asking for a 180-day window up front covers every preset period, its comparison and the 90-day heat map.
    function fetchRange(loIdx) {
      var n = ++serial;
      function go(t) {
        var from = addDays(t, loIdx), to = t;
        return U.rpc('hr_attendance_range', { p_from: from, p_to: to }).then(function (r) { if (!live() || n !== serial) return null; D = r; index(r); loLoaded = loIdx; return r; });
      }
      // the server clamps the end of the range to its own Cairo today; the browser's Cairo date only anchors the request
      return go(todayStr());
    }
    function ensure() {
      var need = periodRange(S.period), len = need[1] - need[0] + 1, lo = Math.min(need[0] - (S.compare && S.period !== 'all' && len * 2 <= MAX_DAYS ? len : 0), -(HEAT_DAYS - 1 + 6), -(PRELOAD - 1));
      if (S.period === 'all' || lo < -(MAX_DAYS - 1)) lo = -(MAX_DAYS - 1);
      if (D && lo >= loLoaded) return Promise.resolve(D);
      return fetchRange(Math.max(lo, -(MAX_DAYS - 1)));
    }
    function load(force) {
      if (force) D = null;
      if (!D) host.innerHTML = '<div class="att-msg" role="status">جاري تحميل التقرير…</div>';
      return ensure().then(function (r) { if (r) draw(); }).catch(function (err) {
        if (!live()) return;
        var missing = /hr_attendance_range|404|schema cache/i.test(err.message || '');
        host.innerHTML = '<div class="att-msg err" role="alert">' + esc(missing ? 'التقارير غير مفعّلة بعد على قاعدة البيانات' : err.message) + '</div><button type="button" class="btn ghost" data-rep-retry>إعادة المحاولة</button>';
        var b = host.querySelector('[data-rep-retry]'); if (b) b.onclick = function () { load(true); };
      });
    }

    // ---------- aggregation (same rules as the live board) ----------
    function people(f) {
      var q = (f.q || '').trim();
      return (D.people || []).filter(function (p) { var d = C.dept(p.department); return (f.dept === 'all' || d.id === f.dept) && (!q || (p.full_name + ' ' + d.name + ' ' + (p.job_title || '') + ' ' + (p.code || '')).indexOf(q) >= 0); });
    }
    function agg(from, to, f) {
      var per = people(f).map(function (p) { return { e: p, d: C.dept(p.department), sched: 0, present: 0, late: 0, lateMin: 0, absent: 0, leave: 0, onTime: 0, early: 0, ot: 0, inc: 0, weeks: [0, 0, 0, 0, 0, 0, 0, 0], dr: new Array(to - from + 1).fill(null), shifts: {}, shiftCol: {} }; });
      var days = []; for (var d = from; d <= to; d++) days.push({ d: d, late: 0, lateMin: 0, absent: 0, present: 0, sched: 0 });
      var unmapped = 0;
      per.forEach(function (p) {
        for (var d = from; d <= to; d++) {
          var r = byKey[p.e.id + '|' + dstr(d)]; if (!r) continue;
          var st = r.status, dd = days[d - from];
          if (st === 'upcoming' || st === 'waiting') continue;
          if (st === 'unmapped') { unmapped++; continue; }
          // an approved leave, or an approved permission that excuses an absence, is not held against the person
          if (st === 'leave' || (st === 'absent' && r.excused)) { p.leave++; continue; }
          p.sched++; dd.sched++;
          if (r.template_name) { p.shifts[r.template_name] = (p.shifts[r.template_name] || 0) + 1; p.shiftCol[r.template_name] = r.color; }
          if (st === 'absent') { p.absent++; dd.absent++; p.dr[d - from] = { l: 0, lm: 0, a: 1 }; continue; }
          p.present++; dd.present++;
          var late = st === 'late';
          p.dr[d - from] = { l: late ? 1 : 0, lm: late ? r.late_min : 0, a: 0 };
          if (late) { p.late++; p.lateMin += r.late_min; dd.late++; dd.lateMin += r.late_min; p.weeks[Math.min(7, Math.floor((to - d) / 7))]++; } else p.onTime++;
          p.early += r.early_leave_min > 0 ? 1 : 0; p.ot += r.overtime_min || 0; p.inc += r.incomplete ? 1 : 0;
        }
      });
      var tot = { sched: 0, present: 0, late: 0, lateMin: 0, absent: 0, leave: 0, onTime: 0, inc: 0, early: 0 };
      per.forEach(function (p) { Object.keys(tot).forEach(function (k) { tot[k] += p[k]; }); p.commit = p.sched ? Math.round(p.onTime / p.sched * 100) : 0; p.shift = Object.keys(p.shifts).sort(function (a, b) { return p.shifts[b] - p.shifts[a]; })[0] || ''; });
      tot.commit = tot.sched ? Math.round(tot.onTime / tot.sched * 100) : 0; tot.avgLate = tot.late ? Math.round(tot.lateMin / tot.late) : 0; tot.unmapped = unmapped;
      return { per: per.filter(function (p) { return p.sched + p.leave > 0; }), days: days, tot: tot };
    }
    function delta(cur, prev, goodDown, suffix) {
      if (prev === undefined || prev === null) return '';
      var d = cur - prev; if (d === 0) return '<span class="delta d-flat">— ثابت</span>';
      var good = goodDown ? d < 0 : d > 0;
      return '<span class="delta ' + (good ? 'd-good' : 'd-bad') + '" data-delta>' + (d > 0 ? '▲' : '▼') + ' ' + Math.abs(d) + (suffix || '') + '</span>';
    }
    function bucketize(a, mode, from) {
      var bk = [], map = {};
      a.days.forEach(function (d, i) {
        var dt = dobj(d.d), key, lab, tip;
        if (mode === 'week') { var off = (dt.getUTCDay() + 1) % 7, st = Math.max(from, d.d - off); key = 'w' + (d.d - off); lab = String(dobj(st).getUTCDate()); tip = 'أسبوع ' + dlabel(st); }
        else if (mode === 'month') { key = 'm' + (dt.getUTCFullYear() * 12 + dt.getUTCMonth()); lab = MONTHS[dt.getUTCMonth()]; tip = lab; }
        else { key = 'd' + d.d; lab = String(dt.getUTCDate()); tip = dlabel(d.d); }
        if (!(key in map)) { map[key] = bk.length; bk.push({ key: key, lab: lab, tip: tip, late: 0, lateMin: 0, absent: 0, idx: [] }); }
        var b = bk[map[key]]; b.late += d.late; b.lateMin += d.lateMin; b.absent += d.absent; b.idx.push(i);
      });
      var per = a.per.map(function (p) { return { e: p.e, d: p.d, vals: bk.map(function (b) { return b.idx.reduce(function (x, i) { var r = p.dr[i]; return r ? { late: x.late + r.l, lateMin: x.lateMin + r.lm, absent: x.absent + r.a } : x; }, { late: 0, lateMin: 0, absent: 0 }); }) }; });
      return { bk: bk, per: per };
    }
    function barChart(days, key, col) {
      var W = 640, HH = 190, pl = 34, pb = 26, pt = 10, max = Math.max.apply(null, [1].concat(days.map(function (d) { return d[key]; }))), n = days.length, bw = (W - pl - 8) / n, g = Math.min(6, bw * .25);
      var lines = [0, .5, 1].map(function (t) { var y = pt + (HH - pt - pb) * (1 - t); return '<line x1="' + pl + '" x2="' + W + '" y1="' + y + '" y2="' + y + '" stroke="#E9EDF5"/><text x="' + (pl - 6) + '" y="' + (y + 4) + '" text-anchor="end" font-size="11" fill="#6B7688">' + Math.round(max * t) + '</text>'; }).join('');
      var bars = days.map(function (d, i) {
        var v = d[key], h = (HH - pt - pb) * (v / max), x = pl + i * bw + g / 2;
        var lab = n <= 16 || i % Math.ceil(n / 12) === 0 ? '<text x="' + (x + (bw - g) / 2) + '" y="' + (HH - 8) + '" text-anchor="middle" font-size="10.5" fill="#6B7688">' + esc(d.lab) + '</text>' : '';
        return '<g><title>' + esc(d.tip) + ': ' + v + '</title><rect x="' + x + '" y="' + (pt + (HH - pt - pb) - h) + '" width="' + Math.max(1, bw - g) + '" height="' + Math.max(h, v ? 2 : 0) + '" rx="3" fill="' + col + '" opacity=".9"/>' + lab + '</g>';
      }).join('');
      return '<svg class="chart" viewBox="0 0 ' + W + ' ' + HH + '" role="img" data-rep-chart>' + lines + bars + '</svg>';
    }
    function spark(vals, col) {
      var W = 84, Hh = 24, max = Math.max.apply(null, [1].concat(vals)), n = vals.length;
      return '<svg width="' + W + '" height="' + Hh + '" viewBox="0 0 ' + W + ' ' + Hh + '" style="direction:ltr;vertical-align:middle"><polyline fill="none" stroke="' + (col || '#D9780F') + '" stroke-width="2" points="' + vals.map(function (v, i) { return (i / (n - 1)) * W + ',' + (Hh - 3 - (Hh - 6) * (v / max)); }).join(' ') + '"/></svg>';
    }
    function insights(a, prev) {
      var out = [], dowC = [0, 0, 0, 0, 0, 0, 0];
      a.days.forEach(function (d) { dowC[dobj(d.d).getUTCDay()] += d.late; });
      var mx = Math.max.apply(null, dowC), di = dowC.indexOf(mx);
      if (mx > 0) out.push(['alarm', 'var(--amber)', 'أكتر يوم تأخيرًا: ' + DOW[di], mx + ' مرة تأخير في الفترة']);
      var byD = {}; a.per.forEach(function (p) { var o = byD[p.d.id] = byD[p.d.id] || { o: 0, s: 0, n: p.d.name }; o.o += p.onTime; o.s += p.sched; });
      var dl = Object.keys(byD).filter(function (k) { return byD[k].s > 0; }).map(function (k) { return [byD[k].n, Math.round(byD[k].o / byD[k].s * 100)]; }).sort(function (x, y) { return y[1] - x[1]; });
      if (dl.length > 1) out.push(['ok', 'var(--pos)', 'أعلى التزام: ' + dl[0][0] + ' (' + dl[0][1] + '%)', 'وأقل التزام: ' + dl[dl.length - 1][0] + ' (' + dl[dl.length - 1][1] + '%)']);
      var bs = {}; a.per.forEach(function (p) { if (!p.shift) return; var o = bs[p.shift] = bs[p.shift] || { l: 0, p: 0 }; o.l += p.late; o.p += p.present; });
      var sl = Object.keys(bs).filter(function (k) { return bs[k].p > 0; }).map(function (k) { return [k, Math.round(bs[k].l / bs[k].p * 100)]; }).sort(function (x, y) { return y[1] - x[1]; });
      if (sl.length > 1) out.push(['clock', 'var(--amber)', 'أكتر وردية تأخيرًا: ' + sl[0][0] + ' (' + sl[0][1] + '%)', 'وأقلها: ' + sl[sl.length - 1][0] + ' (' + sl[sl.length - 1][1] + '%)']);
      var rep = a.per.filter(function (p) { return p.late >= 4; }).sort(function (x, y) { return y.late - x.late; }).slice(0, 3);
      if (rep.length) out.push(['warn', 'var(--neg)', rep.length + ' موظفين متكرر تأخيرهم', rep.map(function (p) { return p.e.full_name + ' (' + p.late + ')'; }).join('، ')]);
      if (prev) { var d = a.tot.absent - prev.tot.absent; out.push(['up', d > 0 ? 'var(--neg)' : 'var(--pos)', d === 0 ? 'الغياب ثابت عن الفترة السابقة' : 'الغياب ' + (d > 0 ? 'زاد' : 'قلّ') + ' ' + Math.abs(d) + ' يوم عن الفترة السابقة', a.tot.absent + ' يوم غياب مقابل ' + prev.tot.absent]); }
      if (a.tot.inc) out.push(['clock', 'var(--blue)', a.tot.inc + ' بصمات ناقصة (دخول بلا خروج)', 'تحتاج مراجعة وتصحيح قبل حساب الراتب']);
      if (a.tot.unmapped) out.push(['link', 'var(--blue)', a.tot.unmapped + ' يوم لموظفين غير مربوطين بالبصمة', 'لا يمكن تقييمها — اربط أرقام الجهاز من تاب «الآن»']);
      return out.slice(0, 6);
    }

    // ---------- render ----------
    function draw() {
      var r = S, rg = periodRange(r.period), from = rg[0], to = rg[1], len = to - from + 1, f = { dept: r.dept, q: r.q };
      if (to < from) { r.to = r.from; rg = periodRange(r.period); from = rg[0]; to = rg[1]; len = to - from + 1; }
      var canCompare = r.compare && r.period !== 'all' && len * 2 <= MAX_DAYS;
      var a = agg(from, to, f), prev = canCompare ? agg(from - len, from - 1, f) : null, T = a.tot, PT = prev && prev.tot;
      var K = [['ok', 'نسبة الالتزام', T.commit + '%', delta(T.commit, PT && PT.commit, false, '%')], ['alarm', 'مرات التأخير', T.late, delta(T.late, PT && PT.late, true)], ['clock', 'دقائق التأخير', T.lateMin, delta(T.lateMin, PT && PT.lateMin, true)], ['hour', 'متوسط التأخير', T.avgLate + ' د', delta(T.avgLate, PT && PT.avgLate, true, ' د')],
        ['userx', 'أيام الغياب', T.absent, delta(T.absent, PT && PT.absent, true)], ['sun', 'أيام الإجازات والأذونات', T.leave, delta(T.leave, PT && PT.leave, false)]];
      var key = { late: 'late', min: 'lateMin', abs: 'absent' }[r.metric], col = { late: '#D9780F', min: '#B86F00', abs: '#D0402A' }[r.metric];
      var B = bucketize(a, r.group, from), cd = B.bk.map(function (b) { return { lab: b.lab, tip: b.tip, late: b.late, lateMin: b.lateMin, absent: b.absent }; }); if (cd.length > 62) cd = cd.slice(-62);
      // heat map: last 12 calendar weeks (Saturday first), minutes of lateness per day
      var dowT = (parse(D.today).getUTCDay() + 1) % 7, hm = agg(-(HEAT_DAYS - 1) + dowT, 0, f), hmax = Math.max.apply(null, [1].concat(hm.days.map(function (d) { return d.lateMin; }))), cells = [], start = -(11 * 7 + dowT);
      for (var d = start; d <= 0; d++) { var x = hm.days[d - hm.days[0].d]; cells.push(x ? { d: d, v: x.lateMin, n: x.late } : { d: d, v: 0, n: 0 }); }
      var lvl = function (v) { return v === 0 ? '#EEF1F6' : 'rgba(217,120,15,' + (.18 + .8 * Math.min(1, v / hmax)) + ')'; };
      var heat = '<div class="heat" data-rep-heat>' + ['س', 'ح', 'ن', 'ث', 'ر', 'خ', 'ج'].map(function (x) { return '<div class="hd">' + x + '</div>'; }).join('') + cells.map(function (c) { return '<div title="' + esc(dlabel(c.d)) + ': ' + c.n + ' تأخير، ' + c.v + ' د" style="background:' + lvl(c.v) + ';color:' + (c.v / hmax > .5 ? '#fff' : '#6B7688') + '">' + dobj(c.d).getUTCDate() + '</div>'; }).join('') + '</div>';
      var byDept = r.by === 'dept', gm = {};
      a.per.forEach(function (p) { var k = byDept ? p.d.id : p.shift; if (!k) return; var g = gm[k] = gm[k] || { s: 0, o: 0, n: byDept ? p.d.name : p.shift, c: byDept ? p.d.col : safeColor(p.shiftCol[p.shift]) }; g.s += p.sched; g.o += p.onTime; });
      var bd = Object.keys(gm).filter(function (k) { return gm[k].s > 0; }).map(function (k) { return [gm[k].n, Math.round(gm[k].o / gm[k].s * 100), gm[k].c]; }).sort(function (x, y) { return y[1] - x[1]; });
      var comp = a.per.filter(function (p) { return p.sched >= 5; }), worst = comp.slice().sort(function (x, y) { return y.late - x.late || y.lateMin - x.lateMin; }).slice(0, 5), best = comp.slice().sort(function (x, y) { return y.commit - x.commit || x.lateMin - y.lateMin; }).slice(0, 5);
      var lbRow = function (p, i, t) { return '<li><span class="rank ' + (i === 0 ? 'r1' : '') + '">' + (i + 1) + '</span><span class="av sm" style="--col:' + esc(p.d.col) + '">' + esc(initials(p.e.full_name)) + '</span><div class="nm"><span class="t">' + esc(p.e.full_name) + '</span><small>' + esc(p.d.name) + '</small></div><b style="color:' + (t === 'w' ? 'var(--amber)' : 'var(--pos)') + '">' + (t === 'w' ? p.late + ' مرة' : p.commit + '%') + '</b></li>'; };
      var th = function (k, l) { return '<th data-s="' + k + '">' + l + (r.sort === k ? (r.dir < 0 ? ' ▼' : ' ▲') : '') + '</th>'; }, ins = insights(a, prev), head = '', rows = '', total = 0;
      if (r.tbl === 'sum') {
        var sorted = a.per.slice().sort(function (x, y) { return (y[r.sort] - x[r.sort]) * (r.dir * -1); }), shown = r.showAll ? sorted : sorted.slice(0, 12);
        head = '<tr><th>الموظف</th>' + th('sched', 'أيام العمل') + th('late', 'مرات التأخير') + th('lateMin', 'دقائق') + th('absent', 'غياب') + th('leave', 'إجازات') + th('early', 'انصراف مبكر') + th('ot', 'إضافي (س)') + th('inc', 'بصمة ناقصة') + th('commit', 'الالتزام') + '<th>آخر 8 أسابيع</th></tr>';
        rows = shown.map(function (p) { return '<tr data-rep-emp><td><b>' + esc(p.e.full_name) + '</b> <small style="color:var(--muted)">' + esc(p.d.name) + '</small></td><td>' + p.sched + '</td><td>' + p.late + '</td><td>' + p.lateMin + '</td><td>' + p.absent + '</td><td>' + p.leave + '</td><td>' + p.early + '</td><td>' + (p.ot / 60).toFixed(1) + '</td><td>' + p.inc + '</td><td>' + p.commit + '%<span class="pb"><i style="width:' + p.commit + '%;background:' + (p.commit >= 90 ? 'var(--pos)' : p.commit >= 75 ? '#E39A1F' : 'var(--neg)') + '"></i></span></td><td>' + spark(p.weeks.slice().reverse()) + '</td></tr>'; }).join('');
        total = sorted.length;
      } else {
        var WB = bucketize(a, r.tbl, from), vmax = Math.max.apply(null, [1].concat(WB.per.reduce(function (acc, x) { return acc.concat(x.vals.map(function (v) { return v.late; })); }, [])));
        var sorted2 = WB.per.slice().sort(function (x, y) { return y.vals.reduce(function (s2, v) { return s2 + v.late; }, 0) - x.vals.reduce(function (s2, v) { return s2 + v.late; }, 0); }), shown2 = r.showAll ? sorted2 : sorted2.slice(0, 12);
        head = '<tr><th>الموظف</th>' + WB.bk.map(function (b) { return '<th class="tdh" title="' + esc(b.tip) + '">' + esc(r.tbl === 'week' ? b.lab + ' ' + MONTHS[dobj(Number(b.key.slice(1))).getUTCMonth()].slice(0, 3) : b.lab) + '</th>'; }).join('') + '<th class="tdh">الإجمالي</th></tr>';
        rows = shown2.map(function (x) { var tot = x.vals.reduce(function (s2, v) { return s2 + v.late; }, 0), totm = x.vals.reduce(function (s2, v) { return s2 + v.lateMin; }, 0); return '<tr data-rep-emp><td><b>' + esc(x.e.full_name) + '</b> <small style="color:var(--muted)">' + esc(x.d.name) + '</small></td>' + x.vals.map(function (v) { return '<td class="tdh"><span class="wk" title="' + v.late + ' تأخير · ' + v.lateMin + ' د · ' + v.absent + ' غياب" style="background:' + (v.late ? 'rgba(217,120,15,' + (.15 + .8 * v.late / vmax) + ')' : '#F3F5F9') + ';color:' + (v.late / vmax > .55 ? '#fff' : '#6B7688') + '">' + (v.late || '·') + '</span></td>'; }).join('') + '<td class="tdh"><b>' + tot + '</b> <small style="color:var(--muted)">(' + totm + ' د)</small></td></tr>'; }).join('');
        total = sorted2.length;
      }
      var depts = []; (D.people || []).forEach(function (p) { var d = C.dept(p.department); if (!depts.some(function (x) { return x.id === d.id; })) depts.push(d); });
      var iso = function (i) { return dstr(i); };
      var watch = a.per.filter(function (p) { return p.sched >= 6 && (p.commit < 75 || p.late >= 5 || p.absent >= 3); }).sort(function (x, y) { return x.commit - y.commit; }).slice(0, 4);
      var empty = !D.rows.length ? '<div class="att-msg" data-rep-empty>' + ico('bulb') + ' لا توجد بيانات حضور في هذه الفترة — تأكد من تحديد ورديات الموظفين وربط أرقام البصمة.</div>' : '';
      host.innerHTML = '<div class="bar sticky" style="margin-top:14px"><div class="chips" role="group" aria-label="الفترة">' + PERIODS.map(function (p) { return '<button type="button" class="chip" data-p="' + p[0] + '" aria-pressed="' + (r.period === p[0]) + '">' + (p[0] === 'custom' ? ico('cal') : '') + p[1] + '</button>'; }).join('') + '</div>' +
        (r.period === 'custom' ? '<input type="date" class="dt" data-rep-from value="' + iso(from) + '" aria-label="من"><span>←</span><input type="date" class="dt" data-rep-to value="' + iso(to) + '" aria-label="إلى">' : '') +
        '<span data-rep-range style="margin-inline-start:auto;color:var(--muted);font-size:13px">' + esc(dlabel(from)) + ' ← ' + esc(dlabel(to)) + ' · ' + len + ' يوم' + (prev ? ' · مقارنة مع ' + len + ' يوم قبلها' : '') + '</span></div>' +
        '<div class="bar" style="margin-top:10px"><label class="search">' + ico('search') + '<span class="sr">بحث</span><input type="search" data-rep-q value="' + esc(r.q) + '" placeholder="موظف أو قسم…" autocomplete="off"></label><select class="sel" data-rep-dept aria-label="القسم"><option value="all">كل الأقسام</option>' +
        depts.map(function (d) { return '<option value="' + esc(d.id) + '"' + (r.dept === d.id ? ' selected' : '') + '>' + esc(d.name) + '</option>'; }).join('') + '</select><select class="sel" data-rep-type aria-label="النوع"><option value="all">كل الحالات</option><option value="late"' + (r.type === 'late' ? ' selected' : '') + '>التأخير فقط</option><option value="abs"' + (r.type === 'abs' ? ' selected' : '') + '>الغياب فقط</option></select>' +
        '<label class="tool" style="cursor:pointer"><input type="checkbox" data-rep-compare' + (r.compare ? ' checked' : '') + '> قارن بالفترة السابقة</label><span style="margin-inline-start:auto;display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="tool" data-rep-csv>' + ico('down') + 'تصدير CSV</button><button type="button" class="tool" data-rep-print>' + ico('print') + 'طباعة</button></span></div>' + empty +
        '<section class="rkpis" data-rep-kpis>' + K.map(function (k) { return '<div class="rk"><span class="l">' + ico(k[0]) + k[1] + '</span><b>' + k[2] + '</b>' + (k[3] || '<span class="delta d-flat">—</span>') + '</div>'; }).join('') + '</section>' +
        (ins.length ? '<section class="ins" data-rep-insights>' + ins.map(function (i) { return '<div style="color:' + i[1] + '">' + ico(i[0]) + '<span style="color:var(--dark)"><b>' + esc(i[2]) + '</b><small style="color:var(--muted)">' + esc(i[3]) + '</small></span></div>'; }).join('') + '</section>' : '') +
        '<div class="grid2"><section class="card"><h4>' + ico('chart') + { late: 'مرات التأخير', min: 'دقائق التأخير', abs: 'أيام الغياب' }[r.metric] + ' ' + { day: 'حسب اليوم', week: 'حسب الأسبوع', month: 'حسب الشهر' }[r.group] + '</h4><div class="mode"><span class="seg" role="group" aria-label="المؤشر">' +
        [['late', 'مرات'], ['min', 'دقائق'], ['abs', 'غياب']].map(function (m) { return '<button type="button" data-m="' + m[0] + '" aria-pressed="' + (r.metric === m[0]) + '">' + m[1] + '</button>'; }).join('') + '</span><span class="seg" role="group" aria-label="التجميع">' + [['day', 'يومي'], ['week', 'أسبوعي'], ['month', 'شهري']].map(function (m) { return '<button type="button" data-g="' + m[0] + '" aria-pressed="' + (r.group === m[0]) + '">' + m[1] + '</button>'; }).join('') + '</span></div>' + barChart(cd, key, col) + '</section>' +
        '<section class="card" data-rep-compliance><h4>' + ico('grid') + 'الالتزام حسب ' + (byDept ? 'القسم' : 'الوردية') + '<span class="seg" role="group">' + [['dept', 'قسم'], ['shift', 'وردية']].map(function (m) { return '<button type="button" data-by="' + m[0] + '" aria-pressed="' + (r.by === m[0]) + '">' + m[1] + '</button>'; }).join('') + '</span></h4>' +
        (bd.map(function (x) { return '<div class="hbar" style="--col:' + esc(x[2]) + '"><span>' + esc(x[0]) + '</span><div class="tr"><i style="width:' + x[1] + '%"></i></div><b>' + x[1] + '%</b></div>'; }).join('') || '<div class="empty">لا بيانات</div>') + '</section></div>' +
        '<div class="grid3"><section class="card"><h4>' + ico('cal') + 'خريطة التأخير (آخر 12 أسبوع)</h4>' + heat + '<div class="legend" style="margin:8px 0 0"><span>أفتح = أقل</span><span>أغمق = دقائق تأخير أكتر</span></div></section><section class="card" data-rep-worst><h4>' + ico('alarm') + 'الأكثر تأخيرًا</h4><ul class="lb">' + (worst.map(function (p, i) { return lbRow(p, i, 'w'); }).join('') || '<li class="empty">لا بيانات</li>') + '</ul></section><section class="card" data-rep-best><h4>' + ico('ok') + 'الأكثر التزامًا</h4><ul class="lb">' + (best.map(function (p, i) { return lbRow(p, i, 'b'); }).join('') || '<li class="empty">لا بيانات</li>') + '</ul></section></div>' +
        (watch.length ? '<section class="card" style="margin-bottom:14px" data-rep-watch><h4>' + ico('warn') + 'تحتاج قرارًا منك <small style="color:var(--muted);font-weight:400">(التزام أقل من 75% أو تأخير متكرر أو غياب)</small></h4><div class="watch">' + watch.map(function (p) { return '<div class="wi"><span class="av" style="--col:' + esc(p.d.col) + '">' + esc(initials(p.e.full_name)) + '</span><div class="nm"><span class="t">' + esc(p.e.full_name) + '</span><small>' + esc(p.d.name) + (p.e.job_title ? ' · ' + esc(p.e.job_title) : '') + '</small><div class="why"><span class="pill p-none">التزام ' + p.commit + '%</span>' + (p.late ? '<span class="pill p-late">' + p.late + ' تأخير (' + p.lateMin + ' د)</span>' : '') + (p.absent ? '<span class="pill p-none">' + p.absent + ' غياب</span>' : '') + '</div></div><div class="wacts"><button type="button" class="mini" data-rep-shifts>' + ico('cal') + 'راجع الوردية</button></div></div>'; }).join('') + '</div></section>' : '') +
        '<section class="card" data-rep-table><h4>' + ico('users') + 'تفصيل الموظفين</h4><div class="mode"><span class="seg" role="group" aria-label="نوع الجدول">' + [['sum', 'ملخص الفترة'], ['week', 'أسبوعيًا'], ['month', 'شهريًا']].map(function (m) { return '<button type="button" data-t="' + m[0] + '" aria-pressed="' + (r.tbl === m[0]) + '">' + m[1] + '</button>'; }).join('') + '</span><small style="color:var(--muted)">' +
        (r.tbl === 'sum' ? 'اضغط على العنوان للترتيب' : 'الأرقام = مرات التأخير في كل ' + (r.tbl === 'week' ? 'أسبوع' : 'شهر') + '. مرّر الماوس لرؤية الدقائق والغياب') + '</small></div><div class="scroll"><table class="tbl"><thead>' + head + '</thead><tbody>' + (rows || '<tr><td colspan="11" class="empty">لا بيانات</td></tr>') + '</tbody></table></div>' +
        (total > 12 ? '<div style="text-align:center;margin-top:10px"><button type="button" class="mini" data-rep-all>' + (r.showAll ? 'عرض أقل' : 'عرض كل الموظفين (' + total + ')') + '</button></div>' : '') + '</section>';
      bind(a, rg);
    }

    function rerender(focusSel) {
      var q = focusSel && host.querySelector(focusSel), pos = q && q.selectionStart;
      draw();
      if (focusSel) { var n = host.querySelector(focusSel); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) { /* not supported on search inputs */ } } }
    }
    function bind(a, rg) {
      var on = function (sel, fn) { host.querySelectorAll(sel).forEach(function (b) { b.onclick = function () { fn(b); }; }); };
      on('[data-p]', function (b) { S.period = b.dataset.p; S.showAll = false; load(); });
      on('[data-m]', function (b) { S.metric = b.dataset.m; rerender(); }); on('[data-g]', function (b) { S.group = b.dataset.g; rerender(); });
      on('[data-by]', function (b) { S.by = b.dataset.by; rerender(); }); on('[data-t]', function (b) { S.tbl = b.dataset.t; rerender(); });
      on('th[data-s]', function (h) { var k = h.dataset.s; S.dir = S.sort === k ? -S.dir : -1; S.sort = k; rerender(); });
      on('[data-rep-all]', function () { S.showAll = !S.showAll; rerender(); });
      on('[data-rep-shifts]', function () { if (ctx && ctx.openTab) ctx.openTab('shifts'); });
      var q = host.querySelector('[data-rep-q]'); if (q) q.oninput = function () { S.q = q.value; rerender('[data-rep-q]'); };
      var dd = host.querySelector('[data-rep-dept]'); if (dd) dd.onchange = function () { S.dept = dd.value; rerender(); };
      var tt = host.querySelector('[data-rep-type]'); if (tt) tt.onchange = function () { S.type = tt.value; S.metric = tt.value === 'abs' ? 'abs' : 'late'; rerender(); };
      var cc = host.querySelector('[data-rep-compare]'); if (cc) cc.onchange = function () { S.compare = cc.checked; load(); };
      var df = host.querySelector('[data-rep-from]'), dt = host.querySelector('[data-rep-to]');
      var toIdx = function (v) { return Math.max(-(MAX_DAYS - 1), Math.min(0, diffDays(v, D.today))); };
      if (df) df.onchange = function () { if (df.value) { S.from = toIdx(df.value); if (S.to < S.from) S.to = S.from; load(); } };
      if (dt) dt.onchange = function () { if (dt.value) { S.to = toIdx(dt.value); if (S.from > S.to) S.from = S.to; load(); } };
      var pr = host.querySelector('[data-rep-print]'); if (pr) pr.onclick = function () { w.print(); };
      var cv = host.querySelector('[data-rep-csv]');
      if (cv) cv.onclick = function () {
        var rows = [['الموظف', 'الكود', 'القسم', 'الوردية', 'أيام العمل', 'مرات التأخير', 'دقائق التأخير', 'الغياب', 'الإجازات', 'انصراف مبكر', 'إضافي (دقائق)', 'بصمة ناقصة', 'الالتزام %']].concat(a.per.map(function (p) {
          return [p.e.full_name, p.e.code || '', p.d.name, p.shift, p.sched, p.late, p.lateMin, p.absent, p.leave, p.early, p.ot, p.inc, p.commit];
        }));
        try { U.csv('attendance-report-' + dstr(rg[0]) + '_' + dstr(rg[1]), rows); } catch (err) { toast(err.message, 'error'); }
      };
    }

    if (ctx && ctx.onRefresh) ctx.onRefresh(function () { return load(true); });
    load();
  }

  w.SSMPDHRReports = { mount: mount, _reset: function () { saved = null; } };
})(window);
