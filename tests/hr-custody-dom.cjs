// DOM test (HR custody register): the real HR page gets a «العهد» section for HR managers only; it loads lazily (only when opened), lists items from the server,
// filters/searches, sends the exact payloads to hr_custody_command (revision, request_id for create), blocks a lost/damaged without a reason, hides actions for read-only
// viewers, escapes names, shows history, and degrades clearly when the migration is not applied.
const fs = require('fs'), assert = require('node:assert/strict'), { JSDOM } = require('jsdom');
const tick = () => new Promise(r => setTimeout(r, 25));
(async () => {
  const dom = new JSDOM('<main></main>', { url: 'https://test.invalid', runScripts: 'outside-only' }), w = dom.window, d = w.document;
  const people = [{ id: 'p1', admin_id: 'hr', full_name: 'موظف أول', code: 'EMP-1', kind: 'employee', department: 'الاستقبال', branch: 'الفرع', status: 'active', revision: 2, leave_balance: 5 }, { id: 'p2', admin_id: 'a2', full_name: 'موظف ثان', code: 'EMP-2', kind: 'employee', status: 'active', revision: 2, leave_balance: 0 }];
  const hrData = { can_manage: true, people, requests: [], attendance: [], documents: [], accounts: [], doctor_keys: [], employee_keys: [] };
  const item = (o) => Object.assign({ id: 'i' + Math.random(), code: 'CUS-000001', item_name: 'لاب توب', category: 'device', description: 'Dell', serial_ref: 'SN1', value: 25000, status: 'with_holder', holder_id: 'p1', holder_name: 'موظف أول', came_from_id: null, came_from_name: null, came_from_note: 'المخزن', issued_on: '2026-10-01', returned_on: null, revision: 2 }, o);
  let custody, calls = [], mode = 'ok', wsCalls = 0;
  const fresh = () => ({ can_manage: true, can_view_all: true, today: '2026-11-09', people: [{ id: 'p1', code: 'EMP-1', full_name: 'موظف أول' }, { id: 'p2', code: 'EMP-2', full_name: 'موظف ثان' }],
    items: [item({ id: 'i1' }), item({ id: 'i2', code: 'CUS-000002', item_name: 'مفتاح العيادة', category: 'keys', value: 0, status: 'in_store', holder_id: null, holder_name: null, came_from_name: 'موظف ثان', came_from_note: '', issued_on: '2026-09-01', returned_on: '2026-10-05', revision: 3 }),
      item({ id: 'i3', code: 'CUS-000003', item_name: 'شاشة <img src=x onerror=window.__xss=1>', status: 'lost', value: 4000, holder_id: 'p2', holder_name: 'موظف ثان', revision: 4 })],
    movements: [{ id: 2, item_id: 'i1', action: 'issue', on_date: '2026-10-01', note: '', from_name: null, to_name: 'موظف أول' }, { id: 1, item_id: 'i1', action: 'create', on_date: '2026-10-01', note: '', from_name: null, to_name: null }] });
  custody = fresh();
  w.SSMPDAuth = { currentAdmin: { id: 'hr', role: 'reception', has_hr_access: true } }; w.SSMPDToast = { show: () => {} };
  w.eval(fs.readFileSync('assets/js/roles.js', 'utf8'));
  w.SSMPDDb = { client: { rpc: async (fn, args) => {
    if (fn === 'hr_workspace') return { data: hrData };
    if (fn === 'hr_custody_workspace') { wsCalls++; if (mode === 'missing') return { error: { message: 'Could not find the function public.hr_custody_workspace in the schema cache' } }; return { data: custody }; }
    if (fn === 'hr_custody_command') { calls.push(args); if (mode === 'reject') return { error: { message: 'البند تغير؛ أعد تحميله قبل الحفظ' } }; return { data: 'x' }; }
    return { data: { rules: [], adjustments: [], devices: [], imports: [], services: [] } }; } } };
  for (const f of ['workforce-prices', 'hr-payroll-workspace', 'hr-custody', 'hr-navigation']) w.eval(fs.readFileSync('assets/js/' + f + '.js', 'utf8'));
  const host = d.querySelector('main');
  w.SSMPDHumanResources.render(host); await tick();

  // ---- the section exists for managers and is lazy
  const tab = d.querySelector('[data-hr-open=custody]'); assert(tab, 'custody tab for HR managers'); assert.equal(tab.textContent, 'العهد');
  assert.equal(wsCalls, 0, 'nothing is loaded until the section is opened');
  tab.click(); await tick();
  const root = () => d.querySelector('[data-hr-custody]'); assert(root(), 'custody mounted'); assert.equal(wsCalls, 1);
  const trs = () => [...root().querySelectorAll('tbody tr')];
  assert.equal(trs().length, 3);
  const txt = root().textContent;
  for (const s of ['لاب توب', 'CUS-000001', 'SN1', '25,000.00', 'موظف أول', 'المخزن', 'مفتاح العيادة', 'مفقودة', 'في المخزن', 'مع موظف', '2026-10-05']) assert(txt.includes(s), 'shows ' + s);
  const cards = [...root().querySelectorAll('[data-custody-cards] .wp-card')].map(x => x.textContent); assert(cards[1].includes('25,000.00') && cards[2].includes('4,000.00'), 'cards: held value and lost value: ' + cards.join('|'));
  assert.equal(w.__xss, undefined); assert(!root().querySelector('img'), 'item names are escaped');
  assert(root().textContent.includes('<img src=x'), 'escaped markup is shown as text');

  // ---- filters + search
  const st = root().querySelector('[name=custody_status]'); st.value = 'lost'; st.dispatchEvent(new w.Event('change')); assert.equal(trs().length, 1);
  st.value = ''; st.dispatchEvent(new w.Event('change'));
  const q = root().querySelector('[name=custody_q]'); q.value = 'مفتاح'; q.dispatchEvent(new w.Event('input')); assert.equal(trs().length, 1); q.value = 'EMP'; q.dispatchEvent(new w.Event('input')); assert.equal(trs().length, 0, 'search is on item/code/person text');
  q.value = 'لاب'; q.dispatchEvent(new w.Event('input')); assert.equal(trs().length, 1); q.value = ''; q.dispatchEvent(new w.Event('input')); assert.equal(trs().length, 3);

  // ---- per-status actions
  const actionsOf = tr => [...tr.querySelectorAll('[data-custody]')].map(b => b.dataset.custody);
  assert.deepEqual(actionsOf(trs()[0]), ['transfer', 'return', 'lost', 'damaged', 'edit', 'history']);
  assert.deepEqual(actionsOf(trs()[1]), ['issue', 'edit', 'history']);
  assert.deepEqual(actionsOf(trs()[2]), ['return', 'edit', 'history']);

  // ---- create (with request_id) — values reach the server exactly
  root().querySelector('[data-custody=new]').click();
  let f = d.querySelector('.wp-modal form'); assert(f, 'modal opened');
  f.elements.item_name.value = 'هاتف'; f.elements.category.value = 'device'; f.elements.value.value = '3000'; f.elements.holder_id.value = 'p2'; f.elements.issued_on.value = '2026-11-09';
  f.dispatchEvent(new w.Event('submit', { cancelable: true })); await tick(); await tick();
  assert.equal(calls.length, 1); assert.equal(calls[0].p_action, 'create'); assert.equal(calls[0].p_payload.item_name, 'هاتف'); assert.equal(calls[0].p_payload.holder_id, 'p2'); assert.equal(calls[0].p_payload.value, '3000'); assert(/^[0-9a-f-]{36}$/.test(calls[0].p_payload.request_id));
  assert(!d.querySelector('.wp-modal'), 'modal closed after save'); assert.equal(wsCalls, 2, 'list reloaded after save'); assert(root());

  // ---- transfer: list excludes the current holder, sends revision
  trs()[0].querySelector('[data-custody=transfer]').click(); f = d.querySelector('.wp-modal form');
  assert.deepEqual([...f.elements.holder_id.options].map(o => o.value), ['p2'], 'current holder not offered');
  f.dispatchEvent(new w.Event('submit', { cancelable: true })); await tick(); await tick();
  assert.deepEqual([calls[1].p_action, calls[1].p_payload.id, calls[1].p_payload.revision, calls[1].p_payload.holder_id], ['transfer', 'i1', 2, 'p2']);

  // ---- lost needs a reason (HTML validation blocks the submit)
  trs()[0].querySelector('[data-custody=lost]').click(); f = d.querySelector('.wp-modal form');
  f.dispatchEvent(new w.Event('submit', { cancelable: true })); await tick(); assert.equal(calls.length, 2, 'no request without a reason'); assert(d.querySelector('.wp-modal'));
  f.elements.note.value = 'ضاعت'; f.dispatchEvent(new w.Event('submit', { cancelable: true })); await tick(); await tick();
  assert.deepEqual([calls[2].p_action, calls[2].p_payload.note, calls[2].p_payload.revision], ['lost', 'ضاعت', 2]);

  // ---- return, issue payloads
  trs()[2].querySelector('[data-custody=return]').click(); f = d.querySelector('.wp-modal form'); f.elements.returned_on.value = '2026-11-08'; f.dispatchEvent(new w.Event('submit', { cancelable: true })); await tick(); await tick();
  assert.deepEqual([calls[3].p_action, calls[3].p_payload.returned_on, calls[3].p_payload.id], ['return', '2026-11-08', 'i3']);
  trs()[1].querySelector('[data-custody=issue]').click(); f = d.querySelector('.wp-modal form'); f.elements.holder_id.value = 'p1'; f.dispatchEvent(new w.Event('submit', { cancelable: true })); await tick(); await tick();
  assert.deepEqual([calls[4].p_action, calls[4].p_payload.holder_id, calls[4].p_payload.revision], ['issue', 'p1', 3]);

  // ---- server rejection is shown inside the dialog, which stays open
  mode = 'reject'; trs()[0].querySelector('[data-custody=return]').click(); f = d.querySelector('.wp-modal form'); f.dispatchEvent(new w.Event('submit', { cancelable: true })); await tick(); await tick();
  assert(d.querySelector('.wp-modal [role=alert]').textContent.includes('تغير'), 'stale error shown'); d.querySelector('.wp-modal [data-close]').click(); mode = 'ok';

  // ---- edit sends value + reason
  trs()[0].querySelector('[data-custody=edit]').click(); f = d.querySelector('.wp-modal form'); assert.equal(f.elements.item_name.value, 'لاب توب'); f.elements.value.value = '20000'; f.elements.note_change.value = 'إعادة تقييم';
  f.dispatchEvent(new w.Event('submit', { cancelable: true })); await tick(); await tick();
  assert.deepEqual([calls.at(-1).p_action, calls.at(-1).p_payload.value, calls.at(-1).p_payload.note], ['update', '20000', 'إعادة تقييم']);

  // ---- history
  trs()[0].querySelector('[data-custody=history]').click(); const h = d.querySelector('[data-custody-history]'); assert(h.textContent.includes('تسليم') && h.textContent.includes('تسجيل البند')); assert.equal(h.querySelectorAll('tbody tr').length, 2);
  d.querySelector('.wp-modal [data-close]').click();

  // ---- read-only viewer: no write buttons
  custody = Object.assign(fresh(), { can_manage: false, people: [] }); tab.click(); w.SSMPDHumanResources.render(host); await tick(); d.querySelector('[data-hr-open=custody]').click(); await tick();
  assert(root().querySelectorAll('tbody tr').length === 3 && !root().querySelector('[data-custody=new]') && !root().querySelector('[data-custody=return]') && root().querySelector('[data-custody=history]'), 'only history for read-only users');

  // ---- migration not applied
  mode = 'missing'; d.querySelector('[data-hr-open=home]').click(); await tick(); d.querySelector('[data-hr-open=custody]').click(); await tick();
  assert(root().textContent.includes('غير مفعّل بعد'), 'clear message while the migration is not applied'); assert(root().querySelector('[data-custody=retry]'));
  mode = 'ok'; root().querySelector('[data-custody=retry]').click(); await tick(); assert.equal(root().querySelectorAll('tbody tr').length, 3, 'retry loads');

  // ---- employees without HR management never get the section
  hrData.can_manage = false; w.SSMPDAuth.currentAdmin = { id: 'a2', role: 'reception' }; w.SSMPDHumanResources.render(host); await tick();
  assert(!d.querySelector('[data-hr-open=custody]'), 'no custody tab for ordinary employees'); assert(!d.querySelector('[data-hr-custody]'));
  dom.window.close();
  console.log('PASS hr custody DOM: manager-only lazy section, list/cards/filters/search, escaping, per-status actions, exact payloads (create+request_id, transfer, lost needs reason, return, issue, edit), stale error in dialog, history, read-only view, missing-migration message.');
})().catch(e => { console.error(e); process.exit(1); });
