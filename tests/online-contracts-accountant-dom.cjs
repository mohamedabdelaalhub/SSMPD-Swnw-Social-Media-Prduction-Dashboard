// DOM test: accountant side of the online contracts: send button per ACTIVE group, acceptance state on contract rows, template block, send flow.
const { JSDOM } = require('jsdom'), fs = require('fs'), assert = require('node:assert/strict');
(async () => {
  const dom = new JSDOM('<main class="fc-workspace"><div data-fc-body></div></main>', { url: 'https://test.invalid', runScripts: 'outside-only' }), w = dom.window, d = w.document;
  const calls = [];
  const status = { templates: [{ id: 't1', kind: 'contract', version: 1, title: 'عقد', published: true, placeholder: false }, { id: 't2', kind: 'consent', version: 1, title: 'إقرار', published: false, placeholder: true }],
    requests: [], consents: {}, contracts: { a1: { state: 'accepted', at: '2026-11-09T10:00:00Z' }, a2: { state: 'pending' }, a3: { state: 'rejected', reason: 'النسبة قليلة' }, a4: { state: 'stale' } } };
  w.SSMPDDb = { financeLinesEnabled: async () => true, financeContractServices: async () => [], financeContractDepartments: async () => [], financeDoctorCommand: async () => ({}),
    client: { rpc: async (name, args) => { calls.push([name, args]); return name === 'clinic_finance_contract_signature_status' ? { data: status } : { data: 'req-1' }; } } };
  w.eval(fs.readFileSync('assets/js/finance-controls.js', 'utf8')); w.eval(fs.readFileSync('assets/js/finance-doctors.js', 'utf8')); w.eval(fs.readFileSync('assets/js/finance-contract-signature.js', 'utf8'));
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const btn = (a, id, text) => '<button type="button" data-fin-action="' + a + '" data-id="' + esc(id || '') + '">' + esc(text) + '</button>';
  const table = (hd, rows) => '<table><thead><tr>' + hd.map(x => '<th>' + esc(x) + '</th>').join('') + '</tr></thead><tbody>' + rows.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
  let modalArgs = null; const h = { esc, money: v => Number(v || 0).toFixed(2), btn, table, stamp: x => x, field: (n, l) => '<input name="' + n + '">', select: () => '', modal: (t, b, save) => { modalArgs = { t, b, save }; } };
  const mk = (id, key, name, scope, status, ref) => ({ id, doctor_key: key, doctor_name: name, service_scope: scope, valid_from: '2027-01-01', valid_to: '2027-12-31', rate: 40, base_scope: 'service', deduction: 'none', basis: 'performed', status, reference: ref, created_by: 'maker' });
  const data = { today: '2026-11-08', me: 'checker', can_create: true, can_review: true, stock_catalog: [], invoices: [],
    doctor_contracts: [mk('a1', 'EMP-1', 'د. أ', 'D-1', 'active', 'R1'), mk('a2', 'EMP-1', 'د. أ', 'D-2', 'active', 'R1'), mk('a3', 'EMP-1', 'د. أ', 'D-3', 'active', 'R2'), mk('a4', 'EMP-2', 'د. ب', 'D-4', 'active', 'R1'), mk('a5', 'EMP-2', 'د. ب', 'D-5', 'pending', 'R1')],
    doctor_allocations: [], doctor_payouts: [], doctor_balances: [] };
  const host = d.querySelector('[data-fc-body]'); host.innerHTML = w.SSMPDFinanceControls.panel('doctors', data, h);
  await new Promise(r => setTimeout(r, 20));
  const groups = host.querySelectorAll('details.fc-doctor-group'); assert.equal(groups.length, 2);
  // one send button per active reference group: doctor 1 has R1 and R2, doctor 2 has R1 (with a pending member -> button still shown, server refuses)
  assert.equal(groups[0].querySelectorAll('.fc-sig-btn').length, 2, 'two active reference groups for doctor 1');
  assert(groups[0].querySelector('summary .fc-sig-btn').textContent.includes('إرسال للتوقيع'));
  assert.equal(groups[0].querySelector('.fc-sig-btn').getAttribute('data-fin-action'), 'contract-signature-send');
  const states = [...groups[0].querySelectorAll('tbody tr')].map(tr => (tr.querySelector('.fc-sig-state') || {}).textContent);
  assert.equal(states[0], 'وافق الطبيب بتاريخ 2026-11-09'); assert.equal(states[1], 'بانتظار موافقة الطبيب'); assert.equal(states[2], 'رفض: النسبة قليلة');
  assert.equal(groups[1].querySelector('tbody tr .fc-sig-state').textContent, 'النص أو الشروط اتغيّرت — أعد الإرسال');
  assert.equal(groups[1].querySelectorAll('tbody tr')[1].querySelector('.fc-sig-state'), null, 'contract never sent shows nothing');
  const tpl = host.querySelector('[data-sig-templates]'); assert(tpl && tpl.textContent.includes('نسخة 1') && tpl.textContent.includes('لا يوجد نص منشور') && tpl.textContent.includes('مسودة بانتظار المستشار القانوني'));
  assert.equal(tpl.querySelectorAll('[data-fin-action="contract-template-publish"]').length, 2, 'publish buttons for the financial manager');
  // repaint is idempotent (no duplicated buttons)
  host.innerHTML = w.SSMPDFinanceControls.panel('doctors', data, h); await new Promise(r => setTimeout(r, 20));
  assert.equal(host.querySelectorAll('.fc-sig-btn').length, 3); assert.equal(host.querySelectorAll('[data-sig-templates]').length, 1);
  // click -> modal -> command
  const sendBtn = host.querySelector('.fc-sig-btn'); const handled = w.SSMPDFinanceControls.act(sendBtn.getAttribute('data-fin-action'), sendBtn.getAttribute('data-id'), data, h);
  assert.equal(handled, true); assert(modalArgs.t.includes('د. أ') && modalArgs.b.includes('(2)') && modalArgs.b.includes('R1'));
  await modalArgs.save({}, 'tok-1'); const sent = calls.filter(c => c[0] === 'clinic_finance_contract_signature_command').pop();
  assert.equal(JSON.stringify(sent[1]), JSON.stringify({ p_action: 'send', p_payload: { doctor_key: 'EMP-1', reference: 'R1' }, p_token: 'tok-1' }));
  // no create right -> no send button, states still shown; migration missing -> nothing painted, no error
  const noCreate = Object.assign({}, data, { can_create: false, can_review: false }); host.innerHTML = w.SSMPDFinanceControls.panel('doctors', noCreate, h); await new Promise(r => setTimeout(r, 20));
  assert.equal(host.querySelectorAll('.fc-sig-btn').length, 0); assert(host.querySelector('.fc-sig-state')); assert.equal(host.querySelectorAll('[data-fin-action="contract-template-publish"]').length, 0);
  w.SSMPDDb.client.rpc = async () => ({ error: { message: 'function does not exist' } }); host.innerHTML = w.SSMPDFinanceControls.panel('doctors', data, h); await new Promise(r => setTimeout(r, 20));
  assert.equal(host.querySelectorAll('.fc-sig-btn,.fc-sig-state,[data-sig-templates]').length, 0, 'nothing painted when the feature is not applied');
  assert(w.SSMPDFinanceControls.act('doctor-payout-xyz', '', data, h) !== undefined);
  console.log('PASS online contracts accountant UI');
})().catch(e => { console.error(e); process.exit(1); });
