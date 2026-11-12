(function (w) {
  'use strict';
  // Live attendance board («الآن»): who is in the center right now, who is late / absent / on leave, per department.
  // Data = hr_presence_snapshot (fingerprint punches, device mapping, heartbeat) + hr_attendance_today (schedule verdicts) + hr_shifts_workspace (shift templates).
  // Mounted by hr-attendance-hub.js into the «الحضور اللحظي» section; loads only while that tab is open and refreshes every 15 seconds.
  var STALE_MINUTES = 5, LONG_IN_MINUTES = 14 * 60, LONG_BREAK_MINUTES = 30, REFRESH_MS = 15000, WIN_PAST = 16 * 60, WIN_FUT = 4 * 60;
  var C = w.SSMPDAttCore, esc = C.esc, ico = C.ico, clock = C.clock, hhmm = C.hhmm, dur = C.dur, mins = C.minutesBetween, initials = C.initials;
  var STATE_LABEL = { in: ['p-in', 'حاضر'], break: ['p-break', 'استراحة'], absent: ['p-none', 'لم يصل'], up: ['p-up', 'لم يبدأ'], out: ['p-out', 'انصرف'], leave: ['p-leave', 'إجازة'], idle: ['p-out', 'لم يبصم'], nolink: ['p-up', 'غير مربوط'] };
  var FILTER_LABEL = { in: 'الموجودون', late: 'المتأخرون', abs: 'الغايبون', leave: 'في إجازة', up: 'لم يبدأوا', out: 'المنصرفون' };
  var UNMAPPED_DEPT = { id: 'unmapped', name: 'أرقام غير مربوطة بموظف', icon: 'link', col: '#6B7688', tint: '#EEF1F6', min: 0 };

  function mount(shell, active, ctx) {
    if (!shell || !active) return;
    ctx = ctx || {};
    var U = w.SSMPDWorkforceUtils, owner = w.SSMPDAuth && w.SSMPDAuth.currentAdmin && w.SSMPDAuth.currentAdmin.id;
    var snap = null, board = null, wsd = null, M = null, serial = 0, timer = null;
    var S = { view: 'cards', dept: 'all', state: 'all', q: '', openOut: {}, trio: 'abs', dlg: null, dlgTab: 'unmapped' };
    var host = document.createElement('div');
    host.dataset.hrPresence = '';
    shell.append(host);
    function live() { return host.isConnected && w.SSMPDAuth.currentAdmin && w.SSMPDAuth.currentAdmin.id === owner; }
    function stop() { if (timer) { clearInterval(timer); timer = null; } }
    function toast(m, kind) { if (w.SSMPDToast) w.SSMPDToast.show(m, kind); }
    function btn(action, label, id) { return '<button type="button" class="btn ghost" data-presence="' + action + '" data-id="' + esc(id || '') + '">' + esc(label) + '</button>'; }

    function optional(fn, args) { return U.rpc(fn, args).catch(function () { return null; }); }
    function load(quiet) {
      var n = ++serial;
      if (!quiet && !snap) host.innerHTML = '<div class="att-msg" role="status">جاري تحميل الحضور…</div>';
      return Promise.all([U.rpc('hr_presence_snapshot', { p_lookback_hours: 16 }), optional('hr_attendance_today', { p_day: null }), optional('hr_shifts_workspace')]).then(function (r) {
        if (!live() || n !== serial) return;
        snap = r[0]; board = r[1]; wsd = r[2]; draw();
      }).catch(function (err) {
        if (!live()) { stop(); return; }
        if (snap) return; // keep the last good picture on screen; the link chip tells how old it is
        var missing = /hr_presence_snapshot|404|schema cache/i.test(err.message || '');
        host.innerHTML = '<div class="att-msg err" role="alert">' + esc(missing ? 'الحضور اللحظي غير مفعّل بعد على قاعدة البيانات' : err.message) + '</div>' + btn('retry', 'إعادة المحاولة');
        bind();
      });
    }

    // ---------- data adapter: snapshot + board -> one list of people with a single state each ----------
    function key(r) { return r.device_user_id + '|' + r.device_id; }
    function build() {
      var now = snap.now, nowMin = (function () { var t = clock(now).split(':'); return Number(t[0]) * 60 + Number(t[1]); })();
      var phones = ctx.phones || {}, byId = {}, list = [], unmapped = [], noPunch = [];
      var boardRows = board && board.rows ? board.rows : [];
      boardRows.forEach(function (b) { byId[b.person_id] = { b: b }; });
      (snap.rows || []).forEach(function (r) {
        if (!r.mapped) { unmapped.push(r); return; }
        (byId[r.person_id] = byId[r.person_id] || {}).r = r;
      });
      Object.keys(byId).forEach(function (id) {
        var x = byId[id], r = x.r, b = x.b, s = r && r.state, st;
        if (b && b.status === 'leave') st = 'leave';
        else if (b && b.excused && b.status === 'absent') st = 'leave';
        else if (s === 'in') st = 'in'; else if (s === 'break') st = 'break'; else if (s === 'out') st = 'out';
        else if (b) st = b.status === 'absent' ? 'absent' : (b.status === 'waiting' || b.status === 'upcoming') ? 'up' : b.status === 'unmapped' ? 'nolink' : 'out';
        else st = 'idle';
        var d = C.dept((r && r.department) || (b && b.department));
        var p = { id: id, name: (r && r.full_name) || (b && b.full_name) || '', code: (r && r.code) || (b && b.code) || '', role: (r && r.job_title) || (b && b.job_title) || '', dept: d, st: st, r: r || null, b: b || null,
          late: b && b.status === 'late' ? b.late_min : 0, isLate: !!(b && b.status === 'late'), sinceStart: b && b.since_start, lateWeek: b ? b.late_week : 0, tname: b && b.template_name, tid: b && b.template_id,
          start: b && b.exp_start, end: b && b.exp_end, excusedLeave: !!(b && b.excused && b.status === 'absent'), phone: C.phoneDigits(phones[id]), unmapped: false };
        p.inAgo = r && r.last_in_at ? mins(r.last_in_at, now) : null;
        p.outAgo = r && r.last_out_at ? mins(r.last_out_at, now) : null;
        p.worked = r && r.last_in_at && r.last_out_at && r.last_out_at >= r.last_in_at ? mins(r.last_in_at, r.last_out_at) : null;
        p.brkAgo = st === 'break' && r.last_punch_at ? mins(r.last_punch_at, now) : null;
        p.long = (st === 'in' && p.inAgo != null && p.inAgo > LONG_IN_MINUTES);
        if (st === 'idle' && r && r.state === 'none') noPunch.push(p);
        list.push(p);
      });
      unmapped.forEach(function (r) {
        var st = r.state === 'in' ? 'in' : r.state === 'break' ? 'break' : r.state === 'out' ? 'out' : 'idle';
        var p = { id: 'dev:' + key(r), name: 'رقم الجهاز ' + r.device_user_id, code: '', role: 'غير مربوط بموظف', dept: UNMAPPED_DEPT, st: st, r: r, b: null, late: 0, isLate: false, unmapped: true, phone: '' };
        p.inAgo = r.last_in_at ? mins(r.last_in_at, now) : null; p.outAgo = r.last_out_at ? mins(r.last_out_at, now) : null;
        p.worked = r.last_in_at && r.last_out_at && r.last_out_at >= r.last_in_at ? mins(r.last_in_at, r.last_out_at) : null;
        p.brkAgo = st === 'break' && r.last_punch_at ? mins(r.last_punch_at, now) : null;
        p.long = st === 'in' && p.inAgo != null && p.inAgo > LONG_IN_MINUTES;
        if (st !== 'idle') list.push(p);
      });
      return { now: now, nowMin: nowMin, list: list, unmapped: unmapped, ignored: snap.ignored || [], noPunch: list.filter(function (p) { return !p.unmapped && p.r && p.r.state === 'none'; }) };
    }

    var isIn = function (p) { return p.st === 'in' || p.st === 'break'; };
    function matchState(p, s) {
      if (s === 'in') return isIn(p); if (s === 'late') return p.isLate; if (s === 'abs') return p.st === 'absent'; if (s === 'leave') return p.st === 'leave';
      if (s === 'up') return p.st === 'up'; if (s === 'out') return p.st === 'out'; return true;
    }
    function filtered() {
      var q = S.q.trim();
      return M.list.filter(function (p) { return (S.dept === 'all' || p.dept.id === S.dept) && (!q || (p.name + ' ' + p.dept.name + ' ' + p.role + ' ' + p.code).indexOf(q) >= 0) && (S.state === 'all' || matchState(p, S.state)); });
    }
    var count = function (fn) { return M.list.filter(fn).length; };
    function deptList() {
      var g = {}, order = [];
      M.list.forEach(function (p) { if (!g[p.dept.id]) { g[p.dept.id] = { d: p.dept, n: 0 }; order.push(p.dept.id); } g[p.dept.id].n++; });
      order.sort(function (a, b) { return a === 'unmapped' ? 1 : b === 'unmapped' ? -1 : g[b].n - g[a].n || g[a].d.name.localeCompare(g[b].d.name, 'ar'); });
      return order.map(function (k) { return g[k]; });
    }

    // ---------- pieces ----------
    function linkInfo() {
      var hasBeat = !!snap.last_seen_at, at = hasBeat ? snap.last_seen_at : snap.last_received_at, age = at ? mins(at, snap.now) : null;
      return { hasBeat: hasBeat, at: at, age: age, stale: age == null || age > STALE_MINUTES };
    }
    function currentShift() {
      if (!wsd || !wsd.templates) return null;
      var t = wsd.templates.filter(function (x) { return x.active; }).map(function (x) {
        var s = Number(x.start_time.slice(0, 2)) * 60 + Number(x.start_time.slice(3, 5)), e = Number(x.end_time.slice(0, 2)) * 60 + Number(x.end_time.slice(3, 5)); return { t: x, s: s, e: e <= s ? e + 1440 : e };
      }), n = M.nowMin, cur = null, next = null;
      t.forEach(function (x) {
        [n, n + 1440].forEach(function (nn) { if (nn >= x.s && nn < x.e && (!cur || x.s > cur.s)) cur = { x: x, left: x.e - nn }; });
        var wait = x.s > n ? x.s - n : x.s + 1440 - n; if (!next || wait < next.wait) next = { x: x, wait: wait };
      });
      return { cur: cur, next: next };
    }
    function alertsHtml() {
      var li = linkInfo(), cs = currentShift(), out = [];
      if (cs) {
        var nextN = cs.next ? count(function (p) { return p.tid === cs.next.x.t.id && p.st === 'up'; }) : 0;
        out.push('<div class="sch info" style="color:var(--primary)" data-presence-shift>' + ico('clock') + '<span>' + (cs.cur ? 'الوردية الحالية: <b>' + esc(cs.cur.x.t.name) + '</b> <span class="ltr">' + esc(cs.cur.x.t.start_time + '–' + cs.cur.x.t.end_time) + '</span> · تنتهي بعد ' + esc(dur(cs.cur.left)) : 'لا توجد وردية جارية الآن') +
          (cs.next && cs.next.x !== (cs.cur && cs.cur.x) ? ' · القادمة: ' + esc(cs.next.x.t.name) + ' (' + nextN + ' مجدولين)' : '') + '</span></div>');
      }
      out.push(li.stale
        ? '<div class="sch warn" data-stale data-presence-feed role="alert">' + ico('wifi') + '<span>الربط متوقف أو متأخر — الأسماء قد لا تعكس الوضع الحالي' + (li.at ? ' (آخر اتصال منذ ' + esc(dur(li.age)) + ')' : '') + '</span></div>'
        : '<div class="sch ok" data-presence-feed>' + ico('wifi') + '<span>الربط سليم' + (snap.last_received_at ? ' — آخر بصمة <b>' + esc(clock(snap.last_received_at)) + '</b>' : '') + '</span></div>');
      if (board && !board.has_schedule) out.push('<div class="sch info" data-presence-noschedule>' + ico('cal') + '<span>لم تُحدَّد ورديات بعد — الغياب والتأخير لا يظهران</span><button data-att-tab="shifts">حدد الورديات</button></div>');
      var nolink = count(function (p) { return p.st === 'nolink'; });
      if (nolink) out.push('<div class="sch info">' + ico('link') + '<span>' + nolink + ' موظف مجدول غير مربوط ببصمة</span></div>');
      M.list.filter(function (p) { return p.long; }).forEach(function (p) {
        out.push('<div class="sch warn" data-presence-warn>' + ico('warn') + '<span><b>' + esc(p.name) + '</b> داخل من ' + esc(dur(p.inAgo)) + ' ولم يبصم خروج — تحقق من بصمة الخروج</span></div>');
      });
      return '<div class="strip">' + out.join('') + '</div>';
    }
    function kpisHtml() {
      var sched = count(function (p) { return p.b && p.st !== 'leave'; });
      var T = [['in', 'k-in', 'check', count(isIn), 'موجودون الآن', board ? 'من ' + sched + ' مجدولين اليوم' : 'حسب بصمات الجهاز'], ['late', 'k-late', 'alarm', count(function (p) { return p.isLate; }), 'متأخرون', 'وصلوا بعد الموعد + السماح'], ['abs', 'k-abs', 'userx', count(function (p) { return p.st === 'absent'; }), 'غايبون', 'مجدولون ولم يصلوا'],
        ['leave', 'k-leave', 'sun', count(function (p) { return p.st === 'leave'; }), 'في إجازة', 'إجازة أو إذن معتمد'], ['up', 'k-up', 'hour', count(function (p) { return p.st === 'up'; }), 'لم يبدأوا بعد', 'ورديتهم لسه ما بدأت'], ['out', 'k-out', 'logout', count(function (p) { return p.st === 'out'; }), 'انصرفوا', 'آخر ' + esc(snap.lookback_hours) + ' ساعة']];
      return '<section class="kpis" data-presence-cards>' + T.map(function (t) { return '<button type="button" class="kpi ' + t[1] + '" data-k="' + t[0] + '" aria-pressed="' + (S.state === t[0]) + '"><span class="ico">' + ico(t[2]) + '</span><span><b>' + t[3] + '</b><span class="l">' + t[4] + '</span><small>' + t[5] + '</small></span></button>'; }).join('') + '</section>';
    }
    function acts(p) {
      if (p.unmapped || !p.phone) return '';
      return '<div class="acts"><a class="ib" href="tel:+' + esc(p.phone) + '" title="اتصال" aria-label="اتصال">' + ico('phone') + '</a><a class="ib wa" href="https://wa.me/' + esc(p.phone) + '" target="_blank" rel="noopener noreferrer" title="واتساب" aria-label="واتساب">' + ico('msg') + '</a></div>';
    }
    function avatar(p, cls) { return '<span class="av ' + (cls || '') + ' st-' + (p.st === 'absent' ? 'none' : p.st === 'idle' || p.st === 'nolink' ? 'up' : p.st) + '" style="--col:' + esc(p.dept.col) + '">' + esc(initials(p.name)) + '</span>'; }
    function trio() {
      var abs = M.list.filter(function (p) { return p.st === 'absent'; }).sort(function (a, b) { return (b.sinceStart || 0) - (a.sinceStart || 0); });
      var late = M.list.filter(function (p) { return p.isLate; }).sort(function (a, b) { return b.late - a.late; });
      var lv = M.list.filter(function (p) { return p.st === 'leave'; });
      var absRow = function (p) { return '<li class="row abs" data-presence-absent>' + avatar(p) + '<div class="nm"><span class="t">' + esc(p.name) + '</span><small>' + esc(p.dept.name) + (p.start ? ' · وردية ' + esc(clock(p.start)) : '') + '</small><span class="pill p-none" style="margin-top:3px">لم يصل منذ ' + esc(dur(p.sinceStart)) + '</span></div><div class="acts-c">' + acts(p) + '</div></li>'; };
      var lateRow = function (p) {
        return '<li class="row" data-presence-late>' + avatar(p) + '<div class="nm"><span class="t">' + esc(p.name) + '</span><small>' + esc(p.dept.name) + (p.start ? ' · الموعد ' + esc(clock(p.start)) : '') + (p.lateWeek >= 2 ? ' · <b style="color:var(--neg)">' + p.lateWeek + ' مرات آخر 6 أيام</b>' : '') + '</small></div><div class="meta"><span class="pill p-late">' + ico('alarm') + ' متأخر ' + esc(p.late) + ' د</span><span>وصل ' + esc(clock(p.b && p.b.first_in)) + '</span></div></li>';
      };
      var lvRow = function (p) { return '<li class="row" data-presence-leave>' + avatar(p) + '<div class="nm"><span class="t">' + esc(p.name) + '</span><small>' + esc(p.dept.name) + (p.role ? ' · ' + esc(p.role) : '') + '</small></div><div class="meta"><span class="pill p-leave">' + (p.excusedLeave ? 'إذن معتمد' : 'إجازة') + '</span>' + (p.start ? '<span>وردية ' + esc(clock(p.start)) + '</span>' : '') + '</div></li>'; };
      var box = function (cls, k, icn, t, sub, n, rows, empty) { return '<section class="box ' + cls + '" data-b="' + k + '"><header><span class="bi">' + ico(icn) + '</span><h3>' + t + '<small>' + sub + '</small></h3><span class="cnt">' + n + '</span></header><ul class="rows">' + (rows || '<li class="empty">' + empty + '</li>') + '</ul></section>'; };
      return '<div class="seg trio-tabs" role="group" aria-label="المتابعة العاجلة">' + [['abs', 'غايبون', abs.length], ['late', 'متأخرون', late.length], ['leave', 'إجازات', lv.length]].map(function (t) { return '<button type="button" data-bx="' + t[0] + '" aria-pressed="' + (S.trio === t[0]) + '">' + t[1] + ' (' + t[2] + ')</button>'; }).join('') + '</div>' +
        '<div class="trio" data-show="' + S.trio + '">' + box('b-neg', 'abs', 'userx', 'الغايبون الآن', 'كان المفروض يحضروا ولم يبصموا', abs.length, abs.map(absRow).join(''), 'لا يوجد غايبون') +
        box('b-amber', 'late', 'alarm', 'المتأخرون اليوم', 'بصموا بعد الموعد + السماح', late.length, late.map(lateRow).join(''), 'لا يوجد متأخرون') + box('b-blue', 'leave', 'sun', 'في إجازة اليوم', 'إجازات وأذونات معتمدة', lv.length, lv.map(lvRow).join(''), 'لا أحد في إجازة') + '</div>';
    }
    function personRow(p) {
      var st = p.st, meta = '';
      if (st === 'in' || st === 'break') {
        var pct = Math.min(100, Math.round((p.inAgo || 0) / 480 * 100));
        meta = '<span class="pill ' + (st === 'break' ? 'p-break' : 'p-in') + '">' + (st === 'break' ? ico('coffee') + ' استراحة ' + esc(dur(p.brkAgo)) : 'دخل ' + esc(clock(p.r.last_in_at))) + '</span>' +
          (p.isLate ? '<span class="pill p-late">متأخر ' + esc(p.late) + ' د</span>' : '<span>' + (st === 'break' ? 'دخل ' + esc(clock(p.r.last_in_at)) : esc(dur(p.inAgo))) + '</span>') + (st === 'in' && !p.long ? '<span class="bar8"><i style="width:' + pct + '%"></i></span>' : '');
      } else if (st === 'absent') meta = '<span class="pill p-none">لم يصل منذ ' + esc(dur(p.sinceStart)) + '</span><span>وردية ' + esc(clock(p.start)) + '</span>';
      else if (st === 'up') meta = '<span class="pill p-up">' + ico('hour') + ' تبدأ ' + esc(clock(p.start)) + '</span><span>' + (p.start ? 'بعد ' + esc(dur(mins(M.now, p.start))) : '') + '</span>';
      else if (st === 'leave') meta = '<span class="pill p-leave">' + (p.excusedLeave ? 'إذن معتمد' : 'إجازة') + '</span>';
      else if (st === 'out') meta = '<span class="pill p-out">انصرف ' + esc(clock(p.r.last_out_at || p.r.last_punch_at)) + '</span><span>' + (p.worked != null ? 'عمل ' + esc(dur(p.worked)) : '') + '</span>';
      else if (st === 'nolink') meta = '<span class="pill p-up">غير مربوط بالبصمة</span>';
      else meta = '<span class="pill p-out">لم يبصم</span>';
      var kebab = S.canManage && !p.unmapped ? '<button type="button" class="kebab" data-presence="map" data-id="' + esc(p.r ? key(p.r) : '') + '" aria-label="تغيير الربط" title="تغيير الربط">' + ico('dots') + '</button>' : '';
      var unm = p.unmapped && S.canManage ? '<div class="acts"><button type="button" class="mini solid" data-presence="map" data-id="' + esc(key(p.r)) + '">ربط</button><button type="button" class="mini" data-presence="ignore" data-id="' + esc(key(p.r)) + '">' + ico('eyeoff') + ' تجاهل</button></div>' : '';
      var warn = p.long ? '<span class="pill p-warn" data-presence-warn>' + ico('warn') + ' مدة طويلة جدًا — تحقق من بصمة الخروج</span>' : '';
      return '<li class="person" data-presence-person>' + avatar(p) + '<div class="nm"><span class="t">' + esc(p.name) + '</span><small>' + esc([p.code, p.role].filter(Boolean).join(' · ')) + '</small>' + warn + unm + '</div><div class="meta">' + meta + '</div>' + kebab + '</li>';
    }
    function cardsView() {
      var list = filtered(), groups = deptList().filter(function (g) { return list.some(function (p) { return p.dept.id === g.d.id; }); }), filt = S.state !== 'all';
      if (!groups.length) return '<div class="panel empty" data-presence-empty>لا توجد نتائج مطابقة.</div>';
      return '<div class="cards" data-presence-depts>' + groups.map(function (g) {
        var d = g.d, all = M.list.filter(function (p) { return p.dept.id === d.id; }), ls = list.filter(function (p) { return p.dept.id === d.id; });
        var pres = all.filter(isIn).length, sched = all.filter(function (p) { return p.st !== 'leave' && (p.b || isIn(p)); }).length, low = d.min > 0 && pres < d.min && all.some(function (p) { return p.st === 'absent'; });
        var main = ls.filter(isIn).sort(function (a, b) { return (b.inAgo || 0) - (a.inAgo || 0); }), absL = ls.filter(function (p) { return p.st === 'absent'; });
        var rest = ls.filter(function (p) { return !isIn(p) && p.st !== 'absent'; }), open = S.openOut[d.id] || (filt && S.state !== 'abs');
        return '<section class="dept" data-presence-dept data-dept="' + esc(d.name) + '" style="--col:' + esc(d.col) + ';--tint:' + esc(d.tint) + '"><header><span class="di">' + ico(d.icon) + '</span><h3>' + esc(d.name) + '<small>' + pres + ' من ' + sched + ' مجدولين' + (d.min ? ' · <span class="cov ' + (low ? 'low' : 'ok') + '">الحد الأدنى ' + d.min + '</span>' : '') + '</small></h3><span class="ring ' + (low ? 'low' : '') + '" style="--p:' + Math.round(pres / Math.max(1, sched) * 100) + '"><b>' + pres + '</b></span></header>' +
          (absL.length ? '<div class="abs-line">' + ico('userx') + '<span><b>لم يصل:</b> ' + absL.map(function (p) { return esc(p.name) + ' <small>(منذ ' + esc(dur(p.sinceStart)) + ')</small>'; }).join('، ') + '</span></div>' : '') +
          (main.length ? '<ul class="people">' + main.map(personRow).join('') + '</ul>' : (filt ? '' : '<ul class="people"><li class="empty" style="padding:12px">لا أحد حاضرًا الآن</li></ul>')) +
          (rest.length ? (filt ? '' : '<button type="button" class="more" data-out="' + esc(d.id) + '">' + ico('chev') + (open ? 'إخفاء' : 'عرض') + ' القادمون والمنصرفون والإجازات (' + rest.length + ')</button>') + (open ? '<ul class="people" style="' + (main.length || !filt ? 'border-top:1px dashed var(--border)' : '') + '">' + rest.map(personRow).join('') + '</ul>' : '') : '') + '</section>';
      }).join('') + '</div>';
    }
    function timelineView() {
      var list = filtered(), groups = deptList().filter(function (g) { return list.some(function (p) { return p.dept.id === g.d.id; }); }), W = WIN_PAST + WIN_FUT;
      if (!groups.length) return '<div class="panel empty" data-presence-empty>لا توجد نتائج مطابقة.</div>';
      var x = function (m) { return Math.max(0, Math.min(100, (m + WIN_PAST) / W * 100)); }, ticks = [];
      for (var h = -16; h <= 4; h += 2) ticks.push([x(h * 60), hhmm(M.nowMin + h * 60)]);
      var row = function (p) {
        var sR = p.start ? mins(M.now, p.start) : null, eR = p.end ? mins(M.now, p.end) : null;
        var band = p.st === 'leave' || sR == null ? '' : '<div class="tl-band" style="left:' + x(sR) + '%;width:' + Math.max(.4, x(eR) - x(sR)) + '%"></div>', bar = '';
        if ((p.st === 'in' || p.st === 'break' || p.st === 'out') && p.inAgo != null) { var s = -p.inAgo, en = p.st === 'out' && p.outAgo != null ? -p.outAgo : 0; bar = '<div class="tl-bar ' + (p.st === 'out' ? '' : 'live') + '" style="left:' + x(s) + '%;width:' + Math.max(.8, x(en) - x(s)) + '%"></div>'; }
        if (p.st === 'absent' && sR != null) bar = '<div class="tl-miss" style="left:' + x(sR) + '%" title="لم يصل"></div>';
        if (p.st === 'up' && p.start) bar = '<span class="tl-lab" style="right:6px">تبدأ ' + esc(clock(p.start)) + ' ←</span>';
        if (p.st === 'leave') bar = '<div class="tl-band" style="left:0;width:100%;background:var(--blue-t);border-color:#BED7EE;text-align:center;font-size:12px;color:var(--blue);line-height:20px">' + (p.excusedLeave ? 'إذن معتمد' : 'إجازة') + '</div>';
        return '<div class="tl-row" data-presence-tlrow style="--col:' + esc(p.dept.col) + '"><div class="tl-nm">' + esc(p.name) + '<br><small>' + esc(p.tname || p.role || '') + '</small></div><div class="tl-track">' + band + bar + '<div class="tl-now" style="left:' + x(0) + '%"></div></div></div>';
      };
      return '<div class="tl" data-presence-timeline><div class="legend"><span><i style="background:var(--pos);width:18px;height:8px;border-radius:99px"></i>داخل المركز</span><span><i style="background:#8794A8;width:18px;height:8px;border-radius:99px"></i>أنهى وردية</span><span><i style="background:rgba(15,54,157,.15);border:1px dashed rgba(15,54,157,.4);width:18px;height:10px;border-radius:3px"></i>ميعاد الوردية</span><span><i style="background:var(--neg);width:3px;height:14px"></i>لم يصل</span><span><i style="background:var(--alert);width:3px;height:14px"></i>الآن</span></div><div class="tl-head"><div></div><div class="tl-axis">' +
        ticks.map(function (t) { return '<span style="left:' + t[0] + '%">' + t[1] + '</span>'; }).join('') + '</div></div>' +
        groups.map(function (g) { return '<div class="tl-group" style="--col:' + esc(g.d.col) + '">' + ico(g.d.icon) + esc(g.d.name) + '</div>' + list.filter(function (p) { return p.dept.id === g.d.id; }).map(row).join(''); }).join('') + '</div>';
    }
    function listView() {
      var order = { absent: 0, in: 1, break: 1, up: 2, nolink: 2, idle: 3, out: 3, leave: 4 }, list = filtered().sort(function (a, b) { return order[a.st] - order[b.st]; });
      if (!list.length) return '<div class="panel empty" data-presence-empty>لا توجد نتائج مطابقة.</div>';
      return '<div class="list" data-presence-list><div class="lr h"><span>الموظف</span><span>القسم</span><span>الحالة</span><span>دخل</span><span>التفصيل</span><span></span></div>' + list.map(function (p) {
        var l = STATE_LABEL[p.st], det = isIn(p) ? (p.isLate ? 'متأخر ' + p.late + ' د' : dur(p.inAgo)) : p.st === 'absent' ? 'منذ ' + dur(p.sinceStart) : p.st === 'up' ? 'تبدأ ' + clock(p.start) : p.st === 'out' ? 'عمل ' + dur(p.worked) : p.st === 'leave' ? (p.excusedLeave ? 'إذن معتمد' : 'إجازة') : '';
        return '<div class="lr" data-presence-person><span class="who">' + avatar(p, 'sm') + '<span class="nm"><span class="t">' + esc(p.name) + '</span><small>' + esc(p.role) + '</small></span></span><span>' + esc(p.dept.name) + '</span><span><span class="pill ' + l[0] + '">' + l[1] + '</span></span><span>' + esc(p.r && p.r.last_in_at ? clock(p.r.last_in_at) : '—') + '</span><span>' + esc(det) + '</span><span>' +
          (S.canManage && p.r ? '<button type="button" class="mini" style="width:36px;padding:0;justify-content:center" data-presence="map" data-id="' + esc(key(p.r)) + '" aria-label="تغيير الربط" title="' + (p.unmapped ? 'ربط' : 'تغيير الربط') + '">' + ico('dots') + '</button>' : '') + '</span></div>';
      }).join('') + '</div>';
    }
    function sideNow() {
      var li = linkInfo(), rows = (snap.rows || []).filter(function (r) { return r.last_punch_at; }).sort(function (a, b) { return a.last_punch_at < b.last_punch_at ? 1 : -1; }).slice(0, 8);
      var feed = rows.map(function (r) {
        var k = r.last_punch === 2 ? 'break' : (r.last_punch === 0 || r.last_punch === 3 || r.last_punch === 4) ? 'in' : 'out', d = r.mapped ? C.dept(r.department) : UNMAPPED_DEPT;
        return '<li data-presence-feed-item><span class="fi ' + k + '">' + ico(k === 'in' ? 'login' : k === 'out' ? 'logout' : 'coffee') + '</span><div><b>' + esc(r.mapped ? r.full_name : 'رقم الجهاز ' + r.device_user_id) + '</b><span>' + (k === 'in' ? 'دخول' : k === 'out' ? 'خروج' : 'بداية استراحة') + ' · ' + esc(d.name) + '</span></div><time>' + esc(clock(r.last_punch_at)) + '</time></li>';
      }).join('');
      var smart = [];
      M.list.filter(function (p) { return p.long; }).forEach(function (p) { smart.push(['var(--neg)', 'warn', '<b>' + esc(p.name) + '</b> داخل من ' + esc(dur(p.inAgo)) + ' ولم يبصم خروج']); });
      M.list.filter(function (p) { return p.st === 'break' && p.brkAgo != null && p.brkAgo >= LONG_BREAK_MINUTES; }).forEach(function (p) { smart.push(['var(--amber)', 'coffee', '<b>' + esc(p.name) + '</b> في استراحة من ' + esc(dur(p.brkAgo)) + ' (الحد ' + LONG_BREAK_MINUTES + ' د)']); });
      deptList().forEach(function (g) {
        if (!g.d.min) return; var all = M.list.filter(function (p) { return p.dept.id === g.d.id; }), pres = all.filter(isIn).length, abs = all.filter(function (p) { return p.st === 'absent'; });
        if (pres < g.d.min && abs.length) smart.push(['var(--blue)', 'up', esc(g.d.name) + ': الموجود <b>' + pres + ' من ' + g.d.min + '</b> المطلوبة بسبب غياب ' + esc(abs.slice(0, 2).map(function (p) { return p.name; }).join(' و'))]);
      });
      var dev = (snap.rows || []).filter(function (r) { return r.device_id; })[0];
      return '<aside class="side"><section class="panel"><h4>' + ico('clock') + 'آخر الحركات</h4>' + (feed ? '<ul class="feed">' + feed + '</ul>' : '<div class="empty">لا توجد حركات</div>') + '</section>' +
        '<section class="panel"><h4>' + ico('bulb') + 'تنبيهات ذكية</h4>' + (smart.length ? '<div class="smart" data-presence-smart>' + smart.map(function (s) { return '<div style="color:' + s[0] + '">' + ico(s[1]) + '<span>' + s[2] + '</span></div>'; }).join('') + '</div>' : '<div class="empty">لا توجد تنبيهات</div>') + '</section>' +
        '<section class="panel" data-presence-health><h4>' + ico('wifi') + 'حالة الربط</h4><div class="health"><div><span>اتصال لاب المركز</span><b style="color:' + (li.stale ? 'var(--neg)' : 'var(--pos)') + '">' + (li.stale ? 'متوقف' : 'متصل') + '</b></div><div><span>' + (li.hasBeat ? 'آخر نبضة' : 'آخر استلام') + '</span><b>' + (li.at ? 'منذ ' + esc(dur(li.age)) : '—') + '</b></div><div data-presence-lastpunch><span>آخر بصمة وصلت</span><b>' + (snap.last_received_at ? esc(clock(snap.last_received_at)) : '—') + '</b></div>' + (dev ? '<div><span>جهاز البصمة</span><b>' + esc(dev.device_id) + '</b></div>' : '') + '</div></section></aside>';
    }

    // ---------- link manager dialog ----------
    function dialogHtml() {
      if (!S.dlg) return '';
      var tabs = [['unmapped', 'غير مربوطة', M.unmapped.length], ['ignored', 'متجاهلة (غير إدارية)', M.ignored.length], ['none', 'مربوطون ولم يبصموا', M.noPunch.length]], h = '', t = S.dlgTab;
      var opts = '<option value="">اختر الموظف…</option>' + (snap.people || []).map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.full_name + ' — ' + p.code) + '</option>'; }).join('');
      if (t === 'unmapped') h = M.unmapped.map(function (r) {
        return '<div class="dr" data-presence-unmapped><span class="num">' + esc(r.device_user_id) + '</span><div class="tx"><b>رقم الجهاز ' + esc(r.device_user_id) + '</b><small>' + (r.last_punch_at ? 'آخر بصمة ' + esc(clock(r.last_punch_at)) + ' · منذ ' + esc(dur(mins(r.last_punch_at, M.now))) : 'بدون بصمات حديثة') + '</small></div>' +
          '<select aria-label="اختر الموظف" data-presence-pick="' + esc(key(r)) + '">' + opts + '</select><button type="button" class="mini solid" data-presence="dlg-map" data-id="' + esc(key(r)) + '">ربط</button><button type="button" class="mini" data-presence="ignore" data-id="' + esc(key(r)) + '" title="لا يظهر في الحضور (مثل الأطباء)">' + ico('eyeoff') + ' تجاهل</button></div>';
      }).join('');
      if (t === 'ignored') h = M.ignored.map(function (r) {
        return '<div class="dr"><span class="num" style="background:var(--out-t);color:var(--out)">' + esc(r.device_user_id) + '</span><div class="tx"><b>رقم الجهاز ' + esc(r.device_user_id) + '</b><small>مخفي من «الحضور»' + (r.last_punch_at ? ' · آخر بصمة ' + esc(clock(r.last_punch_at)) : '') + '</small></div><button type="button" class="mini" data-presence="unignore" data-id="' + esc(key(r)) + '">إلغاء التجاهل</button></div>';
      }).join('');
      if (t === 'none') h = M.noPunch.map(function (p) {
        return '<div class="dr"><span class="num">' + esc(initials(p.name)) + '</span><div class="tx"><b>' + esc(p.name) + '</b><small>' + esc(p.dept.name) + (p.role ? ' · ' + esc(p.role) : '') + '</small></div><button type="button" class="mini" data-presence="map" data-id="' + esc(key(p.r)) + '">تغيير الربط</button></div>';
      }).join('');
      return '<div class="dlg-ov" data-presence-dlg><section class="dlg" role="dialog" aria-modal="true" aria-label="إدارة ربط أرقام الجهاز"><header><h3>' + ico('link') + 'إدارة ربط أرقام الجهاز</h3><button type="button" class="mini" data-presence="dlg-close" aria-label="إغلاق">' + ico('x') + '</button></header><div class="dtabs" role="tablist">' +
        tabs.map(function (x) { return '<button type="button" role="tab" aria-selected="' + (t === x[0]) + '" data-presence="dlg-tab" data-id="' + x[0] + '">' + x[1] + ' (' + x[2] + ')</button>'; }).join('') + '</div><div class="dlg-body">' + (h || '<div class="empty">لا يوجد شيء هنا.</div>') + '</div></section></div>';
    }

    // ---------- render ----------
    function draw() {
      M = build(); S.canManage = !!snap.can_manage;
      if (ctx.setLive) { var li = linkInfo(); ctx.setLive({ stale: li.stale, age: li.age, hasBeat: li.hasBeat, now: snap.now }); }
      if (ctx.setBadge) ctx.setBadge(count(function (p) { return p.st === 'absent'; }));
      var items = [['all', 'الكل', 'users', M.list.length]].concat(deptList().map(function (g) { return [g.d.id, g.d.name, g.d.icon, g.n]; }));
      if (S.dept !== 'all' && !items.some(function (i) { return i[0] === S.dept; })) S.dept = 'all';
      var view = S.view === 'timeline' ? timelineView() : S.view === 'list' ? listView() : cardsView();
      host.innerHTML = alertsHtml() + kpisHtml() + trio() +
        '<div class="bar sticky"><label class="search">' + ico('search') + '<span class="sr">بحث</span><input type="search" data-presence-q value="' + esc(S.q) + '" placeholder="ابحث باسم الموظف أو القسم…" autocomplete="off"></label><div class="chips" role="group" aria-label="الأقسام">' +
        items.map(function (i) { return '<button type="button" class="chip" data-d="' + esc(i[0]) + '" aria-pressed="' + (S.dept === i[0]) + '">' + ico(i[2]) + esc(i[1]) + '<i>' + i[3] + '</i></button>'; }).join('') + '</div><div class="seg" role="group" aria-label="طريقة العرض">' +
        [['cards', 'بطاقات', 'cards'], ['timeline', 'جدول زمني', 'gantt'], ['list', 'قائمة', 'list']].map(function (v) { return '<button type="button" data-v="' + v[0] + '" aria-pressed="' + (S.view === v[0]) + '">' + ico(v[2]) + v[1] + '</button>'; }).join('') + '</div>' +
        (S.canManage ? '<button type="button" class="tool" data-presence="dlg-open">' + ico('link') + 'إدارة الربط<span class="badge">' + M.unmapped.length + '</span></button>' : '') + '</div>' +
        '<div class="layout"><main>' + (S.state !== 'all' ? '<div class="legend" style="margin-bottom:10px"><span>فلتر نشط: <b style="color:var(--dark)">' + FILTER_LABEL[S.state] + '</b></span><button type="button" class="mini" data-presence="clear" style="height:28px">إلغاء الفلتر ' + ico('x') + '</button></div>' : '') + view + '</main>' + sideNow() + '</div>' + dialogHtml();
      bind();
    }
    function rerender(focusQ) {
      var q = host.querySelector('[data-presence-q]'), pos = q && q.selectionStart;
      draw();
      if (focusQ) { var n = host.querySelector('[data-presence-q]'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) { /* search inputs may not support selection */ } } }
    }

    function bind() {
      host.querySelectorAll('.kpi').forEach(function (b) { b.onclick = function () { S.state = S.state === b.dataset.k ? 'all' : b.dataset.k; rerender(); }; });
      host.querySelectorAll('[data-bx]').forEach(function (b) { b.onclick = function () { S.trio = b.dataset.bx; rerender(); }; });
      host.querySelectorAll('.chip').forEach(function (b) { b.onclick = function () { S.dept = b.dataset.d; rerender(); }; });
      host.querySelectorAll('[data-v]').forEach(function (b) { b.onclick = function () { S.view = b.dataset.v; rerender(); }; });
      host.querySelectorAll('[data-out]').forEach(function (b) { b.onclick = function () { S.openOut[b.dataset.out] = !S.openOut[b.dataset.out]; rerender(); }; });
      host.querySelectorAll('[data-att-tab]').forEach(function (b) { b.onclick = function () { if (ctx.openTab) ctx.openTab(b.dataset.attTab); }; });
      var q = host.querySelector('[data-presence-q]'); if (q) q.oninput = function () { S.q = q.value; rerender(true); };
      host.querySelectorAll('[data-presence]').forEach(function (n) {
        n.onclick = function () {
          var a = n.dataset.presence;
          if (a === 'retry') { snap = null; load(); return; }
          if (a === 'clear') { S.state = 'all'; rerender(); return; }
          if (a === 'dlg-open') { S.dlg = true; rerender(); return; }
          if (a === 'dlg-close') { S.dlg = null; rerender(); return; }
          if (a === 'dlg-tab') { S.dlgTab = n.dataset.id; rerender(); return; }
          if (a === 'map') { openMap(n.dataset.id); return; }
          if (a === 'dlg-map') {
            var sel = host.querySelector('[data-presence-pick="' + n.dataset.id.replace(/"/g, '') + '"]'), pp = String(n.dataset.id).split('|');
            if (!sel || !sel.value) { toast('اختر الموظف أولًا', 'error'); return; }
            n.disabled = true;
            U.rpc('hr_presence_map', { p_device_id: pp.slice(1).join('|'), p_device_user_id: Number(pp[0]), p_person_id: sel.value }).then(function () { return load(true); }).catch(function (err) { n.disabled = false; toast(err.message, 'error'); });
            return;
          }
          if (a === 'ignore' || a === 'unignore') {
            var parts = String(n.dataset.id).split('|');
            if (a === 'ignore' && !w.confirm('تجاهل رقم الجهاز ' + parts[0] + '؟ لن يظهر في «الحضور الآن» (البصمات تبقى محفوظة، ويمكن إلغاء التجاهل).')) return;
            n.disabled = true;
            U.rpc('hr_presence_ignore', { p_device_id: parts.slice(1).join('|'), p_device_user_id: Number(parts[0]), p_ignore: a === 'ignore' }).then(function () { return load(true); })
              .catch(function (err) { n.disabled = false; toast(err.message, 'error'); });
          }
        };
      });
    }

    function openMap(k) {
      var parts = String(k).split('|'), uid = Number(parts[0]), dev = parts.slice(1).join('|');
      var row = (snap.rows || []).filter(function (r) { return r.device_user_id === uid && r.device_id === dev; })[0] || {};
      var options = [['', 'بدون ربط (إزالة)']].concat((snap.people || []).map(function (p) { return [p.id, p.full_name + ' — ' + p.code]; }));
      U.modal('ربط رقم الجهاز ' + uid + ' بموظف',
        U.select('person', 'الموظف', options, row.person_id || '') +
        '<p class="wp-wide">يظهر هذا الرقم باسم الموظف في «الحضور الآن». يمكنك تغيير الربط أو إزالته في أي وقت.</p>',
        function (v) { return U.rpc('hr_presence_map', { p_device_id: dev, p_device_user_id: uid, p_person_id: v.person || null }).then(function () { return load(true); }); });
    }

    if (ctx.onRefresh) ctx.onRefresh(function () { return load(); });
    load();
    timer = setInterval(function () { if (!live()) { stop(); return; } load(true); }, REFRESH_MS);
  }

  w.SSMPDHRPresence = { mount: mount };
})(window);
