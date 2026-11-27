// «عقود الأطباء» layout (help 305): global «مراجعة كل المعلّق», per-doctor ⋯ menu (buttons kept), folded settings/needs/allocations, paged allocations, trimmed rates. Nothing removed.
const { JSDOM } = require(require.resolve('jsdom', { paths: [process.env.SSMPD_TEST_MODULES || process.cwd()] })), fs = require('fs'), assert = require('node:assert/strict');
(async () => {
  const dom = new JSDOM('<main id="acc-sub-view"></main>', { url: 'https://test.invalid', runScripts: 'outside-only', pretendToBeVisual: true }), w = dom.window, d = w.document;
  w.SSMPDDb = { financeLinesEnabled: async () => true, financeContractServices: async () => [], financeContractDepartments: async () => [], financeDoctorCommand: async () => ({}) };
  for (const f of ['finance-controls', 'doctor-contracts-ui', 'finance-doctors']) w.eval(fs.readFileSync('assets/js/' + f + '.js', 'utf8'));
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = v => Number(v || 0).toFixed(2), btn = (a, id, text) => '<button type="button" data-fin-action="' + a + '" data-id="' + esc(id || '') + '">' + esc(text) + '</button>';
  const table = (hd, rows) => '<table><thead><tr>' + hd.map(x => '<th>' + esc(x) + '</th>').join('') + '</tr></thead><tbody>' + rows.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
  const h = { esc, money, btn, table, stamp: x => x, field: (n, l) => '<input name="' + n + '">', select: (n) => '<select name="' + n + '"></select>', modal: () => {} };
  const mk = (id, key, name, scope, rate, status, by) => ({ id, doctor_key: key, doctor_name: name, service_scope: scope, valid_from: '2027-01-01', valid_to: '2027-12-31', rate, fee_kind: 'rate', base_scope: 'service', deduction: 'none', basis: 'performed', status, created_by: by || 'x' });
  const contracts = [mk('a1', 'EMP-1', 'د. أ', '0001374', 20, 'pending'), mk('a2', 'EMP-1', 'د. أ', '0001373', 50, 'active'), mk('b1', 'EMP-2', 'د. ب', '0001375', 30, 'pending'), mk('c1', 'EMP-3', 'د. ج', '0001376', 40, 'pending', 'checker'), mk('c2', 'EMP-3', 'د. ج', '0001377', 40, 'active')];
  const alloc = Array.from({ length: 120 }, (_, i) => ({ invoice_reference: 'RX-' + i, doctor_name: 'د. أ', terms: { fee_kind: 'rate', rate: 30, basis: 'performed', base_scope: 'service', deduction: 'none' }, original_base: 1000, original_deduction: 0, earned: 300 }));
  const data = { today: '2026-11-08', me: 'checker', can_create: true, can_review: true, stock_catalog: [], invoices: [], doctor_contracts: contracts, doctor_allocations: alloc, doctor_payouts: [], doctor_balances: [] };
  const view = d.getElementById('acc-sub-view'); view.innerHTML = w.SSMPDFinanceControls.panel('doctors', data, h);
  // modules that inject later (contract texts, doctors without a contract)
  const first = view.querySelector('.fc-doctor-group'); const tpl = d.createElement('div'); tpl.setAttribute('data-sig-templates', 'yes'); tpl.innerHTML = '<h4>نصوص العقد الإلكتروني</h4><button data-fin-action="contract-template-edit" data-id="contract">تعديل النص</button>'; first.parentNode.append(tpl);
  const need = d.createElement('div'); need.setAttribute('data-da-needs', ''); need.innerHTML = '<h4>أطباء مسجلين في الموارد البشرية وملهمش عقد (3)</h4><table></table>'; first.parentNode.append(need);
  w.SSMPDDoctorContractsUI.start(); await new Promise(r => setTimeout(r, 120));
  // ---- global approve-all bar: 2 reviewable pending (c1 is the viewer's own -> excluded), 2 doctors
  const bar = view.querySelector('[data-dcu-bulk]'); assert(bar, 'bulk bar'); assert(bar.textContent.includes('2') && bar.textContent.includes('من 2 دكتور'), bar.textContent);
  assert(bar.querySelector('[data-fin-action="doctor-contracts-review-everyone"]').textContent.includes('(2)'));
  let shown = null, submit = null, sent = null;
  w.SSMPDDb.financeDoctorCommand = async (a, p, k) => { sent = { a, p }; return {}; };
  w.SSMPDFinanceControls.act('doctor-contracts-review-everyone', 'all', data, Object.assign({}, h, { modal: (t, body, fn) => { shown = { t, body }; submit = fn; } }));
  assert(shown.t.includes('2'), shown.t); assert(shown.body.includes('د. أ') && shown.body.includes('20%'), 'preview list with trimmed rate');
  await submit({ approval: 'yes', note: '' }, 'k'); assert.deepEqual(JSON.parse(JSON.stringify(sent)), { a: 'contract_review_batch', p: { ids: ['a1', 'b1'], approve: true, note: '' } });
  await assert.rejects(async () => submit({ approval: 'no', note: ' ' }, 'k'), /سبب الرفض/);
  // ---- ⋯ menu keeps every button in the DOM
  const sum = view.querySelector('.fc-doctor-group > summary'); assert(sum.querySelector('.dcu-more'), '⋯ button'); const menu = sum.querySelector('.dcu-menu'); assert(menu.hidden, 'closed by default');
  assert(menu.querySelector('[data-fin-action="doctor-statement"]') && menu.querySelector('[data-fin-action="contract-marketing"]'), 'same buttons inside the menu');
  sum.querySelector('.dcu-more').click(); assert(!menu.hidden && sum.querySelector('.dcu-more').getAttribute('aria-expanded') === 'true', 'opens'); w.document.body.click(); assert(menu.hidden, 'closes on outside click');
  // ---- details popup: click the summary text -> modal with rows + ✕ + back arrow; closing returns the nodes
  const grp = sum.parentNode, rowsBefore = grp.querySelectorAll('[data-fin-action]').length, tblBefore = grp.querySelectorAll('table').length; assert(tblBefore > 0, 'group has tables');
  assert(sum.querySelector('.dcu-menu-h').textContent === 'خيارات متقدمة' && sum.querySelector('.dcu-more').title === 'خيارات متقدمة', 'menu renamed');
  sum.firstElementChild.click(); const pp = d.querySelector('.dcu-pop'); assert(pp, 'popup opens'); assert(!grp.open, 'details not left open');
  assert(pp.querySelector('[data-dcu-pop-close]') && pp.querySelector('[data-dcu-pop-back]'), '✕ + back arrow'); assert.equal(pp.querySelectorAll('table').length, tblBefore, 'rows moved into the popup');
  pp.querySelector('[data-dcu-pop-close]').click(); assert(!d.querySelector('.dcu-pop'), '✕ closes'); assert.equal(grp.querySelectorAll('table').length, tblBefore, 'tables returned'); assert.equal(grp.querySelectorAll('[data-fin-action]').length, rowsBefore, 'every button still there');
  sum.firstElementChild.click(); d.querySelector('[data-dcu-pop-back]').click(); assert(!d.querySelector('.dcu-pop'), 'back arrow closes');
  sum.firstElementChild.click(); d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); assert(!d.querySelector('.dcu-pop'), 'Esc closes');
  sum.firstElementChild.click(); d.querySelector('.dcu-pop').click(); assert(!d.querySelector('.dcu-pop'), 'outside click closes');
  grp.open = true; assert(grp.open, '«فتح الكل» (open attribute) still works');  grp.open = false;
  // ---- rates trimmed, folds, paging
  assert(!/\d\.00%/.test(sum.textContent), 'no trailing .00: ' + sum.textContent);
  assert(view.querySelector('[data-dcu-fold=settings] [data-sig-templates]'), 'contract texts folded'); assert(view.querySelector('[data-dcu-fold=needs] [data-da-needs]'), 'doctors without contract folded');
  const af = view.querySelector('[data-dcu-fold=alloc]'); assert(af && !af.open, 'allocations folded'); assert.equal(af.querySelectorAll('tbody tr').length, 50, 'only the first page is rendered'); assert(af.textContent.includes('RX-0') && !af.textContent.includes('RX-60'));
  af.querySelector('[data-dcu-next]').click(); assert(af.textContent.includes('RX-50') && af.textContent.includes('RX-99') && !af.textContent.includes('RX-0 '), 'next page'); assert(af.querySelector('[data-dcu-of]').textContent.includes('2 من 3'));
  af.querySelector('[data-dcu-next]').click(); assert(af.textContent.includes('RX-119'), 'every row reachable (last page)'); assert(af.querySelector('[data-dcu-next]').disabled);
  // ---- idempotent: no churn after settling
  let n = 0; new w.MutationObserver(l => { n += l.length; }).observe(view, { childList: true, subtree: true, attributes: false }); await new Promise(r => setTimeout(r, 200)); assert.equal(n, 0, 'no mutation loop');
  console.log('doctor-contracts-ui-dom OK');
})().catch(e => { console.error(e); process.exit(1); });
