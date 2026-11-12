(function (w) {
  'use strict';
  // Live presence (الحضور الآن): who is in the center right now, from the fingerprint device. Server: hr_presence_snapshot / hr_presence_map (migration 20261112100000).
  // Mounted by hr-navigation.js into the «الحضور الآن» section; it loads only when that section is the open one and refreshes every 15 seconds while it stays open.
  var STATE = { in: 'حاضر', break: 'في استراحة', out: 'انصرف', none: 'لم يبصم' };
  var STALE_MINUTES = 5, LONG_IN_MINUTES = 14 * 60, REFRESH_MS = 15000;
  function esc(v) { return w.SSMPDWorkforceUtils.escape(v); }
  function clock(iso) {
    if (!iso) return '—';
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
  }
  function day(iso) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  }
  function when(iso, nowIso) {
    if (!iso) return '—';
    var sameDay = day(iso) === day(nowIso);
    return (sameDay ? '' : day(iso).slice(5) + ' ') + clock(iso);
  }
  function span(minutes) {
    if (minutes == null || minutes < 0) return '—';
    if (minutes < 1) return 'الآن';
    var h = Math.floor(minutes / 60), m = minutes % 60;
    return h ? h + ' س ' + (m ? m + ' د' : '') : m + ' د';
  }
  function minutesBetween(a, b) { return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 60000); }
  function btn(action, label, id) { return '<button type="button" class="btn ghost" data-presence="' + action + '" data-id="' + esc(id || '') + '">' + esc(label) + '</button>'; }

  function mount(shell, active) {
    if (!shell || !active) return;
    var U = w.SSMPDWorkforceUtils, owner = w.SSMPDAuth && w.SSMPDAuth.currentAdmin && w.SSMPDAuth.currentAdmin.id, data = null, serial = 0, timer = null;
    var host = document.createElement('div');
    host.dataset.hrPresence = '';
    shell.append(host);
    function live() { return host.isConnected && w.SSMPDAuth.currentAdmin && w.SSMPDAuth.currentAdmin.id === owner; }
    function stop() { if (timer) { clearInterval(timer); timer = null; } }

    function load(quiet) {
      var n = ++serial;
      if (!quiet && !data) host.innerHTML = '<p role="status">جاري تحميل الحضور…</p>';
      return U.rpc('hr_presence_snapshot', { p_lookback_hours: 16 }).then(function (d) {
        if (!live() || n !== serial) return;
        data = d; draw();
      }).catch(function (err) {
        if (!live()) { stop(); return; }
        if (data) return; // keep the last good picture on screen; the freshness card tells how old it is
        var missing = /hr_presence_snapshot|404|schema cache/i.test(err.message || '');
        host.innerHTML = '<p role="alert">' + esc(missing ? 'الحضور اللحظي غير مفعّل بعد على قاعدة البيانات' : err.message) + '</p>' + btn('retry', 'إعادة المحاولة');
        bind();
      });
    }

    function personRow(r, kind) {
      var name = r.mapped ? '<b>' + esc(r.full_name) + '</b><br><small>' + esc([r.code, r.department, r.job_title].filter(Boolean).join(' · ')) + '</small>'
        : '<b>رقم الجهاز ' + esc(r.device_user_id) + '</b><br><small>غير مربوط بموظف</small>';
      if (kind === 'in') {
        var mins = r.last_in_at ? minutesBetween(r.last_in_at, data.now) : null;
        var warn = mins != null && mins > LONG_IN_MINUTES ? '<br><small data-presence-warn>مدة طويلة جدًا — تحقق من بصمة الخروج</small>' : '';
        return [name, STATE[r.state] || '', when(r.last_in_at, data.now), span(mins) + warn, data.can_manage ? btn('map', r.mapped ? 'تغيير الربط' : 'ربط', r.device_user_id + '|' + r.device_id) : ''];
      }
      if (kind === 'out') return [name, when(r.last_punch_at, data.now), span(r.minutes_since), data.can_manage ? btn('map', r.mapped ? 'تغيير الربط' : 'ربط', r.device_user_id + '|' + r.device_id) : ''];
      return [name, data.can_manage ? btn('map', 'تغيير الربط', r.device_user_id + '|' + r.device_id) : ''];
    }

    function section(title, count, headers, rows, empty) {
      return '<section class="wp-detail" data-presence-section><h3>' + esc(title) + ' <small>(' + count + ')</small></h3>' +
        (rows.length ? U.table(headers, rows) : '<p class="wn-empty">' + esc(empty) + '</p>') + '</section>';
    }

    function draw() {
      var rows = data.rows || [];
      var inside = rows.filter(function (r) { return r.state === 'in' || r.state === 'break'; });
      var left = rows.filter(function (r) { return r.state === 'out'; });
      var absent = rows.filter(function (r) { return r.state === 'none' && r.mapped; });
      var unmapped = rows.filter(function (r) { return !r.mapped; });
      // The link is judged by the agent's heartbeat (last_seen_at), not by the last punch: no punches for an hour is normal, a silent link is not.
      // Older servers without the heartbeat fall back to the last received punch.
      var hasBeat = !!data.last_seen_at, linkAt = hasBeat ? data.last_seen_at : data.last_received_at;
      var feedAge = linkAt ? minutesBetween(linkAt, data.now) : null;
      var stale = feedAge == null || feedAge > STALE_MINUTES;
      var lastPunch = data.last_received_at ? 'آخر بصمة وصلت: ' + when(data.last_received_at, data.now) + ' (منذ ' + span(minutesBetween(data.last_received_at, data.now)) + ')' : 'لم تصل بصمات بعد';
      var fresh = '<div class="wp-card" data-presence-feed' + (stale ? ' data-stale' : '') + '><b>' + (hasBeat ? 'آخر اتصال من لاب المركز' : 'آخر استلام من جهاز البصمة') + '</b><span>' +
        (linkAt ? esc(when(linkAt, data.now)) + ' (منذ ' + esc(span(feedAge)) + ')' : 'لم يصل شيء بعد') + '</span>' +
        (hasBeat ? '<small data-presence-lastpunch>' + esc(lastPunch) + '</small>' : '') +
        (stale ? '<small role="alert">الربط متوقف أو متأخر — الأسماء قد لا تعكس الوضع الحالي</small>' : '') + '</div>';
      host.innerHTML = '<div class="wp-grid" data-presence-cards>' +
        '<div class="wp-card"><b>موجودون الآن</b><span>' + inside.length + '</span></div>' +
        '<div class="wp-card"><b>انصرفوا (آخر ' + esc(data.lookback_hours) + ' ساعة)</b><span>' + left.length + '</span></div>' +
        '<div class="wp-card"><b>أرقام غير مربوطة</b><span>' + unmapped.length + '</span></div>' + fresh + '</div>' +
        '<p><button type="button" class="btn ghost" data-presence="refresh">تحديث الآن</button></p>' +
        section('موجودون الآن', inside.length, ['الموظف', 'الحالة', 'دخل الساعة', 'المدة', ''], inside.map(function (r) { return personRow(r, 'in'); }), 'لا أحد مسجّل حاضرًا حاليًا') +
        section('انصرفوا', left.length, ['الموظف', 'آخر بصمة', 'منذ', ''], left.map(function (r) { return personRow(r, 'out'); }), 'لا توجد انصرافات في الفترة') +
        (unmapped.length ? section('أرقام على الجهاز غير مربوطة بموظف', unmapped.length, ['رقم الجهاز', 'آخر بصمة', 'منذ', ''], unmapped.map(function (r) { return personRow(r, 'out'); }), '') : '') +
        (absent.length ? section('مربوطون ولم يبصموا', absent.length, ['الموظف', ''], absent.map(function (r) { return personRow(r, 'none'); }), '') : '');
      bind();
    }

    function bind() {
      host.querySelectorAll('[data-presence]').forEach(function (n) {
        n.onclick = function () {
          var a = n.dataset.presence;
          if (a === 'refresh' || a === 'retry') { data = a === 'retry' ? null : data; load(); return; }
          if (a === 'map') openMap(n.dataset.id);
        };
      });
    }

    function openMap(key) {
      var parts = String(key).split('|'), uid = Number(parts[0]), dev = parts.slice(1).join('|');
      var row = (data.rows || []).filter(function (r) { return r.device_user_id === uid && r.device_id === dev; })[0] || {};
      var options = [['', 'بدون ربط (إزالة)']].concat((data.people || []).map(function (p) { return [p.id, p.full_name + ' — ' + p.code]; }));
      U.modal('ربط رقم الجهاز ' + uid + ' بموظف',
        U.select('person', 'الموظف', options, row.person_id || '') +
        '<p class="wp-wide">يظهر هذا الرقم باسم الموظف في «الحضور الآن». يمكنك تغيير الربط أو إزالته في أي وقت.</p>',
        function (v) {
          return U.rpc('hr_presence_map', { p_device_id: dev, p_device_user_id: uid, p_person_id: v.person || null }).then(function () { return load(true); });
        });
    }

    load();
    timer = setInterval(function () { if (!live()) { stop(); return; } load(true); }, REFRESH_MS);
  }

  w.SSMPDHRPresence = { mount: mount };
})(window);
