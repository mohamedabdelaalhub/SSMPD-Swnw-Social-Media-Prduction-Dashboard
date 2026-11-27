/* HR — «⋯» actions for one employee (owner 2026-11-23 «طبقه», mockup docs/ui-references/mockups/hr-look.html).
   One sheet that opens the EXISTING HR tools for that person; no new RPC, no new business rule. */
(function (w, d) {
  'use strict';
  var people = {};
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function remember(list) { (list || []).forEach(function (p) { if (p && p.id) people[p.id] = Object.assign({}, people[p.id] || {}, p); }); }
  var DOTS = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/></svg>';
  function button(pid, name) { return '<button type="button" class="hra-dots" data-hra="' + esc(pid) + '" data-hra-name="' + esc(name || '') + '" aria-label="إجراءات ' + esc(name || 'الموظف') + '" title="إجراءات الموظف">' + DOTS + '</button>'; }
  function toast(m, k) { if (w.SSMPDToast && w.SSMPDToast.show) w.SSMPDToast.show(m, k || 'error'); }
  function hrOpen(section) { var b = d.querySelector('[data-hr-open="' + section + '"]'); if (!b) { toast('القسم ده مش متاح لصلاحيتك'); return false; } b.click(); return true; }
  function after(fn) { setTimeout(fn, 60); }
  function openFile(pid, then) {
    if (!hrOpen('people')) return;
    after(function () {
      var card = d.querySelector('.wp-card[data-wp="person"][data-id="' + pid + '"]');
      if (!card) { toast('ملف الموظف مش ظاهر في القائمة الحالية'); return; }
      if (card.getAttribute('aria-expanded') !== 'true') card.click();
      if (then) after(then);
    });
  }
  function personTab(tab) { var t = d.querySelector('[data-person-tab="' + tab + '"]'); if (t) t.click(); }
  function withPerson(section, selector) {
    if (!hrOpen(section)) return;
    after(function () {
      var box = d.querySelector('[data-hr-section="' + section + '"]'), sel = box && box.querySelector(selector);
      if (sel) { sel.value = current.id; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    });
  }
  var current = null;
  var ACTIONS = [
    ['الورديات والحضور', [
      ['mission', 'في مهمة خارجية', 'من وإلى ومكان وملاحظة', '🚗', function (p) { if (w.SSMPDHRMission) w.SSMPDHRMission.form(p); else toast('المهمة الخارجية غير متاحة'); }],
      ['sched', 'تعديل جدول الورديات', 'الأيام ونوع الوردية', '🗓', function (p) { if (w.SSMPDHRShifts && w.SSMPDHRShifts.editPerson) w.SSMPDHRShifts.editPerson(p.id).catch(function (e) { toast((e && e.message) || 'تعذر فتح الجدول'); }); else toast('الورديات مش متاحة'); }],
      ['swap', 'تبديل وردية', 'طلبات التبديل في الورديات', '⇄', function () { if (!hrOpen('presence')) return; after(function () { var t = d.querySelector('[data-att-tab="shifts"]'); if (t) t.click(); }); }],
      ['attend', 'تسجيل وردية وحضور', 'يدوي بعد المراجعة', '⏱', function (p) { if (!hrOpen('attendance')) return; after(function () { var box = d.querySelector('[data-hr-section="attendance"]'), sel = box && box.querySelector('[name=person_for_attendance]'), b = box && box.querySelector('[data-wp="attendance"]'); if (sel) sel.value = p.id; if (b) { b.dataset.id = p.id; b.click(); } }); }],
      ['overtime', 'ساعات إضافية', '', '＋', function () { withPerson('overtime', '[name=person_id]'); }],
      ['workcal', 'مواعيد العمل والإجازات والراحات', 'كالندر الشهر للموظف', '📅', function (p) { if (w.SSMPDHRWorkSchedule) w.SSMPDHRWorkSchedule.open(p); else toast('الكالندر غير متاح'); }]
    ]],
    ['الإجازات والأذونات', [
      ['request', 'إجازة أو إذن جديد', 'بيفتح نموذج الطلب للموظف ده', '🌴', function (p) { if (!hrOpen('requests')) return; after(function () { var box = d.querySelector('[data-hr-section="requests"]'), sel = box && box.querySelector('[name=person_for_request]'), b = box && box.querySelector('[data-wp="request"]'); if (sel) sel.value = p.id; if (b) { b.dataset.id = p.id; b.click(); } }); }],
      ['leaves', 'إجازاته وطلباته', 'الطلبات والرصيد', '✎', function (p) { openFile(p.id, function () { personTab('requests'); }); }]
    ]],
    ['الملف والعقد', [
      ['profile', 'ملف الأداء', 'الحضور والتأخير والإجازات', '📊', function (p) { if (w.SSMPDEmployeeProfile) w.SSMPDEmployeeProfile.open({ personId: p.id, adminId: p.admin_id || null, name: p.full_name || '', department: p.department || '', role: p.job_title || '' }); }],
      ['file', 'فتح ملف الموظف', '', '👤', function (p) { openFile(p.id); }],
      ['edit', 'تحديث العلاقة', 'العقد · الوظيفة · الحالة', '📄', function (p) { openFile(p.id, function () { var b = d.querySelector('.wp-detail [data-wp="edit"][data-id="' + p.id + '"]'); if (b) b.click(); else toast('تعديل الملف محتاج صلاحية إدارة الموارد البشرية'); }); }],
      ['custody', 'العهد', '', '🔑', function () { hrOpen('custody'); }],
      ['insurance', 'التأمينات', '', '🛡', function () { hrOpen('insurance'); }]
    ]]
  ];
  function close(dlg) { if (dlg && dlg.isConnected) { if (dlg.open && dlg.close) dlg.close(); dlg.remove(); } }
  function open(pid, name) {
    var p = Object.assign({ id: pid, full_name: name || '' }, people[pid] || {});
    current = p;
    var old = d.querySelector('[data-hra-sheet]'); if (old) close(old);
    var phone = String(p.phone || '').replace(/[^\d+]/g, ''), wa = phone.replace(/^0/, '20').replace(/^\+/, '');
    var dlg = d.createElement('dialog'); dlg.className = 'hra-sheet'; dlg.dataset.hraSheet = pid; dlg.setAttribute('aria-label', 'إجراءات ' + (p.full_name || 'الموظف'));
    dlg.innerHTML = '<div class="hra-head"><div><b>' + esc(p.full_name || 'الموظف') + '</b><small>' + esc([p.code, p.department, p.job_title].filter(Boolean).join(' · ')) + '</small></div><button type="button" class="hra-x" data-hra-close aria-label="إغلاق">✕</button></div>' +
      ACTIONS.map(function (g) { return '<section class="hra-group"><h4>' + esc(g[0]) + '</h4><div class="hra-grid">' + g[1].map(function (a) { return '<button type="button" class="hra-act" data-hra-act="' + a[0] + '"><i aria-hidden="true">' + a[3] + '</i><span>' + esc(a[1]) + (a[2] ? '<small>' + esc(a[2]) + '</small>' : '') + '</span></button>'; }).join('') + '</div></section>'; }).join('') +
      (phone ? '<section class="hra-group"><h4>تواصل</h4><div class="hra-grid"><a class="hra-act" href="tel:' + esc(phone) + '" data-hra-act="call"><i aria-hidden="true">📞</i><span>اتصال<small dir="ltr">' + esc(p.phone) + '</small></span></a><a class="hra-act" href="https://wa.me/' + esc(wa) + '" target="_blank" rel="noopener" data-hra-act="whatsapp"><i aria-hidden="true">💬</i><span>واتساب</span></a></div></section>' : '') +
      '<section class="hra-group"><div class="hra-grid"><button type="button" class="hra-act danger" data-hra-act="offboarding"><i aria-hidden="true">⏻</i><span>إنهاء الخدمة<small>بيفتح خطوات إنهاء الخدمة والتسوية</small></span></button></div></section>';
    d.body.appendChild(dlg);
    dlg.addEventListener('click', function (e) {
      if (e.target === dlg || e.target.closest('[data-hra-close]')) { close(dlg); return; }
      var b = e.target.closest('[data-hra-act]'); if (!b) return;
      var key = b.dataset.hraAct; if (key === 'call' || key === 'whatsapp') { close(dlg); return; }
      e.preventDefault(); close(dlg);
      if (key === 'offboarding') {
        // UX review 2026-11-25: open «بدء إنهاء خدمة» for THIS person (it used to open the section only, and the dialog defaulted to the first employee)
        if (!hrOpen('offboarding')) return;
        after(function () { var b = d.querySelector('[data-offb="new"]'); if (!b) { toast('بدء إنهاء الخدمة محتاج صلاحية إدارة الموارد البشرية'); return; } b.click(); after(function () { var s = d.querySelector('.wp-modal select[name=person_id]'); if (s) { s.value = p.id; s.dispatchEvent(new Event('change', { bubbles: true })); } }); });
        return;
      }
      ACTIONS.forEach(function (g) { g[1].forEach(function (a) { if (a[0] === key) a[4](p); }); });
    });
    dlg.addEventListener('cancel', function (e) { e.preventDefault(); close(dlg); });
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
    var first = dlg.querySelector('.hra-act'); if (first) first.focus();
    return dlg;
  }
  /* capture phase: the row behind the button opens the performance file on click — the «⋯» must not */
  d.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('[data-hra]'); if (!b) return; e.preventDefault(); e.stopPropagation(); open(b.dataset.hra, b.dataset.hraName); }, true);
  d.addEventListener('keydown', function (e) { if (e.key !== 'Enter' && e.key !== ' ') return; var b = e.target.closest && e.target.closest('[data-hra]'); if (b) e.stopPropagation(); }, true);
  w.SSMPDHRActions = { button: button, open: open, remember: remember, _actions: ACTIONS };
})(window, document);
