/* SSMPD — charts and motion for «الرئيسية الشخصية» (owner-approved mockup docs/ui-references/mockups/home-v2.html).
   Every chart is drawn only from real data; when a field is missing the chart is simply not shown. Evaluation only. */
(function (w, d) {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  // Owner's status colours (2026-11-17). Light ones carry grey-80% text.
  var ST = { ok: '#00B0BD', late: '#FF8800', stop: '#FF0000' };
  var DEPT = { 'التمريض': '#09A0BE', 'الاستقبال': '#2563EB', 'خدمة العملاء': '#002AFA', 'الإدارة': '#6600FF', 'المحاسبة والمالية': '#A87B00', 'العلاج الطبيعي': '#1AA607', 'النظافة': '#4D7C0F', 'السوشيال ميديا': '#D4087F', 'التجميل': '#FF00DD', 'النفسية والتخاطب': '#B400E6' };

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function reduced() { return !!(w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function el(n, a, p) { var e = d.createElementNS(NS, n); for (var k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e; }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function series(v) { return Array.isArray(v) && v.length >= 2 && v.every(function (x) { return num(x) !== null; }) ? v : null; }
  function deptColour(name) {
    if (DEPT[name]) return DEPT[name];
    if (w.SSMPDAttendanceCore && w.SSMPDAttendanceCore.dept) { try { return w.SSMPDAttendanceCore.dept(name).col; } catch (e) { /* fall through */ } }
    return '#6B7688';
  }

  // ---------- shared tooltip ----------
  var tipEl = null;
  function tip(html, x, y) {
    if (!tipEl || !tipEl.isConnected) { tipEl = d.createElement('div'); tipEl.className = 'ph2-tip'; tipEl.setAttribute('role', 'tooltip'); (d.querySelector('dialog[open]') || d.body).appendChild(tipEl); }
    tipEl.innerHTML = html; tipEl.style.left = Math.round(x) + 'px'; tipEl.style.top = Math.round(y) + 'px'; tipEl.classList.add('on');
  }
  function untip() { if (tipEl) tipEl.classList.remove('on'); }

  // ---------- count-up ----------
  function countUp(node) {
    var to = Number(node.dataset.count); if (!isFinite(to)) return;
    if (reduced() || to === 0) { node.textContent = String(to); return; }
    var t0 = 0, dur = 900;
    function f(t) { if (!t0) t0 = t; var k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); node.textContent = String(Math.round(to * e)); if (k < 1 && node.isConnected) w.requestAnimationFrame(f); else node.textContent = String(to); }
    w.requestAnimationFrame(f);
  }

  // ---------- sparkline (time runs left → right) ----------
  function spark(svg) {
    var v = (svg.dataset.spark || '').split(',').map(Number); if (v.length < 2 || v.some(isNaN)) return;
    var box = svg.getBoundingClientRect(), W = Math.max(40, Math.round(box.width) || 96), H = Math.max(20, Math.round(box.height) || 40);
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.innerHTML = '';
    var mx = Math.max.apply(0, v), mn = Math.min.apply(0, v), r = mx - mn || 1;
    var p = v.map(function (n, i) { return [3 + i * (W - 6) / (v.length - 1), 4 + (H - 8) * (1 - (n - mn) / r)]; });
    var dd = p.map(function (q, i) { return (i ? 'L' : 'M') + q[0].toFixed(1) + ',' + q[1].toFixed(1); }).join('');
    el('path', { class: 'a', d: dd + 'L' + p[p.length - 1][0].toFixed(1) + ',' + H + 'L' + p[0][0].toFixed(1) + ',' + H + 'Z' }, svg);
    var line = el('path', { class: 'l', d: dd }, svg);
    if (!reduced() && line.getTotalLength) { var L = line.getTotalLength(); line.style.strokeDasharray = L; line.style.strokeDashoffset = L; line.getBoundingClientRect(); line.style.transition = 'stroke-dashoffset 1s cubic-bezier(.22,1,.36,1) .25s'; line.style.strokeDashoffset = '0'; }
    var last = p[p.length - 1]; el('circle', { cx: last[0].toFixed(1), cy: last[1].toFixed(1), r: 3.5 }, svg);
  }

  // ---------- my month card ----------
  function monthBounds() { var t = new Date(), f = new Date(t.getFullYear(), t.getMonth(), 1); function s(x) { return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); } return { from: s(f), to: s(t) }; }
  function dim(perf, key) { var x = perf && (perf.dimensions || []).find(function (q) { return q.key === key && q.counted !== false; }); return x && num(x.score) !== null ? Math.round(x.score) : null; }
  function meter(label, val, unit, pct, col) {
    if (val == null) return '';
    return '<div class="ph2-m" style="--c:' + col + '"><div class="ph2-ml"><b>' + esc(label) + '</b><span><bdi data-count="' + val + '">0</bdi>' + esc(unit) + '</span></div><div class="ph2-trk"><i data-w="' + Math.max(0, Math.min(100, pct)) + '"></i></div></div>';
  }
  function perfCard(admin, snap, done) {
    var my = snap && snap.my_month || {}, rpc = w.SSMPDDb && w.SSMPDDb.client && w.SSMPDDb.client.rpc;
    var b = monthBounds(), jobs = [];
    jobs.push(rpc ? Promise.resolve(w.SSMPDDb.client.rpc('staff_comprehensive_performance', { p_from: b.from, p_to: b.to, p_admin: admin.id })).then(function (r) { return r && !r.error ? r.data : null; }, function () { return null; }) : Promise.resolve(null));
    jobs.push(w.SSMPDDb && w.SSMPDDb.staffReviewHistory ? Promise.resolve(w.SSMPDDb.staffReviewHistory(admin.id)).then(function (x) { return x; }, function () { return null; }) : Promise.resolve(null));
    Promise.all(jobs).then(function (r) {
      var perf = r[0], reviews = Array.isArray(r[1]) ? r[1] : [], score = perf && num(perf.score) !== null ? Math.round(perf.score) : null;
      var att = num(my.commitment_pct), tasks = num(my.tasks_on_time_pct), latest = reviews.slice().sort(function (a, c) { return String(c.month).localeCompare(String(a.month)); })[0], rating = latest && num(Number(latest.rating)) !== null ? Number(latest.rating) : null;
      var meters = (att !== null ? meter('الالتزام بالمواعيد', Math.round(att), '٪', att, ST.ok) : meter('الحضور والانضباط', dim(perf, 'attendance'), ' من 100', dim(perf, 'attendance'), ST.ok)) +
        (tasks !== null ? meter('المهام في الميعاد', Math.round(tasks), '٪', tasks, '#0F369D') : meter('الالتزام بتنفيذ المهام', dim(perf, 'tasks'), ' من 100', dim(perf, 'tasks'), '#0F369D')) +
        (rating !== null ? '<div class="ph2-m" style="--c:#F5A524"><div class="ph2-ml"><b>تقييم المدير</b><span>' + rating + ' من 5</span></div><div class="ph2-trk"><i data-w="' + rating * 20 + '"></i></div></div>' : '');
      var weeks = my.weekly_commitment && my.weekly_commitment.filter(function (x) { return num(x) !== null; }).length >= 2 ? my.weekly_commitment : null;
      if (score === null && !meters && !weeks) { done(null); return; }
      var card = d.createElement('article'); card.className = 'ph-card ph2-card ph2-perf'; card.style.setProperty('--c', '#2F7D5C'); card.style.setProperty('--t', '#E7F3EE');
      card.innerHTML = '<div class="ph2-head"><span class="ph2-ic" aria-hidden="true">' + ICON.chart + '</span><div><h2>أدائي الشهر ده</h2><small>' + esc(new Date().toLocaleDateString('ar-EG-u-nu-latn', { month: 'long' })) + ' · محسوب لحد النهارده' + (perf && perf.provisional ? ' · مبدئي' : '') + '</small></div>' + (w.SSMPDEmployeeProfile ? '<button type="button" class="ph2-link" data-home-my-profile>ملف أدائي</button>' : '') + '</div>' +
        '<div class="ph2-perf-body">' + (score !== null ? '<div class="ph2-ring" role="img" aria-label="الدرجة الشاملة ' + score + ' من 100"><svg viewBox="0 0 104 104" aria-hidden="true"><circle class="bg" cx="52" cy="52" r="44"/><circle class="fg" cx="52" cy="52" r="44" data-score="' + score + '"/></svg><b data-count="' + score + '">0</b><small>من 100</small></div>' : '') + '<div class="ph2-meters">' + meters + '</div></div>' +
        (weeks ? '<div class="ph2-week"><small>الالتزام الأسبوعي · آخر ' + weeks.length + ' أسابيع</small><svg data-week="' + weeks.map(function (x) { return x == null ? '' : x; }).join(',') + '" role="img" aria-label="الالتزام الأسبوعي آخر ' + weeks.length + ' أسابيع"></svg></div>' : '');
      var link = card.querySelector('[data-home-my-profile]');
      if (link) link.onclick = function () { w.SSMPDEmployeeProfile.open({ adminId: admin.id, name: admin.name, role: admin.role }); };
      done(card);
    });
  }
  function weekLine(svg) {
    var raw = (svg.dataset.week || '').split(','), v = raw.map(function (x) { return x === '' ? null : Number(x); });
    var box = svg.getBoundingClientRect(), W = Math.max(120, Math.round(box.width) || 300), H = 70, lo = 100, hi = 0;
    v.forEach(function (n) { if (n != null) { lo = Math.min(lo, n); hi = Math.max(hi, n); } });
    lo = Math.max(0, Math.floor((lo - 5) / 5) * 5); hi = Math.min(100, Math.ceil((hi + 5) / 5) * 5); if (hi - lo < 10) lo = Math.max(0, hi - 10);
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.innerHTML = '';
    function x(i) { return 6 + i * (W - 12) / (v.length - 1); } function y(n) { return 6 + (H - 12) * (1 - (n - lo) / (hi - lo)); }
    var pts = v.map(function (n, i) { return n == null ? null : [x(i), y(n), n, i]; }).filter(Boolean);
    var dd = pts.map(function (q, i) { return (i ? 'L' : 'M') + q[0].toFixed(1) + ',' + q[1].toFixed(1); }).join('');
    el('path', { class: 'ar', d: dd + 'L' + pts[pts.length - 1][0].toFixed(1) + ',' + H + 'L' + pts[0][0].toFixed(1) + ',' + H + 'Z' }, svg);
    var line = el('path', { class: 'ln', d: dd }, svg);
    if (!reduced() && line.getTotalLength) { var L = line.getTotalLength(); line.style.strokeDasharray = L; line.style.strokeDashoffset = L; line.getBoundingClientRect(); line.style.transition = 'stroke-dashoffset 1.2s cubic-bezier(.22,1,.36,1) .2s'; line.style.strokeDashoffset = '0'; }
    var last = pts[pts.length - 1], dot = el('circle', { class: 'pt', r: 4, cx: last[0], cy: last[1] }, svg);
    var cross = el('line', { class: 'cx', y1: 0, y2: H, x1: last[0], x2: last[0] }, svg);
    function at(q) { dot.setAttribute('cx', q[0]); dot.setAttribute('cy', q[1]); cross.setAttribute('x1', q[0]); cross.setAttribute('x2', q[0]); cross.style.opacity = 1; var b = svg.getBoundingClientRect(); tip('<b>' + q[2] + '٪</b> · ' + (q[3] === v.length - 1 ? 'الأسبوع الحالي' : 'من ' + (v.length - 1 - q[3]) + ' أسبوع'), b.left + b.width * q[0] / W, b.top + b.height * q[1] / H); }
    function reset() { untip(); cross.style.opacity = 0; dot.setAttribute('cx', last[0]); dot.setAttribute('cy', last[1]); }
    svg.addEventListener('pointermove', function (e) { var b = svg.getBoundingClientRect(), px = (e.clientX - b.left) * W / b.width, best = pts[0]; pts.forEach(function (q) { if (Math.abs(q[0] - px) < Math.abs(best[0] - px)) best = q; }); at(best); });
    svg.addEventListener('pointerleave', reset);
    svg.tabIndex = 0; var k = pts.length - 1;
    svg.addEventListener('keydown', function (e) { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); k = Math.max(0, Math.min(pts.length - 1, k + (e.key === 'ArrowRight' ? 1 : -1))); at(pts[k]); } });
    svg.addEventListener('blur', reset);
  }

  // ---------- team load card ----------
  function loadCard(rows, onOpen) {
    rows = (Array.isArray(rows) ? rows : []).filter(function (r) { return r && num(r.open) !== null && r.open > 0; }).slice(0, 12);
    if (!rows.length) return null;
    var max = Math.max.apply(0, rows.map(function (r) { return r.open; }));
    var card = d.createElement('article'); card.className = 'ph-card ph2-card ph2-load'; card.style.setProperty('--c', '#0E8A7E'); card.style.setProperty('--t', '#E6F4F2');
    card.innerHTML = '<div class="ph2-head"><span class="ph2-ic" aria-hidden="true">' + ICON.team + '</span><div><h2>حِمل الفريق <span class="ph-count">' + rows.length + '</span></h2><small>مهام كل موظف المفتوحة دلوقتي — دوس على أي جزء تشوف تفاصيله</small></div>' + (onOpen ? '<button type="button" class="ph2-link" data-home-tab="staff_kpi">أداء الفريق</button>' : '') + '</div>' +
      '<ul class="ph2-loadlist">' + rows.map(function (r) {
        var late = Math.max(0, r.late || 0), stop = Math.max(0, r.blocked || 0), ok = Math.max(0, r.open - late - stop), name = r.assignee_name || 'بدون مسؤول';
        var seg = [[ok, 'ok', 'في وقتها'], [late, 'late', 'متأخرة'], [stop, 'stop', 'متوقفة']].filter(function (s) { return s[0] > 0; }).map(function (s) { return '<span class="ph2-seg ph2-' + s[1] + '" style="flex:' + s[0] + '" tabindex="0" data-tip="<b>' + esc(name) + '</b><br>' + s[0] + ' ' + s[2] + ' من ' + r.open + '">' + (s[0] / max > 0.07 ? s[0] : '') + '</span>'; }).join('');
        return '<li><div class="ph2-who"><i style="background:' + deptColour(r.department) + '"></i><b title="' + esc(name) + '">' + esc(name) + '</b></div><div class="ph2-bar" role="img" aria-label="' + esc(name) + ': ' + r.open + ' مفتوحة، ' + late + ' متأخرة، ' + stop + ' متوقفة">' + seg + (r.open < max ? '<span class="ph2-gap" style="flex:' + (max - r.open) + '"></span>' : '') + '</div><em>' + r.open + '</em></li>';
      }).join('') + '</ul><div class="ph2-legend"><span><i style="background:' + ST.ok + '"></i>في وقتها</span><span><i style="background:' + ST.late + '"></i>متأخرة</span><span><i style="background:' + ST.stop + '"></i>متوقفة</span></div>';
    card.querySelectorAll('[data-tip]').forEach(function (s) {
      var on = function () { var b = s.getBoundingClientRect(); tip(s.dataset.tip, b.left + b.width / 2, b.top); };
      s.addEventListener('pointerenter', on); s.addEventListener('focus', on); s.addEventListener('pointerleave', untip); s.addEventListener('blur', untip);
    });
    return card;
  }

  // ---------- run all entrance motion inside a root ----------
  function animate(root) {
    root.querySelectorAll('[data-spark]').forEach(spark);
    root.querySelectorAll('[data-week]').forEach(weekLine);
    var go = function () {
      root.querySelectorAll('[data-count]').forEach(countUp);
      root.querySelectorAll('[data-w]').forEach(function (i) { i.style.width = i.dataset.w + '%'; });
      root.querySelectorAll('[data-score]').forEach(function (c) { var C = 2 * Math.PI * 44; c.style.strokeDasharray = C; c.style.strokeDashoffset = reduced() ? C * (1 - c.dataset.score / 100) : C; c.getBoundingClientRect(); c.style.strokeDashoffset = C * (1 - c.dataset.score / 100); });
      root.querySelectorAll('.ph2-seg').forEach(function (s, i) { if (reduced()) { s.style.transform = 'none'; return; } setTimeout(function () { s.style.transform = 'none'; }, 60 + i * 40); });
    };
    if (w.requestAnimationFrame) w.requestAnimationFrame(go); else go();
  }

  var ICON = {
    chart: '<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
    team: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.5-5 6.5-5s5.5 1.5 6.5 5M16 4.5a3.5 3.5 0 0 1 0 7M18 15c2 .6 3.3 2.2 3.8 5"/></svg>'
  };

  w.SSMPDHomeCharts = { perfCard: perfCard, loadCard: loadCard, animate: animate, spark: spark, series: series, tip: tip, untip: untip };
})(window, document);
