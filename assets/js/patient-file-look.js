/* Patient file — new look approved by the owner 2026-11-22 («طبقه», mockup docs/ui-references/mockups/patient-file.html).
   Presentation only: it rearranges what render-patients.js + patient-profile-ui.js already built. Every record, permission
   and handler stays where it was — buttons are moved, never re-created, so their listeners keep working. */
(function () {
  'use strict';
  var AR = 'ar-EG-u-nu-latn';
  var ICON = {
    back: '<path d="M9 6l6 6-6 6"/>', user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    chev: '<path d="M6 9l6 6 6-6"/>', refresh: '<path d="M4 12a8 8 0 0 1 14-5l2 2M20 12a8 8 0 0 1-14 5l-2-2M20 4v5h-5M4 20v-5h5"/>',
    link: '<path d="M9 15l6-6M10 6l1-1a4 4 0 0 1 6 6l-1 1M14 18l-1 1a4 4 0 0 1-6-6l1-1"/>', edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 17v4h16v-4"/>'
  };
  function svg(k) { return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + ICON[k] + '</svg>'; }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function parse(v) { if (!v) return null; var s = String(v); var d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + 'T00:00:00' : s); return isNaN(d) ? null : d; }
  // «الجمعة 17 أكتوبر» (the year only when it isn't this year)
  function day(v, opts) {
    var d = parse(v); if (!d) return '';
    var o = { day: 'numeric', month: 'long' };
    if (!opts || opts.weekday !== false) o.weekday = 'long';
    if ((opts && opts.year) || d.getFullYear() !== new Date().getFullYear()) o.year = 'numeric';
    return d.toLocaleDateString(AR, o);
  }
  function clock(v) {
    var d = parse(v); if (!d || /^\d{4}-\d{2}-\d{2}$/.test(String(v)) || (d.getHours() === 0 && d.getMinutes() === 0)) return '';
    return d.toLocaleTimeString(AR, { hour: 'numeric', minute: '2-digit' });
  }
  function hhmm(t) {
    if (!t) return ''; var p = String(t).slice(0, 5).split(':'), h = Number(p[0]);
    if (p.length !== 2 || isNaN(h)) return '';
    return (h % 12 || 12) + ':' + p[1] + (h >= 12 ? ' م' : ' ص');
  }
  function years(n) { n = Number(n); return n === 1 ? 'سنة' : n === 2 ? 'سنتين' : (n >= 3 && n <= 10 ? n + ' سنين' : n + ' سنة'); }
  function files_(n) { return n === 0 ? 'لسه مفيش' : n === 1 ? 'ملف واحد' : n === 2 ? 'ملفين' : n + (n <= 10 ? ' ملفات' : ' ملف'); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function sectionTitled(panel, text) {
    return Array.from(panel.querySelectorAll(':scope > .section')).filter(function (s) {
      var h = s.querySelector('h3 > span') || s.querySelector('h3'); return h && h.textContent.trim().indexOf(text) === 0;
    })[0] || null;
  }
  function byDate(key, dir) { return function (a, b) { return String(b[key] || '').localeCompare(String(a[key] || '')) * (dir || 1); }; }

  // ---------- header ----------
  function header(head, meta, api) {
    var p = meta.patient || {}, h3 = head.querySelector('h3');
    var close = head.querySelector('.modal-close');
    var buttons = Array.from(head.children).filter(function (n) { return n !== h3 && n !== close && n.tagName === 'BUTTON'; });
    var print = head.querySelector('[data-pp-print]');
    var refresh = buttons.filter(function (b) { return /تحديث الملف/.test(b.textContent); })[0];
    var copy = buttons.filter(function (b) { return /نسخ رابط/.test(b.textContent); })[0];
    head.classList.add('pf-head');
    // back: the existing close button (keeps its handler), as an icon
    if (close) { close.classList.add('pf-back'); close.innerHTML = svg('back'); close.title = 'العودة للأرشيف'; }
    var chronic = (meta.profile && Array.isArray(meta.profile.chronic_conditions)) ? meta.profile.chronic_conditions : [];
    var allergy = chronic.filter(function (c) { return c && c.name === 'drug_allergies' && c.has; })[0];
    var chips = [];
    if (p.patient_code) chips.push('<span class="pf-chip code">رقم الملف ' + esc(p.patient_code) + '</span>');
    var ag = [p.age != null && p.age !== '' ? years(p.age) : '', p.gender === 'male' ? 'ذكر' : p.gender === 'female' ? 'أنثى' : ''].filter(Boolean).join(' · ');
    if (ag) chips.push('<span class="pf-chip">' + esc(ag) + '</span>');
    if (p.phone) chips.push('<span class="pf-chip">' + svg('phone') + '<span dir="ltr">' + esc(p.phone) + '</span></span>');
    if (allergy) chips.push('<span class="pf-chip alert">حساسية' + (allergy.medication ? ': ' + esc(allergy.medication) : ' من الأدوية') + '</span>');
    var who = el('div', 'pf-who');
    who.appendChild(h3);
    var code = h3.querySelector('span'); if (code) code.remove();
    if (chips.length) who.appendChild(el('div', 'pf-chips', chips.join('')));
    var av = el('span', 'pf-av', svg('user'));
    var acts = el('div', 'pf-hacts');
    var addVisit = api.panels.visits.querySelector('[data-add-visit]');
    if (addVisit) {
      var nv = el('button', 'btn pf-main', svg('plus') + 'زيارة جديدة'); nv.type = 'button'; nv.dataset.pfNewVisit = '1';
      nv.onclick = function () { addVisit.click(); };
      acts.appendChild(nv);
    }
    if (print) acts.appendChild(print);
    var menuItems = [];
    if (refresh) menuItems.push([refresh, 'refresh']);
    if (copy) menuItems.push([copy, 'link']);
    var editPersonal = api.panels.overview.querySelector('[data-edit-personal]');
    if (menuItems.length || editPersonal) {
      var wrap = el('div', 'pf-menu');
      var more = el('button', 'btn pf-more', svg('more')); more.type = 'button'; more.setAttribute('aria-label', 'أدوات أكتر'); more.setAttribute('aria-haspopup', 'true'); more.setAttribute('aria-expanded', 'false');
      var pop = el('div', 'pf-pop'); pop.hidden = true; pop.setAttribute('role', 'menu');
      menuItems.forEach(function (m) { var b = m[0]; b.className = 'pf-pop-item'; b.setAttribute('role', 'menuitem'); b.innerHTML = svg(m[1]) + '<span>' + esc(b.textContent) + '</span>'; pop.appendChild(b); });
      if (editPersonal) {
        var ed = el('button', 'pf-pop-item', svg('edit') + '<span>تعديل البيانات</span>'); ed.type = 'button'; ed.setAttribute('role', 'menuitem');
        ed.onclick = function () { editPersonal.click(); }; pop.appendChild(ed);
      }
      function setOpen(on) { pop.hidden = !on; more.setAttribute('aria-expanded', String(on)); }
      more.onclick = function (e) { e.stopPropagation(); setOpen(pop.hidden); };
      pop.addEventListener('click', function () { setOpen(false); });
      document.addEventListener('click', function (e) { if (!wrap.contains(e.target)) setOpen(false); });
      wrap.addEventListener('keydown', function (e) { if (e.key === 'Escape') { setOpen(false); more.focus(); } });
      wrap.appendChild(more); wrap.appendChild(pop); acts.appendChild(wrap);
    }
    // anything else the header held (e.g. the original print buttons the combined print action triggers) stays, hidden
    var keep = el('div', 'pf-keep'); keep.hidden = true;
    Array.from(head.childNodes).forEach(function (n) { if (n !== close) keep.appendChild(n); });
    head.textContent = '';
    if (close) head.appendChild(close);
    head.appendChild(keep);
    head.appendChild(av); head.appendChild(who); head.appendChild(acts);
  }

  // ---------- tabs ----------
  var SHORT = { visits: 'الزيارات', specialties: 'التخصصات', clinical: 'الفحوصات', documents: 'المستندات' };
  function tabs(nav, counts) {
    nav.classList.add('pf-tabs');
    Array.from(nav.querySelectorAll('[data-pp-tab]')).forEach(function (b) {
      var k = b.dataset.ppTab, full = b.textContent.trim(), n = counts[k];
      b.innerHTML = '<span class="pf-tab-full">' + esc(full) + '</span>' + (SHORT[k] ? '<span class="pf-tab-short" aria-hidden="true">' + esc(SHORT[k]) + '</span>' : '') +
        (n != null ? '<i class="pf-count">' + n + '</i>' : '');
      b.setAttribute('aria-label', full + (n != null ? ' (' + n + ')' : ''));
    });
  }

  // ---------- summary ----------
  function followLabel(v) {
    if (!v) return '';
    if (v.follow_up_status === 'rescheduled') return 'اتأجّلت';
    return 'لسه متأكدتش';
  }
  function summary(panel, meta, api) {
    var box = panel.querySelector('.pp-summary'); if (!box) return;
    var visits = (meta.visits || []).slice().sort(byDate('visit_date'));
    var last = visits[0];
    var next = (meta.visits || []).filter(function (v) { return v.follow_up_date && ['attended', 'no_show'].indexOf(v.follow_up_status) < 0; }).sort(byDate('follow_up_date', -1))[0];
    var files = meta.files || [];
    var created = ['reports', 'prescriptions', 'labRequests', 'radiologyRequests', 'echoReports'].reduce(function (s, k) { return s + ((meta[k] || []).length); }, 0);
    var lastUp = files.slice().sort(byDate('uploaded_at'))[0];
    var tiles = [
      ['visits', 'آخر زيارة', last ? day(last.visit_date) : 'لسه مفيش', last ? [clock(last.visit_date), last.doctor_name].filter(Boolean).join(' · ') : ''],
      ['visits', 'المتابعة الجاية', next ? day(next.follow_up_date) : 'مفيش متابعة', next ? [hhmm(next.follow_up_time), followLabel(next)].filter(Boolean).join(' · ') : ''],
      ['popup', 'الزيارات', visits.length ? (visits.length === 1 ? 'زيارة واحدة' : visits.length + (visits.length <= 10 ? ' زيارات' : ' زيارة')) : 'لسه مفيش', visits.length ? 'من ' + day(visits[visits.length - 1].visit_date, { weekday: false }) : ''],
      ['documents', 'المستندات والفحوصات', files_(files.length + created), lastUp ? 'آخر رفع ' + day(lastUp.uploaded_at, { weekday: false }) : '']
    ];
    box.className = 'pp-summary pf-tiles';
    box.innerHTML = tiles.map(function (t) {
      return '<button type="button" class="pf-tile" data-pf-tile="' + t[0] + '"><small>' + esc(t[1]) + '</small><b>' + esc(t[2]) + '</b>' + (t[3] ? '<span>' + esc(t[3]) + '</span>' : '') + '</button>';
    }).join('');
    box.querySelectorAll('[data-pf-tile]').forEach(function (b) {
      b.onclick = function () { if (b.dataset.pfTile === 'popup') visitsPopup(meta, api); else api.activate(b.dataset.pfTile, true); };
    });
  }
  function visitsPopup(meta, api) {
    var visits = (meta.visits || []).slice().sort(byDate('visit_date'));
    var dlg = el('dialog', 'pf-dialog');
    dlg.setAttribute('aria-label', 'كل الزيارات');
    dlg.innerHTML = '<div class="pf-dialog-head"><h3>كل الزيارات (' + visits.length + ')</h3><button type="button" class="pf-x" data-pf-close aria-label="إغلاق">✕</button></div>' +
      (visits.length ? '<div class="pf-rows">' + visits.map(function (v) {
        return '<div class="pf-row"><b>' + esc(day(v.visit_date)) + '</b><span>' + esc([v.doctor_name, v.complaint].filter(Boolean).join(' · ') || '—') + '</span></div>';
      }).join('') + '</div>' : '<p class="pf-empty">لسه مفيش زيارات.</p>') +
      '<button type="button" class="btn" data-pf-goto>افتح تاب الزيارات</button>';
    document.body.appendChild(dlg);
    var prev = document.activeElement;
    function done() { if (dlg.open && dlg.close) dlg.close(); dlg.remove(); if (prev && prev.focus) prev.focus(); }
    dlg.querySelector('[data-pf-close]').onclick = done;
    dlg.querySelector('[data-pf-goto]').onclick = function () { done(); api.activate('visits', true); };
    dlg.addEventListener('cancel', function (e) { e.preventDefault(); done(); });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) done(); });
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  }

  // ---------- personal data + medical history ----------
  function personal(panel, meta) {
    var sec = sectionTitled(panel, 'البيانات الشخصية'); if (!sec) return null;
    var p = meta.patient || {}, para = sec.querySelector(':scope > p'), edit = sec.querySelector('[data-edit-personal]');
    var owner = para && para.querySelector('[data-phone-owner-tag]');
    function missing() { return '<span class="pf-missing">ناقص' + (edit ? ' · <button type="button" class="pf-fill" data-pf-fill>كمّله</button>' : '') + '</span>'; }
    var rows = [
      ['التليفون', p.phone ? '<span dir="ltr">' + esc(p.phone) + '</span>' + (owner ? ' ' + owner.outerHTML : '') : missing()],
      ['السن', p.age != null && p.age !== '' ? esc(years(p.age)) : missing()],
      ['النوع', p.gender === 'male' ? 'ذكر' : p.gender === 'female' ? 'أنثى' : missing()],
      ['الرقم الطبي', p.medical_record_no ? esc(p.medical_record_no) : missing()],
      ['آخر زيارة', p.last_visit_date ? esc(day(p.last_visit_date)) : 'لسه مفيش']
    ];
    if (p.created_at) rows.push(['اتفتح الملف', esc(day(p.created_at, { weekday: false, year: true }))]);
    if (p.created_by_name) rows.push(['فتحه', esc(p.created_by_name)]);
    var dl = el('dl', 'pf-kv', rows.map(function (r) { return '<div><dt>' + r[0] + '</dt><dd>' + r[1] + '</dd></div>'; }).join(''));
    if (para) para.replaceWith(dl); else sec.appendChild(dl);
    dl.querySelectorAll('[data-pf-fill]').forEach(function (b) { b.onclick = function () { edit.click(); }; });
    sec.classList.add('pf-card');
    return sec;
  }
  function history(panel, meta) {
    var sec = sectionTitled(panel, 'التاريخ الصحي الثابت'); if (!sec) return null;
    var prof = meta.profile; sec.classList.add('pf-card');
    var h = sec.querySelector('h3 > span'); if (h) h.textContent = 'التاريخ الصحي';
    if (!prof) return sec;
    var chronic = Array.isArray(prof.chronic_conditions) ? prof.chronic_conditions.filter(function (c) { return c && c.has; }) : [];
    var allergy = chronic.filter(function (c) { return c.name === 'drug_allergies'; })[0];
    var others = chronic.filter(function (c) { return c.name !== 'drug_allergies'; });
    var LABEL = { smoking: 'التدخين', blood_pressure: 'الضغط', diabetes: 'السكر', thyroid: 'الغدة الدرقية', kidney_disease: 'أمراض الكلى', tumors: 'أورام' };
    var surg = Array.isArray(prof.surgeries) ? prof.surgeries.filter(function (s) { return s && s.has; }) : [];
    var fam = Array.isArray(prof.family_history) ? prof.family_history.filter(function (f) { return f && f.has; }) : [];
    var rows = [
      ['حساسية من الأدوية', allergy ? (allergy.medication || 'موجودة') : 'مفيش', !!allergy],
      ['أمراض مزمنة', others.length ? others.map(function (c) { return (LABEL[c.name] || c.name) + (c.medication ? ' (' + c.medication + ')' : ''); }).join('، ') : 'مفيش'],
      ['عمليات جراحية', surg.length ? surg.map(function (s) { return (s.name || '') + (s.notes ? ' (' + s.notes + ')' : ''); }).join('، ') : 'مفيش'],
      ['أمراض في العيلة', fam.length ? fam.map(function (f) { return f.disease || ''; }).join('، ') : 'مفيش']
    ];
    Array.from(sec.querySelectorAll(':scope > p')).forEach(function (n) { n.remove(); });
    sec.appendChild(el('div', 'pf-hist', rows.map(function (r) { return '<div class="pf-hrow' + (r[2] ? ' flag' : '') + '"><b>' + r[0] + '</b><span>' + esc(r[1]) + '</span></div>'; }).join('')));
    return sec;
  }

  // ---------- visits ----------
  var FU = { attended: ['ok', 'اتعملت المتابعة'], no_show: ['miss', 'مجاش المتابعة'], rescheduled: ['soon', 'المتابعة اتأجّلت'] };
  function visits(panel, meta) {
    var sec = panel.querySelector('[data-visit-section]'); if (!sec) return;
    sec.classList.add('pf-card', 'pf-visits');
    var bar = sec.querySelector(':scope > div'), add = sec.querySelector('[data-add-visit]');
    if (bar) { bar.className = 'pf-ctitle'; bar.innerHTML = '<h2>الزيارات والمتابعات</h2>'; if (add) { add.className = 'btn pf-main sm'; add.innerHTML = svg('plus') + 'زيارة جديدة'; bar.appendChild(add); } }
    var table = sec.querySelector('table'); if (!table) return;
    var rows = Array.from(table.querySelectorAll('tbody > tr'));
    var list = el('div', 'pf-tl');
    var items = (meta.visits || []).map(function (v, i) { return { v: v, row: rows[i] }; }).sort(function (a, b) { return String(b.v.visit_date || '').localeCompare(String(a.v.visit_date || '')); });
    items.forEach(function (it, idx) {
      var v = it.v, d = parse(v.visit_date);
      var fu = v.follow_up_date ? (FU[v.follow_up_status] || ['soon', 'متابعة ' + day(v.follow_up_date) + (v.follow_up_time ? ' · ' + hhmm(v.follow_up_time) : '')]) : null;
      var plan = [v.medications ? 'أدوية: ' + v.medications : '', v.xrays ? 'أشعة: ' + v.xrays : '', v.labs ? 'تحاليل: ' + v.labs : '', v.other_recommendations || ''].filter(Boolean).join(' · ');
      var card = el('article', 'pf-visit');
      card.dataset.pfVisit = String(v.id);
      if (idx >= 5) card.hidden = true, card.dataset.pfExtra = '1';
      card.innerHTML = '<div class="pf-date"><b>' + (d ? d.toLocaleDateString(AR, { day: 'numeric' }) : '—') + '</b><small>' + (d ? d.toLocaleDateString(AR, { month: 'long' }) : '') + '</small></div>' +
        '<div class="pf-mid"><div class="pf-line"><b>' + esc([day(v.visit_date), clock(v.visit_date)].filter(Boolean).join(' · ') || '—') + '</b>' +
        (fu ? '<span class="pf-st ' + fu[0] + '">' + esc(fu[1]) + '</span>' : '') +
        (v.referred_to_other_doctor ? '<span class="pf-st soon">محوّل لـ' + esc(v.referred_doctor_name || 'طبيب آخر') + '</span>' : '') + '</div>' +
        '<p>' + (v.doctor_name ? '<small>' + esc(v.doctor_name) + ' — </small>' : '') + esc(v.complaint || 'من غير شكوى مسجلة') + '</p>' +
        '<div class="pf-vmore"><p><small>خطة العلاج: </small>' + esc(plan || '—') + '</p>' + (v.visit_number ? '<p><small>رقم الزيارة: </small>' + esc(v.visit_number) + '</p>' : '') +
        (v.follow_up_patient_message ? '<p><small>رسالة المتابعة: </small>' + esc(v.follow_up_patient_message) + '</p>' : '') + '</div></div>' +
        '<div class="pf-vacts"><button type="button" class="pf-ib" data-pf-expand aria-expanded="false" aria-label="تفاصيل الزيارة">' + svg('chev') + '</button></div>';
      var actions = card.querySelector('.pf-vacts');
      if (it.row) { var cell = it.row.lastElementChild; Array.from(cell ? cell.querySelectorAll('button') : []).forEach(function (b) { actions.appendChild(b); }); }
      card.querySelector('[data-pf-expand]').onclick = function () { var on = card.classList.toggle('open'); this.setAttribute('aria-expanded', String(on)); };
      list.appendChild(card);
    });
    table.replaceWith(list);
    if (items.length > 5) {
      var all = el('button', 'pf-link pf-showall', 'عرض الكل (' + items.length + ')'); all.type = 'button';
      all.onclick = function () {
        var open = all.dataset.open !== '1'; all.dataset.open = open ? '1' : '';
        list.querySelectorAll('[data-pf-extra]').forEach(function (c) { c.hidden = !open; });
        all.textContent = open ? 'إظهار آخر 5 بس' : 'عرض الكل (' + items.length + ')';
      };
      sec.appendChild(all);
    }
  }

  // ---------- clinical + documents: filter chips, one upload / create button, empty groups folded ----------
  function titleEl(sec) { return sec.querySelector('h3 > span') || sec.querySelector('h3'); }
  function countOf(sec) { var s = titleEl(sec); var m = s && /\((\d+)\)\s*$/.exec(s.textContent.trim()); return m ? Number(m[1]) : null; }
  function labelOf(sec) { var s = titleEl(sec); return s ? s.textContent.trim().replace(/\s*\(\d+\)\s*$/, '') : ''; }
  function groups(panel, kind) {
    var secs = Array.from(panel.querySelectorAll(':scope > .section')).filter(function (s) { return countOf(s) != null && labelOf(s); });
    if (!secs.length) return;
    var printAll = null;
    Array.from(panel.querySelectorAll(':scope > .section')).forEach(function (s) {
      if (secs.indexOf(s) >= 0) return;
      var b = s.querySelector('[data-print-all]');
      if (b) { printAll = b; s.hidden = true; s.dataset.pfFolded = '1'; }
    });
    var state = { f: '' };
    var bar = el('div', 'pf-dbar');
    var chips = el('div', 'pf-fchips'); chips.setAttribute('role', 'group'); chips.setAttribute('aria-label', 'فلتر بالنوع');
    var tools = el('div', 'pf-dtools');
    bar.appendChild(chips); bar.appendChild(tools);
    var empty = el('p', 'pf-empty', '');
    panel.prepend(empty); panel.prepend(bar);
    secs.forEach(function (s) {
      s.classList.add('pf-group');
      // files open by default (no extra «عرض المستندات» click)
      s.querySelectorAll('[data-files-list-cat]').forEach(function (l) { l.style.display = 'block'; });
      s.querySelectorAll('[data-toggle-files-cat]').forEach(function (b) { b.hidden = true; });
      if (countOf(s) > 0) Array.from(s.querySelectorAll('p')).forEach(function (p) { if (/^مفيش (مستندات مرفوعة|ملفات|.* مُنشأة لسه)/.test(p.textContent.trim())) p.hidden = true; });
    });
    function pick(title, list, run) {
      var dlg = el('dialog', 'pf-dialog');
      dlg.setAttribute('aria-label', title);
      dlg.innerHTML = '<div class="pf-dialog-head"><h3>' + esc(title) + '</h3><button type="button" class="pf-x" data-pf-close aria-label="إغلاق">✕</button></div><div class="pf-cats">' +
        list.map(function (x, i) { return '<button type="button" data-pf-i="' + i + '">' + esc(x.label) + '</button>'; }).join('') + '</div>';
      document.body.appendChild(dlg);
      var prev = document.activeElement;
      function done() { if (dlg.open && dlg.close) dlg.close(); dlg.remove(); }
      dlg.querySelector('[data-pf-close]').onclick = function () { done(); if (prev && prev.focus) prev.focus(); };
      dlg.addEventListener('cancel', function (e) { e.preventDefault(); done(); });
      dlg.addEventListener('click', function (e) { if (e.target === dlg) done(); });
      dlg.querySelectorAll('[data-pf-i]').forEach(function (b) { b.onclick = function () { done(); run(list[Number(b.dataset.pfI)]); }; });
      if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
    }
    var uploads = secs.map(function (s) { var b = s.querySelector('[data-upload-cat]'); return b ? { label: labelOf(s), sec: s, btn: b } : null; }).filter(Boolean);
    var creates = [];
    secs.forEach(function (s) {
      Array.from(s.querySelectorAll('h3 button')).forEach(function (b) {
        if (b.hasAttribute('data-upload-cat') || b.hasAttribute('data-toggle-files-cat')) return;
        if (/إنشاء جديد|جديد/.test(b.textContent)) creates.push({ label: labelOf(s), sec: s, btn: b });
      });
    });
    // the per-group header buttons move to the toolbar pickers (the hidden ones stay where their handlers expect them)
    secs.forEach(function (s) { var h = s.querySelector('h3 > span:last-child'); if (h && h !== s.querySelector('h3 > span')) h.classList.add('pf-group-acts'); });
    if (creates.length) {
      var c = el('button', 'btn pf-ghost', svg('plus') + 'اكتب جديد'); c.type = 'button'; c.dataset.pfCreate = kind;
      c.onclick = function () { pick('اكتب جديد', creates, function (x) { x.btn.click(); }); };
      tools.appendChild(c);
    }
    if (uploads.length) {
      var u = el('button', 'btn pf-main', svg('upload') + (kind === 'documents' ? 'رفع مستند' : 'رفع')); u.type = 'button'; u.dataset.pfUpload = kind;
      u.onclick = function () { pick('رفع — اختار النوع', uploads, function (x) { setFilter(x.label); x.btn.click(); }); };
      tools.appendChild(u);
    }
    if (printAll) { printAll.classList.add('pf-ghost'); tools.appendChild(printAll); }
    function setFilter(f) {
      state.f = f;
      var shown = 0;
      secs.forEach(function (s) { var on = f ? labelOf(s) === f : countOf(s) > 0; s.hidden = !on; if (on) shown++; });
      chips.querySelectorAll('button').forEach(function (b) { var on = b.dataset.pfF === f; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
      empty.hidden = shown > 0;
      empty.textContent = f ? '' : 'لسه مفيش ملفات هنا.';
    }
    var total = secs.reduce(function (s, x) { return s + countOf(x); }, 0);
    chips.innerHTML = '<button type="button" data-pf-f="">الكل <i>' + total + '</i></button>' + secs.map(function (s) {
      var n = countOf(s); return '<button type="button" class="' + (n ? '' : 'zero') + '" data-pf-f="' + esc(labelOf(s)) + '">' + esc(labelOf(s)) + ' <i>' + n + '</i></button>';
    }).join('');
    chips.querySelectorAll('button').forEach(function (b) { b.onclick = function () { setFilter(b.dataset.pfF); }; });
    setFilter('');
    return total;
  }

  function specialtiesCount(panel) {
    return Array.from(panel.querySelectorAll(':scope > .pp-specialty-grid > .pp-specialty')).length;
  }

  function enhance(page, meta, api) {
    if (!page || !meta || !api || !api.panels) return;
    page.classList.add('pf-look');
    var p = api.panels;
    var docTotal = groups(p.documents, 'documents');
    var clinTotal = groups(p.clinical, 'clinical');
    header(api.head, meta, api);
    summary(p.overview, meta, api);
    var a = personal(p.overview, meta), b = history(p.overview, meta);
    if (a || b) { var g = el('div', 'pf-grid2'); (a || b).before(g); if (a) g.appendChild(a); if (b) g.appendChild(b); }
    visits(p.visits, meta);
    var rating = sectionTitled(p.visits, 'تقييم تجربة المريض'); if (rating) rating.classList.add('pf-card');
    var empty = p.specialties.querySelector('.pp-empty-specialties');
    if (empty) { var sm = empty.querySelector('summary'); if (sm) sm.textContent = 'تخصصات لسه مفيهاش سجلات'; }
    tabs(api.nav, { visits: (meta.visits || []).length, specialties: specialtiesCount(p.specialties), clinical: clinTotal == null ? null : clinTotal, documents: docTotal == null ? null : docTotal });
  }

  window.SSMPDPatientFileLook = { enhance: enhance, day: day };
})();
