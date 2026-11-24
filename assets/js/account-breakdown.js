/* «الحساب الرئيسي + التفصيل» (owner 2026-11-24 «طبق التفصيل», server 20261125030000).
   1) Chart: «تفصيل» on the control accounts 1115 (by wallet), 2120 (by doctor), 5111 (by doctor, this month) →
      public.clinic_finance_account_breakdown. Rows + «حركات تانية» always add up to the account balance.
      Old wallet receipts without a kind: finance proposes the wallet (create), another person confirms (review).
   2) Collection forms: when «طريقة السداد» = محفظة إلكترونية, a required «أنهي محفظة؟» appears. The kind is NOT sent to the
      collect RPC (stripped from every payload); after a successful reception collect it is saved with
      clinic_finance_wallet_kind('set') matched by the cashier's own reference + amount. No posting changes. */
(function (w, d) {
  'use strict';
  var KINDS = [['vodafone', 'فودافون كاش'], ['valu', 'فاليو'], ['other', 'محفظة تانية']];
  var CODES = { '1115': 'المحافظ والتحويلات — حسب المحفظة', '2120': 'مستحقات الأطباء — حسب الطبيب', '5111': 'أتعاب ونسب الأطباء — حسب الطبيب (الشهر ده)' };
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(v) { return Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function day(v) { if (!v) return '—'; var t = new Date(v); return isNaN(t) ? '—' : t.toLocaleDateString('en-GB', { timeZone: 'Africa/Cairo', day: '2-digit', month: '2-digit', year: 'numeric' }); }
  function uuid() { if (w.crypto && w.crypto.randomUUID) return w.crypto.randomUUID(); return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, function () { return (Math.random() * 16 | 0).toString(16); }); }
  function client() { return w.SSMPDDb && w.SSMPDDb.client; }
  function rpc(name, args) { var c = client(); if (!c || typeof c.rpc !== 'function') return Promise.reject(Error('تعذر الاتصال')); return Promise.resolve().then(function () { return c.__wkRpc ? c.__wkRpc(name, args) : c.rpc(name, args); }).then(function (r) { if (r && r.error) throw r.error; return r && r.data; }); }
  function errText(e) { var m = e && (e.message || e.details) || ''; return /[؀-ۿ]/.test(m) ? m : 'حصلت مشكلة ومقدرناش نكمل — جرّب تاني'; }
  var kindLabel = function (k) { var x = KINDS.filter(function (p) { return p[0] === k; })[0]; return x ? x[1] : 'لسه ما اتحددتش'; };

  /* ---------- 1) chart breakdown ---------- */
  function body(b) {
    var h = '<p class="ab-total">رصيد الحساب: <b><bdi dir="ltr">' + money(b.total) + '</bdi></b>' + (b.from ? ' — من ' + esc(day(b.from)) + ' لحد ' + esc(day(b.to)) : '') + '</p>';
    h += '<div class="fc-table"><table class="simple ab-table"><thead><tr><th>' + (b.code === '1115' ? 'المحفظة' : 'الطبيب') + '</th><th>المبلغ</th>' + (b.code === '1115' ? '<th>الإيصالات</th>' : '') + '</tr></thead><tbody>';
    (b.rows || []).forEach(function (r) { h += '<tr data-ab-row="' + esc(r.key) + '"><td>' + esc(r.label) + '</td><td><bdi dir="ltr">' + money(r.amount) + '</bdi></td>' + (b.code === '1115' ? '<td>' + Number(r.count || 0) + '</td>' : '') + '</tr>'; });
    if (Math.abs(Number(b.other || 0)) >= 0.005) h += '<tr data-ab-row="other" class="ab-other"><td>' + (b.code === '1115' ? 'حركات تانية على الحساب (تسويات / مرتجعات / عمليات قديمة)' : 'قيود قديمة من غير طبيب محدد (قبل ربط الأطباء بالسيستم)') + '</td><td><bdi dir="ltr">' + money(b.other) + '</bdi></td>' + (b.code === '1115' ? '<td>—</td>' : '') + '</tr>';
    if (!(b.rows || []).length && Math.abs(Number(b.other || 0)) < 0.005) h += '<tr><td colspan="3">مفيش حركة على الحساب ده.</td></tr>';
    h += '</tbody></table></div>';
    if (b.code === '1115' && (b.unset || []).length) {
      h += '<h4>إيصالات محفظة لسه نوعها ما اتحددش</h4><div class="fc-table"><table class="simple ab-table"><thead><tr><th>الإيصال</th><th>التاريخ</th><th>الموظف</th><th>المبلغ</th><th>المحفظة</th></tr></thead><tbody>';
      b.unset.forEach(function (u) {
        var cell;
        if (u.pending) cell = '<span>' + esc(kindLabel(u.pending)) + ' — مستني تأكيد' + (u.pending_by ? ' (' + esc(u.pending_by) + ')' : '') + '</span>' + (b.can_review && !u.pending_mine ? ' <button type="button" class="btn sm" data-ab-review="' + esc(u.id) + '" data-ok="true">تأكيد</button> <button type="button" class="btn ghost sm" data-ab-review="' + esc(u.id) + '" data-ok="false">رفض</button>' : '');
        else if (b.can_propose) cell = '<select class="ab-kind" data-ab-kind="' + esc(u.id) + '" aria-label="أنهي محفظة"><option value="">اختار المحفظة</option>' + KINDS.map(function (k) { return '<option value="' + k[0] + '">' + k[1] + '</option>'; }).join('') + '</select> <button type="button" class="btn btn-primary sm" data-ab-propose="' + esc(u.id) + '">حفظ</button>';
        else cell = '—';
        h += '<tr><td><bdi dir="ltr">' + esc(u.receipt_no || u.reference || '—') + '</bdi></td><td>' + esc(day(u.at)) + '</td><td>' + esc(u.by || '—') + '</td><td><bdi dir="ltr">' + money(u.amount) + '</bdi></td><td>' + cell + '</td></tr>';
      });
      h += '</tbody></table></div><p class="fc-note">المحاسب يحدد المحفظة وشخص تاني يأكد. لو الإيصال طلع «إنستا باي» مش محفظة، صلّحه من «تصحيح طريقة السداد».</p>';
    }
    if (b.code !== '1115') h += '<p class="fc-note">رصيد كل طبيب هو نفس رصيده في «حسابات الأطباء»، وتفاصيله في «كشف حساب الطبيب».</p>';
    return h + '<p class="fc-note" data-ab-status role="status"></p>';
  }
  function open(code) {
    var title = CODES[code] || 'تفصيل الحساب', box = d.createElement('div');
    box.className = 'modal-backdrop fc-modal ab-modal';
    box.innerHTML = '<section class="modal" role="dialog" aria-modal="true" dir="rtl"><div class="modal-head"><h3>' + esc(title) + '</h3><button type="button" class="modal-close" aria-label="إغلاق" data-ab-close>×</button></div><div data-ab-body><p>جاري التحميل…</p></div></section>';
    d.body.appendChild(box);
    function close() { box.remove(); d.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    d.addEventListener('keydown', onKey);
    box.addEventListener('click', function (e) { if (e.target === box || e.target.hasAttribute('data-ab-close')) close(); });
    function load() {
      var host = box.querySelector('[data-ab-body]');
      return rpc('clinic_finance_account_breakdown', { p_code: code, p_from: null, p_to: null }).then(function (b) { host.innerHTML = body(b); wire(host); return b; })
        .catch(function (e) { host.innerHTML = '<p>' + esc(errText(e)) + '</p>'; });
    }
    function wire(host) {
      var st = host.querySelector('[data-ab-status]');
      host.querySelectorAll('[data-ab-propose]').forEach(function (btn) { btn.onclick = function () { var id = btn.getAttribute('data-ab-propose'), k = host.querySelector('[data-ab-kind="' + id + '"]').value; if (!k) { st.textContent = 'اختار المحفظة الأول'; return; } btn.disabled = true; rpc('clinic_finance_wallet_kind', { p_action: 'propose', p_payload: { id: id, kind: k }, p_token: uuid() }).then(function () { st.textContent = 'اتحفظت — مستنية تأكيد شخص تاني.'; load(); }).catch(function (e) { btn.disabled = false; st.textContent = errText(e); }); }; });
      host.querySelectorAll('[data-ab-review]').forEach(function (btn) { btn.onclick = function () { btn.disabled = true; rpc('clinic_finance_wallet_kind', { p_action: 'review', p_payload: { id: btn.getAttribute('data-ab-review'), approve: btn.getAttribute('data-ok') === 'true' }, p_token: uuid() }).then(function () { st.textContent = 'اتسجّل القرار.'; load(); }).catch(function (e) { btn.disabled = false; st.textContent = errText(e); }); }; });
    }
    return load();
  }
  var prior = w.SSMPDFinanceControls;
  if (prior && !prior.__ab) {
    w.SSMPDFinanceControls = Object.assign({}, prior, { __ab: true, act: function (a, id, data, h) { if (a === 'account-breakdown') { open(id); return true; } return prior.act(a, id, data, h); } });
  }

  /* ---------- 2) «أنهي محفظة؟» in collection forms ---------- */
  function inject(sel) {
    if (sel.__wk || !sel.querySelector('option[value="wallet"]')) return; sel.__wk = true;
    var form = sel.form; if (!form || form.querySelector('[name="wallet_kind"]')) return;
    var label = d.createElement('label'); label.className = 'fc-field wk-field'; label.setAttribute('data-wk-field', '');
    label.innerHTML = 'أنهي محفظة؟<select name="wallet_kind"><option value="">اختار المحفظة</option>' + KINDS.map(function (k) { return '<option value="' + k[0] + '">' + k[1] + '</option>'; }).join('') + '</select>';
    (sel.closest('label') || sel).insertAdjacentElement('afterend', label);
    var kind = label.querySelector('select');
    function sync() { var on = sel.value === 'wallet'; label.hidden = !on; kind.disabled = !on; kind.required = on; if (!on) kind.value = ''; }
    sel.addEventListener('change', sync); sync();
  }
  function scan(root) { (root.querySelectorAll ? root : d).querySelectorAll('select[name="method"]').forEach(inject); }
  var COLLECT = ['collect', 'collect_multi'];
  function wrap() {
    var c = client(); if (!c || typeof c.rpc !== 'function') return false; if (c.__wkWrapped) return true;
    var orig = c.rpc.bind(c); c.__wkWrapped = true; c.__wkRpc = orig;
    c.rpc = function (name, args) {
      var p = args && args.p_payload, kind = null;
      if (p && typeof p === 'object' && !Array.isArray(p) && Object.prototype.hasOwnProperty.call(p, 'wallet_kind')) { kind = p.wallet_kind; args = Object.assign({}, args, { p_payload: Object.assign({}, p) }); delete args.p_payload.wallet_kind; p = args.p_payload; }
      var res = orig(name, args);
      if (!(kind && name === 'clinic_reception_command' && COLLECT.indexOf(args.p_action) >= 0 && p && p.method === 'wallet')) return res;
      return Promise.resolve(res).then(function (r) {
        if (r && !r.error) return Promise.resolve(orig('clinic_finance_wallet_kind', { p_action: 'set', p_payload: { reference: String(p.reference || '').trim(), amount: Number(p.amount), kind: kind }, p_token: uuid() })).then(function () { return r; }, function () { return r; });
        return r;
      });
    };
    return true;
  }
  function start() {
    if (!wrap()) { w.setTimeout(start, 400); }
    scan(d);
    if (w.MutationObserver && !start.obs) { start.obs = new w.MutationObserver(function (ms) { ms.forEach(function (m) { m.addedNodes.forEach(function (n) { if (n.nodeType === 1) { if (n.matches && n.matches('select[name="method"]')) inject(n); else scan(n); } }); }); }); start.obs.observe(d.body || d.documentElement, { childList: true, subtree: true }); }
  }
  w.SSMPDAccountBreakdown = { open: open, body: body, inject: inject, wrap: wrap, KINDS: KINDS, CODES: CODES, kindLabel: kindLabel };
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', start); else start();
})(window, document);
