(function (w) {
  'use strict';
  // Shifts («الورديات»): the weekly work times of the administrative staff — shift types and a weekly grid per employee.
  // Server: hr_shifts_workspace / hr_shifts_command (template_save, schedule_save) from migration 20261113100000. Mounted by hr-attendance-hub.js as the second inner tab.
  var C = w.SSMPDAttCore, esc = C.esc, ico = C.ico;
  var DAYS = [[6, 'السبت'], [0, 'الأحد'], [1, 'الاثنين'], [2, 'الثلاثاء'], [3, 'الأربعاء'], [4, 'الخميس'], [5, 'الجمعة']];
  var MIN_REST_MINUTES = 11 * 60, MAX_WEEK_HOURS = 48;
  function safeColor(c) { return /^#[0-9A-Fa-f]{6}$/.test(c || '') ? c : '#0F369D'; }
  function mins(t) { return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)); }
  function shortTime(t) { return t.slice(0, 2) + (t.slice(3, 5) === '00' ? '' : ':' + t.slice(3, 5)); }
  function span(t) { var s = mins(t.start_time), e = mins(t.end_time); return (e <= s ? e + 1440 : e) - s; }

  function mount(shell, active, ctx) {
    if (!shell || !active) return;
    var U = w.SSMPDWorkforceUtils, owner = w.SSMPDAuth && w.SSMPDAuth.currentAdmin && w.SSMPDAuth.currentAdmin.id;
    var ws = null, serial = 0, host = document.createElement('div');
    host.dataset.hrShifts = ''; shell.append(host);
    function live() { return host.isConnected && w.SSMPDAuth.currentAdmin && w.SSMPDAuth.currentAdmin.id === owner; }
    function btn(action, label, id, cls) { return '<button type="button" class="' + (cls || 'btn ghost') + '" data-shifts="' + action + '" data-id="' + esc(id || '') + '">' + esc(label) + '</button>'; }

    function load(quiet) {
      var n = ++serial;
      if (!quiet && !ws) host.innerHTML = '<div class="att-msg" role="status">جاري تحميل الورديات…</div>';
      return U.rpc('hr_shifts_workspace').then(function (r) {
        if (!live() || n !== serial) return;
        ws = r; draw();
      }).catch(function (err) {
        if (!live() || ws) return;
        var missing = /hr_shifts_workspace|404|schema cache/i.test(err.message || '');
        host.innerHTML = '<div class="att-msg err" role="alert">' + esc(missing ? 'الورديات غير مفعّلة بعد على قاعدة البيانات' : err.message) + '</div>' + btn('retry', 'إعادة المحاولة');
        bind();
      });
    }
    function tpl(id) { return ws.templates.filter(function (x) { return x.id === id; })[0]; }
    function chipStyle(t) { var c = safeColor(t.color); return 'background:' + c + '1f;color:' + c; }

    function warnChips() {
      var out = [];
      ws.people.forEach(function (p) {
        for (var i = 0; i < 6; i++) {
          var a = tpl(p.days && p.days[DAYS[i][0]]), b = tpl(p.days && p.days[DAYS[i + 1][0]]); if (!a || !b) continue;
          var endA = mins(a.end_time) <= mins(a.start_time) ? mins(a.end_time) + 1440 : mins(a.end_time);
          if (mins(b.start_time) + 1440 - endA < MIN_REST_MINUTES) out.push('<div class="sch warn" data-shifts-conflict>' + ico('clock') + '<span><b>' + esc(p.full_name) + ':</b> ' + esc(a.name) + ' ' + esc(DAYS[i][1]) + ' ثم ' + esc(b.name) + ' ' + esc(DAYS[i + 1][1]) + ' (راحة أقل من 11 ساعة)</span></div>');
        }
      });
      if (!out.length) out.push('<div class="sch ok" data-shifts-ok>' + ico('ok') + '<span>الجدول متوازن: لا تعارض راحة بين الورديات</span></div>');
      return out.slice(0, 5).join('');
    }
    function bannerHtml() {
      var scheduled = ws.people.filter(function (p) { return p.days && Object.keys(p.days).length; }).length, unscheduled = ws.people.length - scheduled;
      if (!ws.templates.length || !scheduled) return '<div class="banner" data-shifts-empty>' + ico('bulb') + '<div style="flex:1;min-width:220px"><b>الجدول هو أساس معرفة «الغايب» و«المتأخر»</b><span style="color:var(--muted);font-size:13.5px">لم تُحدَّد ورديات بعد — أضف وردية (مثلًا «صباحي» من 09:00 إلى 17:00) ثم حدّد أيام عمل كل موظف من الجدول ليظهر من وصل في ميعاده ومن تأخر.</span></div>' + btn('tpl', 'إضافة وردية', '', 'btn') + '</div>';
      if (unscheduled) return '<div class="banner" data-shifts-unscheduled>' + ico('warn') + '<div style="flex:1;min-width:220px"><b>' + unscheduled + ' موظف بدون جدول ورديات</b><span style="color:var(--muted);font-size:13.5px">لا يظهرون في الغياب والتأخير حتى يُحدَّد جدولهم. اضغط على اسم الموظف في الجدول.</span></div></div>';
      return '';
    }
    function gridHtml() {
      var tIdx = DAYS.map(function (d) { return d[0]; }).indexOf(new Date(ws.today + 'T12:00:00Z').getUTCDay());
      var dayLabel = function (i) { var d = new Date(ws.today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + i - tIdx); return d.getUTCDate() + '/' + (d.getUTCMonth() + 1); };
      var groups = {}, order = [];
      ws.people.forEach(function (p) { var d = C.dept(p.department); if (!groups[d.id]) { groups[d.id] = { d: d, p: [] }; order.push(d.id); } groups[d.id].p.push(p); });
      var rows = order.map(function (k) {
        var g = groups[k], d = g.d;
        return '<tr data-shifts-dept><td class="n" style="background:' + esc(d.tint) + ';color:' + esc(d.col) + ';font-weight:700">' + ico(d.icon) + ' ' + esc(d.name) + '</td>' + DAYS.map(function () { return '<td style="background:' + esc(d.tint) + '"></td>'; }).join('') + '<td style="background:' + esc(d.tint) + '"></td></tr>' +
          g.p.map(function (p) {
            var hours = 0;
            var cells = DAYS.map(function (dy, i) {
              var has = p.days && Object.prototype.hasOwnProperty.call(p.days, dy[0]), t = has ? tpl(p.days[dy[0]]) : null;
              if (t) hours += span(t) / 60;
              var b = t ? '<button type="button" class="sc" style="' + chipStyle(t) + '" data-shifts="sched" data-id="' + esc(p.id) + '" title="' + esc(t.name) + '">' + esc(t.name) + ' <span class="ltr">' + esc(shortTime(t.start_time) + '–' + shortTime(t.end_time)) + '</span></button>'
                : '<button type="button" class="sc sc-off" data-shifts="sched" data-id="' + esc(p.id) + '">' + (has ? 'راحة' : '—') + '</button>';
              return '<td class="' + (i === tIdx ? 'today' : '') + '">' + b + '</td>';
            }).join('');
            return '<tr data-shifts-person><td class="n"><button type="button" data-shifts="sched" data-id="' + esc(p.id) + '" style="border:0;background:none;padding:0;text-align:start"><b>' + esc(p.full_name) + '</b></button> <small style="color:var(--muted)">' + esc([p.code, p.job_title].filter(Boolean).join(' · ')) + '</small></td>' + cells +
              '<td><b style="color:' + (hours > MAX_WEEK_HOURS ? 'var(--neg)' : 'var(--dark)') + '">' + Math.round(hours * 10) / 10 + '</b> <small style="color:var(--muted)">س</small>' + (hours > MAX_WEEK_HOURS ? '<br><small style="color:var(--neg)">فوق ' + MAX_WEEK_HOURS + '</small>' : '') + '</td></tr>';
          }).join('');
      }).join('');
      var cov = '<tr class="covrow"><td class="n"><b>التغطية</b></td>' + DAYS.map(function (dy) {
        var c = {}; ws.people.forEach(function (p) { var id = p.days && p.days[dy[0]]; if (id) c[id] = (c[id] || 0) + 1; });
        return '<td>' + ws.templates.filter(function (t) { return c[t.id]; }).map(function (t) { return '<span class="cv ok">' + esc(t.name) + ' ' + c[t.id] + '</span>'; }).join('') + '</td>';
      }).join('') + '<td></td></tr>';
      return '<div class="card scroll" style="padding:0" data-shifts-schedule><table class="sg"><thead><tr><th style="text-align:start;padding-inline:10px">الموظف <small>(' + ws.people.length + ')</small></th>' + DAYS.map(function (d, i) { return '<th class="' + (i === tIdx ? 'today' : '') + '">' + d[1] + '<br><small>' + dayLabel(i) + '</small></th>'; }).join('') + '<th>ساعات الأسبوع</th></tr></thead><tbody>' +
        (ws.people.length ? rows + cov : '<tr><td colspan="9" class="empty">لا يوجد موظفون</td></tr>') + '</tbody></table></div>';
    }
    function templatesHtml() {
      var rows = ws.templates.map(function (t) {
        var c = safeColor(t.color);
        return '<div class="tpl-row" data-shifts-tpl><span class="tpl-sw" style="background:' + c + '">' + esc(shortTime(t.start_time)) + '</span><div class="nm"><span class="t">' + esc(t.name) + (t.active ? '' : ' <small>(متوقفة)</small>') + '</span><small><span class="ltr">' + esc(t.start_time + ' → ' + t.end_time) + '</span>' + (t.overnight ? ' (تعبر منتصف الليل)' : '') + ' · سماح ' + esc(t.grace_minutes) + ' د</small></div>' + btn('tpl', 'تعديل', t.id, 'mini') + '</div>';
      }).join('');
      return '<section class="card" style="margin-top:14px" data-shifts-templates><h4>' + ico('clock') + 'أنواع الورديات <small style="color:var(--muted);font-weight:400">(' + ws.templates.length + ')</small><span style="margin-inline-start:auto">' + btn('tpl', 'إضافة وردية', '', 'mini solid') + '</span></h4>' +
        (rows || '<div class="empty">لا توجد ورديات — أضف مثلًا «صباحي» من 09:00 إلى 17:00</div>') + '</section>';
    }
    function draw() {
      var legend = ws.templates.filter(function (t) { return t.active; }).map(function (t) { return '<span class="pill" style="' + chipStyle(t) + '">' + esc(t.name) + ' <span class="ltr">' + esc(shortTime(t.start_time) + '–' + shortTime(t.end_time)) + '</span></span>'; }).join('');
      host.innerHTML = bannerHtml() + '<div class="strip" style="margin:0 0 14px">' + warnChips() + '</div>' +
        '<div class="bar" style="margin-bottom:14px"><div class="legend" style="margin:0">' + legend + '<span class="pill p-out">راحة</span></div><span style="margin-inline-start:auto;color:var(--muted);font-size:13px">اضغط على أي خانة أو اسم لتعديل جدول الموظف</span></div>' + gridHtml() + templatesHtml();
      bind();
    }
    function bind() {
      host.querySelectorAll('[data-shifts]').forEach(function (n) {
        n.onclick = function () {
          var a = n.dataset.shifts;
          if (a === 'retry') { ws = null; load(); }
          if (a === 'tpl') openTemplate(n.dataset.id);
          if (a === 'sched') openSchedule(n.dataset.id);
        };
      });
    }

    function openTemplate(id) {
      var t = id ? tpl(id) : null;
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
          return U.rpc('hr_shifts_command', { p_action: 'schedule_save', p_payload: { person_id: p.id, days: map, valid_from: v.valid_from } }).then(function () { return load(true); });
        });
      var f = document.querySelector('.wp-overlay [name=fill]');
      if (f) f.onchange = function () { if (!f.value) return; DAYS.forEach(function (d) { var s = document.querySelector('.wp-overlay [name=d' + d[0] + ']'); if (s) s.value = d[0] === 5 ? '' : f.value; }); };
    }

    if (ctx && ctx.onRefresh) ctx.onRefresh(function () { return load(); });
    load();
  }

  w.SSMPDHRShifts = { mount: mount };
})(window);
