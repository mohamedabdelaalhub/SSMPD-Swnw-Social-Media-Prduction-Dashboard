// DOM test (doctor statement): the button appears for staff who can create/review, opens the statement, falls back when the RPC is missing or fails. (Old header: "تعديل العقد" appears only on ACTIVE contracts (for users who can create), opens a prefilled form and sends ONE contract_revise command; revisions/superseded contracts are labelled.
const { JSDOM } = require('jsdom'), fs = require('fs'), assert = require('node:assert/strict');
(async () => {
  const dom = new JSDOM('<main></main>', { url: 'https://test.invalid', runScripts: 'outside-only' }), w = dom.window, d = w.document;
  let sent = null; const calls = []; const STMT = { summary: { accrued: 700, payable_invoices: 250, pending: 450, paid_out: 0, balance: 700, available_to_pay: 250, other_credits: 0 }, invoices: [{ invoice_id: 'i1', reference: 'INV-1', patient_ref: 'م1', date: '2026-11-01', net: 500, collected: 500, status: 'paid', fee: 250, insurer: null, lines: [{ service_code: 'D-1', service_name: 'حشو', amount: 300, rate: 50 }] }, { invoice_id: 'i2', reference: 'INV-2', patient_ref: '', date: '2026-11-02', net: 400, collected: 100, status: 'insurance', insurer: 'شركة ب', fee: 200, lines: [] }, { invoice_id: 'i4', reference: 'INV-4', patient_ref: '', date: '2026-11-04', net: 200, collected: 50, status: 'credit', insurer: null, fee: 100, lines: [] }, { invoice_id: 'i3', reference: 'INV-3', patient_ref: '', date: '2026-11-03', net: 200, collected: 0, status: 'credit', insurer: null, fee: 100, lines: [] }] };
  w.SSMPDDb = { financeLinesEnabled: async () => true, financeContractServices: async () => [], financeContractDepartments: async () => [], financeDoctorCommand: async (a, p, k) => { sent = { a, p, k }; return {}; }, financeDoctorStatement: async (k, f, t) => { calls.push([k, f, t]); return STMT; } };
  w.eval(fs.readFileSync('assets/js/finance-controls.js', 'utf8'));
  w.eval(fs.readFileSync('assets/js/finance-doctors.js', 'utf8'));
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const btn = (a, id, text) => '<button type="button" data-fin-action="' + a + '" data-id="' + esc(id || '') + '">' + esc(text) + '</button>';
  const table = (hd, rows) => '<table><tbody>' + rows.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
  const field = (n, l, type, val, attrs) => '<label>' + l + '<input name="' + n + '" type="' + (type || 'text') + '" ' + (attrs || '') + '></label>';
  const select = (n, l, o) => '<label>' + l + '<select name="' + n + '">' + (o || []).map(x => '<option value="' + x[0] + '">' + x[1] + '</option>').join('') + '</select></label>';
  let form = null, submit = null;
  const modal = (title, body, fn) => { form = d.createElement('form'); form.innerHTML = body; const wrap = d.createElement('div'); wrap.className = 'fc-modal'; wrap.append(form); d.body.append(wrap); submit = fn; };
  const h = { esc, money: v => Number(v || 0).toFixed(2), btn, table, stamp: x => x, field, select, modal };
  const mk = (id, status, extra) => Object.assign({ id, doctor_key: 'EMP-1', doctor_name: 'د. أ', service_scope: '0001374', valid_from: '2027-01-01', valid_to: '2027-12-31', rate: 50, base_scope: 'service', deduction: 'none', basis: 'performed', status, created_by: 'maker' }, extra || {});
  const data = { today: '2026-11-08', me: 'checker', can_create: true, can_review: true, stock_catalog: [], invoices: [], doctor_allocations: [], doctor_payouts: [], doctor_balances: [],
    doctor_contracts: [mk('a1', 'active'), mk('a2', 'pending'), mk('a3', 'rejected'), mk('a4', 'superseded'), mk('a5', 'pending', { supersedes: 'a1' })] };

  const box = d.createElement('div'); box.innerHTML = w.SSMPDFinanceControls.panel('doctors', data, h); d.body.append(box);
  const sb = box.querySelectorAll('[data-fin-action="doctor-statement"]');
  assert.equal(sb.length, 1, 'one statement button per doctor'); assert.equal(sb[0].dataset.id, 'EMP-1');
  const none = d.createElement('div'); none.innerHTML = w.SSMPDFinanceControls.panel('doctors', Object.assign({}, data, { can_create: false, can_review: false }), h);
  assert.equal(none.querySelectorAll('[data-fin-action="doctor-statement"]').length, 0, 'hidden for users without create/review');
  const tick = () => new Promise(r => setTimeout(r, 20));
  w.SSMPDFinanceControls.act('doctor-statement', 'EMP-1', data, h); await tick();
  assert.deepEqual(calls[0], ['EMP-1', '2026-08-10', '2026-11-08'], 'last 90 days up to today');
  const txt = d.querySelector('.fc-modal form').textContent;
  /* help 279: 3 cards + one explaining line; plain section titles */
  for (const s of ['إجمالي اللي ليه', 'يتصرف له دلوقتي', '250.00', 'مستني فلوس المريض أو التأمين', '450.00', 'INV-1', 'حشو', 'يتصرف دلوقتي (1)', 'مستني فلوس (3)', 'بانتظار دفعة التأمين (شركة ب) — متبقي 300.00', 'آجل — لم يُسدَّد شيء', 'مدفوعة جزئيًا — متبقي 150.00', 'متبقي للتحصيل 650.00']) assert(txt.includes(s), 'statement shows ' + s);
  const secs = [...d.querySelectorAll('.fc-modal form .fc-st-h')]; assert.equal(secs.length, 2, 'two sections');
  const tabs = [...d.querySelectorAll('.fc-modal form table')]; assert.equal(tabs[0].querySelectorAll('tbody tr').length, 1, 'paid section: INV-1 only'); assert.equal(tabs[1].querySelectorAll('tbody tr').length, 3, 'not-yet section: 3 invoices');
  assert(tabs[0].textContent.includes('INV-1') && !tabs[0].textContent.includes('INV-2'), 'paid rows are not in the waiting table'); assert(tabs[1].textContent.includes('INV-2') && !tabs[1].textContent.includes('INV-1'));
  assert(secs[0].textContent.includes('250.00'), 'paid section total fee'); assert(secs[1].textContent.includes('أتعاب محجوزة 400.00'), 'waiting fee total 200+100+100');
  // RPC missing -> clear message, no crash
  d.querySelectorAll('.fc-modal').forEach(x => x.remove()); delete w.SSMPDDb.financeDoctorStatement;
  w.SSMPDFinanceControls.act('doctor-statement', 'EMP-1', data, h); await tick(); assert(d.querySelector('.fc-modal form').textContent.includes('غير متاحة'));
  // RPC fails (migration not applied yet) -> clear message
  d.querySelectorAll('.fc-modal').forEach(x => x.remove()); w.SSMPDDb.financeDoctorStatement = async () => { throw new Error('404'); };
  w.SSMPDFinanceControls.act('doctor-statement', 'EMP-1', data, h); await tick(); assert(d.querySelector('.fc-modal form').textContent.includes('تعذر تحميل'));
  // ---- detail RPC: patient/insurer split + services without an active contract; falls back to the base statement when the detail RPC fails
  const DET = JSON.parse(JSON.stringify(STMT)); DET.has_active_contract = true;
  DET.invoices[1] = Object.assign(DET.invoices[1], { patient_open: 150, insurer_open: 300, claim_amount: 600 });
  DET.invoices.push({ invoice_id: 'i5', reference: 'INV-5', patient_ref: '', date: '2026-11-05', net: 500, collected: 200, status: 'insurance', insurer: 'شركة ج', fee: 50, patient_open: 0, insurer_open: 300, claim_amount: 300, lines: [] });
  DET.uncovered = [{ order_id: 'o1', date: '2026-11-03', service_code: 'L-1', service_name: 'تحليل', department: 'التحاليل', amount: 360, reason: 'none' }, { order_id: 'o2', date: '2026-10-01', service_code: 'D-2', service_name: 'حشو', department: 'الاسنان', amount: 100, reason: 'starts_later' }];
  let detCalls = 0; w.SSMPDDb.financeDoctorStatementDetail = async (k, f, t) => { detCalls++; return DET; }; w.SSMPDDb.financeDoctorStatement = async () => STMT;
  d.querySelectorAll('.fc-modal').forEach(x => x.remove()); w.SSMPDFinanceControls.act('doctor-statement', 'EMP-1', data, h); await tick();
  const dt = d.querySelector('.fc-modal form').textContent; assert.equal(detCalls, 1, 'detail RPC preferred');
  for (const s2 of ['بانتظار حصة المريض — متبقي 150.00', 'بانتظار التأمين (شركة ب) — متبقي 300.00', 'بانتظار التأمين (شركة ج) — متبقي 300.00', 'اتعملت ومالهاش عقد (2)', 'مفيش عقد ساري يغطي الخدمة', 'العقد بيبدأ بعد تاريخ التنفيذ', 'تحليل', '360.00', 'طلبات الاستقبال']) assert(dt.includes(s2), 'detail shows ' + s2);
  assert(!dt.includes('بانتظار حصة المريض — متبقي 0.00'), 'a closed part is not shown'); assert.equal((dt.match(/بانتظار حصة المريض/g) || []).length, 1, 'patient part only where it is open');
  // doctor without an active contract: no uncovered section
  assert(!dt.includes('(L-1)'),'no service codes');assert(!dt.includes('ماعندوش عقد فعّال'));
  DET.uncovered = null; DET.has_active_contract = false; d.querySelectorAll('.fc-modal').forEach(x => x.remove()); w.SSMPDFinanceControls.act('doctor-statement', 'EMP-1', data, h); await tick(); { const t0 = d.querySelector('.fc-modal form').textContent; assert(!t0.includes('ومالهاش عقد')); assert(t0.includes('الدكتور ماعندوش عقد فعّال — الخدمات اللي اتعملت مش بتتحسب'), 'no-contract note'); } DET.has_active_contract = true;
  DET.uncovered = []; d.querySelectorAll('.fc-modal').forEach(x => x.remove()); w.SSMPDFinanceControls.act('doctor-statement', 'EMP-1', data, h); await tick(); assert(d.querySelector('.fc-modal form').textContent.includes('مفيش خدمات منفذة من غير عقد ساري'));
  // detail RPC not applied yet -> base statement still works
  w.SSMPDDb.financeDoctorStatementDetail = async () => { throw new Error('404'); }; d.querySelectorAll('.fc-modal').forEach(x => x.remove()); w.SSMPDFinanceControls.act('doctor-statement', 'EMP-1', data, h); await tick();
  assert(d.querySelector('.fc-modal form').textContent.includes('INV-1') && !d.querySelector('.fc-modal form').textContent.includes('بدون عقد ساري'), 'fallback to the base statement');
  delete w.SSMPDDb.financeDoctorStatementDetail; d.querySelectorAll('.fc-modal').forEach(x => x.remove());
  // finance chat 2026-11-26: clinic_finance_doctor_dues preferred (reception invoices RX-…), dues_status mapped; falls back when it fails
  let duesCalls = 0; w.SSMPDDb.financeDoctorDues = async (k, f, t) => { duesCalls++; return { summary: { balance: 900, paid_out: 200, other_credits: 0 }, dues: { payable_total: 300, waiting_total: 400, available_now: 300 }, invoices: [
    { invoice_id: 'r1', reference: 'RX-11', patient_ref: 'P-1', patient_name: 'سارة', date: '2026-11-20', fee: 300, net: 600, collected: 600, dues_status: 'payable', lines: [{ service_name: 'كشف', amount: 600, rate: 50 }] },
    { invoice_id: 'r2', reference: 'RX-12', date: '2026-11-21', fee: 400, net: 800, collected: 0, patient_open: 800, dues_status: 'waiting_patient', lines: [{ service_name: 'أشعة', amount: 800, rate: 50 }] },
    { invoice_id: 'r3', reference: 'RX-13', date: '2026-11-22', fee: 200, net: 400, collected: 400, dues_status: 'paid_out', lines: [] }, { invoice_id: 'r4', reference: 'RX-14', date: '2026-11-23', fee: 50, net: 100, collected: 100, dues_status: 'requested', lines: [] }] }; };
  w.SSMPDFinanceControls.act('doctor-statement', 'EMP-1', data, h); await tick(); { const t2 = d.querySelector('.fc-modal form').textContent; assert.equal(duesCalls, 1, 'dues RPC preferred');
    for (const s3 of ['يتصرف دلوقتي (1)', 'سارة', 'مستني فلوس (1)', 'في طلب صرف أو اتصرفت (2)', 'اتصرف', 'في طلب صرف', '300.00']) assert(t2.includes(s3), 'dues view shows ' + s3); }
  d.querySelectorAll('.fc-modal').forEach(x => x.remove()); w.SSMPDDb.financeDoctorDues = async () => ({ summary: {}, dues: {}, invoices: [] }); w.SSMPDFinanceControls.act('doctor-statement', 'EMP-1', data, h); await tick();
  assert(d.querySelector('.fc-modal form').textContent.includes('لازم تتسجل إنها «اتنفذت» في الاستقبال'), 'empty: executed hint');
  d.querySelectorAll('.fc-modal').forEach(x => x.remove()); w.SSMPDDb.financeDoctorDues = async () => { throw new Error('denied'); }; w.SSMPDFinanceControls.act('doctor-statement', 'EMP-1', data, h); await tick();
  assert(d.querySelector('.fc-modal form').textContent.includes('INV-1'), 'dues failure falls back to the statement'); delete w.SSMPDDb.financeDoctorDues; d.querySelectorAll('.fc-modal').forEach(x => x.remove());
  // ---- contracts status filter
  d.body.append(box);
  const fd = Object.assign({}, data, { doctor_contracts: [mk('f1', 'active'), mk('f2', 'pending'), Object.assign(mk('f3', 'rejected'), { doctor_key: 'EMP-2', doctor_name: 'د. ب' })] });
  box.innerHTML = w.SSMPDFinanceControls.panel('doctors', fd, h); await tick();
  const chips = [...box.querySelectorAll('[data-fc-filter]')].map(x => x.dataset.fcFilter); assert.deepEqual(chips, ['live', 'pending', 'all'], 'owner 2026-11-25: «سارية + قيد الاعتماد» first; «بتنتهي قريب» only when it has contracts');
  const groups = () => [...box.querySelectorAll('.fc-doctor-group')].filter(g => !g.hidden).length;
  assert.equal(groups(), 1, 'default view hides a doctor whose only contract is rejected (old history)'); assert(box.querySelector('.fc-chip.active').dataset.fcFilter === 'live');
  box.querySelector('[data-fc-filter="pending"]').click(); assert.equal(groups(), 1); assert.equal([...box.querySelectorAll('.fc-doctor-group tbody tr')].filter(r => !r.hidden).length, 1, 'only the pending row shows');
  box.querySelector('[data-fc-filter="all"]').click(); assert.equal(groups(), 2);
  const inp = box.querySelector('[data-fc-name]'); inp.value = 'EMP-2'; inp.dispatchEvent(new w.Event('input', { bubbles: true })); assert.equal(groups(), 1, 'name search'); inp.value = ''; inp.dispatchEvent(new w.Event('input', { bubbles: true }));
  console.log('PASS doctor statement DOM: button visibility, statement content (cards, services, statuses), 90-day window, RPC-missing and RPC-error fallbacks');
})().catch(e => { console.error(e); process.exitCode = 1; });
