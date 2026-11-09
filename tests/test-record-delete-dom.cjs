// DOM test for the owner-only «سجلات تجريبية» panel: card only for super_admin, search -> scan -> flag (typed confirmation), delete (typed confirmation), blockers shown and delete disabled,
// unflag, history, errors shown in Arabic, "feature not applied yet" message.
const { JSDOM } = require('jsdom'), fs = require('fs'), assert = require('node:assert/strict');
(async () => {
  const tick = () => new Promise(r => setTimeout(r, 15));
  const mk = async (role, db) => {
    const dom = new JSDOM('<div id="app-root"><div id="admin-users"><h3>كل المستخدمين</h3></div></div>', { url: 'https://test.invalid', runScripts: 'outside-only', pretendToBeVisual: true });
    const w = dom.window; w.SSMPDAuth = { currentAdmin: { role, roles: [role] } }; w.SSMPDDb = db; w.eval(fs.readFileSync('assets/js/test-records.js', 'utf8')); await tick(); await tick(); return w;
  };
  const calls = [];
  let flags = [], dels = [], mode = 'ok', blockers = [];
  const INV = { key: 'i1', label: 'TST-INV-1 — مريض تجريبي', sub: '600 ج — 2026-11-09', flagged: false };
  const scanOf = (key, bl) => ({ type: 'invoice', key, exists: true, label: 'فاتورة TST-INV-1', flagged: flags.some(f => f.key === key), blockers: bl || [], counts: { 'clinic_finance.invoices': 1, 'clinic_finance.lines': 2 }, deletable: !(bl || []).length });
  const db = {
    financeTestOverview: async () => { if (mode === 'missing') throw new Error('Could not find the function public.clinic_finance_test_overview'); return { flags: flags.map(f => Object.assign({}, f, { scan: scanOf(f.key, blockers) })), deletions: dels }; },
    financeTestFind: async (t, q) => { calls.push(['find', t, q]); return [Object.assign({}, INV, { flagged: flags.some(f => f.key === 'i1') }), { key: 'i2', label: 'TST-REAL', sub: '100', flagged: false }]; },
    financeTestScan: async (t, k) => { calls.push(['scan', t, k]); return scanOf(k, k === 'i2' ? [{ code: 'payments', label: 'دفعات مسجلة على الفاتورة', count: 1 }] : []); },
    financeTestFlag: async (t, k, r, c) => { calls.push(['flag', t, k, r, c]); if (c !== 'تجريبي') throw new Error('اكتب كلمة «تجريبي» للتأكيد'); flags.push({ type: t, key: k, label: 'فاتورة TST-INV-1', reason: r, flagged_at: '2026-11-09T10:00:00Z', flagged_by: 'المالك' }); return 'f1'; },
    financeTestUnflag: async (t, k, r) => { calls.push(['unflag', t, k, r]); flags = flags.filter(f => f.key !== k); },
    financeTestDelete: async (t, k, r, c) => { calls.push(['delete', t, k, r, c]); if (c !== 'حذف') throw new Error('اكتب كلمة «حذف» للتأكيد'); flags = flags.filter(f => f.key !== k); dels.unshift({ id: 'd1', type: t, label: 'فاتورة TST-INV-1', reason: r, deleted_at: '2026-11-09T11:00:00Z', deleted_by: 'المالك', counts: { 'clinic_finance.invoices': 1 } }); return 'd1'; },
  };

  // 1. only the owner sees the card
  for (const role of ['financial_manager', 'accountant', 'general_manager', 'reception']) { const x = await mk(role, db); assert.equal(x.document.querySelector('[data-test-records-card]'), null, role + ' sees nothing'); }
  const w = await mk('super_admin', db), d = w.document, $ = s => d.querySelector(s), $$ = s => [...d.querySelectorAll(s)];
  const card = $('[data-test-records-card]'); assert(card, 'owner sees the card'); assert(card.nextElementSibling === $('#admin-users'), 'card sits above «كل المستخدمين»'); assert.equal($$('[data-test-records-card]').length, 1, 'no duplicates after DOM mutations');

  // 2. open, search, scan a clean record, flag with typed confirmation
  card.querySelector('[data-test-records-open]').click(); await tick();
  const m = () => $('[data-test-records-modal]'); assert(m()); assert(m().textContent.includes('مفيش سجلات معلَّمة'), 'no flags yet');
  const submit = async (form, vals) => { for (const [k, v] of Object.entries(vals)) form.elements[k].value = v; form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await tick(); await tick(); };
  const search = async (type, q) => submit($('[data-tr-search]'), { type, q });
  await search('invoice', 'TST'); assert.deepEqual(calls.pop(), ['find', 'invoice', 'TST']); assert.equal($$('[data-tr-results] [data-tr-scan]').length, 2);
  $$('[data-tr-scan]')[0].click(); await tick(); await tick();
  assert.equal(calls.pop().join(), 'scan,invoice,i1'); const box = $('[data-tr-scan-box]'); assert(box.textContent.includes('هيتمسح لو اتحذف') && box.textContent.includes('فاتورة: 1') && box.textContent.includes('سطر قيد: 2'));
  assert.equal($('[data-tr-blockers]'), null); assert(box.querySelector('[data-tr-flag]'), 'flag form for a clean record');
  await submit($('[data-tr-flag]'), { reason: 'فاتورة تجربة', confirm: 'غلط' });
  assert($('[data-tr-error]').textContent.includes('اكتب كلمة «تجريبي»'), 'server refusal shown'); assert.equal(flags.length, 0);
  await submit($('[data-tr-flag]'), { reason: 'فاتورة تجربة', confirm: 'تجريبي' });
  assert.deepEqual(calls.filter(c => c[0] === 'flag').pop(), ['flag', 'invoice', 'i1', 'فاتورة تجربة', 'تجريبي']); assert(m().textContent.includes('اتعلّم السجل «تجريبي»')); assert.equal($$('[data-tr-flag-row]').length, 1);

  // 3. a record with real activity: blockers shown, no flag form
  await search('invoice', 'TST'); assert.equal($$('[data-tr-flagged]').length, 1, 'flagged badge replaces the button'); $$('[data-tr-scan]')[0].click(); await tick(); await tick();
  assert($('[data-tr-blockers]').textContent.includes('دفعات مسجلة على الفاتورة (1)')); assert.equal($('[data-tr-flag]'), null, 'cannot flag a record with blockers');

  // 4. delete: needs the typed word, sends reason + confirmation
  $('[data-tr-del-open]').click(); await tick(); assert($('[data-tr-delete]'));
  await submit($('[data-tr-delete]'), { reason: 'تنظيف التجربة', confirm: 'x' }); assert($('[data-tr-error]').textContent.includes('اكتب كلمة «حذف»')); assert.equal(dels.length, 0);
  $('[data-tr-del-open]').click(); await tick();
  await submit($('[data-tr-delete]'), { reason: 'تنظيف التجربة', confirm: 'حذف' });
  assert.deepEqual(calls.filter(c => c[0] === 'delete').pop(), ['delete', 'invoice', 'i1', 'تنظيف التجربة', 'حذف']);
  assert(m().textContent.includes('اتحذف السجل بعد ما اتنسخ كامل في الأرشيف')); assert.equal($$('[data-tr-flag-row]').length, 0); assert($('[data-tr-history]').textContent.includes('تنظيف التجربة'), 'history shows who/why/what');

  // 5. flagged record that later got a payment: delete button disabled, reason shown
  flags.push({ type: 'invoice', key: 'i9', label: 'فاتورة', reason: 'تجربة', flagged_at: '2026-11-09', flagged_by: 'المالك' }); blockers = [{ code: 'payments', label: 'دفعات مسجلة على الفاتورة', count: 1 }];
  $('[data-tr-close]').click(); card.querySelector('[data-test-records-open]').click(); await tick(); await tick();
  const row = $('[data-tr-flag-row]'); assert(row.querySelector('[data-tr-del-open]').disabled, 'delete disabled while tied to real activity'); assert(row.textContent.includes('مرفوض'));
  // 6. unflag asks for a reason
  w.prompt = () => 'تراجعت'; row.querySelector('[data-tr-unflag]').click(); await tick(); await tick();
  assert.deepEqual(calls.filter(c => c[0] === 'unflag').pop(), ['unflag', 'invoice', 'i9', 'تراجعت']); assert.equal($$('[data-tr-flag-row]').length, 0);
  // 7. close, and the migration not applied yet
  $('[data-tr-close]').click(); assert.equal(m(), null);
  mode = 'missing'; const w2 = await mk('super_admin', db); w2.document.querySelector('[data-test-records-open]').click(); await tick(); await tick();
  assert(w2.document.querySelector('[data-tr-error]').textContent.includes('لم تُفعَّل بعد'), 'clear message when the DB update is not applied');
  console.log('PASS test-record delete DOM: owner-only card, search/scan, flag + delete with typed confirmations, blockers shown and delete disabled, unflag, history, errors in Arabic, not-applied message');
})().catch(e => { console.error(e); process.exitCode = 1; });
