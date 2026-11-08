/* Staff review of the links between the partner lab's test list and the center's lab services.
   Suggestions come from the import (matcher); NOTHING is confirmed here without a person pressing a button, and every decision is stored with who made it.
   All writes go through the lab_links_command RPC; this file only draws and asks. */
(function (w) {
  'use strict';
  var U = w.SSMPDWorkforceUtils;
  if (!U) return;
  var esc = U.escape, PAGE = 25;
  var CONF = { high: ['ثقة عالية', 'll-high'], medium: ['ثقة متوسطة', 'll-med'], low: ['ثقة ضعيفة', 'll-low'], none: ['بلا اقتراح', 'll-none'] };
  var STATES = [['needs_review', 'تحتاج مراجعة'], ['confirmed', 'مؤكدة'], ['no_match', 'بلا مقابل'], ['removed', 'محذوفة'], ['all', 'الكل']];

  function money(v) { return v == null || v === '' ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, ' ').trim(); }
  function stateOf(item) {
    if (item.removed_at) return 'removed';
    if (item.links.some(function (l) { return l.status === 'confirmed'; })) return 'confirmed';
    if (item.links.some(function (l) { return l.status === 'no_match'; })) return 'no_match';
    return 'needs_review';
  }
  function pending(item) {
    return item.links.filter(function (l) { return l.status === 'suggested'; }).sort(function (a, b) { return (a.rank || 99) - (b.rank || 99); });
  }
  function topConf(item) { var p = pending(item)[0]; return p ? p.confidence : 'none'; }
  /** Margin of a center service over the partner cost. loss = the center sells below what the lab charges. */
  function margin(price, cost) {
    if (cost == null || price == null) return null;
    var m = Number(price) - Number(cost);
    return { amount: m, percent: Number(price) > 0 ? m / Number(price) * 100 : null, loss: m < 0 };
  }

  /** Pure filtering so it can be tested without the DOM. */
  function view(data, f) {
    var services = {};
    data.services.forEach(function (s) { services[s.id] = s; });
    var counts = { needs_review: 0, confirmed: 0, no_match: 0, removed: 0, all: data.items.length };
    var q = norm(f.q), rows = data.items.filter(function (it) {
      var st = stateOf(it);
      counts[st]++;
      if (f.state !== 'all' && st !== f.state) return false;
      if (f.sample && norm(it.sample) !== norm(f.sample)) return false;
      if (f.conf && st === 'needs_review' && topConf(it) !== f.conf) return false;
      if (q) {
        var hay = norm(it.test_name + ' ' + (it.sample || '') + ' ' + it.links.map(function (l) { return (services[l.service_id] || {}).name || ''; }).join(' '));
        if (!q.split(' ').every(function (t) { return hay.indexOf(t) !== -1; })) return false;
      }
      if (f.below) {
        var shown = st === 'confirmed' ? it.links.filter(function (l) { return l.status === 'confirmed'; }) : pending(it);
        if (!shown.some(function (l) { var m = margin((services[l.service_id] || {}).base_price, it.cost); return m && m.loss; })) return false;
      }
      return true;
    });
    return { rows: rows, counts: counts, services: services };
  }

  function candidateHtml(it, l, svc, st) {
    var s = svc[l.service_id] || {}, m = margin(s.base_price, it.cost), c = CONF[l.confidence] || CONF.none;
    var h = '<div class="ll-cand ' + c[1] + (l.status === 'confirmed' ? ' ll-chosen' : '') + '">';
    h += '<div class="ll-cand-main"><b>' + esc(s.name || 'خدمة غير متاحة') + '</b><small>' + esc(s.code || '') + '</small></div>';
    h += '<div class="ll-cand-money"><span>سعر المركز <b>' + money(s.base_price) + '</b></span>';
    if (m) h += '<span class="' + (m.loss ? 'll-loss' : 'll-gain') + '">الهامش <b>' + money(m.amount) + '</b>' + (m.percent == null ? '' : ' (' + m.percent.toFixed(0) + '%)') + '</span>';
    h += '</div><div class="ll-badges"><span class="ll-pill">' + esc(c[0]) + (l.score != null ? ' · ' + Number(l.score).toFixed(2) : '') + '</span>';
    if (l.match_note) h += '<span class="ll-pill ' + (l.match_note.indexOf('تعارض') !== -1 ? 'll-warn' : '') + '">' + esc(l.match_note) + '</span>';
    if (m && m.loss) h += '<span class="ll-pill ll-warn">السعر أقل من تكلفة المعمل</span>';
    h += '</div>';
    if (st === 'needs_review') {
      h += '<div class="ll-btns"><button type="button" class="btn" data-ll="confirm" data-item="' + esc(it.id) + '" data-service="' + esc(l.service_id) + '">تأكيد الربط</button>' +
        '<button type="button" class="btn ghost" data-ll="reject" data-item="' + esc(it.id) + '" data-service="' + esc(l.service_id) + '">رفض الاقتراح</button></div>';
    }
    return h + '</div>';
  }

  function rowHtml(it, data, svc) {
    var st = stateOf(it), flag = it.import_flag ? '<span class="ll-pill ll-warn" title="' + esc(it.import_flag) + '">راجع النص الأصلي</span>' : '';
    var h = '<article class="ll-row" data-item-row="' + esc(it.id) + '"><div class="ll-lab"><b>' + esc(it.test_name) + '</b>' +
      '<small>العينة: ' + esc(it.sample || '—') + ' · مدة التشغيل: ' + esc(it.turnaround || '—') + '</small>' +
      '<span class="ll-cost">' + (it.cost == null ? 'تكلفة المعمل غير مسجلة <button type="button" class="btn ghost" data-ll="cost" data-item="' + esc(it.id) + '">تسجيل التكلفة</button>' : 'تكلفة المعمل <b>' + money(it.cost) + '</b>') + '</span>' + flag + '</div><div class="ll-side">';
    if (st === 'confirmed') {
      var l = it.links.filter(function (x) { return x.status === 'confirmed'; })[0];
      h += candidateHtml(it, l, svc, st) + '<p class="ll-meta">أكد الربط: ' + esc((data.reviewers || {})[l.reviewed_by] || '—') + ' · ' + esc(String(l.reviewed_at || '').slice(0, 10)) + (l.review_note ? ' — ' + esc(l.review_note) : '') + '</p>' +
        '<div class="ll-btns"><button type="button" class="btn ghost" data-ll="reopen" data-item="' + esc(it.id) + '">إعادة فتح الربط</button></div>';
    } else if (st === 'removed') {
      h += '<p class="ll-meta">صف محذوف من المراجعة (التكلفة محفوظة) — ' + esc((data.reviewers || {})[it.removed_by] || '—') + ' · ' + esc(String(it.removed_at || '').slice(0, 10)) + ': ' + esc(it.removed_note || '') + '</p>' +
        '<div class="ll-btns"><button type="button" class="btn ghost" data-ll="restore_row" data-item="' + esc(it.id) + '">استرجاع الصف</button></div>';
    } else if (st === 'no_match') {
      var n = it.links.filter(function (x) { return x.status === 'no_match'; })[0];
      h += '<p class="ll-meta">بلا مقابل في قائمة المركز — ' + esc((data.reviewers || {})[n.reviewed_by] || '—') + ': ' + esc(n.review_note || '') + '</p>' +
        '<div class="ll-btns"><button type="button" class="btn ghost" data-ll="reopen" data-item="' + esc(it.id) + '">إعادة فتح</button>' +
        '<button type="button" class="btn ghost" data-ll="remove_row" data-item="' + esc(it.id) + '">حذف الصف</button></div>';
    } else {
      var cands = pending(it);
      h += cands.length ? cands.map(function (l) { return candidateHtml(it, l, svc, st); }).join('') : '<p class="ll-meta">لا يوجد اقتراح تلقائي؛ اختر خدمة يدويًا أو سجّل أنه بلا مقابل.</p>';
      h += '<div class="ll-btns"><button type="button" class="btn ghost" data-ll="choose" data-item="' + esc(it.id) + '">اختيار خدمة أخرى</button>' +
        '<button type="button" class="btn ghost" data-ll="no_match" data-item="' + esc(it.id) + '">لا يوجد مقابل</button>' +
        '<button type="button" class="btn ghost" data-ll="remove_row" data-item="' + esc(it.id) + '">حذف الصف</button></div>';
      var rej = it.links.filter(function (x) { return x.status === 'rejected'; });
      if (rej.length) {
        h += '<details class="ll-rejected"><summary>اقتراحات مرفوضة (' + rej.length + ')</summary>' + rej.map(function (x) {
          return '<p class="ll-meta">' + esc((svc[x.service_id] || {}).name || '') + ' — ' + esc(x.review_note || '') + ' <button type="button" class="btn ghost" data-ll="restore" data-item="' + esc(it.id) + '" data-service="' + esc(x.service_id) + '">استرجاع</button></p>';
        }).join('') + '</details>';
      }
    }
    return h + '</div></article>';
  }

  function render(el) {
    var owner = w.SSMPDAuth && w.SSMPDAuth.currentAdmin && w.SSMPDAuth.currentAdmin.id, data = null, serial = 0, versionId = '';
    var f = { state: 'needs_review', q: '', sample: '', conf: '', below: false, page: 0 };
    function alive() { return el.isConnected && w.SSMPDAuth.currentAdmin && w.SSMPDAuth.currentAdmin.id === owner; }
    async function load() {
      var token = ++serial;
      try {
        var d = await U.rpc('lab_links_workspace', { p_version: versionId || null });
        if (!alive() || token !== serial) return;
        data = d;
        if (d.version && d.version.id) versionId = d.version.id;
        draw();
      } catch (err) {
        if (alive()) el.innerHTML = '<p role="alert">' + esc(err.message) + '</p><button type="button" class="btn ghost" data-ll="retry">إعادة المحاولة</button>';
      }
    }
    async function run(action, payload) {
      try {
        var out = await U.rpc('lab_links_command', { p_action: action, p_payload: payload });
        await load();
        return out;
      } catch (err) {
        if (w.SSMPDToast) w.SSMPDToast.show(err.message, 'error');
        throw err;
      }
    }
    function draw() {
      if (!data.items.length) { el.innerHTML = '<section class="wp ll"><div class="wp-detail"><h3>ربط تحاليل المعمل الشريك</h3><p>لم يتم استيراد قائمة معمل شريك بعد.</p></div></section>'; return; }
      var v = view(data, f), pages = Math.max(1, Math.ceil(v.rows.length / PAGE));
      if (f.page >= pages) f.page = pages - 1;
      var slice = v.rows.slice(f.page * PAGE, f.page * PAGE + PAGE), samples = {};
      data.items.forEach(function (i) { if (i.sample) samples[i.sample] = 1; });
      var bulk = f.state === 'needs_review' ? slice.filter(function (i) { return topConf(i) === 'high'; }) : [];
      var ver = data.version || {};
      el.innerHTML = '<section class="wp ll"><header class="wp-head"><div><h1>ربط تحاليل ' + esc(ver.lab_name || 'المعمل الشريك') + ' بقائمة المركز</h1><p>' + esc(ver.source_name || '') + ' — إصدار ' + esc(ver.version) +
        '. الاقتراحات تلقائية للمساعدة فقط؛ لا يُعتمد أي ربط إلا بتأكيد موظف، ويُسجل اسمه.</p></div></header>' +
        '<div class="ll-stats">' + STATES.filter(function (s) { return s[0] !== 'removed' || v.counts.removed > 0; }).map(function (s) { return '<button type="button" class="ll-chip' + (f.state === s[0] ? ' on' : '') + '" data-ll="state" data-value="' + s[0] + '">' + esc(s[1]) + ' <b>' + v.counts[s[0]] + '</b></button>'; }).join('') + '</div>' +
        '<div class="ll-filters"><label class="wp-field">بحث<input type="search" data-ll-q value="' + esc(f.q) + '" placeholder="اسم التحليل أو الخدمة"></label>' +
        '<label class="wp-field">العينة<select data-ll-sample><option value="">الكل</option>' + Object.keys(samples).sort().map(function (s) { return '<option ' + (f.sample === s ? 'selected' : '') + '>' + esc(s) + '</option>'; }).join('') + '</select></label>' +
        '<label class="wp-field">الثقة<select data-ll-conf><option value="">الكل</option>' + ['high', 'medium', 'low', 'none'].map(function (c) { return '<option value="' + c + '" ' + (f.conf === c ? 'selected' : '') + '>' + esc(CONF[c][0]) + '</option>'; }).join('') + '</select></label>' +
        '<label class="ll-check"><input type="checkbox" data-ll-below ' + (f.below ? 'checked' : '') + '> السعر أقل من التكلفة فقط</label>' +
        (data.versions.length > 1 ? '<label class="wp-field">الإصدار<select data-ll-version>' + data.versions.map(function (x) { return '<option value="' + esc(x.id) + '" ' + (x.id === versionId ? 'selected' : '') + '>' + esc(x.lab_name + ' — ' + x.version) + '</option>'; }).join('') + '</select></label>' : '') + '</div>' +
        (bulk.length ? '<div class="ll-bulk"><span>' + bulk.length + ' تحليلًا عالي الثقة في هذه الصفحة. التأكيد الجماعي يسجل كل ربط باسمك ولا يشمل الثقة المتوسطة أو الضعيفة.</span><button type="button" class="btn" data-ll="bulk">تأكيد عالي الثقة في هذه الصفحة (' + bulk.length + ')</button></div>' : '') +
        '<div class="ll-list">' + (slice.length ? slice.map(function (i) { return rowHtml(i, data, v.services); }).join('') : '<p class="ll-empty">لا توجد نتائج بهذه التصفية.</p>') + '</div>' +
        '<nav class="ll-pager"><button type="button" class="btn ghost" data-ll="page" data-value="-1" ' + (f.page === 0 ? 'disabled' : '') + '>السابق</button><span>صفحة ' + (f.page + 1) + ' من ' + pages + ' — ' + v.rows.length + ' نتيجة</span><button type="button" class="btn ghost" data-ll="page" data-value="1" ' + (f.page >= pages - 1 ? 'disabled' : '') + '>التالي</button></nav></section>';
      var q = el.querySelector('[data-ll-q]');
      q.oninput = function () { f.q = q.value; f.page = 0; clearTimeout(q._t); q._t = setTimeout(function () { draw(); var n = el.querySelector('[data-ll-q]'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 200); };
      el.querySelector('[data-ll-sample]').onchange = function (ev) { f.sample = ev.target.value; f.page = 0; draw(); };
      el.querySelector('[data-ll-conf]').onchange = function (ev) { f.conf = ev.target.value; f.page = 0; draw(); };
      el.querySelector('[data-ll-below]').onchange = function (ev) { f.below = ev.target.checked; f.page = 0; draw(); };
      var vs = el.querySelector('[data-ll-version]');
      if (vs) vs.onchange = function (ev) { versionId = ev.target.value; f.page = 0; load(); };
    }
    function noteModal(title, intro, label, fn) {
      U.modal(title, '<p class="wp-wide">' + intro + '</p>' + U.field('note', label, 'text', '', 'required minlength="3"'), function (v) { return fn(v.note); });
    }
    function chooseModal(item) {
      var all = data.services.slice(), svc = view(data, f).services;
      var f2 = U.modal('اختيار خدمة من قائمة المركز — ' + item.test_name,
        '<p class="wp-wide">تكلفة المعمل: <b>' + money(item.cost) + '</b></p>' + U.field('q', 'ابحث باسم الخدمة', 'search', '', 'autocomplete="off"') +
        '<label class="wp-field wp-wide">الخدمة<select name="service_id" size="8" required></select></label>' + U.field('note', 'سبب هذا الاختيار', 'text', '', 'required minlength="3"'),
        function (v) { return run('choose', { item_id: item.id, service_id: v.service_id, note: v.note }); });
      var sel = f2.elements.service_id, qn = f2.elements.q;
      function fill() {
        var toks = norm(qn.value).split(' ').filter(Boolean);
        var hit = all.filter(function (s) { var h = norm(s.name + ' ' + (s.code || '')); return toks.every(function (t) { return h.indexOf(t) !== -1; }); }).slice(0, 60);
        sel.innerHTML = hit.map(function (s) {
          var m = margin(s.base_price, item.cost);
          return '<option value="' + esc(s.id) + '">' + esc(s.name + ' — ' + money(s.base_price) + (m && m.loss ? ' (أقل من التكلفة)' : '')) + '</option>';
        }).join('');
      }
      qn.oninput = fill; fill();
    }
    el.onclick = function (ev) {
      var b = ev.target.closest('[data-ll]');
      if (!b || !el.contains(b)) return;
      var a = b.dataset.ll, item = data && data.items.find(function (i) { return i.id === b.dataset.item; });
      if (a === 'retry') return load();
      if (a === 'state') { f.state = b.dataset.value; f.page = 0; return draw(); }
      if (a === 'page') { f.page += Number(b.dataset.value); draw(); return el.scrollIntoView && el.scrollIntoView(); }
      if (a === 'confirm') { b.disabled = true; return run('confirm', { item_id: b.dataset.item, service_id: b.dataset.service }).catch(function () { b.disabled = false; }); }
      if (a === 'reject') return noteModal('رفض الاقتراح', 'سجّل سبب رفض هذا الاقتراح (مثلًا: عينة مختلفة).', 'سبب الرفض', function (note) { return run('reject', { item_id: b.dataset.item, service_id: b.dataset.service, note: note }); });
      if (a === 'restore') return run('restore', { item_id: b.dataset.item, service_id: b.dataset.service });
      if (a === 'no_match') return noteModal('لا يوجد مقابل', 'هذا التحليل غير موجود في قائمة المركز: اكتب السبب.', 'السبب', function (note) { return run('no_match', { item_id: b.dataset.item, note: note }); });
      if (a === 'remove_row') return noteModal('حذف الصف من المراجعة', 'يُخفى هذا التحليل من قوائم المراجعة لأنه بلا مقابل في المركز. تكلفة المعمل تبقى محفوظة ويمكن استرجاع الصف لاحقًا.', 'سبب الحذف', function (note) { return run('remove_row', { item_id: b.dataset.item, note: note }); });
      if (a === 'restore_row') return run('restore_row', { item_id: b.dataset.item });
      if (a === 'reopen') return noteModal('إعادة فتح القرار', 'سيعود التحليل إلى «تحتاج مراجعة».', 'سبب إعادة الفتح', function (note) { return run('reopen', { item_id: b.dataset.item, note: note }); });
      if (a === 'choose') return chooseModal(item);
      if (a === 'cost') return U.modal('تسجيل تكلفة المعمل — ' + item.test_name, U.field('cost', 'التكلفة (جنيه)', 'number', '', 'required min="0" step="0.01"') + U.field('note', 'مصدر الرقم', 'text', '', 'required minlength="3"'), function (v) { return run('set_cost', { item_id: item.id, cost: Number(v.cost), note: v.note }); });
      if (a === 'bulk') {
        var ids = view(data, f).rows.slice(f.page * PAGE, f.page * PAGE + PAGE).filter(function (i) { return topConf(i) === 'high'; }).map(function (i) { return i.id; });
        U.modal('تأكيد جماعي لتطابق عالي الثقة', '<p class="wp-wide">سيتم تأكيد <b>' + ids.length + '</b> ربطًا ظاهرًا في هذه الصفحة، وكل واحد يُسجل باسمك. راجع القائمة قبل المتابعة.</p><label class="ll-check wp-wide"><input type="checkbox" name="ok" required> راجعت الصفحة وأتحمل مسؤولية التأكيد باسمي</label>',
          function () { return run('bulk_confirm', { item_ids: ids }).then(function (r) { if (w.SSMPDToast) w.SSMPDToast.show('تم تأكيد ' + r.confirmed + (r.skipped.length ? ' وتخطي ' + r.skipped.length : '')); }); });
      }
    };
    el.innerHTML = '<p role="status">جاري تحميل قائمة المعمل…</p>';
    load();
  }

  w.SSMPDLabLinks = { render: render, view: view, stateOf: stateOf, margin: margin };

  // Mount as a second tab of the existing "price lists" workspace without touching its code.
  var PL = w.SSMPDPriceLists;
  if (PL && typeof PL.render === 'function') {
    var base = PL.render, current = 'lists';
    PL.render = function (el) {
      var admin = w.SSMPDAuth && w.SSMPDAuth.currentAdmin;
      if (!admin || !w.SSMPDRoles || !w.SSMPDRoles.canModuleAction(admin, 'price_lists', 'view')) return base(el);
      el.innerHTML = '<nav class="ll-tabs" role="tablist"><button type="button" role="tab" data-ll-tab="lists">لوائح الأسعار</button><button type="button" role="tab" data-ll-tab="labs">ربط تحاليل المعمل</button></nav><div data-ll-pane></div>';
      function show(tab) {
        current = tab;
        el.querySelectorAll('[data-ll-tab]').forEach(function (b) { var on = b.dataset.llTab === tab; b.setAttribute('aria-selected', String(on)); b.classList.toggle('on', on); });
        var pane = el.querySelector('[data-ll-pane]');
        pane.innerHTML = '';
        if (tab === 'labs') render(pane); else base(pane);
      }
      el.querySelectorAll('[data-ll-tab]').forEach(function (b) { b.onclick = function () { show(b.dataset.llTab); }; });
      show(current);
    };
  }
})(window);
