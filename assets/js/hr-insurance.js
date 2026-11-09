(function (w) {
  'use strict';
  // HR social + medical insurance register (التأمينات). Server: hr_insurance_workspace / hr_insurance_command (migration 20261109120000).
  // Mounted by hr-navigation.js into the «التأمينات» section; loads only when that section is open. The notification deadline is a MANUAL field (no legal days are computed).
  var TYPE = { social: 'تأمينات اجتماعية', medical: 'تأمين طبي' };
  var STATUS = { active: 'مشترك', stopped: 'موقوف' };
  function esc(v) { return w.SSMPDWorkforceUtils.escape(v); }
  function money(v) { return Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function opts(map) { return Object.keys(map).map(function (k) { return [k, map[k]]; }); }
  function btn(action, label, id) { return '<button type="button" class="btn ghost" data-insurance="' + action + '" data-id="' + esc(id || '') + '">' + esc(label) + '</button>'; }

  function mount(shell, active) {
    if (!shell || !active) return;
    var U = w.SSMPDWorkforceUtils, owner = w.SSMPDAuth && w.SSMPDAuth.currentAdmin && w.SSMPDAuth.currentAdmin.id, data = null, filter = { type: '', status: 'active', q: '' }, serial = 0;
    var host = document.createElement('div');
    host.dataset.hrInsurance = '';
    shell.append(host);
    function live() { return host.isConnected && w.SSMPDAuth.currentAdmin && w.SSMPDAuth.currentAdmin.id === owner; }
    function item(id) { return data.items.find(function (x) { return x.id === id; }); }
    function command(action, payload) { return U.rpc('hr_insurance_command', { p_action: action, p_payload: payload }).then(load); }

    function load() {
      var n = ++serial;
      host.innerHTML = '<p role="status">جاري تحميل سجل التأمينات…</p>';
      return U.rpc('hr_insurance_workspace', {}).then(function (d) {
        if (!live() || n !== serial) return;
        data = d; draw();
      }).catch(function (err) {
        if (!live()) return;
        var missing = /hr_insurance_workspace|404|schema cache/i.test(err.message || '');
        host.innerHTML = '<p role="alert">' + esc(missing ? 'سجل التأمينات غير مفعّل بعد على قاعدة البيانات' : err.message) + '</p>' + btn('retry', 'إعادة المحاولة');
        bind();
      });
    }

    function visible() {
      var q = filter.q.trim().toLowerCase();
      return data.items.filter(function (i) {
        if (filter.type && i.insurance_type !== filter.type) return false;
        if (filter.status && i.status !== filter.status) return false;
        return !q || [i.full_name, i.code, i.insurance_number].join(' ').toLowerCase().indexOf(q) >= 0;
      });
    }

    function actions(i) {
      if (!data.can_manage) return '—';
      return (i.status === 'active' ? btn('edit', 'تعديل', i.id) + btn('stop', 'إيقاف الاشتراك', i.id) : btn('edit', 'استكمال بيانات الإخطار', i.id));
    }

    function rows() {
      return visible().map(function (i) {
        return [
          '<b>' + esc(i.full_name) + '</b><br><small>' + esc(i.code) + '</small>',
          esc(TYPE[i.insurance_type] || i.insurance_type),
          esc(i.insurance_number || '—'),
          money(i.employee_deduction),
          money(i.center_share),
          '<span data-insurance-status="' + esc(i.status) + '">' + esc(STATUS[i.status] || i.status) + '</span>',
          esc(i.started_on || '—'),
          i.status === 'stopped' ? esc(i.stopped_on) + (i.stop_reference ? '<br><small>إخطار: ' + esc(i.stop_reference) + '</small>' : '') + '<br><small>' + (i.notification_deadline ? 'آخر موعد للإخطار: ' + esc(i.notification_deadline) : 'موعد الإخطار لم يُسجَّل') + '</small>' : '—',
          actions(i)];
      });
    }

    function draw() {
      var act = data.items.filter(function (i) { return i.status === 'active'; });
      var sum = function (k) { return act.reduce(function (t, i) { return t + Number(i[k] || 0); }, 0); };
      var cards = [['اشتراكات قائمة', act.length], ['استقطاع الموظفين شهريًا', money(sum('employee_deduction'))], ['حصة المركز شهريًا', money(sum('center_share'))], ['إجمالي المستحق للجهة شهريًا', money(sum('employee_deduction') + sum('center_share'))]];
      host.innerHTML = '<p>لكل موظف نوع التأمين ورقمه وقيمة الاستقطاع من المرتب وحصة المركز وحالة الاشتراك. هذه الأرقام تُقرأ تلقائيًا في شاشة حساب المرتب، والحسابات تسدّد للجهة من «سداد التأمينات».</p>' +
        '<div class="wp-grid" data-insurance-cards>' + cards.map(function (c) { return '<div class="wp-card"><b>' + esc(c[1]) + '</b><span>' + esc(c[0]) + '</span></div>'; }).join('') + '</div>' +
        '<div class="wp-actions">' + (data.can_manage ? btn('new', 'إضافة اشتراك') : '') + U.select('ins_type', 'النوع', [['', 'الكل']].concat(opts(TYPE)), filter.type) + U.select('ins_status', 'الحالة', [['', 'الكل']].concat(opts(STATUS)), filter.status) + U.field('ins_q', 'بحث بالاسم أو الكود أو رقم التأمين', 'search', filter.q) + '</div>' +
        '<div data-insurance-table></div>';
      table(); bind();
      [['ins_type', 'type', 'change'], ['ins_status', 'status', 'change'], ['ins_q', 'q', 'input']].forEach(function (c) {
        var n = host.querySelector('[name=' + c[0] + ']');
        n['on' + c[2]] = function () { filter[c[1]] = n.value; table(); bind(); };
      });
    }

    function table() {
      var t = host.querySelector('[data-insurance-table]'), r = rows();
      t.innerHTML = r.length ? U.table(['الموظف', 'النوع', 'رقم التأمين', 'استقطاع الموظف', 'حصة المركز', 'الحالة', 'بدأ في', 'الإيقاف', 'الإجراء'], r) : '<p class="wn-empty">' + (data.items.length ? 'لا توجد اشتراكات مطابقة' : 'لم تُسجل أي اشتراكات بعد') + '</p>';
    }

    function amountFields(i) {
      i = i || {};
      return U.field('insurance_number', 'رقم التأمين', 'text', i.insurance_number || '', 'maxlength="100"') +
        U.field('employee_deduction', 'استقطاع الموظف شهريًا من الراتب', 'number', i.employee_deduction == null ? 0 : i.employee_deduction, 'required min="0" step="0.01"') +
        U.field('center_share', 'حصة المركز شهريًا (إن وجدت)', 'number', i.center_share == null ? 0 : i.center_share, 'required min="0" step="0.01"');
    }

    function act(action, id) {
      var i = id && item(id);
      if (action === 'retry') return load();
      if (action === 'new') {
        var requestId = w.crypto.randomUUID();
        return U.modal('إضافة اشتراك', U.select('person_id', 'الموظف', data.people.map(function (p) { return [p.id, p.full_name + ' — ' + p.code]; }), '') + U.select('insurance_type', 'النوع', opts(TYPE), 'social') + amountFields() + U.field('started_on', 'تاريخ بدء الاشتراك', 'date', data.today, 'required'), function (v) {
          return command('create', { request_id: requestId, person_id: v.person_id, insurance_type: v.insurance_type, insurance_number: v.insurance_number, employee_deduction: v.employee_deduction, center_share: v.center_share, started_on: v.started_on });
        });
      }
      if (action === 'edit' && i.status === 'active') {
        return U.modal('تعديل اشتراك: ' + i.full_name, amountFields(i) + U.field('reason', 'سبب تغيير المبلغ (إن تغيّر)', 'text', ''), function (v) {
          return command('update', { id: id, revision: i.revision, insurance_number: v.insurance_number, employee_deduction: v.employee_deduction, center_share: v.center_share, reason: v.reason });
        });
      }
      if (action === 'edit') {
        return U.modal('بيانات الإخطار: ' + i.full_name, U.field('insurance_number', 'رقم التأمين', 'text', i.insurance_number || '') + U.field('stop_reference', 'رقم أو مرجع إخطار الإيقاف', 'text', i.stop_reference || '') +
          U.field('notification_deadline', 'آخر موعد للإخطار (يكتبه المسؤول يدويًا)', 'date', i.notification_deadline || ''), function (v) {
          return command('update', { id: id, revision: i.revision, insurance_number: v.insurance_number, stop_reference: v.stop_reference, notification_deadline: v.notification_deadline });
        });
      }
      if (action === 'stop') {
        return U.modal('إيقاف الاشتراك: ' + i.full_name + ' — ' + (TYPE[i.insurance_type] || ''), U.field('stopped_on', 'تاريخ الإيقاف', 'date', data.today, 'required') + U.field('stop_reference', 'رقم أو مرجع إخطار الإيقاف', 'text', '') +
          U.field('notification_deadline', 'آخر موعد للإخطار (يكتبه المسؤول يدويًا — لا يحسبه النظام)', 'date', '') + U.field('note', 'ملاحظة', 'text', ''), function (v) {
          return command('stop', { id: id, revision: i.revision, stopped_on: v.stopped_on, stop_reference: v.stop_reference, notification_deadline: v.notification_deadline, note: v.note });
        });
      }
    }

    function fail(err) { host.insertAdjacentHTML('afterbegin', '<p role="alert">' + esc(err.message) + '</p>'); }
    function bind() {
      host.querySelectorAll('[data-insurance]').forEach(function (n) {
        n.onclick = function () { try { var r = act(n.dataset.insurance, n.dataset.id); if (r && r.catch) r.catch(fail); } catch (err) { fail(err); } };
      });
    }
    load();
  }
  w.SSMPDHRInsurance = { mount: mount };
})(window);
