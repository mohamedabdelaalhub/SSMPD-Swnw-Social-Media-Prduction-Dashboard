// DOM test of the channels section + the invoice channel picker, loading the REAL finance-controls.js -> finance-doctors.js -> finance-channels.js chain.
const { JSDOM } = require('jsdom'), fs = require('fs'), assert = require('node:assert/strict');
const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));
(async () => {
  const dom = new JSDOM('<main></main>', { url: 'https://test.invalid', runScripts: 'outside-only' }), w = dom.window, d = w.document;
  const rule = (o) => Object.assign({ id: 'r', code: 'x', version: 1, name: 'قاعدة', kind: 'external', applies_to: 'consultation', patient_discount_percent: 0, platform_share_percent: 25, payable_kind: 'commission', payable_when: 'آخر الشهر', source_codes: [], valid_from: '2026-01-01', valid_to: '2026-12-31', notes: '', status: 'active', created_by: 'other' }, o);
  const data = { today: '2026-11-08', me: 'me', can_create: true, can_review: true, doctor_contracts: [], stock_catalog: [], invoices: [],
    channel_rules: [rule({ id: 'vez', code: 'vezeeta', name: 'فيزيتا <منصة>' }),
      rule({ id: 'kaf', code: 'kafaret', name: 'كفارة', kind: 'contracting', patient_discount_percent: 20, platform_share_percent: 10, payable_kind: 'cashback' }),
      rule({ id: 'club', code: 'club', name: 'نادي', kind: 'contracting', applies_to: 'all', patient_discount_percent: 30, platform_share_percent: 0, payable_kind: 'none' }),
      rule({ id: 'phone', code: 'phone', name: 'تليفون', kind: 'internal', applies_to: 'all', payable_kind: 'none' }),
      rule({ id: 'pend', code: 'newone', name: 'جديدة', status: 'pending' }),
      rule({ id: 'own', code: 'mine', name: 'قاعدتي', status: 'pending', created_by: 'me' }),
      rule({ id: 'old', code: 'old', name: 'منتهية', valid_to: '2026-06-30' })],
    channel_payables: [{ channel_code: 'vezeeta', channel_name: 'فيزيتا <منصة>', kind: 'external', payable_kind: 'commission', month: '2026-11-01', invoices: 3, gross: 300, patient_discount: 0, share_due: 75 },
      { channel_code: 'phone', channel_name: 'تليفون', kind: 'internal', payable_kind: 'none', month: '2026-11-01', invoices: 1, gross: 100, patient_discount: 0, share_due: 25 }],
    channel_allocations: [{ invoice_reference: 'INV-9', channel_name: 'كفارة', gross_consultation: 100, gross_services: 0, patient_discount: 20, platform_share: 10, invoice_amount: 80, voided: false }] };
  const calls = [];
  w.SSMPDDb = { financeBill: async (p, k) => { calls.push(['bill', p]); return 'id'; }, financeChannelCommand: async (a, p, k) => { calls.push(['channel', a, p]); return 'id'; } };
  w.eval(fs.readFileSync('assets/js/finance-controls.js', 'utf8'));
  w.eval(fs.readFileSync('assets/js/finance-doctors.js', 'utf8'));
  w.eval(fs.readFileSync('assets/js/finance-channels.js', 'utf8'));
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = v => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const field = (name, label, type, value, extra) => '<label class="fc-field">' + esc(label) + '<input name="' + name + '" type="' + (type || 'text') + '" value="' + esc(value || '') + '" ' + (extra || 'required') + '></label>';
  const select = (name, label, options) => '<label class="fc-field">' + esc(label) + '<select name="' + name + '" required><option value="">اختر</option>' + options.map(o => '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>').join('') + '</select></label>';
  const btn = (a, id, text) => '<button type="button" data-fin-action="' + a + '" data-id="' + esc(id || '') + '">' + esc(text) + '</button>';
  const table = (h, rows) => '<table><thead><tr>' + h.map(x => '<th>' + esc(x) + '</th>').join('') + '</tr></thead><tbody>' + rows.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
  let saver;
  const modal = (title, body, save) => { saver = save; const root = d.createElement('div'); root.className = 'fc-modal'; root.innerHTML = '<form>' + body + '</form>'; d.body.append(root); };
  const h = { esc, money, btn, table, stamp: x => x, field, select, modal };
  const C = () => w.SSMPDFinanceControls;
  const submit = async () => { const f = d.querySelector('.fc-modal form'), v = {}; new w.FormData(f).forEach((x, k) => { v[k] = x; }); await saver(v, 'tok'); d.querySelector('.fc-modal').remove(); };

  // ---- section on the doctors tab only
  assert(!C().panel('invoices', data, h).includes('القنوات والمنصات'));
  const html = C().panel('doctors', data, h);
  assert(html.includes('القنوات والمنصات وخصومات المرضى') && html.includes('مستحقات المنصات والجهات آخر الشهر'));
  assert(html.includes('فيزيتا &lt;منصة&gt;') && !html.includes('<منصة>'), 'names are escaped');
  assert(html.includes('عمولة منصة') && html.includes('كاش باك') && html.includes('يبقى بالمركز'));
  assert(html.includes('data-fin-action="channel-review" data-id="pend"'), 'another person\'s pending rule can be reviewed');
  assert(!html.includes('data-fin-action="channel-review" data-id="own"'), 'own rule cannot be reviewed by its creator');
  assert(html.includes('data-fin-action="channel-retire" data-id="vez"'));
  assert(html.includes('INV-9'));
  assert(!C().panel('doctors', Object.assign({}, data, { can_create: false, can_review: false }), h).includes('data-fin-action="channel-create"'));

  // ---- invoice form: channel picker computes what the patient pays; only active, in-date rules are offered
  C().act('invoice', '', data, h);
  const form = d.querySelector('.fc-modal form'), sel = form.elements.channel;
  assert(sel && !sel.required);
  assert.deepEqual([...sel.options].map(o => o.value), ['', 'vez', 'kaf', 'club', 'phone']);
  assert(form.elements.doctor_contract, 'doctor contract picker still there');
  const set = (n, v) => { form.elements[n].value = v; form.elements[n].dispatchEvent(new w.Event('input')); };
  const choose = id => { sel.value = id; sel.dispatchEvent(new w.Event('change')); };
  form.elements.reference.value = 'R1'; form.elements.description.value = 'كشف'; form.elements.patient.value = 'P1'; d.querySelector('input[type=checkbox]').checked = true;

  choose('vez'); set('consultation_gross', '100');                        // external platform: patient pays everything
  assert.equal(form.elements.amount.value, '100.00'); assert(form.elements.amount.readOnly);
  assert(form.querySelector('[data-channel-note]').textContent.includes('حصة القناة 25.00') && form.querySelector('[data-channel-note]').textContent.includes('مستحقة للجهة'));
  choose('kaf'); assert.equal(form.elements.amount.value, '80.00');         // Kafaret: 100 - 20%
  assert(form.querySelector('[data-channel-note]').textContent.includes('خصم 20.00'));
  choose('club'); assert.equal(form.elements.amount.value, '70.00');
  choose('phone'); set('consultation_gross', '0'); set('services_gross', '100');
  assert.equal(form.elements.amount.value, '100.00'); assert(form.querySelector('[data-channel-note]').textContent.includes('تبقى بالمركز'));
  choose('kaf'); set('consultation_gross', '0'); set('services_gross', '50'); set('consultation_gross', '100');   // consultation-only rule leaves services at full price
  assert.equal(form.elements.amount.value, '130.00');
  choose(''); assert(!form.elements.amount.readOnly && form.querySelector('[data-channel-fields]').hidden);

  // ---- payload sent to the server carries the channel + gross parts; no channel = exactly the old payload shape
  choose('kaf'); set('consultation_gross', '100'); set('services_gross', '0');
  await submit();
  let [, p] = calls.pop();
  assert.equal(JSON.stringify([p.service_amount, p.channel_id, p.consultation_gross, p.services_gross, p.doctor_contract_id]), JSON.stringify([80, 'kaf', 100, 0, null]));
  C().act('invoice', '', data, h);
  const f2 = d.querySelector('.fc-modal form');
  f2.elements.reference.value = 'R2'; f2.elements.description.value = 'خدمة'; f2.elements.patient.value = ''; f2.elements.amount.value = '55'; d.querySelector('input[type=checkbox]').checked = true;
  await submit(); [, p] = calls.pop();
  assert.equal(JSON.stringify(Object.keys(p).sort()), JSON.stringify(['description', 'doctor_contract_id', 'items', 'patient_ref', 'reference', 'service_amount']));

  // ---- rounding in the browser matches numeric round() in Postgres (half up)
  const K = w.SSMPDFinanceChannels, r7 = rule({ patient_discount_percent: 7.5, platform_share_percent: 12.5, applies_to: 'all' });
  assert.deepEqual(JSON.parse(JSON.stringify(K.compute(r7, 33.33, 0))), { discount: 2.5, share: 4.17, patientPays: 30.83 });  // 2.49975 -> 2.50 ; 4.16625 -> 4.17
  assert.deepEqual(JSON.parse(JSON.stringify(K.compute(rule({ patient_discount_percent: 30, platform_share_percent: 0 }), 0.05, 0))).patientPays, 0.03);  // discount 0.015 -> 0.02 (half up), 0.05 - 0.02 = 0.03
  console.log('PASS channels DOM: section, maker-checker buttons, invoice channel picker math, payload shape, rounding');
})().catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
