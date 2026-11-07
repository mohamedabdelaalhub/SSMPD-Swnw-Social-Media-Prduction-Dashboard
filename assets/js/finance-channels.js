/* Booking channels / platforms (Vezeeta, Akshef, Kafaret, clubs, phone/WhatsApp/website ...) managed from the dashboard, no code.
   Lives inside the existing "doctors" section of the finance workspace and chains onto SSMPDFinanceControls like finance-doctors.js does.
   A rule is created pending and approved by a different person; the cashier picks the channel on the invoice; the server recomputes and freezes the rule on the invoice. */
(function () {
  'use strict';
  var prior = window.SSMPDFinanceControls;
  if (!prior) return;
  var KIND = { external: 'منصة خارجية', internal: 'قناة داخلية للمركز', contracting: 'جهة تعاقد' };
  var APPLIES = { consultation: 'الكشف فقط', all: 'الكشف وكل الخدمات' };
  var PAY = { none: 'لا يُدفع لطرف خارجي (يبقى بالمركز)', commission: 'عمولة تُدفع للمنصة', cashback: 'كاش باك يُدفع للجهة' };
  var PAY_SHORT = { none: 'يبقى بالمركز', commission: 'عمولة منصة', cashback: 'كاش باك' };
  var STATUS = { pending: 'قيد الاعتماد', active: 'معتمد', rejected: 'مرفوض', retired: 'منتهي' };

  function pct(v) { return Number(v || 0) + '%'; }
  function opts(map) { return Object.keys(map).map(function (k) { return [k, map[k]]; }); }
  function activeRules(d) {
    return (d.channel_rules || []).filter(function (r) { return r.status === 'active' && r.valid_from <= d.today && r.valid_to >= d.today; });
  }
  /** Same rounding as the server (numeric round: half up for positives), done in integer arithmetic. */
  function compute(rule, consultation, services) {
    var cons = Math.round(consultation * 100), svc = Math.round(services * 100);
    var applicable = rule.applies_to === 'consultation' ? cons : cons + svc;
    function part(p) { return Math.floor((applicable * Math.round(Number(p) * 10000) + 500000) / 1000000); }
    var discount = part(rule.patient_discount_percent), share = part(rule.platform_share_percent);
    return { discount: discount / 100, share: share / 100, patientPays: (cons + svc - discount) / 100 };
  }

  function section(d, h) {
    var b = h.btn, e = h.esc, m = h.money, t = h.table;
    var html = '<h4>القنوات والمنصات وخصومات المرضى</h4><p>كل قناة (فيزيتا، اكشف، كلينيدو، كفارة وسلامتك، النوادي والنقابات، حجز التليفون والموقع والواتساب...) لها قاعدة تحدد: تسري على الكشف فقط أم على الكشف وكل الخدمات، ونسبة خصم المريض، ونسبة حصة المنصة، ولمن تُدفع. القاعدة الجديدة أو المعدلة تحتاج اعتماد شخص آخر. عند الفوترة يختار الكاشير القناة ويحفظ النظام نسخة من القاعدة على الفاتورة، وتُخصم حصة المنصة من وعاء الطبيب قبل النسبة.</p>' +
      '<div class="fc-actions">' + (d.can_create ? b('channel-create', '', 'إضافة قناة أو منصة') : '') + '</div>';
    html += t(['القناة', 'النوع', 'تسري على', 'خصم المريض', 'حصة المنصة', 'الدفع', 'الفترة', 'الحالة', 'الإجراء'], (d.channel_rules || []).map(function (r) {
      var act = [];
      if (d.can_review && r.created_by !== d.me && r.status === 'pending') act.push(b('channel-review', r.id, 'مراجعة القاعدة'));
      if (d.can_review && r.status === 'active') act.push(b('channel-retire', r.id, 'إنهاء'));
      if (d.can_create && (r.status === 'active' || r.status === 'retired')) act.push(b('channel-create', r.id, 'إصدار جديد'));
      return [e(r.name) + '<br><small>' + e(r.code) + ' — إصدار ' + e(r.version) + '</small>', KIND[r.kind], APPLIES[r.applies_to], pct(r.patient_discount_percent), pct(r.platform_share_percent),
        e(PAY_SHORT[r.payable_kind]) + (r.payable_when ? '<br><small>' + e(r.payable_when) + '</small>' : ''), e(r.valid_from) + ' ← ' + e(r.valid_to), STATUS[r.status], act.join(' ') || '—'];
    }));
    html += '<h4>مستحقات المنصات والجهات آخر الشهر</h4><p>الحصة المستحقة تتناقص تلقائيًا مع المرتجعات والفواتير الملغاة. الصفوف المكتوب بجانبها «يبقى بالمركز» قنوات داخلية: لا تُدفع لأي جهة.</p>' +
      t(['الشهر', 'القناة', 'النوع', 'عدد الفواتير', 'الإجمالي قبل الخصم', 'خصم المرضى', 'المستحق / المحتجز'], (d.channel_payables || []).map(function (p) {
        return [e(String(p.month).slice(0, 7)), e(p.channel_name), e(PAY_SHORT[p.payable_kind]), e(p.invoices), m(p.gross), m(p.patient_discount), '<b>' + m(p.share_due) + '</b>'];
      }));
    html += '<h4>فواتير بقناة حجز</h4>' + t(['الفاتورة', 'القناة', 'قبل الخصم', 'خصم المريض', 'حصة المنصة', 'المريض دفع'], (d.channel_allocations || []).map(function (a) {
      return [e(a.invoice_reference) + (a.voided ? ' (ملغاة)' : ''), e(a.channel_name), m(Number(a.gross_consultation) + Number(a.gross_services)), m(a.patient_discount), m(a.platform_share), m(a.invoice_amount)];
    }));
    return html;
  }

  function panel(tab, d, h) {
    var html = prior.panel(tab, d, h);
    return tab === 'doctors' ? html + section(d, h) : html;
  }

  function invoiceForm(d, h) {
    var form = document.querySelector('.fc-modal form'), rules = activeRules(d);
    if (!form || !rules.length || form.querySelector('[name=channel]')) return;
    var wrap = document.createElement('div');
    wrap.className = 'fc-channel';
    wrap.innerHTML = h.select('channel', 'قناة الحجز / المنصة', rules.map(function (r) { return [r.id, r.name + ' — ' + APPLIES[r.applies_to] + (Number(r.patient_discount_percent) ? ' — خصم ' + pct(r.patient_discount_percent) : '') + (Number(r.platform_share_percent) ? ' — حصة ' + pct(r.platform_share_percent) : '')]; })) +
      '<div data-channel-fields hidden>' + h.field('consultation_gross', 'قيمة الكشف قبل الخصم', 'number', '0', 'min="0" step="0.01"') + h.field('services_gross', 'قيمة الخدمات الأخرى قبل الخصم', 'number', '0', 'min="0" step="0.01"') +
      '<p role="status" data-channel-note></p></div>';
    var sel = wrap.querySelector('[name=channel]');
    sel.querySelector('option').textContent = 'بدون قناة (حجز مباشر)';
    sel.required = false;
    form.querySelector('fieldset').before(wrap);
    var amount = form.elements.amount, fields = wrap.querySelector('[data-channel-fields]'), note = wrap.querySelector('[data-channel-note]');
    function sync() {
      var rule = rules.filter(function (r) { return r.id === sel.value; })[0];
      fields.hidden = !rule;
      form.elements.consultation_gross.required = !!rule && rule.applies_to === 'consultation';
      amount.readOnly = !!rule;
      if (!rule) { note.textContent = ''; return; }
      var c = compute(rule, Number(form.elements.consultation_gross.value) || 0, Number(form.elements.services_gross.value) || 0);
      amount.value = c.patientPays.toFixed(2);
      amount.dispatchEvent(new Event('input'));
      note.textContent = 'المريض يدفع ' + h.money(c.patientPays) + ' (خصم ' + h.money(c.discount) + '). حصة القناة ' + h.money(c.share) + (rule.payable_kind === 'none' ? ' تبقى بالمركز' : ' مستحقة للجهة آخر الشهر') + ' وتُخصم من وعاء الطبيب. الخادم يعيد الحساب ويرفض أي فرق.';
    }
    sel.onchange = sync;
    ['consultation_gross', 'services_gross'].forEach(function (n) { form.elements[n].oninput = sync; });
  }

  function act(action, id, d, h) {
    var f = h.field, s = h.select, modal = h.modal, db = window.SSMPDDb;
    if (action === 'invoice') {
      var handled = prior.act(action, id, d, h);
      if (handled) invoiceForm(d, h);
      return handled;
    }
    if (action === 'channel-create') {
      var base = id ? (d.channel_rules || []).filter(function (r) { return r.id === id; })[0] : null;
      modal(base ? 'إصدار جديد لقناة ' + base.name : 'إضافة قناة أو منصة',
        f('code', 'الكود (حروف إنجليزية صغيرة وأرقام و _)', 'text', base ? base.code : '', 'required pattern="[a-z0-9_]{2,40}"' + (base ? ' readonly' : '')) +
        f('name', 'اسم القناة كما يظهر للمحاسب', 'text', base ? base.name : '', 'required maxlength="120"') +
        s('kind', 'نوع القناة', opts(KIND), base && base.kind) + s('applies_to', 'تسري على', opts(APPLIES), base && base.applies_to) +
        f('patient_discount_percent', 'خصم المريض %', 'number', base ? base.patient_discount_percent : '0', 'required min="0" max="100" step="0.0001"') +
        f('platform_share_percent', 'حصة المنصة أو القناة % (تُخصم من وعاء الطبيب)', 'number', base ? base.platform_share_percent : '0', 'required min="0" max="100" step="0.0001"') +
        s('payable_kind', 'تُدفع لمن؟', opts(PAY), base && base.payable_kind) + f('payable_when', 'متى تُدفع (مثال: آخر الشهر)', 'text', base ? base.payable_when : '', 'maxlength="200"') +
        f('source_codes', 'مصادر الحجز المرتبطة (مفصولة بفاصلة)', 'text', base ? (base.source_codes || []).join(',') : '', 'maxlength="200"') +
        f('valid_from', 'ساري من', 'date', '', 'required') + f('valid_to', 'ساري حتى', 'date', '', 'required') + f('notes', 'ملاحظات', 'text', base ? base.notes : '', 'maxlength="1000"') +
        '<label class="fc-check"><input type="checkbox" required>أؤكد أن النسب مطابقة لاتفاق المركز مع هذه الجهة، وأن القاعدة لن تعمل قبل اعتماد شخص آخر.</label>',
        function (v, k) {
          v.patient_discount_percent = Number(v.patient_discount_percent); v.platform_share_percent = Number(v.platform_share_percent);
          v.source_codes = String(v.source_codes || '').split(',').map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean);
          if (v.kind === 'internal') v.payable_kind = 'none';
          return db.financeChannelCommand('create', v, k);
        });
      var form = document.querySelector('.fc-modal form');
      if (form) {
        if (base) { form.elements.kind.value = base.kind; form.elements.applies_to.value = base.applies_to; form.elements.payable_kind.value = base.payable_kind; }
        // internal channels never pay a third party
        var sync = function () { var internal = form.elements.kind.value === 'internal'; if (internal) form.elements.payable_kind.value = 'none'; form.elements.payable_kind.disabled = internal; form.elements.payable_kind.required = !internal; };
        form.elements.kind.onchange = sync; sync();
      }
      return true;
    }
    if (action === 'channel-review') {
      var rule = (d.channel_rules || []).filter(function (r) { return r.id === id; })[0];
      modal('مراجعة قاعدة قناة', '<p>' + h.esc(rule.name) + ' — ' + APPLIES[rule.applies_to] + ' — خصم المريض ' + pct(rule.patient_discount_percent) + ' — حصة القناة ' + pct(rule.platform_share_percent) + ' — ' + PAY[rule.payable_kind] + '</p>' +
        s('approval', 'القرار', [['yes', 'اعتماد'], ['no', 'رفض']]) + f('note', 'سبب القرار'),
        function (v, k) { return db.financeChannelCommand('review', { id: id, approve: v.approval === 'yes', note: v.note }, k); });
      return true;
    }
    if (action === 'channel-retire') {
      modal('إنهاء قاعدة قناة', '<p>الفواتير القديمة تحتفظ بنسخة القاعدة التي حُسبت بها، ولن تُستخدم هذه القاعدة في فواتير جديدة.</p>' + f('note', 'سبب الإنهاء'),
        function (v, k) { return db.financeChannelCommand('retire', { id: id, note: v.note }, k); });
      return true;
    }
    return prior.act(action, id, d, h);
  }

  window.SSMPDFinanceChannels = { compute: compute, activeRules: activeRules };
  window.SSMPDFinanceControls = { panel: panel, act: act, due: prior.due };
})();
