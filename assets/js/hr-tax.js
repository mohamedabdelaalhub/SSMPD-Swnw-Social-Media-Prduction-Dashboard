(function (w) {
  'use strict';
  // HR monthly register of income tax withheld from salaries (ضريبة الدخل). Server: hr_tax_workspace / hr_tax_command (migration 20261109150000).
  // Mounted by hr-navigation.js into the «ضريبة الدخل» section; loads only when open. Amounts are typed from the tax document (nothing is computed here).
  // tax_type: only «salary_income» exists today; the server returns the active types, so doctors' / center taxes will appear here without a new screen once the owner sends their details.
  function esc(v) { return w.SSMPDWorkforceUtils.escape(v); }
  function money(v) { return Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function btn(action, label, id) { return '<button type="button" class="btn ghost" data-tax="' + action + '" data-id="' + esc(id || '') + '">' + esc(label) + '</button>'; }

  function mount(shell, active) {
    if (!shell || !active) return;
    var U = w.SSMPDWorkforceUtils, owner = w.SSMPDAuth && w.SSMPDAuth.currentAdmin && w.SSMPDAuth.currentAdmin.id, data = null, month = '', serial = 0;
    var host = document.createElement('div');
    host.dataset.hrTax = '';
    shell.append(host);
    function live() { return host.isConnected && w.SSMPDAuth.currentAdmin && w.SSMPDAuth.currentAdmin.id === owner; }
    function item(id) { return data.items.find(function (x) { return x.id === id; }); }
    function command(action, payload) { return U.rpc('hr_tax_command', { p_action: action, p_payload: payload }).then(load); }

    function load() {
      var n = ++serial;
      host.innerHTML = '<p role="status">جاري تحميل سجل الضريبة…</p>';
      return U.rpc('hr_tax_workspace', { p_month: month ? month + '-01' : null }).then(function (d) {
        if (!live() || n !== serial) return;
        data = d; month = String(d.month).slice(0, 7); draw();
      }).catch(function (err) {
        if (!live()) return;
        var missing = /hr_tax_workspace|404|schema cache/i.test(err.message || '');
        host.innerHTML = '<p role="alert">' + esc(missing ? 'سجل ضريبة الدخل غير مفعّل بعد على قاعدة البيانات' : err.message) + '</p>' + btn('retry', 'إعادة المحاولة');
        bind();
      });
    }

    function typeName(code) { var t = data.tax_types.find(function (x) { return x.code === code; }); return t ? t.name : code; }

    function draw() {
      var total = data.items.reduce(function (t, i) { return t + Number(i.amount || 0); }, 0);
      var rows = data.items.map(function (i) {
        return ['<b>' + esc(i.full_name) + '</b><br><small>' + esc(i.code) + '</small>', esc(typeName(i.tax_type)), i.taxable_base == null ? '—' : money(i.taxable_base), money(i.amount), esc(i.reference || '—'), data.can_manage ? btn('edit', 'تعديل', i.id) : '—'];
      });
      host.innerHTML = '<p>الضريبة المستقطعة من مرتب كل موظف في الشهر (من مستند الضريبة). الرقم هنا هو الذي يظهر تلقائيًا في شاشة حساب المرتب، والحسابات تسدّد إجمالي الشهر للجهة من «سداد ضريبة المرتبات».</p>' +
        '<div class="wp-actions">' + U.field('tax_month', 'الشهر', 'month', month, 'required') + (data.can_manage ? btn('new', 'تسجيل ضريبة موظف') : '') + '</div>' +
        '<div class="wp-grid" data-tax-cards><div class="wp-card"><b>' + esc(data.items.length) + '</b><span>موظفين عليهم ضريبة</span></div><div class="wp-card"><b>' + esc(money(total)) + '</b><span>إجمالي المستحق للجهة عن الشهر</span></div></div>' +
        (rows.length ? U.table(['الموظف', 'نوع الضريبة', 'الوعاء الخاضع', 'الضريبة المستقطعة', 'مرجع المستند', 'الإجراء'], rows) : '<p class="wn-empty">لم تُسجل ضريبة لهذا الشهر</p>');
      var m = host.querySelector('[name=tax_month]');
      m.onchange = function () { if (/^\d{4}-\d{2}$/.test(m.value)) { month = m.value; load(); } };
      bind();
    }

    function amountFields(i) {
      i = i || {};
      return U.field('amount', 'الضريبة المستقطعة بالجنيه', 'number', i.amount == null ? '' : i.amount, 'required min="0" step="0.01"') +
        U.field('taxable_base', 'الوعاء الخاضع للضريبة (اختياري)', 'number', i.taxable_base == null ? '' : i.taxable_base, 'min="0" step="0.01"') +
        U.field('reference', 'مرجع مستند الضريبة', 'text', i.reference || '', 'maxlength="200"');
    }

    function act(action, id) {
      var i = id && item(id);
      if (action === 'retry') return load();
      if (action === 'new') {
        var requestId = w.crypto.randomUUID();
        return U.modal('تسجيل ضريبة مرتب — ' + month, U.select('person_id', 'الموظف', data.people.map(function (p) { return [p.id, p.full_name + ' — ' + p.code]; }), '') + amountFields(), function (v) {
          return command('create', { request_id: requestId, person_id: v.person_id, month: month + '-01', tax_type: 'salary_income', amount: v.amount, taxable_base: v.taxable_base, reference: v.reference });
        });
      }
      if (action === 'edit') {
        return U.modal('تعديل ضريبة: ' + i.full_name, amountFields(i) + U.field('reason', 'سبب تغيير المبلغ (إن تغيّر)', 'text', ''), function (v) {
          return command('update', { id: id, revision: i.revision, amount: v.amount, taxable_base: v.taxable_base, reference: v.reference, reason: v.reason });
        });
      }
    }

    function fail(err) { host.insertAdjacentHTML('afterbegin', '<p role="alert">' + esc(err.message) + '</p>'); }
    function bind() {
      host.querySelectorAll('[data-tax]').forEach(function (n) {
        n.onclick = function () { try { var r = act(n.dataset.tax, n.dataset.id); if (r && r.catch) r.catch(fail); } catch (err) { fail(err); } };
      });
    }
    load();
  }
  w.SSMPDHRTax = { mount: mount };
})(window);
