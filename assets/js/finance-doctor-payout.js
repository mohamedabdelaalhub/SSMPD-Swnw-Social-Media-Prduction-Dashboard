/* Doctor payout, Phase 2 UI hook (separate small file; chains onto SSMPDFinanceControls like finance-channels.js, does not touch finance-doctors.js or db.js).
   - payout form: tax % and withholding % inputs, the withheld amount is COMPUTED (read-only) = round(gross*tax%)+round(gross*withholding%), live net line, 0..100 / sum<=100 checks,
     and (when db.financeDoctorPayable exists, see docs/payout-phase2-ui-patch.md) a "payable now" hint that also caps the gross field.
   - payout review button: tells users who are not the financial manager that review is not theirs (the server enforces it anyway).
   The server (migration 20261108260000) re-validates everything; this file only helps the user and never decides. */
(function () {
  'use strict';
  var prior = window.SSMPDFinanceControls;
  if (!prior) return;
  var info = null, loading = false;

  function money(v) { return Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function cents(x) { return Math.round(Number(x || 0) * 100); }
  function hundredths(x) { return Math.round(Number(x || 0) * 100); }
  // half-up rounding on integers, same as numeric round() in Postgres for positive values
  function part(grossCents, pctHundredths) { return Math.floor((grossCents * pctHundredths + 5000) / 10000); }

  function refresh(key) {
    var db = window.SSMPDDb;
    if (loading || !db || typeof db.financeDoctorPayable !== 'function') return Promise.resolve(info);
    loading = true;
    return Promise.resolve(db.financeDoctorPayable(key || null)).then(function (r) { info = r || info; loading = false; return info; }, function () { loading = false; return info; });
  }
  function doctorRow(key) {
    var list = (info && info.doctors) || [];
    for (var i = 0; i < list.length; i++) if (list[i].doctor_key === key) return list[i];
    return null;
  }

  function enhance(h) {
    var form = document.querySelector('.fc-modal form');
    if (!form || !form.elements.gross || !form.elements.withheld) return;
    var wl = form.elements.withheld.closest('label');
    wl.insertAdjacentHTML('beforebegin',
      h.field('tax_pct', 'نسبة الضريبة %', 'number', '0', 'required min="0" max="100" step="0.01"') +
      h.field('withholding_pct', 'نسبة الاستقطاع %', 'number', '0', 'required min="0" max="100" step="0.01"'));
    form.elements.withheld.readOnly = true;
    wl.firstChild.textContent = 'إجمالي الضريبة والاستقطاع (محسوب)';
    var box = document.createElement('p');
    box.className = 'fc-note'; box.setAttribute('data-payout-sum', 'yes');
    wl.insertAdjacentElement('afterend', box);

    function available() {
      var r = doctorRow(form.elements.doctor_key && form.elements.doctor_key.value);
      return r ? Number(r.available_now) : null;
    }
    function recalc() {
      var g = cents(form.elements.gross.value), tp = Number(form.elements.tax_pct.value || 0), wp = Number(form.elements.withholding_pct.value || 0);
      var dec = function (x) { return Math.abs(x * 100 - Math.round(x * 100)) < 1e-6; };
      var bad = !(tp >= 0 && wp >= 0 && tp <= 100 && wp <= 100 && tp + wp <= 100 && dec(tp) && dec(wp));
      var t = part(g, hundredths(tp)), w = part(g, hundredths(wp));
      form.elements.withheld.value = ((t + w) / 100).toFixed(2);
      form.elements.tax_pct.setCustomValidity(bad ? 'النسب بين 0 و100 ومجموعها لا يتجاوز 100 وبحد أقصى خانتين عشريتين' : '');
      var av = available(), over = av != null && g / 100 > av + 1e-9;
      form.elements.gross.setCustomValidity(over ? 'المبلغ يتجاوز المستحق للصرف الآن (' + money(av) + ')' : '');
      box.textContent = 'الإجمالي ' + money(g / 100) + ' — ضريبة ' + money(t / 100) + ' — استقطاع ' + money(w / 100) + ' — الصافي للدكتور ' + money((g - t - w) / 100) +
        (av != null ? ' — المتاح للصرف الآن ' + money(av) : '') + (bad ? ' — راجع النسب' : '');
    }
    ['gross', 'tax_pct', 'withholding_pct'].forEach(function (n) { form.elements[n].addEventListener('input', recalc); });
    if (form.elements.doctor_key) form.elements.doctor_key.addEventListener('change', function () { refresh(form.elements.doctor_key.value).then(recalc); recalc(); });
    refresh(null).then(recalc);
    recalc();
  }

  function panel(tab, d, h) {
    if (tab === 'doctors') refresh(null);
    return prior.panel(tab, d, h);
  }
  function act(action, id, d, h) {
    if (action === 'doctor-payout') { var r = prior.act(action, id, d, h); enhance(h); return r; }
    if (action === 'doctor-payout-review' && info && info.can_review_payouts === false) {
      if (window.SSMPDToast && window.SSMPDToast.show) window.SSMPDToast.show('مراجعة صرف مستحقات الأطباء للمدير المالي فقط', 'error');
      return true;
    }
    return prior.act(action, id, d, h);
  }
  window.SSMPDFinancePayout = { part: part, refresh: refresh };
  window.SSMPDFinanceControls = { panel: panel, act: act, due: prior.due };
})();
