(function (w) {
  'use strict';
  // HR custody register (سجل العهد): a permanent list of items handed to people. Server: hr_custody_workspace / hr_custody_command (migration 20261109110000).
  // Mounted by hr-navigation.js into the «العهد» section; it loads only when that section is the open one.
  var STATUS = { in_store: 'في المخزن', with_holder: 'مع موظف', lost: 'مفقودة', damaged: 'تالفة' };
  var CATEGORY = { device: 'جهاز', keys: 'مفاتيح', card: 'بطاقة', tools: 'أدوات', document: 'عقد أو مستند', other: 'أخرى' };
  var MOVE = { create: 'تسجيل البند', issue: 'تسليم', transfer: 'تحويل', return: 'إرجاع', lost: 'تسجيل فقد', damaged: 'تسجيل تلف', update: 'تعديل البيانات' };
  function esc(v) { return w.SSMPDWorkforceUtils.escape(v); }
  function money(v) { return Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function opts(map) { return Object.keys(map).map(function (k) { return [k, map[k]]; }); }
  function btn(action, label, id) { return '<button type="button" class="btn ghost" data-custody="' + action + '" data-id="' + esc(id || '') + '">' + esc(label) + '</button>'; }

  function mount(shell, active) {
    if (!shell || !active) return;
    var U = w.SSMPDWorkforceUtils, owner = w.SSMPDAuth && w.SSMPDAuth.currentAdmin && w.SSMPDAuth.currentAdmin.id, data = null, filter = { status: '', q: '' }, serial = 0;
    var host = document.createElement('div');
    host.dataset.hrCustody = '';
    shell.append(host);
    function live() { return host.isConnected && w.SSMPDAuth.currentAdmin && w.SSMPDAuth.currentAdmin.id === owner; }
    function item(id) { return data.items.find(function (x) { return x.id === id; }); }
    function people() { return data.people.map(function (p) { return [p.id, p.full_name + ' — ' + p.code]; }); }
    function command(action, payload) { return U.rpc('hr_custody_command', { p_action: action, p_payload: payload }).then(load); }

    function load() {
      var n = ++serial;
      host.innerHTML = '<p role="status">جاري تحميل سجل العهد…</p>';
      return U.rpc('hr_custody_workspace', {}).then(function (d) {
        if (!live() || n !== serial) return;
        data = d; draw();
      }).catch(function (err) {
        if (!live()) return;
        var missing = /hr_custody_workspace|404|schema cache/i.test(err.message || '');
        host.innerHTML = '<p role="alert">' + esc(missing ? 'سجل العهد غير مفعّل بعد على قاعدة البيانات' : err.message) + '</p>' + btn('retry', 'إعادة المحاولة');
        bind();
      });
    }

    function visible() {
      var q = filter.q.trim().toLowerCase();
      return data.items.filter(function (i) {
        if (filter.status && i.status !== filter.status) return false;
        if (!q) return true;
        return [i.item_name, i.code, i.serial_ref, i.description, i.holder_name].join(' ').toLowerCase().indexOf(q) >= 0;
      });
    }

    function actions(i) {
      var a = [];
      if (!data.can_manage) return btn('history', 'السجل', i.id);
      if (i.status === 'in_store') a.push(btn('issue', 'تسليم', i.id));
      if (i.status === 'with_holder') a.push(btn('transfer', 'تحويل', i.id), btn('return', 'إرجاع', i.id), btn('lost', 'فقد', i.id), btn('damaged', 'تلف', i.id));
      if (i.status === 'lost' || i.status === 'damaged') a.push(btn('return', 'إرجاع', i.id));
      a.push(btn('edit', 'تعديل', i.id), btn('history', 'السجل', i.id));
      return a.join('');
    }

    function rows() {
      return visible().map(function (i) {
        return [
          '<b>' + esc(i.item_name) + '</b><br><small>' + esc([i.code, CATEGORY[i.category], i.serial_ref, i.description].filter(Boolean).join(' · ')) + '</small>',
          money(i.value),
          i.holder_name ? esc(i.holder_name) : 'المخزن',
          esc(i.came_from_name || i.came_from_note || '—'),
          esc(i.issued_on || '—'),
          esc(i.returned_on || '—'),
          '<span data-custody-status="' + esc(i.status) + '">' + esc(STATUS[i.status] || i.status) + '</span>',
          actions(i)];
      });
    }

    function draw() {
      var items = data.items, held = items.filter(function (i) { return i.status === 'with_holder'; }), bad = items.filter(function (i) { return i.status === 'lost' || i.status === 'damaged'; });
      var sum = function (list) { return list.reduce(function (t, i) { return t + Number(i.value || 0); }, 0); };
      var cards = [['إجمالي البنود', items.length, ''], ['مع موظفين', held.length, money(sum(held))], ['مفقودة أو تالفة', bad.length, money(sum(bad))], ['في المخزن', items.filter(function (i) { return i.status === 'in_store'; }).length, '']];
      host.innerHTML = '<p>سجل دائم لكل عهدة: من استلمها ومن سلّمها ومتى. العهدة التي لم تُرجع تظهر تلقائيًا في مخالصة الموظف عند إنهاء الخدمة.</p>' +
        '<div class="wp-grid" data-custody-cards>' + cards.map(function (c) { return '<div class="wp-card"><b>' + esc(c[1]) + '</b><span>' + esc(c[0]) + '</span>' + (c[2] ? '<small>' + esc(c[2]) + ' ج.م</small>' : '') + '</div>'; }).join('') + '</div>' +
        '<div class="wp-actions">' + (data.can_manage ? btn('new', 'إضافة بند عهدة') : '') + U.select('custody_status', 'الحالة', [['', 'الكل']].concat(opts(STATUS)), filter.status) + U.field('custody_q', 'بحث بالبند أو الكود أو الشخص', 'search', filter.q) + '</div>' +
        '<div data-custody-table></div>';
      table(); bind();
      var s = host.querySelector('[name=custody_status]'), q = host.querySelector('[name=custody_q]');
      s.onchange = function () { filter.status = s.value; table(); bind(); };
      q.oninput = function () { filter.q = q.value; table(); bind(); };
    }

    function table() {
      var t = host.querySelector('[data-custody-table]'), r = rows();
      t.innerHTML = r.length ? U.table(['البند', 'القيمة', 'مع من الآن', 'خرج من عند', 'تاريخ الخروج', 'تاريخ الإرجاع', 'الحالة', 'الإجراء'], r) : '<p class="wn-empty">' + (data.items.length ? 'لا توجد بنود مطابقة' : 'لم تُسجل أي عهدة بعد') + '</p>';
    }

    function itemFields(i) {
      i = i || {};
      return U.field('item_name', 'اسم البند', 'text', i.item_name || '', 'required maxlength="200"') +
        U.select('category', 'النوع', opts(CATEGORY), i.category || 'other') +
        U.field('description', 'الوصف', 'text', i.description || '', 'maxlength="2000"') +
        U.field('serial_ref', 'الرقم التسلسلي أو المرجع', 'text', i.serial_ref || '', 'maxlength="200"') +
        U.field('value', 'القيمة بالجنيه', 'number', i.value == null ? '' : i.value, 'required min="0" step="0.01"');
    }

    function newItem() {
      var requestId = w.crypto.randomUUID();
      U.modal('إضافة بند عهدة', itemFields() + U.select('holder_id', 'يُسلَّم الآن إلى (اختياري)', [['', 'يبقى في المخزن']].concat(people()), '') +
        U.field('issued_on', 'تاريخ التسليم', 'date', data.today) + U.field('came_from_note', 'مصدر البند (اختياري)', 'text', '', 'maxlength="500"'), function (v) {
        return command('create', { request_id: requestId, item_name: v.item_name, category: v.category, description: v.description, serial_ref: v.serial_ref, value: v.value, holder_id: v.holder_id, issued_on: v.issued_on, came_from_note: v.came_from_note });
      });
    }

    function act(action, id) {
      var i = id && item(id);
      if (action === 'new') return newItem();
      if (action === 'retry') return load();
      if (action === 'history') return history(i);
      if (action === 'issue' || action === 'transfer') {
        var list = people().filter(function (p) { return p[0] !== i.holder_id; });
        return U.modal((action === 'issue' ? 'تسليم: ' : 'تحويل: ') + i.item_name, U.select('holder_id', 'إلى', list, '') + U.field('issued_on', 'تاريخ التسليم', 'date', data.today, 'required'), function (v) {
          return command(action, { id: id, revision: i.revision, holder_id: v.holder_id, issued_on: v.issued_on });
        });
      }
      if (action === 'return') {
        return U.modal('إرجاع: ' + i.item_name, U.field('returned_on', 'تاريخ الإرجاع', 'date', data.today, 'required') + U.field('note', 'ملاحظة (اختياري)', 'text', ''), function (v) {
          return command('return', { id: id, revision: i.revision, returned_on: v.returned_on, note: v.note });
        });
      }
      if (action === 'lost' || action === 'damaged') {
        return U.modal((action === 'lost' ? 'تسجيل فقد: ' : 'تسجيل تلف: ') + i.item_name, '<p class="wp-wide">تبقى العهدة على ' + esc(i.holder_name) + ' وتُحسب قيمتها (' + money(i.value) + ' ج.م) في مخالصته.</p>' + U.field('note', 'السبب', 'text', '', 'required minlength="3"'), function (v) {
          return command(action, { id: id, revision: i.revision, note: v.note });
        });
      }
      if (action === 'edit') {
        return U.modal('تعديل: ' + i.item_name, itemFields(i) + U.field('note_change', 'سبب تغيير القيمة (إن تغيّرت)', 'text', ''), function (v) {
          return command('update', { id: id, revision: i.revision, item_name: v.item_name, category: v.category, description: v.description, serial_ref: v.serial_ref, value: v.value, note: v.note_change });
        });
      }
    }

    function history(i) {
      var f = U.modal('سجل: ' + i.item_name, '<div class="wp-wide" data-custody-history></div>', function () { return true; });
      var list = data.movements.filter(function (m) { return m.item_id === i.id; });
      f.querySelector('[data-custody-history]').innerHTML = U.table(['التاريخ', 'الإجراء', 'من', 'إلى', 'ملاحظة'], list.map(function (m) {
        return [esc(m.on_date), esc(MOVE[m.action] || m.action), esc(m.from_name || '—'), esc(m.to_name || '—'), esc(m.note || '')];
      }));
    }

    function fail(err) { host.insertAdjacentHTML('afterbegin', '<p role="alert">' + esc(err.message) + '</p>'); }
    function bind() {
      host.querySelectorAll('[data-custody]').forEach(function (n) {
        n.onclick = function () { try { var r = act(n.dataset.custody, n.dataset.id); if (r && r.catch) r.catch(fail); } catch (err) { fail(err); } };
      });
    }
    load();
  }
  w.SSMPDHRCustody = { mount: mount };
})(window);
