/* Doctor dues BY INVOICE: lists EVERY case the doctor treated (payable now / requested / paid / waiting for the patient share / waiting for the insurer / service without a contract),
   the accountant ticks the invoices to pay now (select-all of the payable ones, running total) and the payout request carries exactly those invoices.
   Reads db.financeDoctorDues() and sends db.financePayoutInvoices() (migration 20261109100000, not applied until the owner approves). The server re-validates everything:
   only fully paid invoices, none already in a pending/approved payout, gross = sum of their fees, the existing payable-now cap, tax rules and financial-manager review. */
(function () {
  'use strict';
  var prior = window.SSMPDFinanceControls;
  if (!prior) return;
  var ST = { payable: ['مستحق للصرف الآن', 'paid'], requested: ['طلب صرف معلّق', 'insurance'], paid_out: ['تم صرفه', 'paid'], waiting_patient: ['بانتظار حصة المريض', 'credit'], waiting_insurer: ['بانتظار التأمين', 'insurance'], waiting_both: ['بانتظار المريض والتأمين', 'insurance'] };
  var NC = { none: 'مفيش عقد ساري يغطي الخدمة', starts_later: 'العقد بيبدأ بعد تاريخ التنفيذ', expired: 'العقد انتهى قبل تاريخ التنفيذ', pending: 'العقد لسه قيد الاعتماد' };

  function cents(x) { return Math.round(Number(x || 0) * 100); }
  function part(grossCents, pct) { return Math.floor((grossCents * Math.round(Number(pct || 0) * 100) + 5000) / 10000); }   // half-up, same as the server's round()

  function note(inv, m) {
    var left = Math.max(0, cents(inv.net) - cents(inv.collected)) / 100;
    switch (inv.dues_status) {
      case 'waiting_patient': return Number(inv.patient_open) > 0 ? 'متبقي على المريض ' + m(inv.patient_open) : (Number(inv.collected) > 0 ? 'مدفوعة جزئيًا — متبقي ' + m(left) : 'آجل — لم يُسدَّد شيء');
      case 'waiting_insurer': return 'متبقي على التأمين' + (inv.insurer ? ' (' + inv.insurer + ')' : '') + ' ' + m(inv.insurer_open != null ? inv.insurer_open : left);
      case 'waiting_both': return 'المريض ' + m(inv.patient_open) + ' + التأمين' + (inv.insurer ? ' (' + inv.insurer + ')' : '') + ' ' + m(inv.insurer_open);
      case 'requested': return 'داخلة في طلب صرف ينتظر المراجعة';
      case 'paid_out': return 'اتصرفت أتعابها';
      default: return 'اتسددت بالكامل';
    }
  }

  function open(id, d, h) {
    var db = window.SSMPDDb, e = h.esc, m = h.money, f = h.field, s = h.select;
    var to = d.today || new Date().toISOString().slice(0, 10), from = new Date(Date.parse(to) - 365 * 864e5).toISOString().slice(0, 10), st = null;
    var who = ((d.doctor_contracts || []).filter(function (x) { return x.doctor_key === id; })[0] || {}).doctor_name || id;
    if (!db || typeof db.financeDoctorDues !== 'function' || typeof db.financePayoutInvoices !== 'function') {
      h.modal('صرف مستحقات بالفواتير — ' + who, '<p>الميزة غير متاحة في هذا الإصدار.</p>', function () { return Promise.resolve(); }); return true;
    }
    h.modal('صرف مستحقات بالفواتير — ' + who, '<div data-dues-body><p class="fc-note">جاري تحميل فواتير الدكتور…</p></div>', function (v, k) {
      if (!st) throw new Error('البيانات لسه بتتحمل');
      var ids = [].map.call(document.querySelectorAll('.fc-modal [data-dues-row]:checked'), function (x) { return x.value; });
      if (!ids.length) throw new Error('اختر فاتورة واحدة على الأقل');
      var total = ids.reduce(function (sum, i) { return sum + cents(st.fee[i]); }, 0) / 100;
      if (total > Number(st.dues.available_now) + 0.004) throw new Error('المحدد (' + m(total) + ') أكبر من المتاح للصرف حسب رصيد الدكتور (' + m(st.dues.available_now) + ')');
      return db.financePayoutInvoices(id, ids, Number(v.tax_pct), Number(v.withholding_pct), v.method, v.method === 'cash' ? (v.shift_id || null) : null, v.reference, from, to, k);
    });
    var form = document.querySelector('.fc-modal form'), box = form && form.querySelector('[data-dues-body]');
    Promise.resolve(db.financeDoctorDues(id, from, to)).then(function (r) {
      if (!box || !box.isConnected) return;
      var invs = r.invoices || [], fee = {}, dues = r.dues || {};
      invs.forEach(function (i) { fee[i.invoice_id] = i.fee; });
      st = { fee: fee, dues: dues };
      var payable = invs.filter(function (i) { return i.selectable; });
      var html = '<div class="fc-st-cards"><div class="fc-st-card ok"><span>مستحق للصرف الآن (' + payable.length + ' فاتورة)</span><strong>' + m(dues.payable_total) + '</strong></div>' +
        '<div class="fc-st-card wait"><span>بانتظار التحصيل</span><strong>' + m(dues.waiting_total) + '</strong></div>' +
        '<div class="fc-st-card"><span>المتاح للصرف حسب الرصيد</span><strong>' + m(dues.available_now) + '</strong></div></div>';
      html += '<p class="fc-note">كل حالات الدكتور موجودة تحت. اختر الفواتير اللي هتصرف أتعابها دلوقتي (المستحقة بس تتحدد). اللي مش مختارة تفضل مستحقة للصرف بعدين، واللي اتصرفت أو داخلة في طلب معلّق مش بتظهر للاختيار تاني.</p>';
      if (payable.length) html += '<label class="fc-check"><input type="checkbox" data-dues-all>تحديد كل المستحق للصرف الآن (' + payable.length + ')</label>';
      html += '<div data-dues-list>' + h.table(['اختيار', 'التاريخ', 'الفاتورة', 'الخدمات', 'الأتعاب', 'الحالة', 'التفاصيل'], invs.map(function (i) {
        var info = ST[i.dues_status] || [i.dues_status, 'credit'], lines = (i.lines || []).map(function (l) { return e(l.service_name || l.service_code); }).join('، ') || '—';
        return [i.selectable ? '<input type="checkbox" data-dues-row value="' + e(i.invoice_id) + '" aria-label="اختيار ' + e(i.reference) + '">' : '—', e(i.date), e(i.reference) + (i.patient_ref ? '<br><small>' + e(i.patient_ref) + '</small>' : ''), lines, m(i.fee),
          '<span class="fc-st-badge ' + e(info[1]) + '">' + e(info[0]) + '</span>', e(note(i, m))];
      }).concat((r.uncovered || []).map(function (u) {
        return ['—', e(u.date), '—', e((u.service_name || u.service_code) + ' (' + u.service_code + ')'), '—', '<span class="fc-st-badge credit">بدون عقد ساري</span>', e(NC[u.reason] || u.reason) + ' — ' + m(u.amount)];
      }))) + '</div>';
      if (!invs.length) html += '<p class="fc-note">مفيش فواتير ليها أتعاب للدكتور في آخر سنة.</p>';
      html += '<div class="fc-st-cards"><div class="fc-st-card ok"><span>إجمالي المحدد</span><strong data-dues-total>0.00</strong></div></div>' +
        f('tax_pct', 'نسبة الضريبة %', 'number', '0', 'required min="0" max="100" step="0.01"') + f('withholding_pct', 'نسبة الاستقطاع %', 'number', '0', 'required min="0" max="100" step="0.01"') +
        '<p class="fc-note" data-dues-sum></p>' + s('method', 'طريقة الصرف', [['bank', 'تحويل بنكي'], ['cash', 'نقدي'], ['instapay', 'إنستا باي']]) +
        s('shift_id', 'الوردية النقدية', (d.active_shifts || []).map(function (x) { return [x.id, x.register_name]; })) + f('reference', 'مرجع السداد أو التحويل');
      box.innerHTML = html;
      var fm = box.closest('form'), all = box.querySelector('[data-dues-all]');
      function rows() { return [].slice.call(box.querySelectorAll('[data-dues-row]')); }
      function recalc() {
        var total = rows().filter(function (x) { return x.checked; }).reduce(function (sum, x) { return sum + cents(fee[x.value]); }, 0);
        box.querySelector('[data-dues-total]').textContent = m(total / 100);
        var tp = fm.elements.tax_pct.value, wp = fm.elements.withholding_pct.value, t = part(total, tp), w = part(total, wp);
        box.querySelector('[data-dues-sum]').textContent = 'الإجمالي ' + m(total / 100) + ' — ضريبة ' + m(t / 100) + ' — استقطاع ' + m(w / 100) + ' — الصافي للدكتور ' + m((total - t - w) / 100) + (total / 100 > Number(dues.available_now) + 0.004 ? ' — أكبر من المتاح للصرف (' + m(dues.available_now) + ')' : '');
        if (all) all.checked = rows().length > 0 && rows().every(function (x) { return x.checked; });
      }
      if (all) all.onchange = function () { rows().forEach(function (x) { x.checked = all.checked; }); recalc(); };
      box.addEventListener('change', function (ev) { if (ev.target && ev.target.hasAttribute && ev.target.hasAttribute('data-dues-row')) recalc(); });
      fm.elements.tax_pct.addEventListener('input', recalc); fm.elements.withholding_pct.addEventListener('input', recalc);
      function sync() { var cash = fm.elements.method.value === 'cash'; fm.elements.shift_id.disabled = !cash; fm.elements.shift_id.required = cash; fm.elements.shift_id.closest('label').hidden = !cash; }
      fm.elements.method.onchange = sync; sync(); recalc();
    }).catch(function () {
      if (box && box.isConnected) box.innerHTML = '<p>تعذر تحميل فواتير الدكتور. الميزة تحتاج تطبيق تحديث قاعدة البيانات أولًا.</p>';
    });
    return true;
  }

  function act(action, id, d, h) {
    if (action === 'doctor-dues') return open(id, d, h);
    return prior.act(action, id, d, h);
  }
  window.SSMPDDoctorDues = { part: part };
  window.SSMPDFinanceControls = { panel: prior.panel, act: act, due: prior.due };
})();
