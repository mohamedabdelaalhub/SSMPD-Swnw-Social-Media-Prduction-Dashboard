(function (w) {
  'use strict';
  // Shifts (الورديات والمواعيد): the weekly work times of the administrative staff + today's board (who arrived on time / late / absent).
  // Server: hr_shifts_workspace / hr_shifts_command / hr_attendance_today (migration 20261113100000). Mounted lazily by hr-navigation.js into the «الورديات والمواعيد» section.
  var STATUS = { on_time: ['في الميعاد', 'in'], late: ['متأخر', 'late'], absent: ['غائب', 'absent'], waiting: ['في فترة السماح', 'unknown'], upcoming: ['لم يحن موعده', 'out'], leave: ['إجازة', 'out'], unmapped: ['غير مربوط بالبصمة', 'unknown'] };
  var DAYS = [[6, 'السبت'], [0, 'الأحد'], [1, 'الاثنين'], [2, 'الثلاثاء'], [3, 'الأربعاء'], [4, 'الخميس'], [5, 'الجمعة']];
  var REFRESH_MS = 30000;
  function esc(v) { return w.SSMPDWorkforceUtils.escape(v); }
  function clock(iso) { return iso ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)) : '—'; }
  function span(m) { if (m == null || m <= 0) return '—'; var h = Math.floor(m / 60), r = m % 60; return h ? h + ' س' + (r ? ' ' + r + ' د' : '') : r + ' د'; }
  function btn(action, label, id) { return '<button type="button" class="btn ghost" data-shifts="' + action + '" data-id="' + esc(id || '') + '">' + esc(label) + '</button>'; }

  function mount(shell, active) {
    if (!shell || !active) return;
    var U = w.SSMPDWorkforceUtils, owner = w.SSMPDAuth && w.SSMPDAuth.currentAdmin && w.SSMPDAuth.currentAdmin.id;
    var ws = null, board = null, day = '', serial = 0, timer = null, host = document.createElement('div');
    host.dataset.hrShifts = ''; shell.append(host);
    function live() { return host.isConnected && w.SSMPDAuth.currentAdmin && w.SSMPDAuth.currentAdmin.id === owner; }
    function stop() { if (timer) { clearInterval(timer); timer = null; } }
    function isToday() { return !ws || !day || day === ws.today; }

    function load(quiet) {
      var n = ++serial;
      if (!quiet && !board) host.innerHTML = '<p role="status">جاري تحميل الورديات…</p>';
      return Promise.all([U.rpc('hr_shifts_workspace'), U.rpc('hr_attendance_today', { p_day: day || null })]).then(function (r) {
        if (!live() || n !== serial) return;
        ws = r[0]; board = r[1]; if (!day) day = ws.today; draw();
      }).catch(function (err) {
        if (!live()) { stop(); return; }
        if (board) return;
        var missing = /hr_shifts_workspace|hr_attendance_today|404|schema cache/i.test(err.message || '');
        host.innerHTML = '<p role="alert">' + esc(missing ? 'الورديات غير مفعّلة بعد على قاعدة البيانات' : err.message) + '</p>' + btn('retry', 'إعادة المحاولة');
        bind();
      });
    }

    function tplName(id) { var t = ws.templates.filter(function (x) { return x.id === id; })[0]; return t ? t.name : ''; }
    function tplChip(id) {
      var t = ws.templates.filter(function (x) { return x.id === id; })[0];
      return t ? '<span class="hrp-state" style="background:' + esc(t.color) + '1a;color:' + esc(t.color) + '">' + esc(t.name) + '</span>' : '<small>راحة</small>';
    }

    function boardHtml() {
      var rows = board.rows || [], c = {};
      rows.forEach(function (r) { c[r.status] = (c[r.status] || 0) + 1; });
      var pending = (c.waiting || 0) + (c.upcoming || 0);
      var note = !board.has_schedule ? '<p class="wn-empty" data-shifts-empty>لم تُحدَّد ورديات بعد — أضف وردية ثم حدّد أيام عمل كل موظف من الأسفل ليظهر هنا من وصل في ميعاده ومن تأخر.</p>'
        : board.unscheduled ? '<p role="status" data-shifts-unscheduled>' + esc(board.unscheduled) + ' موظف بدون جدول ورديات (لا يظهرون في هذا الكشف).</p>' : '';
      var cards = '<div class="wp-grid" data-shifts-cards>' +
        '<div class="wp-card" data-card="on_time"><b>في الميعاد</b><span>' + (c.on_time || 0) + '</span></div>' +
        '<div class="wp-card" data-card="late"><b>متأخرون</b><span>' + (c.late || 0) + '</span></div>' +
        '<div class="wp-card" data-card="absent"><b>غائبون</b><span>' + (c.absent || 0) + '</span></div>' +
        '<div class="wp-card" data-card="pending"><b>لم يحن موعدهم / في السماح</b><span>' + pending + '</span></div>' +
        '<div class="wp-card" data-card="leave"><b>إجازة</b><span>' + (c.leave || 0) + '</span></div>' +
        '<div class="wp-card" data-card="unmapped"><b>غير مربوطين بالبصمة</b><span>' + (c.unmapped || 0) + '</span></div></div>';
      var body = rows.map(function (r) {
        var st = STATUS[r.status] || [r.status, 'out'];
        var detail = r.status === 'late' ? 'تأخر ' + span(r.late_min) : r.status === 'absent' ? 'تأخر ' + span(r.since_start) + ' بلا بصمة' : r.status === 'on_time' && r.late_min > 0 ? 'ضمن السماح (' + r.late_min + ' د)' : '';
        var week = (r.late_week || r.absent_week) ? 'آخر 6 أيام: تأخر ' + r.late_week + ' · غياب ' + r.absent_week : '';
        return ['<b>' + esc(r.full_name) + '</b><br><small>' + esc([r.code, r.department, r.job_title].filter(Boolean).join(' · ')) + '</small>',
          '<span class="hrp-state hrp-' + st[1] + '">' + esc(st[0]) + '</span>' + (r.excused && (r.status === 'absent' || r.status === 'late') ? '<br><small>بإذن معتمد</small>' : '') + (detail ? '<br><small>' + esc(detail) + '</small>' : ''),
          esc(r.template_name || '') + '<br><small>' + esc(clock(r.exp_start) + ' → ' + clock(r.exp_end)) + '</small>', esc(clock(r.first_in)), '<small>' + esc(week) + '</small>'];
      });
      return '<section class="wp-detail" data-shifts-board><h3>كشف الحضور بالمواعيد</h3>' +
        '<p><label class="wp-field">اليوم <input type="date" name="day" value="' + esc(day) + '" data-shifts-day></label> ' + btn('refresh', 'تحديث الآن') + '</p>' + note + cards +
        (rows.length ? U.table(['الموظف', 'الحالة', 'الوردية', 'أول بصمة دخول', 'ملاحظات'], body) : (board.has_schedule ? '<p class="wn-empty">لا يوجد موظفون عليهم وردية في هذا اليوم</p>' : '')) + '</section>';
    }

    function templatesHtml() {
      var rows = ws.templates.map(function (t) {
        return [tplChip(t.id) + (t.active ? '' : ' <small>متوقفة</small>'), esc(t.start_time + ' → ' + t.end_time) + (t.overnight ? ' <small>(تعبر منتصف الليل)</small>' : ''), esc(t.grace_minutes) + ' د', btn('tpl', 'تعديل', t.id)];
      });
      return '<section class="wp-detail" data-shifts-templates><h3>أنواع الورديات <small>(' + ws.templates.length + ')</small></h3><p>' + btn('tpl', 'إضافة وردية', '') + '</p>' +
        (rows.length ? U.table(['الوردية', 'من → إلى', 'السماح', ''], rows) : '<p class="wn-empty">لا توجد ورديات — أضف مثلًا «صباحي» من 09:00 إلى 17:00</p>') + '</section>';
    }

    function scheduleHtml() {
      var rows = ws.people.map(function (p) {
        var cells = DAYS.map(function (d) { return p.days && p.days[d[0]] ? tplChip(p.days[d[0]]) : '<small>' + (p.days && Object.prototype.hasOwnProperty.call(p.days, d[0]) ? 'راحة' : '—') + '</small>'; });
        return ['<b>' + esc(p.full_name) + '</b><br><small>' + esc([p.code, p.department].filter(Boolean).join(' · ')) + '</small>'].concat(cells, [btn('sched', 'تعديل الجدول', p.id)]);
      });
      return '<section class="wp-detail" data-shifts-schedule><h3>جدول الأسبوع لكل موظف <small>(' + ws.people.length + ')</small></h3>' +
        (rows.length ? U.table(['الموظف'].concat(DAYS.map(function (d) { return d[1]; }), ['']), rows) : '<p class="wn-empty">لا يوجد موظفون</p>') + '</section>';
    }

    function draw() { host.innerHTML = boardHtml() + templatesHtml() + scheduleHtml(); bind(); }

    function bind() {
      var dp = host.querySelector('[data-shifts-day]');
      if (dp) dp.onchange = function () { if (dp.value) { day = dp.value; board = null; load(); } };
      host.querySelectorAll('[data-shifts]').forEach(function (n) {
        n.onclick = function () {
          var a = n.dataset.shifts;
          if (a === 'refresh' || a === 'retry') { if (a === 'retry') board = null; load(); }
          if (a === 'tpl') openTemplate(n.dataset.id);
          if (a === 'sched') openSchedule(n.dataset.id);
        };
      });
    }

    function openTemplate(id) {
      var t = id ? ws.templates.filter(function (x) { return x.id === id; })[0] : null;
      U.modal(t ? 'تعديل وردية' : 'إضافة وردية',
        U.field('name', 'اسم الوردية', 'text', t ? t.name : '', 'required maxlength="40"') + U.field('start_time', 'تبدأ', 'time', t ? t.start_time : '09:00', 'required') + U.field('end_time', 'تنتهي', 'time', t ? t.end_time : '17:00', 'required') +
        U.field('grace_minutes', 'دقائق السماح قبل احتساب التأخير', 'number', t ? t.grace_minutes : 10, 'required min="0" max="120"') + U.field('color', 'اللون', 'color', t ? t.color : '#0F369D') +
        (t ? U.select('active', 'الحالة', [['true', 'مفعّلة'], ['false', 'متوقفة']], String(t.active)) : '') +
        '<p class="wp-wide">إذا كانت النهاية أقل من البداية (مثل 21:00 → 05:00) تُحتسب وردية ليلية تنتهي في اليوم التالي.</p>',
        function (v) {
          var p = { name: v.name, start_time: v.start_time, end_time: v.end_time, grace_minutes: Number(v.grace_minutes), color: v.color };
          if (t) { p.id = t.id; p.active = v.active === 'true'; }
          return U.rpc('hr_shifts_command', { p_action: 'template_save', p_payload: p }).then(function () { return load(true); });
        });
    }

    function openSchedule(pid) {
      var p = ws.people.filter(function (x) { return x.id === pid; })[0]; if (!p) return;
      var opts = [['', 'راحة']].concat(ws.templates.filter(function (t) { return t.active; }).map(function (t) { return [t.id, t.name + ' (' + t.start_time + ' → ' + t.end_time + ')']; }));
      var fill = U.select('fill', 'تعبئة سريعة (كل الأيام ما عدا الجمعة)', [['', '— اختر —']].concat(opts.slice(1)), '');
      var days = DAYS.map(function (d) { return U.select('d' + d[0], d[1], opts, p.days && p.days[d[0]] || ''); }).join('');
      U.modal('جدول ' + p.full_name, fill + days + U.field('valid_from', 'يسري من', 'date', ws.today, 'required') + '<p class="wp-wide">الجدول الجديد يسري من هذا التاريخ ولا يغيّر حضور الأيام السابقة.</p>',
        function (v) {
          var map = {}; DAYS.forEach(function (d) { map[String(d[0])] = v['d' + d[0]] || null; });
          return U.rpc('hr_shifts_command', { p_action: 'schedule_save', p_payload: { person_id: p.id, days: map, valid_from: v.valid_from } }).then(function () { board = null; return load(true); });
        });
      var f = document.querySelector('.wp-overlay [name=fill]');
      if (f) f.onchange = function () { if (!f.value) return; DAYS.forEach(function (d) { var s = document.querySelector('.wp-overlay [name=d' + d[0] + ']'); if (s) s.value = d[0] === 5 ? '' : f.value; }); };
    }

    load();
    timer = setInterval(function () { if (!live()) { stop(); return; } if (isToday()) load(true); }, REFRESH_MS);
  }

  w.SSMPDHRShifts = { mount: mount };
})(window);
