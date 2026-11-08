/* «سداد ضريبة المرتبات» — accounting tab for the employee income tax withheld from salaries and paid to the tax authority.
   Shows, for a month: the total due (from the HR tax register), what payroll actually withheld, what was already paid (approved / waiting for approval),
   what is left, and the balance of the liability account (2142). «تسجيل سداد» creates the EXISTING statutory_payment request (Dr 2142 / Cr cash or bank) which a different person approves.
   Server: clinic_finance_tax_month / clinic_finance_tax_pay (migration 20261109130000, not applied until the owner approves).
   Chains onto SSMPDFinanceControls like finance-doctor-accounts.js does; registered in finance-cash.js (group «الصرف والمستحقات»). */
(function () {
  'use strict';
  var prior = window.SSMPDFinanceControls;
  if (!prior) return;
  var TAB = 'staff-tax', cache = {}, month = null, loading = false;
    var PSTATUS = { pending: 'بانتظار الاعتماد', approved: 'معتمد ومرحّل', rejected: 'مرفوض' };

  function db() { return window.SSMPDDb; }
  function current(d) { return month || (d.today || '').slice(0, 7); }
  function redraw() {
    var cash = window.SSMPDFinanceCash;
    if (!cash || typeof cash.navigate !== 'function' || document.querySelector('.fc-modal')) return;
    if (!document.querySelector('[data-st-tab]')) return;
    cash.navigate(TAB);
  }
  function fetchMonth(m, force) {
    if (loading) return;
    if (!force && cache[m]) return;
    loading = true;
    var d = db();
    Promise.resolve().then(function () {
      if (!d || typeof d.financeTaxMonth !== 'function') throw Object.assign(new Error('missing'), { missing: true });
      return d.financeTaxMonth(m + '-01', 'salary_income');
    }).then(function (v) { cache[m] = { ok: true, v: v || {} }; }, function (e) { cache[m] = { ok: false, error: e }; })
      .then(function () { loading = false; redraw(); });
  }

  function panelHtml(d, h) {
    var m = current(d), e = h.esc, money = h.money, b = h.btn;
    fetchMonth(m);
    var head = '<div data-st-tab><p>إجمالي ضريبة المرتبات المستحقة للجهة عن الشهر من سجل ضريبة الدخل في الموارد البشرية، وما اتخصم فعلًا من المرتبات، وما اتسدد وما فاضل. السداد يمرّ على اعتماد شخص آخر قبل ما يترحّل.</p>' +
      '<div class="fc-actions"><label>الشهر <input type="month" name="st_month" data-st-month value="' + e(m) + '"></label>' + b('staff-tax-refresh', '', 'تحديث') + '</div>';
    var c = cache[m];
    if (!c) return head + '<p role="status">جاري تحميل بيانات الشهر…</p></div>';
    if (!c.ok) {
      var msg = String((c.error && c.error.message) || '');
      return head + '<p role="alert">' + (c.error && c.error.missing || /404|schema cache|tax_month/i.test(msg) ? 'سداد ضريبة المرتبات يحتاج تطبيق تحديث قاعدة البيانات أولًا.' : e(msg || 'تعذر تحميل البيانات')) + '</p></div>';
    }
    var s = c.v, remaining = Number(s.remaining || 0), withheldGap = Number(s.total_due || 0) - Number(s.payroll_withheld || 0);
    var cards = [['إجمالي المستحق للجهة', s.total_due], ['المخصوم فعليًا في المرتبات', s.payroll_withheld],
      ['مسدّد (معتمد)', s.paid_approved], ['بانتظار الاعتماد', s.paid_pending], ['المتبقي للسداد', s.remaining], ['رصيد ضرائب الأجور المستحقة (2142)', s.liability_balance]];
    var html = head + '<div class="fc-st-cards" data-st-cards>' + cards.map(function (x) { return '<div class="fc-st-card"><span>' + e(x[0]) + '</span><strong>' + money(x[1]) + '</strong></div>'; }).join('') + '</div>';
    if (Math.abs(withheldGap) >= 0.01) html += '<p class="fc-note" data-st-gap>تنبيه: إجمالي السجل (' + money(s.total_due) + ') يختلف عن المخصوم فعليًا في المرتبات المعتمدة (' + money(s.payroll_withheld) + '). راجع المرتبات أو السجل قبل السداد.</p>';
    if (remaining > Number(s.liability_balance || 0) + 0.005) html += '<p class="fc-note" data-st-cap>المتبقي أكبر من رصيد ضرائب الأجور المثبت في الدفاتر (' + money(s.liability_balance) + '): السداد الذي يتجاوز الرصيد لن يُعتمد.</p>';
    html += (d.can_create && remaining > 0 ? '<div class="fc-actions">' + b('staff-tax-pay', m, 'تسجيل سداد للمصلحة') + '</div>' : '');
    html += '<h4>ضريبة كل موظف في الشهر</h4>' + (s.lines && s.lines.length ? h.table(['الموظف', 'الوعاء الخاضع', 'الضريبة المستقطعة', 'مرجع المستند'], s.lines.map(function (l) {
      return [e(l.full_name) + ' <small>' + e(l.code) + '</small>', l.taxable_base == null ? '—' : money(l.taxable_base), money(l.amount), e(l.reference || '—')];
    })) : '<p class="fc-note">لا توجد ضريبة مسجلة لهذا الشهر في الموارد البشرية.</p>');
    html += '<h4>عمليات السداد عن الشهر</h4>' + (s.payments && s.payments.length ? h.table(['المرجع', 'المبلغ', 'الحالة', 'ملاحظة'], s.payments.map(function (p) {
      return [e(p.reference), money(p.amount), e(PSTATUS[p.status] || p.status), e(p.review_note || p.note || '')];
    })) : '<p class="fc-note">لم يُسجل سداد بعد.</p>');
    return html + '</div>';
  }

  function pay(m, d, h) {
    var c = cache[m]; if (!c || !c.ok) return true;
    var s = c.v, f = h.field, sel = h.select, shifts = (d.active_shifts || []).filter(function (x) { return x.cashier_id === d.me; }).map(function (x) { return [x.id, x.register_name]; });
    h.modal('تسجيل سداد ضريبة مرتبات شهر ' + m, '<p>المتبقي للشهر: ' + h.money(s.remaining) + ' جنيه. يُنشأ طلب سداد يعتمده شخص آخر ثم يُرحَّل من حساب ضرائب الأجور المستحقة.</p>' +
      f('amount', 'المبلغ المسدد للجهة', 'number', Number(s.remaining), 'required min="0.01" step="0.01"') + sel('method', 'قناة السداد', [['bank', 'تحويل بنكي'], ['cash', 'نقدي']]) + (shifts.length ? sel('shift_id', 'الوردية النقدية (للنقدي فقط)', shifts) : '') +
      f('reference', 'رقم إيصال أو مرجع السداد للمصلحة', 'text', '', 'required minlength="2"') + f('note', 'شرح السداد', 'text', 'سداد ضريبة مرتبات شهر ' + m, 'required minlength="3"'),
      function (v, k) {
        if (v.method === 'cash' && !v.shift_id) throw new Error('السداد النقدي يحتاج وردية نقدية مفتوحة باسمك');
        return Promise.resolve(db().financeTaxPay(m + '-01', 'salary_income', Number(v.amount), v.method, v.method === 'cash' ? v.shift_id : null, v.reference, v.note, k)).then(function (r) { delete cache[m]; return r; });
      });
    return true;
  }

  function panel(tab, d, h) { return tab === TAB ? panelHtml(d, h) : prior.panel(tab, d, h); }
  function act(action, id, d, h) {
    if (action === 'staff-tax-refresh') { fetchMonth(current(d), true); return true; }
    if (action === 'staff-tax-pay') return pay(id || current(d), d, h);
    return prior.act(action, id, d, h);
  }
  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (!t || !t.matches || !t.matches('[data-st-month]') || !/^\d{4}-\d{2}$/.test(t.value)) return;
    month = t.value; fetchMonth(month); redraw();
  });
  window.SSMPDFinanceControls = { panel: panel, act: act, due: prior.due };
})();
