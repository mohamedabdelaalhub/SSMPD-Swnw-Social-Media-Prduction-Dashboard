(function (w) {
  'use strict';
  // «الحضور اللحظي» hub: one page with three inner tabs — «الآن (مباشر)» (hr-presence.js), «الورديات» (hr-shifts.js), «التقارير» (hr-attendance-reports.js).
  // Mounted by hr-navigation.js into the 'presence' section (the old 'shifts' section key is redirected here). Everything is styled under .att-hub (attendance-hub.css).
  var C = w.SSMPDAttCore, esc = C.esc, ico = C.ico;
  var TABS = [['now', 'الآن (مباشر)', 'check', 'SSMPDHRPresence'], ['shifts', 'الورديات', 'cal', 'SSMPDHRShifts'], ['reports', 'التقارير', 'chart', 'SSMPDHRReports']];
  var last = 'now';

  function mount(shell, active, opts) {
    if (!shell || !active) return;
    opts = opts || {};
    var tab = TABS.some(function (t) { return t[0] === opts.tab; }) ? opts.tab : last, badge = 0, liveInfo = null, refreshFn = null;
    var phones = {}; (opts.people || []).forEach(function (p) { if (p && p.id && p.phone) phones[p.id] = p.phone; });
    var root = document.createElement('div');
    root.className = 'att-hub'; root.dataset.attHub = '';
    root.innerHTML = C.sprite() + '<header class="hero"><div class="hero-top"><div><h1>' + ico('check', '') + ' الحضور والانصراف</h1><p data-att-today></p></div><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><div class="live" data-att-live></div>' +
      '<button type="button" class="hbtn" data-att="refresh">' + ico('refresh') + 'تحديث</button></div></div><nav class="tabs-main" role="tablist" data-att-tabs></nav></header><div class="att-panel" data-att-panel></div>';
    shell.append(root);
    var panel = root.querySelector('[data-att-panel]');

    function ago(m) { return m == null ? '—' : C.dur(m); }
    function drawLive() {
      var el = root.querySelector('[data-att-live]'), td = root.querySelector('[data-att-today]');
      var now = liveInfo && liveInfo.now ? new Date(liveInfo.now) : new Date();
      td.textContent = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { timeZone: 'Africa/Cairo', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now) + ' — ' + C.clock(now.toISOString());
      if (!liveInfo) el.innerHTML = '<span class="dot" style="background:#9AA4B5;animation:none"></span><span>جاري الاتصال…</span>';
      else if (liveInfo.stale) el.innerHTML = '<span class="dot" style="background:var(--neg);animation:none"></span><span data-att-stale>الربط متوقف' + (liveInfo.age != null ? ' — آخر اتصال منذ ' + esc(ago(liveInfo.age)) : '') + '</span>';
      else el.innerHTML = '<span class="dot"></span><span>متصل — آخر ' + (liveInfo.hasBeat ? 'نبضة من لاب المركز' : 'استلام من الجهاز') + ' منذ ' + esc(ago(liveInfo.age)) + '</span>';
    }
    function drawTabs() {
      var nav = root.querySelector('[data-att-tabs]');
      nav.innerHTML = TABS.map(function (t) { return '<button type="button" role="tab" data-att-tab="' + t[0] + '" aria-selected="' + (tab === t[0]) + '">' + ico(t[2]) + esc(t[1]) + (t[0] === 'now' && badge ? '<span class="nb" data-att-badge>' + badge + '</span>' : '') + '</button>'; }).join('');
      nav.querySelectorAll('[data-att-tab]').forEach(function (b) { b.onclick = function () { open(b.dataset.attTab); }; });
    }
    var ctx = {
      phones: phones,
      onRefresh: function (fn) { refreshFn = fn; },
      setLive: function (info) { liveInfo = info; drawLive(); },
      setBadge: function (n) { if (n !== badge) { badge = n; drawTabs(); } },
      openTab: function (t) { open(t); }
    };
    function open(t) {
      tab = t; last = t; refreshFn = null; panel.innerHTML = ''; drawTabs();
      var def = TABS.filter(function (x) { return x[0] === t; })[0], mod = w[def[3]];
      if (!mod) { panel.innerHTML = '<div class="att-msg err" role="alert">هذه الشاشة غير محمّلة</div>'; return; }
      mod.mount(panel, true, ctx);
    }
    root.querySelector('[data-att=refresh]').onclick = function () { if (refreshFn) refreshFn(); else open(tab); };
    drawLive(); open(tab);
  }

  w.SSMPDHRAttendance = { mount: mount };
})(window);
