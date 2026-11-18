/* «الملخص العام» v2 (owner-approved mockup docs/ui-references/mockups/summary.html, 2026-11-18).
   One page instead of two stacked dashboards: «محتاج منك» first, KPI tiles 4/2/1 (only those with real data),
   «رحلة المحتوى», social trend, ads campaigns as cards, «نظرة على باقي المركز».
   «ذكاء الإدارة» (business-intelligence*.js) and the original summary sections (archives, comparisons, imports,
   bank expenses) stay complete inside two folded sections. Nothing is estimated: a tile or row without data is hidden. */
(function (w) {
  'use strict';
  var BASE = w.SSMPDRenderSummaryBase;
  if (!BASE) return;
  var MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  var PERIODS = [['today', 'اليوم'], ['week', 'الأسبوع'], ['month', 'الشهر']];
  var S = { period: 'week', specialty: '' }, token = 0;
  var DAY = 864e5;

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v, d) { return Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d == null ? 1 : d }); }
  function t(v) { var x = v ? new Date(v).getTime() : NaN; return isNaN(x) ? null : x; }
  function cairo(d) { var o = {}; new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d).forEach(function (x) { o[x.type] = x.value; }); return o; }
  function fmtDay(v) { var x = t(v); if (x == null) return ''; var p = cairo(new Date(x)); return Number(p.day) + ' ' + MONTHS[Number(p.month) - 1]; }
  function fmtStamp(d) { var p = cairo(d), h = Number(p.hour) % 24; return Number(p.day) + ' ' + MONTHS[Number(p.month) - 1] + ' ' + p.year + ' · ' + (h % 12 || 12) + ':' + p.minute + ' ' + (h < 12 ? 'ص' : 'م'); }
  function ago(ms) { var h = Math.floor(ms / 36e5); if (h < 1) return 'أقل من ساعة'; if (h < 24) return h === 1 ? 'ساعة' : h === 2 ? 'ساعتين' : h + ' ساعات'; var d = Math.floor(h / 24); return d === 1 ? 'يوم' : d === 2 ? 'يومين' : d + ' أيام'; }
  function role(list) { var a = w.SSMPDAuth && w.SSMPDAuth.currentAdmin; return !!(a && w.SSMPDRoles && w.SSMPDRoles.hasAnyRole(a, list)); }
  function canTab(tab) { var a = w.SSMPDAuth && w.SSMPDAuth.currentAdmin; return !!(a && w.SSMPDRoles && w.SSMPDRoles.canSeeTab && w.SSMPDRoles.canSeeTab(a, tab)); }
  function sound(k) { if (w.SSMPDMotion && w.SSMPDMotion.sound) w.SSMPDMotion.sound(k || 'tap'); }
  function ico(n) {
    var P = {
      alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.5"/>', check: '<path d="m5 12 4 4 10-10"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
      bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3Z"/>', task: '<path d="M9 11l2 2 4-4"/><rect x="4" y="4" width="16" height="16" rx="3"/>',
      doc: '<path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h5"/>', user: '<path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6"/><circle cx="12" cy="8" r="4"/>', mega: '<path d="M3 11v2a2 2 0 0 0 2 2h2l5 4V5L7 9H5a2 2 0 0 0-2 2Z"/><path d="M16 9a4 4 0 0 1 0 6"/>',
      refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>', chev: '<path d="m14 6-6 6 6 6"/>', down: '<path d="m6 9 6 6 6-6"/>'
    };
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + P[n] + '</svg>';
  }
  // period windows (Cairo calendar day for «اليوم», 7 days for «الأسبوع», calendar month for «الشهر»), plus the one before
  function windows(now) {
    var p = cairo(new Date(now)), midnight = now - ((Number(p.hour) % 24) * 60 + Number(p.minute)) * 6e4;
    if (S.period === 'today') return { from: midnight, prevFrom: midnight - DAY, prevTo: midnight };
    if (S.period === 'month') { var start = midnight - (Number(p.day) - 1) * DAY, len = now - start; return { from: start, prevFrom: start - Math.max(len, DAY), prevTo: start }; }
    return { from: now - 7 * DAY, prevFrom: now - 14 * DAY, prevTo: now - 7 * DAY };
  }
  function lastAt(i, stage) { var h = Array.isArray(i.stage_history) ? i.stage_history : [], at = null; h.forEach(function (x) { if (!stage || x.stage === stage) at = x.at; }); return t(at) || t(i.updated_at); }

  function shell() {
    return '<section class="sv" data-summary-v2 dir="rtl">' +
      '<div class="sv-ph"><div><h2>الملخص العام</h2><div class="sv-sub" data-sv-stamp>بيحمّل…</div></div>' +
      '<div class="sv-acts"><div class="sv-seg" role="group" aria-label="الفترة">' + PERIODS.map(function (p) { return '<button type="button" data-sv-period="' + p[0] + '" aria-pressed="' + (S.period === p[0]) + '">' + p[1] + '</button>'; }).join('') + '</div>' +
      '<button type="button" class="sv-ib" data-sv-refresh aria-label="تحديث" title="تحديث">' + ico('refresh') + '</button></div></div>' +
      '<div data-sv-body><div class="loading">بيحمّل الملخص…</div></div>' +
      (role(['general_manager', 'super_admin']) ? '<details class="sv-fold" data-sv-bi><summary><b>ذكاء الإدارة</b><small>التوصيات والقرارات وذاكرة المشروع</small>' + ico('down') + '</summary><div class="sv-fold-body" data-sv-bi-body></div></details>' : '') +
      '<details class="sv-fold" data-sv-more><summary><b>كل التفاصيل والأرشيف</b><small>أرشيف السوشيال والإعلانات والمقارنات والاستيراد ومصروفات البنك</small>' + ico('down') + '</summary><div class="sv-fold-body" data-sv-legacy></div></details>' +
      '</section>';
  }

  function load() {
    var manager = role(['general_manager', 'super_admin']), db = w.SSMPDDb;
    function soft(p) { return p.then(function (x) { return x; }, function () { return null; }); }
    return Promise.all([
      db.listContentItems({}),
      soft(db.listWeeklyMetrics(500)),
      soft(db.listAdCampaigns()),
      manager ? soft(db.getLeadsStats({})) : null,
      manager ? soft(db.listLeads({ status: 'new', page_size: 50 })) : null,
      manager ? soft(db.getPatientArchiveStats()) : null,
      manager ? soft(db.getAppSettings()) : null,
      manager && db.client && db.client.rpc ? soft(db.client.rpc('business_owner_snapshot', { p_period: S.period }).then(function (r) { if (r.error) throw r.error; return r.data; })) : null
    ]).then(function (r) { return { items: r[0] || [], metrics: r[1] || [], ads: r[2] || [], leadsStats: r[3], newLeads: (r[4] && r[4].leads) || [], patients: r[5], settings: r[6] || {}, snap: r[7] || null, manager: manager }; });
  }

  // ---------- «محتاج منك» ----------
  function needs(D, now) {
    var out = [], st = D.settings, contentSla = (st.content_sla_hours || 48) * 36e5, leadSla = (st.leads_sla_hours || 24) * 36e5;
    if (D.manager) {
      var late = D.newLeads.filter(function (l) { var x = t(l.created_at); return x != null && now - x > leadSla; });
      if (late.length) { var oldest = Math.min.apply(null, late.map(function (l) { return t(l.created_at); })); out.push({ p: 1, c: 'neg', ic: 'alert', go: 'leads', n: late.length, b: (late.length === 1 ? 'ليد مستني رد' : late.length === 2 ? 'ليدين مستنيين رد' : late.length + ' ليدز مستنيين رد'), s: 'أقدم واحد من ' + ago(now - oldest) }); }
      ((D.snap && D.snap.alerts) || []).forEach(function (a) { out.push({ p: a.severity === 'high' || a.severity === 'critical' ? 1 : 4, c: a.severity === 'high' || a.severity === 'critical' ? 'neg' : 'mute', ic: 'alert', bi: 'overview', b: a.title, s: a.detail }); });
    }
    if (role(['approver', 'general_manager', 'super_admin'])) {
      var wait = D.items.filter(function (i) { return i.stage === 'initial_approval' || i.stage === 'final_approval'; });
      if (wait.length) {
        var ini = wait.filter(function (i) { return i.stage === 'initial_approval'; }).length, fin = wait.length - ini;
        var overdue = wait.filter(function (i) { var x = lastAt(i, i.stage); return x != null && now - x > contentSla; }).length;
        out.push({ p: overdue ? 1 : 2, c: overdue ? 'warn' : 'blue', ic: 'check', go: 'review', n: wait.length, b: (wait.length === 1 ? 'مادة مستنية اعتمادك' : wait.length + ' مواد مستنية اعتمادك'), s: [ini ? ini + ' اعتماد أولي' : '', fin ? fin + ' اعتماد نهائي' : '', overdue ? overdue + ' متأخرة' : ''].filter(Boolean).join(' · ') });
      }
      var stuck = D.items.filter(function (i) { var x = lastAt(i, 'in_design'); return i.stage === 'in_design' && x != null && now - x > 3 * DAY; });
      if (stuck.length) { var o = Math.min.apply(null, stuck.map(function (i) { return lastAt(i, 'in_design'); })); out.push({ p: 3, c: 'warn', ic: 'clock', go: 'review', n: stuck.length, b: stuck.length === 1 ? 'مادة واقفة في التصميم' : stuck.length + ' مواد واقفة في التصميم', s: 'أقدمها من ' + ago(now - o) + (stuck.length === 1 && stuck[0].title ? ' · «' + stuck[0].title + '»' : '') }); }
    }
    if (D.manager && D.snap) {
      var rec = (D.snap.recommendations || {}).pending;
      if (rec) out.push({ p: 4, c: 'mute', ic: 'bulb', bi: 'recommendations', n: rec, b: rec === 1 ? 'توصية مستنية قرارك' : rec + ' توصيات مستنية قرارك', s: 'ذكاء الإدارة' });
      var od = (D.snap.tasks || {}).overdue;
      if (od && canTab('tasks')) out.push({ p: 3, c: 'warn', ic: 'task', go: 'tasks', n: od, b: od === 1 ? 'مهمة متأخرة' : od + ' مهام متأخرة', s: 'المهام' });
    }
    return out.sort(function (a, b) { return a.p - b.p; });
  }
  function needHtml(list) {
    var body = list.length ? '<ul class="sv-need-list">' + list.map(function (x, i) {
      return '<li><button type="button" class="sv-row c-' + x.c + '" data-sv-need="' + i + '"' + (x.go ? ' data-sv-go="' + x.go + '"' : '') + (x.bi ? ' data-sv-bi-view="' + x.bi + '"' : '') + '><span class="sv-ic">' + ico(x.ic) + '</span><span class="sv-tx"><b>' + esc(x.b) + '</b>' + (x.s ? '<small>' + esc(x.s) + '</small>' : '') + '</span>' + (x.n ? '<em>' + num(x.n) + '</em>' : '') + '<span class="sv-ar">' + ico('chev') + '</span></button></li>';
    }).join('') + '</ul>' : '<p class="sv-calm" data-sv-calm>' + ico('check') + ' مفيش حاجة مستنياك دلوقتي</p>';
    return '<section class="sv-card sv-need" data-sv-need-card><div class="sv-ch"><div><h3>محتاج منك</h3><small>' + (list.length ? 'مرتبة حسب الأهمية — دوس على أي سطر يفتحلك مكانه' : 'كل حاجة ماشية') + '</small></div></div>' + body + '</section>';
  }

  // ---------- KPI tiles ----------
  function spark(vals, col) {
    if (!vals || vals.length < 2 || !vals.some(function (v) { return v > 0; })) return '';
    var mx = Math.max.apply(null, vals) || 1, step = 200 / (vals.length - 1), pts = vals.map(function (v, i) { return [Math.round(i * step * 10) / 10, Math.round((42 - v / mx * 34) * 10) / 10]; });
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0] + ' ' + p[1]; }).join(' '), last = pts[pts.length - 1];
    return '<svg class="sv-sp" viewBox="0 0 200 46" preserveAspectRatio="none" style="--c:' + col + '" data-sv-spark><path class="a" d="' + d + ' L200 46 L0 46Z"/><path class="l" d="' + d + '"/><circle cx="' + last[0] + '" cy="' + last[1] + '" r="3.5"/></svg>';
  }
  function tiles(D, now, W) {
    var out = [], pubIn = function (a, b) { return D.items.filter(function (i) { var x = t(i.published_at) || (i.stage === 'published' ? lastAt(i, 'published') : null); return x != null && x >= a && x < b; }).length; };
    var cur = pubIn(W.from, now + 1), prev = pubIn(W.prevFrom, W.prevTo), daily = [];
    for (var k = 13; k >= 0; k--) daily.push(pubIn(now - (k + 1) * DAY, now - k * DAY));
    var diff = cur - prev;
    out.push({ go: 'review', c: '#0F369D', bg: '#E8EEFB', ic: 'doc', label: 'اتنشر', val: num(cur), unit: cur === 1 ? 'مادة' : 'مواد', sub: diff ? (diff > 0 ? '↑ ' : '↓ ') + num(Math.abs(diff)) + ' عن الفترة اللي فاتت' : 'زي الفترة اللي فاتت', cls: diff > 0 ? 'up' : diff < 0 ? 'dn' : '', extra: spark(daily, '#0F369D') });
    if (role(['approver', 'general_manager', 'super_admin'])) {
      var wait = D.items.filter(function (i) { return i.stage === 'initial_approval' || i.stage === 'final_approval'; });
      var oldest = wait.length ? Math.min.apply(null, wait.map(function (i) { return lastAt(i, i.stage) || now; })) : null;
      out.push({ go: 'review', c: '#B86200', bg: '#FFF1DF', ic: 'check', label: 'مستني الاعتماد', val: num(wait.length), unit: wait.length === 1 ? 'مادة' : 'مواد', sub: oldest ? 'أقدمها من ' + ago(now - oldest) : 'مفيش حاجة مستنية', cls: '' });
    }
    var L = D.snap && D.snap.leads;
    if (D.manager && L && L.total != null) out.push({ go: canTab('leads') ? 'leads' : '', c: '#3E8F68', bg: '#EAF6F0', ic: 'user', label: 'ليدز جديدة', val: num(L.total), unit: '', sub: 'اتحجز ' + num(L.booked) + (L.conversion != null ? ' · تحويل \u2066' + num(L.conversion) + '%\u2069' : ''), cls: '' });
    var B = latestBatch(D.ads);
    if (B) out.push({ go: canTab('metaads') ? 'metaads' : '', more: !canTab('metaads'), c: '#4A6FD0', bg: '#EAF0FC', ic: 'mega', label: 'إنفاق الإعلانات', val: num(B.spent, 2), unit: 'ج', sub: 'آخر تقرير · ' + fmtDay(B.createdAt), cls: '' });
    return out;
  }
  function tilesHtml(list) {
    return '<section class="sv-kpis" data-n="' + list.length + '">' + list.map(function (k) {
      return '<button type="button" class="sv-k" style="--c:' + k.c + ';--t:' + k.bg + '"' + (k.go ? ' data-sv-go="' + k.go + '"' : k.more ? ' data-sv-open-more' : ' disabled') + '><span class="sv-ic">' + ico(k.ic) + '</span><small>' + esc(k.label) + '</small><b><bdi data-sv-count>' + esc(k.val) + '</bdi>' + (k.unit ? '<u>' + esc(k.unit) + '</u>' : '') + '</b><i class="' + k.cls + '">' + esc(k.sub) + '</i>' + (k.extra || '') + '</button>';
    }).join('') + '</section>';
  }

  // ---------- رحلة المحتوى ----------
  function journeyHtml(D, now, W) {
    var WF = w.SSMPDWorkflow, items = S.specialty ? D.items.filter(function (i) { return i.specialty === S.specialty; }) : D.items;
    var sla = (D.settings.content_sla_hours || 48) * 36e5, rows = [];
    var COL = { idea_selection: '#9AA8C7', initial_approval: '#7D93CF', in_design: '#5B7BD6', final_approval: '#4A6FD0', needs_revision: '#FF8800', ready_to_publish: '#3F62C4', scheduled: '#2B4DAF' };
    (WF.STAGES || []).forEach(function (s) {
      if (s.key === 'published') return;
      var list = items.filter(function (i) { return i.stage === s.key; });
      var warn = list.some(function (i) { var x = lastAt(i, s.key); if (x == null) return false; return s.key === 'in_design' ? now - x > 3 * DAY : (s.key === 'initial_approval' || s.key === 'final_approval') ? now - x > sla : false; });
      rows.push({ key: s.key, label: s.label, n: list.length, col: COL[s.key] || '#4A6FD0', warn: warn });
    });
    var pub = items.filter(function (i) { var x = t(i.published_at) || (i.stage === 'published' ? lastAt(i, 'published') : null); return x != null && x >= W.from; });
    rows.push({ key: 'published', label: 'اتنشر في الفترة', n: pub.length, col: '#6CC49A', warn: false });
    rows = rows.filter(function (r) { return r.n > 0; });
    var mx = Math.max.apply(null, rows.map(function (r) { return r.n; }).concat([1]));
    var specs = Object.keys(WF.SPECIALTIES || {}).filter(function (k) { return D.items.some(function (i) { return i.specialty === k; }); });
    // average journey (created → published) and the slowest stage, from stage_history of what was published in the period
    var foot = '';
    if (pub.length) {
      var tot = 0, cnt = 0, per = {};
      pub.forEach(function (i) {
        var a = t(i.created_at), b = t(i.published_at) || lastAt(i, 'published'); if (a != null && b != null && b >= a) { tot += b - a; cnt++; }
        var h = Array.isArray(i.stage_history) ? i.stage_history : [];
        for (var j = 0; j < h.length - 1; j++) { var x = t(h[j].at), y = t(h[j + 1].at); if (x != null && y != null && y >= x && h[j].stage !== 'published') { per[h[j].stage] = per[h[j].stage] || [0, 0]; per[h[j].stage][0] += y - x; per[h[j].stage][1]++; } }
      });
      var slow = Object.keys(per).sort(function (a, b) { return per[b][0] / per[b][1] - per[a][0] / per[a][1]; })[0];
      var lbl = slow && (WF.STAGES || []).filter(function (s) { return s.key === slow; })[0];
      var avg = cnt ? tot / cnt : 0;
      foot = (cnt ? '<span>متوسط وقت الرحلة <b>' + (avg >= DAY ? num(avg / DAY, 1) + ' يوم' : ago(avg)) + '</b></span>' : '') + (lbl && Object.keys(per).length > 1 && per[slow][0] > 0 ? '<span>أطول مرحلة <b>' + esc(lbl.label) + '</b></span>' : '');
    }
    var anyWarn = rows.some(function (r) { return r.warn; });
    return '<section class="sv-card sv-span2" data-sv-journey><div class="sv-ch"><div><h3>رحلة المحتوى</h3><small>كل مادة فين دلوقتي — دوس على مرحلة تفتح إدارة المحتوى</small></div>' + (canTab('review') ? '<button type="button" class="sv-lnk" data-sv-go="review">إدارة المحتوى</button>' : '') + '</div>' +
      (specs.length ? '<div class="sv-chips" role="group" aria-label="التخصص"><button type="button" data-sv-spec="" aria-pressed="' + !S.specialty + '">كل التخصصات</button>' + specs.map(function (k) { return '<button type="button" data-sv-spec="' + esc(k) + '" aria-pressed="' + (S.specialty === k) + '">' + esc(WF.SPECIALTIES[k].label) + '</button>'; }).join('') + '</div>' : '') +
      (rows.length ? '' : '<p class="sv-calm sv-mute-line">مفيش مواد في المراحل دي دلوقتي</p>') + '<ul class="sv-flow">' + rows.map(function (r) { return '<li><button type="button" class="sv-fr' + (r.warn ? ' warn' : '') + '" style="--c:' + r.col + '"' + (canTab('review') ? ' data-sv-go="review"' : '') + ' data-sv-stage="' + r.key + '"><span class="sv-fl">' + esc(r.label) + '</span><span class="sv-t"><i data-sv-w="' + Math.round(r.n / mx * 100) + '"></i></span><b>' + num(r.n) + '</b></button></li>'; }).join('') + '</ul>' +
      ((anyWarn || foot) ? '<div class="sv-foot">' + (anyWarn ? '<span><i class="sv-dot"></i> فيها تأخير</span>' : '') + foot + '</div>' : '') + '</section>';
  }

  // ---------- السوشيال ميديا ----------
  function socialHtml(D) {
    var m = (D.metrics || []).slice().sort(function (a, b) { return String(b.week_start).localeCompare(String(a.week_start)); });
    var can = role(['approver', 'general_manager', 'super_admin']);
    if (!m.length) return can ? '<section class="sv-card" data-sv-social><div class="sv-ch"><div><h3>السوشيال ميديا</h3><small>لسه مفيش أسبوع متسجل</small></div><button type="button" class="sv-lnk" data-sv-week>+ أسبوع جديد</button></div></section>' : '';
    var c = m[0], p = m[1];
    function d(k, pctPoint) { if (!p || c[k] == null || p[k] == null) return ''; var a = Number(c[k]), b = Number(p[k]), x = a - b; if (!x) return '<i>زي اللي فات</i>'; var v = pctPoint || !b ? num(Math.abs(x)) : num(Math.abs(x / b * 100), 0) + '%'; return '<i class="' + (x > 0 ? 'up' : 'dn') + '">' + (x > 0 ? '↑ ' : '↓ ') + v + '</i>'; }
    var pts = m.slice(0, 8).reverse(), line = '';
    if (pts.length >= 2) {
      var rv = pts.map(function (x) { return Number(x.reach || 0); }), mx = Math.max.apply(null, rv), mn = Math.min.apply(null, rv), span = mx - mn || 1, st = 294 / (pts.length - 1);
      var xy = pts.map(function (x, i) { return [Math.round((10 + i * st) * 10) / 10, Math.round((115 - (Number(x.reach || 0) - mn) / span * 85) * 10) / 10]; }), path = xy.map(function (q, i) { return (i ? 'L' : 'M') + q[0] + ' ' + q[1]; }).join(' '), l = xy[xy.length - 1];
      line = '<svg class="sv-line" viewBox="0 0 320 150" preserveAspectRatio="none" data-sv-line aria-label="الوصول آخر ' + pts.length + ' أسابيع"><path class="g" d="M0 30H320M0 75H320M0 120H320"/><path class="a" d="' + path + ' L' + l[0] + ' 130 L10 130Z"/><path class="l" d="' + path + '"/><circle cx="' + l[0] + '" cy="' + l[1] + '" r="4"/></svg><div class="sv-axis"><span>' + esc(fmtDay(pts[0].week_start)) + '</span><span>الوصول أسبوع بأسبوع</span><span>' + esc(fmtDay(pts[pts.length - 1].week_start)) + '</span></div>';
    }
    return '<section class="sv-card" data-sv-social><div class="sv-ch"><div><h3>السوشيال ميديا</h3><small>آخر ' + Math.min(8, m.length) + ' أسابيع · آخر إدخال ' + esc(fmtDay(c.week_start)) + '</small></div>' + (can ? '<button type="button" class="sv-lnk" data-sv-week>+ أسبوع جديد</button>' : '') + '</div>' +
      '<div class="sv-trio"><div><small>الوصول</small><b>' + num(c.reach) + '</b>' + d('reach') + '</div><div><small>التفاعل</small><b>' + num(c.engagement_rate) + '%</b>' + d('engagement_rate', true) + '</div><div><small>متابعين جدد</small><b>' + num(c.new_followers) + '</b>' + d('new_followers', true) + '</div></div>' + line + '</section>';
  }

  // ---------- الإعلانات ----------
  function latestBatch(ads) {
    if (!ads || !ads.length) return null; var map = {};
    ads.forEach(function (a) { var id = a.report_batch_id || '-'; var b = map[id] = map[id] || { rows: [], createdAt: a.created_at }; b.rows.push(a); if (a.created_at && a.created_at > b.createdAt) b.createdAt = a.created_at; });
    var b = Object.keys(map).map(function (k) { return map[k]; }).sort(function (x, y) { return String(y.createdAt || '').localeCompare(String(x.createdAt || '')); })[0];
    b.spent = b.rows.reduce(function (s, r) { return s + Number(r.amount_spent || 0); }, 0);
    b.from = b.rows.reduce(function (m, r) { return r.reporting_start && (!m || r.reporting_start < m) ? r.reporting_start : m; }, null);
    b.to = b.rows.reduce(function (m, r) { return r.reporting_end && (!m || r.reporting_end > m) ? r.reporting_end : m; }, null);
    return b;
  }
  function adsHtml(D) {
    var B = latestBatch(D.ads); if (!B) return '';
    var rows = B.rows.slice().sort(function (a, b) { return Number(b.amount_spent || 0) - Number(a.amount_spent || 0); }).slice(0, 5);
    return '<section class="sv-card sv-span2" data-sv-ads><div class="sv-ch"><div><h3>الإعلانات المدفوعة</h3><small>آخر تقرير ' + esc(fmtDay(B.createdAt)) + (B.from && B.to ? ' · فترة ' + esc(fmtDay(B.from)) + ' – ' + esc(fmtDay(B.to)) : '') + '</small></div><button type="button" class="sv-lnk" ' + (canTab('metaads') ? 'data-sv-go="metaads"' : 'data-sv-open-more') + '>كل الحملات</button></div>' +
      '<ul class="sv-camps">' + rows.map(function (r) {
        return '<li><b title="' + esc(r.campaign_name) + '">' + esc(r.campaign_name || 'حملة بدون اسم') + '</b><div><small>الإنفاق</small><span>' + num(r.amount_spent, 2) + ' ج</span></div><div><small>' + esc(BASE.resultLabel(r.result_indicator)) + '</small><span>' + num(r.results) + '</span></div><div><small>تكلفة النتيجة</small><span>' + (r.cost_per_result != null ? num(r.cost_per_result, 2) + ' ج' : '—') + '</span></div></li>';
      }).join('') + '</ul>' + (B.rows.length > rows.length ? '<p class="sv-more-note">وفيه ' + num(B.rows.length - rows.length) + ' حملات تانية في «كل الحملات».</p>' : '') + '</section>';
  }

  // ---------- نظرة على باقي المركز ----------
  function otherHtml(D) {
    if (!D.manager) return '';
    var rows = [];
    if (D.leadsStats && D.leadsStats.open) rows.push(['ليدز مفتوحة', D.leadsStats.open, '#3E8F68', canTab('leads') ? 'leads' : '']);
    if (D.patients && D.patients.pending_review) rows.push(['ملفات مرضى للمراجعة', D.patients.pending_review, '#B86200', canTab('patients') ? 'patients' : '']);
    var tk = D.snap && D.snap.tasks; if (tk && tk.review) rows.push(['مهام مستنية مراجعة', tk.review, '#0F369D', canTab('tasks') ? 'tasks' : '']);
    var op = D.snap && D.snap.operations; if (op && op.open_issues) rows.push(['مشكلات تشغيل مفتوحة', op.open_issues, '#D0402A', '']);
    if (!rows.length) return '';
    var mx = Math.max.apply(null, rows.map(function (r) { return r[1]; })) || 1;
    return '<section class="sv-card" data-sv-other><div class="sv-ch"><div><h3>نظرة على باقي المركز</h3><small>أرقام سريعة من الموديولات التانية</small></div></div><ul class="sv-flow">' + rows.map(function (r) { return '<li><button type="button" class="sv-fr" style="--c:' + r[2] + '"' + (r[3] ? ' data-sv-go="' + r[3] + '"' : ' disabled') + '><span class="sv-fl">' + esc(r[0]) + '</span><span class="sv-t"><i data-sv-w="' + Math.round(r[1] / mx * 100) + '"></i></span><b>' + num(r[1]) + '</b></button></li>'; }).join('') + '</ul></section>';
  }

  // ---------- render ----------
  function draw(root, D) {
    var now = Date.now(), W = windows(now), body = root.querySelector('[data-sv-body]'); if (!body) return;
    var k = tiles(D, now, W), j = journeyHtml(D, now, W), so = socialHtml(D), ad = adsHtml(D), ot = otherHtml(D);
    body.innerHTML = needHtml(needs(D, now)) + tilesHtml(k) + '<div class="sv-grid">' + j + so + ad + ot + '</div>';
    var stamp = root.querySelector('[data-sv-stamp]'); if (stamp) stamp.textContent = 'آخر تحديث ' + fmtStamp(new Date(now));
    requestAnimationFrame(function () { setTimeout(function () { body.querySelectorAll('[data-sv-w]').forEach(function (i) { i.style.width = Math.max(i.dataset.svW > 0 ? 3 : 0, +i.dataset.svW) + '%'; }); body.classList.add('sv-on'); }, 60); });
    bindBody(root, D);
  }
  function bindBody(root, D) {
    root.querySelectorAll('[data-sv-body] [data-sv-go]').forEach(function (b) { b.onclick = function () { sound(); if (w.SSMPDGotoTab) w.SSMPDGotoTab(b.dataset.svGo); }; });
    root.querySelectorAll('[data-sv-body] [data-sv-bi-view]').forEach(function (b) { b.onclick = function () { sound(); openBi(root, b.dataset.svBiView); }; });
    root.querySelectorAll('[data-sv-body] [data-sv-open-more]').forEach(function (b) { b.onclick = function () { sound(); var d = root.querySelector('[data-sv-more]'); if (d) { d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }; });
    root.querySelectorAll('[data-sv-spec]').forEach(function (b) { b.onclick = function () { sound(); S.specialty = b.dataset.svSpec; var card = root.querySelector('[data-sv-journey]'); if (card) { var tmp = document.createElement('div'); tmp.innerHTML = journeyHtml(D, Date.now(), windows(Date.now())); card.replaceWith(tmp.firstChild); bindBody(root, D); setTimeout(function () { root.querySelectorAll('[data-sv-journey] [data-sv-w]').forEach(function (i) { i.style.width = Math.max(i.dataset.svW > 0 ? 3 : 0, +i.dataset.svW) + '%'; }); }, 30); } }; });
    root.querySelectorAll('[data-sv-week]').forEach(function (b) { b.onclick = function () { sound(); BASE.openMetricsModal(); }; });
  }
  function openBi(root, view) {
    var d = root.querySelector('[data-sv-bi]'); if (!d) return; d.open = true;
    var go = function () { var b = d.querySelector('[data-bi-view="' + view + '"]'); if (b) b.click(); d.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    if (d.querySelector('[data-bi-view]')) go(); else setTimeout(go, 400);
  }
  function mountBi(root) {
    var host = root.querySelector('[data-sv-bi-body]'); if (!host || !w.SSMPDBusinessIntelligence) return;
    w.SSMPDBusinessIntelligence.mount(host);
    var b = host.querySelector('[data-bi-period="' + S.period + '"]'); if (b && !b.classList.contains('primary')) b.click();
  }
  function syncBi(root) { var host = root.querySelector('[data-sv-bi-body]'); if (!host) return; var b = host.querySelector('[data-bi-period="' + S.period + '"]'); if (b) b.click(); if (w.SSMPDBusinessStrategy && w.SSMPDBusinessStrategy.refresh) w.SSMPDBusinessStrategy.refresh(); }

  function render(container) {
    if (!container) return;
    var my = ++token; container.innerHTML = shell();
    var root = container.querySelector('[data-summary-v2]');
    function run() {
      return load().then(function (D) { if (my !== token || !root.isConnected) return; draw(root, D); }).catch(function (e) {
        if (my !== token || !root.isConnected) return; var body = root.querySelector('[data-sv-body]');
        body.innerHTML = '<div class="err-msg">تعذّر تحميل الملخص. دوس تحديث وجرّب تاني.</div>'; if (w.console) console.warn('summary-v2', e);
      });
    }
    root.querySelectorAll('[data-sv-period]').forEach(function (b) { b.onclick = function () { if (S.period === b.dataset.svPeriod) return; sound(); S.period = b.dataset.svPeriod; root.querySelectorAll('[data-sv-period]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); run(); syncBi(root); }; });
    root.querySelector('[data-sv-refresh]').onclick = function () { var b = this; sound(); b.classList.remove('spin'); void b.offsetWidth; b.classList.add('spin'); run(); if (w.SSMPDBusinessIntelligence && w.SSMPDBusinessIntelligence.refresh) w.SSMPDBusinessIntelligence.refresh(); if (w.SSMPDBusinessStrategy && w.SSMPDBusinessStrategy.refresh) w.SSMPDBusinessStrategy.refresh(); };
    // the original sections (archives, comparisons, imports, bank expenses) load only when someone opens them
    var more = root.querySelector('[data-sv-more]');
    more.addEventListener('toggle', function () { if (more.open && !more.dataset.loaded) { more.dataset.loaded = '1'; BASE.render(root.querySelector('[data-sv-legacy]')); } });
    run();
    mountBi(root);
  }
  w.SSMPDRenderSummary = { render: render, _state: S };
})(window);
