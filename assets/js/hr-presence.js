(function (w) {
  'use strict';
  // Live attendance board («الآن»): who is in the center right now, who is late / absent / on leave, per department.
  // Data = hr_presence_snapshot (fingerprint punches, device mapping, heartbeat) + hr_attendance_today (schedule verdicts) + hr_shifts_workspace (shift templates).
  // Mounted by hr-attendance-hub.js into the «الحضور اللحظي» section; loads only while that tab is open and refreshes every 15 seconds.
  var STALE_MINUTES = 5, LONG_IN_MINUTES = 14 * 60, LONG_BREAK_MINUTES = 30, REFRESH_MS = 15000, WIN_PAST = 16 * 60, WIN_FUT = 4 * 60;
  var C = w.SSMPDAttCore, esc = C.esc, ico = C.ico, clock = C.clock, day = function (iso) { return new Intl.DateTimeFormat('ar-EG-u-nu-latn', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'long' }).format(new Date(iso)); }, hhmm = C.hhmm, dur = C.dur, mins = C.minutesBetween, initials = C.initials;
  var STATE_LABEL = { in: ['p-in', 'حاضر'], break: ['p-break', 'استراحة'], absent: ['p-none', 'لم يصل'], up: ['p-up', 'لم يبدأ'], out: ['p-out', 'انصرف'], leave: ['p-leave', 'إجازة'], idle: ['p-out', 'لم يبصم'], nolink: ['p-up', 'غير مربوط'] };
  var FILTER_LABEL = { in: 'الموجودون', late: 'المتأخرون', abs: 'الغايبون', leave: 'في إجازة', up: 'لم يبدأوا', out: 'المنصرفون' };
  var UNMAPPED_DEPT = { id: 'unmapped', name: 'أرقام غير مربوطة بموظف', icon: 'link', col: '#6B7688', tint: '#EEF1F6', min: 0 };

  function mount(shell, active, ctx) {
    if (!shell || !active) return;
    ctx = ctx || {};
    var U = w.SSMPDWorkforceUtils, owner = w.SSMPDAuth && w.SSMPDAuth.currentAdmin && w.SSMPDAuth.currentAdmin.id;
    var snap = null, board = null, wsd = null, M = null, serial = 0, timer = null, first = true;
    var S = { view: 'cards', dept: 'all', state: 'all', q: '', openOut: {}, trio: 'abs', dlg: null, dlgTab: 'unmapped', pop: null, popFocus: false };
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
    // Departments below their minimum staffing because someone scheduled did not come.
    function deptStats(d) {
      var all = M.list.filter(function (p) { return p.dept.id === d.id; }), pres = all.filter(isIn).length;
      var sched = all.filter(function (p) { return p.st !== 'leave' && (p.b || isIn(p)); }).length, abs = all.filter(function (p) { return p.st === 'absent'; }).length;
      return { all: all, pres: pres, sched: sched, abs: abs, low: d.min > 0 && pres < d.min && abs > 0 };
    }
    function lowDepts() { return deptList().filter(function (g) { return deptStats(g.d).low; }); }
    function kpisHtml() {
      var sched = count(function (p) { return p.b && p.st !== 'leave'; }), base = Math.max(1, sched || M.list.length), lows = lowDepts();
      var hero = '<div class="pv-hero' + (lows.length ? '' : ' ok') + '" data-presence-hero><small>' + (lows.length ? 'أقسام أقل من الحد الأدنى' : 'تغطية الأقسام') + '</small><b>' + lows.length + '</b>' +
        (lows.length ? '<div class="pv-hero-l">' + lows.map(function (g) { var st = deptStats(g.d); return '<span>' + esc(g.d.name) + ' <b>' + st.pres + ' من ' + g.d.min + '</b></span>'; }).join('') + '</div>' : '<div class="pv-hero-l"><span>كل الأقسام فوق الحد الأدنى</span></div>') + '</div>';
      var T = [['in', 'k-in', count(isIn), 'موجودون الآن', board ? 'من ' + sched + ' مجدولين اليوم' : 'حسب بصمات الجهاز'], ['abs', 'k-abs', count(function (p) { return p.st === 'absent'; }), 'غايبون', 'مجدولون ولم يصلوا'], ['late', 'k-late', count(function (p) { return p.isLate; }), 'متأخرون', 'بعد الموعد + السماح'],
        ['leave', 'k-leave', count(function (p) { return p.st === 'leave'; }), 'في إجازة', 'إجازة أو إذن معتمد'], ['up', 'k-up', count(function (p) { return p.st === 'up'; }), 'لم يبدأوا بعد', 'ورديتهم لسه ما بدأت'], ['out', 'k-out', count(function (p) { return p.st === 'out'; }), 'انصرفوا', 'آخر ' + esc(snap.lookback_hours) + ' ساعة']];
      return '<div class="pv-top">' + hero + '<section class="kpis" data-presence-cards>' + T.map(function (t) {
        return '<button type="button" class="kpi ' + t[1] + '" data-k="' + t[0] + '" aria-haspopup="dialog"><span class="l">' + t[3] + '</span><b>' + t[2] + '</b><small>' + t[4] + '</small><span class="kbar"><i style="width:' + Math.min(100, Math.round(t[2] / base * 100)) + '%"></i></span></button>';
      }).join('') + '</section></div>';
    }
    function acts(p) {
      if (p.unmapped || !p.phone) return '';
      return '<div class="acts"><a class="ib" href="tel:+' + esc(p.phone) + '" title="اتصال" aria-label="اتصال">' + ico('phone') + '</a><a class="ib wa" href="https://wa.me/' + esc(p.phone) + '" target="_blank" rel="noopener noreferrer" title="واتساب" aria-label="واتساب">' + ico('msg') + '</a></div>';
    }
    function avatar(p, cls) { return '<span class="av ' + (cls || '') + ' st-' + (p.st === 'absent' ? 'none' : p.st === 'idle' || p.st === 'nolink' ? 'up' : p.st) + '" style="--col:' + esc(p.dept.col) + ';--tint:' + esc(p.dept.tint || '#EEF1F6') + '" title="' + esc(p.name) + '">' + ico('user') + '</span>'; }
    function trio() {
      var abs = M.list.filter(function (p) { return p.st === 'absent'; }).sort(function (a, b) { return (b.sinceStart || 0) - (a.sinceStart || 0); });
      var late = M.list.filter(function (p) { return p.isLate; }).sort(function (a, b) { return b.late - a.late; });
      var lv = M.list.filter(function (p) { return p.st === 'leave'; });
      var absRow = function (p) { return '<li class="row abs" data-presence-absent data-pid="' + esc(p.id) + '" tabindex="0">' + avatar(p) + '<div class="nm"><span class="t">' + esc(p.name) + '</span><small>' + esc(p.dept.name) + (p.start ? ' · وردية ' + esc(clock(p.start)) : '') + '</small><span class="pill p-none">لم يصل منذ ' + esc(dur(p.sinceStart)) + '</span></div><div class="acts-c">' + acts(p) + (w.SSMPDHRActions ? w.SSMPDHRActions.button(p.id, p.name) : '') + '</div></li>'; };
      var lateRow = function (p) {
        return '<li class="row" data-presence-late data-pid="' + esc(p.id) + '" tabindex="0">' + avatar(p) + '<div class="nm"><span class="t">' + esc(p.name) + '</span><small>' + esc(p.dept.name) + (p.start ? ' · الموعد ' + esc(clock(p.start)) : '') + ' · وصل ' + esc(clock(p.b && p.b.first_in)) + (p.lateWeek >= 2 ? ' · <b style="color:var(--neg)">' + p.lateWeek + ' مرات آخر 6 أيام</b>' : '') + '</small><span class="pill p-late">متأخر ' + esc(dur(p.late)) + '</span></div>' + (w.SSMPDHRActions ? w.SSMPDHRActions.button(p.id, p.name) : '') + '</li>';
      };
      var lvRow = function (p) { return '<li class="row" data-presence-leave data-pid="' + esc(p.id) + '" tabindex="0">' + avatar(p) + '<div class="nm"><span class="t">' + esc(p.name) + '</span><small>' + esc(p.dept.name) + (p.start ? ' · وردية ' + esc(clock(p.start)) : '') + '</small></div><div class="meta"><span class="pill p-leave">' + (p.excusedLeave ? 'إذن معتمد' : 'إجازة') + '</span></div>' + (w.SSMPDHRActions ? w.SSMPDHRActions.button(p.id, p.name) : '') + '</li>'; };
      var box = function (cls, k, t, sub, n, rows, empty) { return '<section class="box ' + cls + '" data-b="' + k + '"><header><h3>' + t + '<span class="cnt">' + n + '</span>' + (sub ? '<small>' + sub + '</small>' : '') + '</h3></header><ul class="rows">' + (rows || '<li class="empty">' + empty + '</li>') + '</ul></section>'; };
      return '<section class="panel pv-follow" data-presence-follow><h4>' + ico('bulb') + 'محتاجين متابعة</h4><div class="seg trio-tabs" role="group" aria-label="المتابعة العاجلة">' + [['abs', 'غايبون', abs.length], ['late', 'متأخرون', late.length], ['leave', 'إجازات', lv.length]].map(function (t) { return '<button type="button" data-bx="' + t[0] + '" aria-pressed="' + (S.trio === t[0]) + '">' + t[1] + ' (' + t[2] + ')</button>'; }).join('') + '</div>' +
        '<div class="trio" data-show="' + S.trio + '">' + box('b-neg', 'abs', 'الغايبون الآن', 'كان المفروض يحضروا ولسه مبصموش', abs.length, abs.map(absRow).join(''), 'لا يوجد غايبون') +
        box('b-amber', 'late', 'المتأخرون اليوم', 'بعد الموعد + السماح', late.length, late.map(lateRow).join(''), 'لا يوجد متأخرون') + box('b-blue', 'leave', 'الإجازات والأذونات', '', lv.length, lv.map(lvRow).join(''), 'لا أحد في إجازة') + '</div></section>';
    }
    function metaOf(p) {
      var st = p.st, meta = '';
      if (st === 'in' || st === 'break') {
        meta = (st === 'break' ? '<span class="pill p-break">' + ico('coffee') + ' استراحة ' + esc(dur(p.brkAgo)) + '</span><span>دخل ' + esc(clock(p.r.last_in_at)) + '</span>' : '<b class="tin">دخل ' + esc(clock(p.r.last_in_at)) + '</b>') +
          (p.isLate ? '<span class="pill p-late">متأخر ' + esc(dur(p.late)) + '</span>' : st === 'in' ? '<span>من ' + esc(dur(p.inAgo)) + '</span>' : '');
      } else if (st === 'absent') meta = '<span class="pill p-none">لم يصل منذ ' + esc(dur(p.sinceStart)) + '</span><span>وردية ' + esc(clock(p.start)) + '</span>';
      else if (st === 'up') meta = '<span class="pill p-up">' + ico('hour') + ' تبدأ ' + esc(clock(p.start)) + '</span><span>' + (p.start ? 'بعد ' + esc(dur(mins(M.now, p.start))) : '') + '</span>';
      else if (st === 'leave') meta = '<span class="pill p-leave">' + (p.excusedLeave ? 'إذن معتمد' : 'إجازة') + '</span>';
      else if (st === 'out') meta = '<span class="pill p-out">انصرف ' + esc(clock(p.r.last_out_at || p.r.last_punch_at)) + '</span><span>' + (p.worked != null ? 'عمل ' + esc(dur(p.worked)) : '') + '</span>';
      else if (st === 'nolink') meta = '<span class="pill p-up">غير مربوط بالبصمة</span>';
      else meta = '<span class="pill p-out">لم يبصم</span>';
      return meta;
    }
    function personRow(p) {
      var meta = metaOf(p);
      var kebab = S.canManage && !p.unmapped ? '<button type="button" class="kebab" data-presence="map" data-id="' + esc(p.r ? key(p.r) : '') + '" aria-label="تغيير ربط البصمة" title="تغيير ربط البصمة">' + ico('link') + '</button>' : '';
      var unm = p.unmapped && S.canManage ? '<div class="acts"><button type="button" class="mini solid" data-presence="map" data-id="' + esc(key(p.r)) + '">ربط</button><button type="button" class="mini" data-presence="ignore" data-id="' + esc(key(p.r)) + '">' + ico('eyeoff') + ' تجاهل</button></div>' : '';
      var warn = p.long ? '<span class="pill p-warn" data-presence-warn>' + ico('warn') + ' مدة طويلة جدًا — تحقق من بصمة الخروج</span>' : '';
      return '<li class="person" data-presence-person' + (p.unmapped ? '' : ' data-pid="' + esc(p.id) + '" tabindex="0" title="افتح ملف الأداء"') + '>' + avatar(p) + '<div class="nm"><span class="t">' + esc(p.name) + '</span><small>' + esc(p.unmapped ? p.role : p.role || p.code) + '</small>' + warn + unm + '</div><div class="meta">' + meta + '</div>' + kebab + (p.unmapped || !w.SSMPDHRActions ? '' : w.SSMPDHRActions.button(p.id, p.name)) + '</li>';
    }
    // Calm card rows + popups: a tap on a total, a department or a person opens a dialog; nothing filters the page in place.
    function shortStatus(p) {
      var st = p.st;
      if (st === 'in') return p.isLate ? ['متأخر ' + dur(p.late), 'p-late'] : ['دخل ' + clock(p.r.last_in_at), 'tin'];
      if (st === 'break') return ['استراحة', 'p-break'];
      if (st === 'absent') return ['لم يصل', 'p-none'];
      if (st === 'up') return ['تبدأ ' + clock(p.start), 'p-up'];
      if (st === 'leave') return [p.excusedLeave ? 'إذن معتمد' : 'إجازة', 'p-leave'];
      if (st === 'out') return ['انصرف ' + clock(p.r.last_out_at || p.r.last_punch_at), 'p-out'];
      if (st === 'nolink') return ['غير مربوط', 'p-up'];
      return ['لم يبصم', 'p-out'];
    }
    function rowFor(p) { return p.unmapped ? personRow(p) : calmRow(p); }
    function calmRow(p) {
      var sh = shortStatus(p), tap = p.unmapped ? '' : ' data-pp="' + esc(p.id) + '" tabindex="0" role="button"';
      return '<li class="person calm' + (p.st === 'absent' ? ' abs abs-line' : '') + '" data-presence-person' + tap + '>' + avatar(p) + '<div class="nm"><span class="t">' + esc(p.name) + '</span></div>' + (p.long ? '<span class="warn-ic" data-presence-warn title="مدة طويلة جدًا — تحقق من بصمة الخروج" aria-label="مدة طويلة جدًا — تحقق من بصمة الخروج">' + ico('warn') + '</span>' : '') + '<span class="pill ' + sh[1] + '">' + esc(sh[0]) + '</span>' + (p.unmapped || !w.SSMPDHRActions ? '' : w.SSMPDHRActions.button(p.id, p.name)) + '</li>';
    }
    function popRow(p) {
      var sh = shortStatus(p), tap = p.unmapped ? '' : ' data-pp="' + esc(p.id) + '"';
      return '<li><button type="button" class="pp-row"' + tap + '>' + avatar(p) + '<span class="nm"><b>' + esc(p.name) + '</b><small>' + esc(p.dept.name) + '</small></span><span class="pill ' + sh[1] + '">' + esc(sh[0]) + '</span></button></li>';
    }
    function popupHtml() {
      var P = S.pop; if (!P) return '';
      var title = '', body = '', back = '';
      var order = { absent: 0, in: 1, break: 1, up: 2, nolink: 2, idle: 3, out: 3, leave: 4 };
      var sorted = function (l) { return l.slice().sort(function (a, b) { return (order[a.st] || 0) - (order[b.st] || 0) || a.name.localeCompare(b.name, 'ar'); }); };
      if (P.t === 'state') {
        var l = sorted(M.list.filter(function (p) { return matchState(p, P.k); }));
        title = FILTER_LABEL[P.k] + ' (' + l.length + ')';
        body = l.length ? '<ul class="pp-list">' + l.map(popRow).join('') + '</ul>' : '<p class="pp-empty">لا أحد هنا دلوقتي</p>';
      } else if (P.t === 'dept') {
        var g = deptList().filter(function (x) { return x.d.id === P.id; })[0];
        if (!g) { S.pop = null; return ''; }
        var st = deptStats(g.d), dl = sorted(M.list.filter(function (p) { return p.dept.id === g.d.id; }));
        title = g.d.name;
        body = '<div class="pp-sum"><div><b>' + st.pres + '</b><small>موجودون</small></div><div><b>' + st.sched + '</b><small>مجدولون</small></div><div><b>' + (g.d.min || 0) + '</b><small>الحد الأدنى</small></div></div><ul class="pp-list">' + dl.map(popRow).join('') + '</ul>';
      } else {
        var p = M.list.filter(function (x) { return x.id === P.id; })[0];
        if (!p) { S.pop = null; return ''; }
        title = p.name;
        if (P.from) back = '<button type="button" class="pp-back" data-pop="back" aria-label="رجوع" title="رجوع"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>';
        body = '<dl class="pp-dl"><dt>القسم</dt><dd>' + esc(p.dept.name) + '</dd><dt>الوظيفة</dt><dd>' + esc(p.role || p.code || '—') + '</dd>' + (p.tname ? '<dt>الوردية</dt><dd>' + esc(p.tname) + (p.start ? ' · ' + esc(clock(p.start)) : '') + '</dd>' : '') + '</dl><div class="pp-meta">' + metaOf(p) + (p.long ? '<span class="pill p-warn">' + ico('warn') + ' مدة طويلة جدًا — تحقق من بصمة الخروج</span>' : '') + '</div>' +
          '<div class="pp-acts">' + acts(p) + (ctx.openProfile && !p.unmapped ? '<button type="button" class="mini solid" data-pop="profile" data-id="' + esc(p.id) + '">فتح ملف الأداء</button>' : '') + (S.canManage && !p.unmapped && p.r ? '<button type="button" class="mini" data-pop="map" data-id="' + esc(key(p.r)) + '">تغيير الربط</button>' : '') + '</div>';
      }
      return '<div class="pp-ov" data-pop="overlay"><section class="pp" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' + back + '<button type="button" class="pp-x" data-pop="close" aria-label="إغلاق">' + ico('x') + '</button><header><h3>' + esc(title) + '</h3></header>' + body + '</section></div>';
    }
    // Departments where nobody is in and nobody is missing (only upcoming / left / on leave) -> one line each in the side column.
    function quietDepts() { return deptList().filter(function (g) { var st = deptStats(g.d); return g.d.id !== 'unmapped' && !st.pres && !st.abs; }); }
    function cardsView() {
      var list = filtered(), filt = S.state !== 'all', forced = filt || S.dept !== 'all' || !!S.q.trim(), quiet = forced ? [] : quietDepts().map(function (g) { return g.d.id; });
      var groups = deptList().filter(function (g) { return quiet.indexOf(g.d.id) < 0 && list.some(function (p) { return p.dept.id === g.d.id; }); });
      if (!groups.length) return quiet.length ? '<div class="panel empty" data-presence-empty>لا أحد حاضر الآن — شوف «أقسام بدون حضور الآن».</div>' : '<div class="panel empty" data-presence-empty>لا توجد نتائج مطابقة.</div>';
      var halves = 0, html = groups.map(function (g) {
        var d = g.d, stt = deptStats(d), ls = list.filter(function (p) { return p.dept.id === d.id; }), pres = stt.pres, sched = stt.sched, low = stt.low;
        var main = ls.filter(isIn).sort(function (a, b) { return (b.inAgo || 0) - (a.inAgo || 0); }), absL = ls.filter(function (p) { return p.st === 'absent'; });
        var rest = ls.filter(function (p) { return !isIn(p) && p.st !== 'absent'; }), open = S.openOut[d.id] || (filt && S.state !== 'abs');
        var n = main.length + absL.length, wide = n >= 3, unm = d.id === 'unmapped';
        var badge = unm ? '' : low ? '<span class="pv-st bad">ناقص ' + (d.min - pres) + '</span>' : stt.abs ? '<span class="pv-st warn">غايب ' + stt.abs + '</span>' : pres ? '<span class="pv-st ok">مكتمل</span>' : '';
        var c = { up: 0, out: 0, leave: 0, other: 0 }; rest.forEach(function (p) { c[p.st === 'up' ? 'up' : p.st === 'out' ? 'out' : p.st === 'leave' ? 'leave' : 'other']++; });
        var fc = function (l, v) { return '<span class="fc' + (v ? '' : ' zero') + '">' + l + ' <b>' + v + '</b></span>'; };
        var foot = unm ? '' : '<footer class="pv-foot">' + fc('جاي لسه', c.up) + fc('انصرف', c.out) + fc('إجازة', c.leave) + (c.other ? fc('أخرى', c.other) : '') +
          (rest.length && !filt ? '<button type="button" class="more" data-out="' + esc(d.id) + '" aria-expanded="' + !!open + '">' + (open ? 'إخفاء' : 'عرض') + ico('chev') + '</button>' : '') + '</footer>';
        return '<section class="dept ' + (wide ? 'wide' : 'half') + (low ? ' short' : '') + '" data-presence-dept data-dept="' + esc(d.name) + '" style="--col:' + esc(d.col) + ';--tint:' + esc(d.tint) + '"><header' + (unm ? '' : ' data-pd="' + esc(d.id) + '" tabindex="0" role="button" title="تفاصيل القسم"') + '><span class="di">' + ico(d.icon) + '</span><h3>' + esc(d.name) + '<small>' + pres + ' من ' + sched + ' مجدولين' + (d.min ? ' · <span class="cov ' + (low ? 'low' : 'ok') + '">الحد الأدنى ' + d.min + '</span>' : '') + '</small></h3>' + badge + '</header>' +
          (n ? '<ul class="people">' + absL.map(rowFor).join('') + main.map(rowFor).join('') + '</ul>' : (filt ? '' : '<ul class="people"><li class="empty">لا أحد حاضرًا الآن</li></ul>')) +
          (open && rest.length ? '<ul class="people rest">' + rest.map(rowFor).join('') + '</ul>' : '') + foot + '</section>';
      });
      // half cards pair up two per row; a half card left alone at the end takes the whole row
      groups.forEach(function (g, i) { if (/class="dept half/.test(html[i])) halves++; });
      if (halves % 2) { for (var j = html.length - 1; j >= 0; j--) if (/class="dept half/.test(html[j])) { html[j] = html[j].replace('class="dept half', 'class="dept half solo'); break; } }
      return '<div class="cards" data-presence-depts>' + html.join('') + '</div>';
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
      var li = linkInfo(), rows = (snap.rows || []).filter(function (r) { return r.last_punch_at; }).sort(function (a, b) { return a.last_punch_at < b.last_punch_at ? 1 : -1; }).slice(0, 30);
      var feed = rows.map(function (r) {
        var k = r.last_punch === 2 ? 'break' : (r.last_punch === 0 || r.last_punch === 3 || r.last_punch === 4) ? 'in' : 'out', d = r.mapped ? C.dept(r.department) : UNMAPPED_DEPT;
        return '<li data-presence-feed-item><span class="fi ' + k + '">' + ico(k === 'in' ? 'login' : k === 'out' ? 'logout' : 'coffee') + '</span><div><b>' + esc(r.mapped ? r.full_name : 'رقم الجهاز ' + r.device_user_id) + '</b><span>' + (k === 'in' ? 'دخول' : k === 'out' ? 'خروج' : 'بداية استراحة') + ' · ' + esc(d.name) + '</span></div><time>' + esc(clock(r.last_punch_at)) + '</time></li>';
      }).join('');
      var smart = [];
      M.list.filter(function (p) { return p.long; }).forEach(function (p) { smart.push(['var(--neg)', 'warn', '<b>' + esc(p.name) + '</b> داخل من ' + esc(dur(p.inAgo)) + ' ولم يبصم خروج']); });
      M.list.filter(function (p) { return p.st === 'break' && p.brkAgo != null && p.brkAgo >= LONG_BREAK_MINUTES; }).forEach(function (p) { smart.push(['var(--amber)', 'coffee', '<b>' + esc(p.name) + '</b> في استراحة من ' + esc(dur(p.brkAgo)) + ' (الحد ' + LONG_BREAK_MINUTES + ' د)']); });
      var dev = (snap.rows || []).filter(function (r) { return r.device_id; })[0];
      var quiet = quietDepts(), qh = quiet.length ? '<section class="panel pv-quiet" data-presence-quiet><h4>أقسام بدون حضور الآن <span class="cnt">' + quiet.length + '</span></h4>' + quiet.map(function (g) {
        var st = deptStats(g.d), c = { up: 0, out: 0, leave: 0 }; st.all.forEach(function (p) { if (c[p.st] != null) c[p.st]++; });
        var why = [c.up ? c.up + ' جاي لسه' : '', c.out ? c.out + ' انصرف' : '', c.leave ? c.leave + ' إجازة' : ''].filter(Boolean).join(' · ') || 'مفيش حد مجدول دلوقتي';
        return '<button type="button" class="qd" data-d="' + esc(g.d.id) + '" style="--col:' + esc(g.d.col) + '"><i></i><b>' + esc(g.d.name) + '</b><small>' + why + '</small></button>';
      }).join('') + '</section>' : '';
      return '<aside class="side">' + trio() + qh + '<section class="panel pv-moves"><h4>' + ico('clock') + 'آخر الحركات</h4>' + (feed ? '<ul class="feed">' + feed + '</ul>' : '<div class="empty">لا توجد حركات</div>') + '</section>' +
        (smart.length ? '<section class="panel"><h4>' + ico('bulb') + 'تنبيهات ذكية</h4><div class="smart" data-presence-smart>' + smart.map(function (s) { return '<div style="color:' + s[0] + '">' + ico(s[1]) + '<span>' + s[2] + '</span></div>'; }).join('') + '</div></section>' : '') +
        '<section class="panel" data-presence-health><h4>' + ico('wifi') + 'حالة الربط</h4><div class="health"><div><span>اتصال لاب المركز</span><b style="color:' + (li.stale ? 'var(--neg)' : 'var(--pos)') + '">' + (li.stale ? 'متوقف' : 'متصل') + '</b></div><div><span>' + (li.hasBeat ? 'آخر نبضة' : 'آخر استلام') + '</span><b>' + (li.at ? 'منذ ' + esc(dur(li.age)) : '—') + '</b></div><div data-presence-lastpunch><span>آخر بصمة وصلت</span><b>' + (snap.last_received_at ? esc(clock(snap.last_received_at)) : '—') + '</b></div>' + (dev ? '<div><span>جهاز البصمة</span><b>' + esc(dev.device_id) + '</b></div>' : '') + '</div></section></aside>';
    }

    // ---------- link manager dialog ----------
    function dialogHtml() {
      if (!S.dlg) return '';
      var tabs = [['unmapped', 'غير مربوطة', M.unmapped.length], ['ignored', 'متجاهلة (غير إدارية)', M.ignored.length], ['none', 'مابصموش آخر ' + (snap.lookback_hours || 16) + ' ساعة', M.noPunch.length]], h = '', t = S.dlgTab;
      var opts = '<option value="">اختر الموظف…</option>' + (snap.people || []).map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.full_name + ' — ' + p.code) + '</option>'; }).join('');
      if (t === 'unmapped') h = M.unmapped.map(function (r) {
        return '<div class="dr" data-presence-unmapped><span class="num">' + esc(r.device_user_id) + '</span><div class="tx"><b>رقم الجهاز ' + esc(r.device_user_id) + '</b><small>' + (r.last_punch_at ? 'آخر بصمة ' + esc(clock(r.last_punch_at)) + ' · منذ ' + esc(dur(mins(r.last_punch_at, M.now))) : 'بدون بصمات حديثة') + '</small></div>' +
          '<select aria-label="اختر الموظف" data-presence-pick="' + esc(key(r)) + '">' + opts + '</select><button type="button" class="mini solid" data-presence="dlg-map" data-id="' + esc(key(r)) + '">ربط</button><button type="button" class="mini" data-presence="ignore" data-id="' + esc(key(r)) + '" title="لا يظهر في الحضور (مثل الأطباء)">' + ico('eyeoff') + ' تجاهل</button></div>';
      }).join('');
      if (t === 'ignored') h = M.ignored.map(function (r) {
        return '<div class="dr"><span class="num" style="background:var(--out-t);color:var(--out)">' + esc(r.device_user_id) + '</span><div class="tx"><b>رقم الجهاز ' + esc(r.device_user_id) + '</b><small>مخفي من «الحضور»' + (r.last_punch_at ? ' · آخر بصمة ' + esc(clock(r.last_punch_at)) : '') + '</small></div><button type="button" class="mini" data-presence="unignore" data-id="' + esc(key(r)) + '">إلغاء التجاهل</button></div>';
      }).join('');
      // «none» from hr_presence_snapshot only means «no punch inside the look-back window» — never «never punched» (owner 2026-11-18)
      if (t === 'none') h = M.noPunch.map(function (p) {
        var last = p.r && p.r.last_punch_at ? ' · آخر بصمة ' + esc(day(p.r.last_punch_at)) + ' ' + esc(clock(p.r.last_punch_at)) : '';
        return '<div class="dr"><span class="num">' + esc(initials(p.name)) + '</span><div class="tx"><b>' + esc(p.name) + '</b><small>' + esc(p.dept.name) + (p.role ? ' · ' + esc(p.role) : '') + last + '</small></div><button type="button" class="mini" data-presence="map" data-id="' + esc(key(p.r)) + '">تغيير الربط</button></div>';
      }).join('');
      if (t === 'none' && h) h = '<p class="dlg-note" data-presence-none-note>دول موظفين مربوطين بالجهاز بس مفيش ليهم بصمة في آخر ' + esc(snap.lookback_hours || 16) + ' ساعة. ده حضور لحظي بس — بصمات الأيام اللي فاتت موجودة في تقرير الحضور.</p>' + h;
      return '<div class="dlg-ov" data-presence-dlg><section class="dlg" role="dialog" aria-modal="true" aria-label="إدارة ربط أرقام الجهاز"><header><h3>' + ico('link') + 'إدارة ربط أرقام الجهاز</h3><button type="button" class="mini" data-presence="dlg-close" aria-label="إغلاق">' + ico('x') + '</button></header><div class="dtabs" role="tablist">' +
        tabs.map(function (x) { return '<button type="button" role="tab" aria-selected="' + (t === x[0]) + '" data-presence="dlg-tab" data-id="' + x[0] + '">' + x[1] + ' (' + x[2] + ')</button>'; }).join('') + '</div><div class="dlg-body">' + (h || '<div class="empty">لا يوجد شيء هنا.</div>') + '</div></section></div>';
    }

    // ---------- render ----------
    function draw() {
      M = build(); S.canManage = !!snap.can_manage;
      if (ctx.setLive) { var li = linkInfo(); ctx.setLive({ stale: li.stale, age: li.age, hasBeat: li.hasBeat, now: snap.now }); }
      if (ctx.setBadge) ctx.setBadge(count(function (p) { return p.st === 'absent'; }));
      var items = [['all', 'الكل', 'users', M.list.length, '']].concat(deptList().map(function (g) { return [g.d.id, g.d.name, g.d.icon, g.n, g.d.col]; })), lowIds = lowDepts().map(function (g) { return g.d.id; });
      if (S.dept !== 'all' && !items.some(function (i) { return i[0] === S.dept; })) S.dept = 'all';
      var view = S.view === 'timeline' ? timelineView() : S.view === 'list' ? listView() : cardsView();
      host.className = 'pv' + (first ? ' pv-enter' : ''); first = false;
      host.innerHTML = alertsHtml() + kpisHtml() +
        '<div class="bar sticky"><label class="search">' + ico('search') + '<span class="sr">بحث</span><input type="search" data-presence-q value="' + esc(S.q) + '" placeholder="ابحث باسم الموظف أو القسم…" autocomplete="off"></label><div class="chips" role="group" aria-label="الأقسام">' +
        items.map(function (i) { return '<button type="button" class="chip' + (lowIds.indexOf(i[0]) >= 0 ? ' warn' : '') + '" data-d="' + esc(i[0]) + '" aria-pressed="' + (S.dept === i[0]) + '"' + (i[4] ? ' style="--col:' + esc(i[4]) + '"><span class="cdot"></span>' : '>') + esc(i[1]) + '<i>' + i[3] + '</i></button>'; }).join('') + '</div><div class="seg" role="group" aria-label="طريقة العرض">' +
        [['cards', 'بطاقات', 'cards'], ['timeline', 'جدول زمني', 'gantt'], ['list', 'قائمة', 'list']].map(function (v) { return '<button type="button" data-v="' + v[0] + '" aria-pressed="' + (S.view === v[0]) + '">' + ico(v[2]) + v[1] + '</button>'; }).join('') + '</div>' +
        (S.canManage ? '<button type="button" class="tool" data-presence="dlg-open">' + ico('link') + 'إدارة الربط<span class="badge">' + M.unmapped.length + '</span></button>' : '') + '</div>' +
        '<div class="layout"><main>' + ''+ view + '</main>' + sideNow() + '</div>' + dialogHtml() + popupHtml();
      bind();
      if (S.pop && S.popFocus) { var cb = host.querySelector('[data-pop=close]'); if (cb) cb.focus(); S.popFocus = false; }
    }
    function rerender(focusQ) {
      var q = host.querySelector('[data-presence-q]'), pos = q && q.selectionStart;
      draw();
      if (focusQ) { var n = host.querySelector('[data-presence-q]'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) { /* search inputs may not support selection */ } } }
    }

    function bind() {
      host.querySelectorAll('.kpi').forEach(function (b) { b.onclick = function () { S.pop = { t: 'state', k: b.dataset.k }; S.popFocus = true; rerender(); }; });
      host.querySelectorAll('[data-pd]').forEach(function (h) {
        var open = function () { S.pop = { t: 'dept', id: h.dataset.pd }; S.popFocus = true; rerender(); };
        h.onclick = open; h.onkeydown = function (e) { if ((e.key === 'Enter' || e.key === ' ') && e.target === h) { e.preventDefault(); open(); } };
      });
      host.querySelectorAll('[data-pp]').forEach(function (r) {
        var open = function () { var prev = S.pop && S.pop.t !== 'person' ? S.pop : null; S.pop = { t: 'person', id: r.dataset.pp, from: prev }; S.popFocus = true; rerender(); };
        r.onclick = function (e) { if (e.target.closest('a,select,input')) return; open(); };
        r.onkeydown = function (e) { if ((e.key === 'Enter' || e.key === ' ') && e.target === r) { e.preventDefault(); open(); } };
      });
      host.querySelectorAll('[data-pop]').forEach(function (n) {
        var a = n.dataset.pop;
        n.onclick = function (e) {
          if (a === 'overlay') { if (e.target === n) { S.pop = null; rerender(); } return; }
          if (a === 'close') { S.pop = null; rerender(); return; }
          if (a === 'back') { S.pop = S.pop && S.pop.from; S.popFocus = true; rerender(); return; }
          if (a === 'profile') { var p = M.list.filter(function (x) { return x.id === n.dataset.id; })[0] || {}; S.pop = null; rerender(); if (ctx.openProfile) ctx.openProfile(n.dataset.id, { name: p.name, department: p.dept && p.dept.name, role: p.role }); return; }
          if (a === 'map') { S.pop = null; rerender(); openMap(n.dataset.id); }
        };
        if (a === 'overlay') n.onkeydown = function (e) { if (e.key === 'Escape') { e.stopPropagation(); S.pop = null; rerender(); } };
      });
      host.querySelectorAll('[data-bx]').forEach(function (b) { b.onclick = function () { S.trio = b.dataset.bx; rerender(); }; });
      host.querySelectorAll('.chip,.qd').forEach(function (b) { b.onclick = function () { S.dept = b.dataset.d; rerender(); }; });
      host.querySelectorAll('[data-pid]').forEach(function (r) {
        var go = function () { if (ctx.openProfile) { var p = M.list.filter(function (x) { return x.id === r.dataset.pid; })[0] || {}; ctx.openProfile(r.dataset.pid, { name: p.name, department: p.dept && p.dept.name, role: p.role }); } };
        r.onclick = function (e) { if (e.target.closest('a,button,select,input')) return; go(); };
        r.onkeydown = function (e) { if ((e.key === 'Enter' || e.key === ' ') && e.target === r) { e.preventDefault(); go(); } };
      });
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
