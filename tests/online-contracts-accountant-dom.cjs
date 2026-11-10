// DOM test: accountant side of the online contracts: send button per ACTIVE group, acceptance state on contract rows, template block, send flow.
const { JSDOM } = require('jsdom'), fs = require('fs'), assert = require('node:assert/strict');
(async () => {
  const dom = new JSDOM('<main class="fc-workspace"><div data-fc-body></div></main>', { url: 'https://test.invalid', runScripts: 'outside-only' }), w = dom.window, d = w.document;
  const calls = [];
  const status = { templates: [{ id: 't1', kind: 'contract', version: 1, title: 'عقد', body: 'مقدمة العقد الأولى هنا', clauses: ['بند أ', 'بند ب'], published: true, placeholder: false }, { id: 't2', kind: 'consent', version: 1, title: 'إقرار', body: 'مقدمة الإقرار المبدئية', clauses: ['إقرار 1'], published: false, placeholder: true }],
    enforcement: { contract_signature: { start_date: null, active: false }, consent: { start_date: '2027-01-01', active: false } },
    compliance: { 'EMP-1': { contract_ok: false, consent_ok: true }, 'EMP-2': { contract_ok: true, consent_ok: false } },
    requests: [], consents: { 'EMP-1': { version: 1, at: '2026-11-09T10:00:00Z', acceptance_id: 'acc-c', signature_kind: 'drawn' } }, contracts: { a1: { state: 'accepted', at: '2026-11-09T10:00:00Z', acceptance_id: 'acc-1', signature_kind: 'uploaded' }, a2: { state: 'pending' }, a3: { state: 'rejected', reason: 'النسبة قليلة' }, a4: { state: 'stale' } } };
  w.SSMPDDb = { financeLinesEnabled: async () => true, financeContractServices: async () => [], financeContractDepartments: async () => [], financeDoctorCommand: async () => ({}),
    client: { rpc: async (name, args) => { calls.push([name, args]); if (name === 'clinic_finance_contract_signature_status') return { data: status }; if (name === 'clinic_finance_contract_signed_document') return { data: { kind: 'contract', doctor_key: 'EMP-1', template_version: 1, text: 'نص موقّع <i>x</i>', text_sha256: 'a'.repeat(64), signature_kind: 'uploaded', signature_image: 'data:image/png;base64,QUJD', signature_sha256: 'b'.repeat(64), decided_at: '2026-11-09T10:00:00Z' } }; return { data: 'req-1' }; } } };
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
  assert.equal(groups[0].querySelectorAll('.fc-sig-btn[data-fin-action="contract-signature-send"]').length, 2, 'two active reference groups for doctor 1');
  assert(groups[0].querySelector('summary .fc-sig-btn[data-fin-action="contract-signature-send"]').textContent.includes('إرسال للتوقيع'));
  assert.equal(groups[0].querySelector('.fc-sig-btn[data-fin-action="contract-signature-send"]').getAttribute('data-fin-action'), 'contract-signature-send');
  const states = [...groups[0].querySelectorAll('tbody tr')].map(tr => (tr.querySelector('.fc-sig-state') || {}).textContent);
  assert(states[0].startsWith('وافق الطبيب بتاريخ 2026-11-09')); assert(groups[0].querySelector('tbody tr .fc-sig-state [data-fin-action="contract-signed-view"][data-id="acc-1"]').textContent.includes('صورة مرفوعة'), 'signed view button on the accepted row');
  const comp1 = groups[0].querySelector('[data-sig-comp="EMP-1"]').textContent; assert(comp1.includes('العقد: غير موقّع') && comp1.includes('الإقرار: تم'), comp1);
  const comp2 = groups[1].querySelector('[data-sig-comp="EMP-2"]').textContent; assert(comp2.includes('العقد: موقّع') && comp2.includes('الإقرار: لم يتم (يُشترط من 2027-01-01)'), comp2);
  assert(groups[0].querySelector('summary [data-fin-action="contract-signed-view"][data-id="acc-c"]'), 'consent signed view for the doctor who signed it'); assert.equal(states[1], 'بانتظار موافقة الطبيب'); assert.equal(states[2], 'رفض: النسبة قليلة');
  assert(groups[1].querySelector('tbody tr .fc-sig-state').textContent.startsWith('النص أو الشروط اتغيّرت — أعد الإرسال'));
  assert.equal(groups[1].querySelectorAll('tbody tr')[1].querySelector('.fc-sig-state'), null, 'contract never sent shows nothing');
  const tpl = host.querySelector('[data-sig-templates]'); assert(tpl && tpl.textContent.includes('نسخة 1') && tpl.textContent.includes('لا يوجد نص منشور') && tpl.textContent.includes('مسودة بانتظار المستشار القانوني'));
  assert.equal(tpl.querySelectorAll('[data-fin-action="contract-template-edit"]').length, 2, 'edit buttons for the financial manager');
  assert(tpl.textContent.includes('غير مفعّل') && tpl.textContent.includes('سيبدأ في 2027-01-01'), 'enforcement block: off by default / future date');
  assert.equal(tpl.querySelectorAll('[data-enf-rule]').length, 2); assert.equal(tpl.querySelector('[data-enf-rule="consent"]').value, '2027-01-01');
  // repaint is idempotent (no duplicated buttons)
  host.innerHTML = w.SSMPDFinanceControls.panel('doctors', data, h); await new Promise(r => setTimeout(r, 20));
  assert.equal(host.querySelectorAll('.fc-sig-btn[data-fin-action="contract-signature-send"]').length, 3); assert.equal(host.querySelectorAll('[data-sig-templates]').length, 1);
  // click -> modal -> command
  const sendBtn = host.querySelector('.fc-sig-btn[data-fin-action="contract-signature-send"]'); const handled = w.SSMPDFinanceControls.act(sendBtn.getAttribute('data-fin-action'), sendBtn.getAttribute('data-id'), data, h);
  assert.equal(handled, true); assert(modalArgs.t.includes('د. أ') && modalArgs.b.includes('(2)') && modalArgs.b.includes('R1'));
  await modalArgs.save({}, 'tok-1'); const sent = calls.filter(c => c[0] === 'clinic_finance_contract_signature_command').pop();
  assert.equal(JSON.stringify(sent[1]), JSON.stringify({ p_action: 'send', p_payload: { doctor_key: 'EMP-1', reference: 'R1' }, p_token: 'tok-1' }));
  // enforcement date save
  d.querySelector('[data-enf-rule="contract_signature"]').value = '2027-03-01';
  assert.equal(w.SSMPDFinanceControls.act('contract-enforcement-save', 'contract_signature', data, h), true); await new Promise(r => setTimeout(r, 20));
  assert.equal(JSON.stringify(calls.filter(c => c[0] === 'clinic_finance_contract_signature_command').pop()[1].p_payload), JSON.stringify({ rule: 'contract_signature', start_date: '2027-03-01' }));
  d.querySelector('[data-enf-rule="consent"]').value = ''; w.SSMPDFinanceControls.act('contract-enforcement-save', 'consent', data, h); await new Promise(r => setTimeout(r, 20));
  assert.equal(calls.filter(c => c[0] === 'clinic_finance_contract_signature_command').pop()[1].p_payload.start_date, null, 'empty date = off');
  // signed view shows the stored signature image and escapes the text
  w.SSMPDFinanceControls.act('contract-signed-view', 'acc-1', data, h); await new Promise(r => setTimeout(r, 20));
  const sv = d.querySelector('.fc-sig-overlay'); assert(sv && sv.querySelector('[data-signed-image]').getAttribute('src') === 'data:image/png;base64,QUJD' && sv.textContent.includes('نص موقّع <i>x</i>') && !sv.querySelector('i')); sv.querySelector('[data-sig-close]').click(); assert(!d.querySelector('.fc-sig-overlay'));
  // template editor (drafts only): loads the draft text, add / remove / reorder clauses, publish needs a second click, saves a new version
  // the buttons are painted after the panel bound its handlers: a REAL click must open the editor. A published text is immutable: clear message, no editor, nothing saved.
  w.SSMPDFinanceCash = { helpers: h }; const nLock = calls.filter(c => c[0] === 'clinic_finance_contract_signature_command').length;
  host.querySelector('[data-sig-templates] [data-fin-action="contract-template-edit"][data-id="contract"]').click(); const lk = d.querySelector('.fc-sig-overlay');
  assert(lk && lk.querySelector('[data-tpl-locked]').textContent.includes('منشور ولا يمكن تعديله') && !lk.querySelector('[data-tpl-save],[data-tpl-title]'), 'published text: message only'); lk.remove();
  assert.equal(calls.filter(c => c[0] === 'clinic_finance_contract_signature_command').length, nLock);
  host.querySelector('[data-sig-templates] [data-fin-action="contract-template-edit"][data-id="consent"]').click(); const cd = d.querySelector('.fc-sig-overlay'); assert(cd && cd.querySelector('[data-tpl-title]').value === 'إقرار', 'draft opens by a real click'); cd.remove();
  status.templates.unshift({ id: 'dc', kind: 'contract', version: 2, title: 'عقد', body: 'مقدمة العقد الأولى هنا', clauses: ['بند أ', 'بند ب'], published: false, placeholder: false });
  w.SSMPDFinanceControls.act('contract-template-edit', 'contract', data, h); let ed = d.querySelector('.fc-sig-overlay'); assert(ed);
  assert.equal(ed.querySelector('[data-tpl-title]').value, 'عقد'); assert.equal(ed.querySelectorAll('[data-clause]').length, 2);
  ed.querySelector('[data-clause-add]').click(); const rows = () => [...ed.querySelectorAll('[data-clause-text]')]; rows()[2].value = 'بند جديد';
  ed.querySelectorAll('[data-clause-down]')[0].click(); assert.equal(rows()[0].value, 'بند ب', 'moved down'); ed.querySelectorAll('[data-clause-up]')[2].click(); assert.deepEqual(rows().map(x => x.value), ['بند ب', 'بند جديد', 'بند أ']);
  ed.querySelectorAll('[data-clause-del]')[0].click(); assert.deepEqual(rows().map(x => x.value), ['بند جديد', 'بند أ']);
  ed.querySelector('[data-tpl-body]').value = 'مقدمة معدلة من المالك للعقد'; const nCmd = calls.filter(c => c[0] === 'clinic_finance_contract_signature_command').length;
  ed.querySelector('[data-tpl-save="publish"]').click(); assert.equal(calls.filter(c => c[0] === 'clinic_finance_contract_signature_command').length, nCmd, 'publishing needs a confirming second click'); assert(ed.querySelector('[data-tpl-save="publish"]').textContent.includes('تأكيد'));
  ed.querySelector('[data-tpl-save="publish"]').click(); await new Promise(r => setTimeout(r, 30));
  const sv2 = calls.filter(c => c[0] === 'clinic_finance_contract_signature_command').pop()[1]; assert.equal(sv2.p_action, 'template_save');
  assert.equal(JSON.stringify(sv2.p_payload), JSON.stringify({ kind: 'contract', title: 'عقد', body: 'مقدمة معدلة من المالك للعقد', publish: true, clauses: ['بند جديد', 'بند أ'], id: 'dc' })); assert(!d.querySelector('.fc-sig-overlay'), 'closed after save');
  // editing a DRAFT updates it in place (payload carries its id) and a draft save does not publish
  status.templates.unshift({ id: 'd1', kind: 'consent', version: 2, title: 'مسودة', body: 'مقدمة مسودة الإقرار', clauses: [], published: false, placeholder: false });
  w.SSMPDFinanceControls.act('contract-template-edit', 'consent', data, h); ed = d.querySelector('.fc-sig-overlay'); assert(ed.textContent.includes('مسودة (نسخة 2)'));
  ed.querySelector('[data-tpl-save="draft"]').click(); await new Promise(r => setTimeout(r, 30)); const sv3 = calls.filter(c => c[0] === 'clinic_finance_contract_signature_command').pop()[1].p_payload; assert.equal(sv3.id, 'd1'); assert.equal(sv3.publish, false);
  // server error stays in the editor
  w.SSMPDDb.client.rpc = async (n) => n === 'clinic_finance_contract_signature_command' ? { error: { message: 'صلاحية مرفوضة' } } : { data: status };
  w.SSMPDFinanceControls.act('contract-template-edit', 'contract', data, h); ed = d.querySelector('.fc-sig-overlay'); ed.querySelector('[data-tpl-save="draft"]').click(); await new Promise(r => setTimeout(r, 30)); assert(ed.querySelector('[data-tpl-msg]').textContent.includes('صلاحية')); ed.remove();
  w.SSMPDDb.client.rpc = async (name, args) => { calls.push([name, args]); return name === 'clinic_finance_contract_signature_status' ? { data: status } : { data: 'req-1' }; };
  // no create right -> no send button, states still shown; migration missing -> nothing painted, no error
  const noCreate = Object.assign({}, data, { can_create: false, can_review: false }); host.innerHTML = w.SSMPDFinanceControls.panel('doctors', noCreate, h); await new Promise(r => setTimeout(r, 20));
  assert.equal(host.querySelectorAll('.fc-sig-btn[data-fin-action="contract-signature-send"]').length, 0); assert(host.querySelector('.fc-sig-state')); assert.equal(host.querySelectorAll('[data-fin-action="contract-template-edit"],[data-fin-action="contract-enforcement-save"]').length, 0); assert(host.querySelector('[data-enf-rule]').disabled, 'dates are read-only without review rights');
  w.SSMPDDb.client.rpc = async () => ({ error: { message: 'function does not exist' } }); host.innerHTML = w.SSMPDFinanceControls.panel('doctors', data, h); await new Promise(r => setTimeout(r, 20));
  assert.equal(host.querySelectorAll('.fc-sig-btn,.fc-sig-state,[data-sig-templates]').length, 0, 'nothing painted when the feature is not applied');
  assert(w.SSMPDFinanceControls.act('doctor-payout-xyz', '', data, h) !== undefined);
  console.log('PASS online contracts accountant UI');
})().catch(e => { console.error(e); process.exit(1); });
