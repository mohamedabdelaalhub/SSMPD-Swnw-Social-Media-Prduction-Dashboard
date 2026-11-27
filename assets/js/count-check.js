/* «جرد الوردية: تأكيد العد + تنبيه لو مش مطابق» (owner 2026-11-25 «طبق تصور الجرد», server 20261125110000).
   gate(shiftId, counts, note) runs before every collection-shift handover (accountant workspace «إنهاء الوردية وتسليم النقد»,
   finance «جرد وإغلاق الوردية», peer handover «سلّم الوردية»):
     1) «راجع اللي كتبته»: denomination × count lines and the total the cashier entered (always) → «متأكد — سلّم» / «رجوع أعدّل»;
     2) clinic_finance_count_check('check') → when the count is not equal to the recorded collection (and the alert is on):
        «العد ده مش مطابق — عدّ تاني» with NO amount / difference → «أعدّ تاني» or «متأكد من العد — سلّم» (+ optional reason).
   Resolves with the note to send (reason appended); rejects to keep the count form open. If the check cannot be reached, the
   handover is never blocked. Also: the on/off setting box (settings tab) and the attempts line on «فروق الخزينة». */
(function (w, d) {
  'use strict';
  var DEN = ['200', '100', '50', '20', '10', '5', '1', '0.5', '0.25'];
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(v) { return Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function stamp(v) { var t = new Date(v); return isNaN(t) ? '—' : t.toLocaleTimeString('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit' }); }
  function rpc(name, args) { var c = w.SSMPDDb && w.SSMPDDb.client; if (!c || typeof c.rpc !== 'function') return Promise.reject(Error('تعذر الاتصال')); return Promise.resolve().then(function () { return c.rpc(name, args); }).then(function (r) { if (r && r.error) throw r.error; return r && r.data; }); }
  function errText(e) { var m = e && (e.message || e.details) || ''; return /[؀-ۿ]/.test(m) ? m : 'حصلت مشكلة ومقدرناش نكمل — جرّب تاني'; }
  function total(counts) { return DEN.reduce(function (s, k) { return s + Number(k) * (Number(counts[k]) || 0); }, 0); }

  function dialog(title, html) {
    var box = d.createElement('div'); box.className = 'modal-backdrop fc-modal cc-modal';
    box.innerHTML = '<section class="modal" role="dialog" aria-modal="true" dir="rtl"><div class="modal-head"><h3>' + esc(title) + '</h3></div><div class="cc-body">' + html + '</div></section>';
    d.body.appendChild(box); var first = box.querySelector('button'); if (first && first.focus) first.focus(); return box;
  }
  function review(counts) {
    return new Promise(function (resolve) {
      var rows = DEN.filter(function (k) { return Number(counts[k]) > 0; }).map(function (k) { return '<tr><td><bdi dir="ltr">' + esc(k) + ' × ' + Number(counts[k]) + '</bdi></td><td class="n"><bdi dir="ltr">' + money(Number(k) * Number(counts[k])) + '</bdi></td></tr>'; }).join('');
      var box = dialog('راجع اللي كتبته', '<table class="cc-table"><tbody>' + (rows || '<tr><td colspan="2">مفيش فلوس متعدودة (صفر)</td></tr>') + '<tr class="cc-tot"><td>الإجمالي اللي عدّيته</td><td class="n" data-cc-total><bdi dir="ltr">' + money(total(counts)) + '</bdi></td></tr></tbody></table><p class="fc-note">اتأكد إن الأرقام دي هي اللي في إيدك فعلًا.</p><div class="fc-actions"><button type="button" class="btn btn-primary" data-cc-ok>متأكد — سلّم</button><button type="button" class="btn ghost" data-cc-back>رجوع أعدّل</button></div>');
      box.querySelector('[data-cc-ok]').onclick = function () { box.remove(); resolve(true); };
      box.querySelector('[data-cc-back]').onclick = function () { box.remove(); resolve(false); };
    });
  }
  function mismatch(left) {
    return new Promise(function (resolve) {
      var box = dialog('العد مش مطابق', '<div class="cc-alert"><b>العد ده مش مطابق للتحصيل المسجّل على ورديتك.</b><span>عدّ الفلوس تاني بهدوء فئة فئة. لو متأكد من العد، سلّم واكتب السبب لو تعرفه.</span>' + (left > 0 ? '' : '<span>دي آخر مرة السيستم بيراجع فيها العد.</span>') + '</div><div class="fc-actions"><button type="button" class="btn btn-primary" data-cc-recount>أعدّ تاني</button><button type="button" class="btn cc-warn" data-cc-anyway>متأكد من العد — سلّم</button></div><label class="fc-field">السبب لو تعرفه (اختياري)<input data-cc-reason maxlength="300" placeholder="مثلًا: مريض دفع ولسه ما اتسجّلش"></label><p class="fc-note">مفيش مبلغ متوقع بيظهر — علشان الجرد يفضل حقيقي.</p>');
      box.querySelector('[data-cc-recount]').onclick = function () { box.remove(); resolve(null); };
      box.querySelector('[data-cc-anyway]').onclick = function () { var r = box.querySelector('[data-cc-reason]').value.trim(); box.remove(); resolve({ reason: r }); };
    });
  }
  /* «امنع تكرار العد» (20261126020000): the count is exactly the cashier's previous shift count → «عدّيت فعلًا؟» */
  function repeated(at) {
    return new Promise(function (resolve) {
      var when = at ? new Date(at) : null, day = when && !isNaN(when) ? when.toLocaleDateString('ar-EG-u-nu-latn', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'long' }) : '';
      var box = dialog('العد ده هو هو عد الوردية اللي فاتت', '<div class="cc-alert"><b>الأرقام اللي كتبتها هي هي بالظبط عدّ ورديتك اللي فاتت' + (day ? ' (' + esc(day) + ')' : '') + '.</b><span>ممكن المتصفح يكون كتبها لوحده، أو العد اتكرر. عدّ الفلوس اللي في الدرج دلوقتي فئة فئة.</span></div>' +
        '<div class="cc-actions"><button type="button" class="btn btn-primary" data-cc-recount>هعدّ تاني</button><button type="button" class="btn ghost" data-cc-same>عدّيت فعلًا النهارده — نفس الأرقام</button></div>');
      box.querySelector('[data-cc-recount]').onclick = function () { box.remove(); resolve(false); };
      box.querySelector('[data-cc-same]').onclick = function () { box.remove(); resolve(true); };
    });
  }
  function gate(shiftId, counts, note) {
    note = note || '';
    return review(counts).then(function (ok) {
      if (!ok) throw new Error('رجعت تعدّل العد — صلّح الأرقام ودوس حفظ تاني.');
      return rpc('clinic_finance_count_repeat', { p_shift: shiftId, p_counts: counts }).then(function (x) {
        if (!x || !x.same) return;
        return repeated(x.last_at).then(function (yes) {
          if (!yes) throw new Error('عدّ الفلوس تاني وعدّل الأرقام، وبعدين دوس حفظ.');
          note = (note ? note + ' — ' : '') + 'نفس عدّ الوردية اللي فاتت بالظبط — الكاشير أكّد إنه عدّ فعلي';
        });
      }, function () { return null; });
    }).then(function () {
      return rpc('clinic_finance_count_check', { p_action: 'check', p_payload: { shift_id: shiftId, counts: counts } }).then(function (r) {
        if (!r || !r.enabled || r.limit || r.match) return note;
        return mismatch(Number(r.left)).then(function (x) {
          if (!x) throw new Error('عدّ الفلوس تاني وعدّل الأرقام، وبعدين دوس حفظ.');
          return (note ? note + ' — ' : '') + 'سلّم رغم تنبيه عدم المطابقة' + (x.reason ? ': ' + x.reason : '');
        });
      }, function () { return note; });
    });
  }

  /* settings box (super admin / FM change it; everyone allowed in the settings tab sees the state) */
  function settingsBox(host) {
    host.innerHTML = '<p class="fc-note">جاري التحميل…</p>';
    return rpc('clinic_finance_count_check', { p_action: 'settings', p_payload: {} }).then(function (s) {
      host.innerHTML = '<div class="cc-tog"><div><b>تنبيه «العد مش مطابق» في جرد الوردية</b><small>شغّال: الكاشير يتنبّه يعدّ تاني لو العد مش مطابق (من غير ما يعرف الفرق). مقفول: الجرد يتسجّل على طول، والفرق يروح «فروق الخزينة».' + (s.updated_by ? ' آخر تغيير: ' + esc(s.updated_by) : '') + '</small></div>' +
        (s.can_change ? '<button type="button" class="btn ' + (s.enabled ? 'ghost' : 'btn-primary') + ' sm" data-cc-toggle>' + (s.enabled ? 'إيقاف التنبيه' : 'تشغيل التنبيه') + '</button>' : '') +
        '<span class="cc-state ' + (s.enabled ? 'on' : 'off') + '">' + (s.enabled ? 'شغّال' : 'مقفول') + '</span></div><p class="fc-note" data-cc-status role="status"></p>';
      var t = host.querySelector('[data-cc-toggle]');
      if (t) t.onclick = function () { t.disabled = true; rpc('clinic_finance_count_check', { p_action: 'set', p_payload: { enabled: !s.enabled } }).then(function () { settingsBox(host); }).catch(function (e) { t.disabled = false; host.querySelector('[data-cc-status]').textContent = errText(e); }); };
    }).catch(function () { host.innerHTML = ''; host.hidden = true; });
  }
  /* «فروق الخزينة»: attempts under each case's state (reviewers only — the RPC refuses others, and the line just stays empty) */
  function fillAttempts(body) {
    var cells = body.querySelectorAll('[data-cs-bal]'); if (!cells.length) return null;
    var ids = [].map.call(cells, function (c) { return c.getAttribute('data-cs-bal'); });
    return rpc('clinic_finance_count_check', { p_action: 'attempts', p_payload: { case_ids: ids } }).then(function (rows) {
      (rows || []).forEach(function (r) {
        if (!r.attempts || !r.attempts.length) return; var cell = body.querySelector('[data-cs-bal="' + r.case_id + '"]'); if (!cell) return;
        var tr = cell.closest('tr'); if (!tr || tr.querySelector('.cc-att')) return;
        var line = d.createElement('small'); line.className = 'cc-att';
        line.innerHTML = 'محاولات العد: ' + r.attempts.map(function (a, i) { return '<span class="' + (a.matched ? 'ok' : 'bad') + '">' + (i + 1) + ') <bdi dir="ltr">' + money(a.counted) + '</bdi> ' + esc(stamp(a.at)) + (a.matched ? ' — مطابق' : ' — مش مطابق') + '</span>'; }).join(' ← ');
        (tr.lastElementChild || tr).appendChild(line);
      });
    }).catch(function () { return null; });
  }
  var priorFill = w.SSMPDCaseSettleFill;
  w.SSMPDCaseSettleFill = function (body, tab) { var r = priorFill ? priorFill(body, tab) : null; if (tab === 'cases' && body) fillAttempts(body); return r; };
  var prior = w.SSMPDFinanceControls;
  if (prior && !prior.__cc) w.SSMPDFinanceControls = Object.assign({}, prior, { __cc: true, panel: function (tab, data, h) { var html = prior.panel(tab, data, h); return tab === 'settings' && data && data.can_review ? html + '<section class="cc-setting" data-cc-setting></section>' : html; } });
  if (w.MutationObserver) new w.MutationObserver(function () { d.querySelectorAll('[data-cc-setting]:not([data-cc-done])').forEach(function (h) { h.setAttribute('data-cc-done', ''); settingsBox(h); }); }).observe(d.documentElement, { childList: true, subtree: true });
  w.SSMPDCountCheck = { gate: gate, total: total, settingsBox: settingsBox, fillAttempts: fillAttempts, DEN: DEN };
})(window, document);
