// «امنع تكرار العد» UI (count-check.js gate + 20261126020000): a count identical to the previous shift → «العد ده هو هو عد الوردية اللي فاتت»;
// «هعدّ تاني» keeps the form (rejects, no count_check call); «عدّيت فعلًا» continues with a note; not-same / unreachable never blocks.
// Count inputs on every count form have autocomplete="off" (the browser can't refill yesterday's numbers).
const { JSDOM } = require('jsdom'), fs = require('fs'), assert = require('node:assert/strict');
const tick = (ms = 10) => new Promise(r => setTimeout(r, ms));
(async () => {
  const dom = new JSDOM('<!doctype html><html dir="rtl"><body></body></html>', { runScripts: 'outside-only' });
  const w = dom.window, d = w.document, calls = []; let rep = { same: true, last_at: '2026-11-22T20:00:00Z' }, chk = { enabled: true, match: true };
  w.SSMPDDb = { client: { rpc: (n, a) => { calls.push([n, JSON.parse(JSON.stringify(a))]); const r = n === 'clinic_finance_count_repeat' ? rep : chk; return Promise.resolve(r instanceof Error ? { error: r } : { data: r }); } } };
  w.SSMPDFinanceControls = { panel: t => t, act: () => false };
  w.eval(fs.readFileSync('assets/js/count-check.js', 'utf8')); const CC = w.SSMPDCountCheck;
  const click = s => { const b = d.querySelector(s); assert.ok(b, s); b.click(); };
  const counts = { '200': 5, '100': 1, '50': 1, '20': 2 };
  // same → warning with the date; «هعدّ تاني» rejects before count_check
  let p = CC.gate('S1', counts, ''); await tick(); click('[data-cc-ok]'); await tick();
  const m = d.querySelector('.cc-modal'); assert.match(m.textContent, /هي هي بالظبط عدّ ورديتك اللي فاتت/); assert.match(m.textContent, /22/);
  assert.ok(!/1,190|1190/.test(m.textContent), 'no amount in the warning');
  click('[data-cc-recount]'); await assert.rejects(p, /عدّ الفلوس تاني/);
  assert.deepEqual(calls.map(c => c[0]), ['clinic_finance_count_repeat']); assert.deepEqual(calls[0][1], { p_shift: 'S1', p_counts: counts });
  // «عدّيت فعلًا» → continues to count_check, note says so
  calls.length = 0; p = CC.gate('S1', counts, 'ملاحظة'); await tick(); click('[data-cc-ok]'); await tick(); click('[data-cc-same]');
  assert.equal(await p, 'ملاحظة — نفس عدّ الوردية اللي فاتت بالظبط — الكاشير أكّد إنه عدّ فعلي');
  assert.deepEqual(calls.map(c => c[0]), ['clinic_finance_count_repeat', 'clinic_finance_count_check']);
  // not same / unreachable → straight through
  for (const r of [{ same: false }, new Error('x')]) { rep = r; p = CC.gate('S1', counts, 'n'); await tick(); click('[data-cc-ok]'); assert.equal(await p, 'n'); }
  assert.equal(d.querySelectorAll('.cc-modal').length, 0, 'dialogs cleaned up');
  // autocomplete off on every count form
  const src = f => fs.readFileSync('assets/js/' + f, 'utf8');
  assert.match(src('peer-handover.js'), /<form data-peer-form class="peer-form" autocomplete="off">/);
  for (const f of ['accountant-workspace.js', 'finance-advances.js', 'finance-cash.js']) assert.match(src(f), /required min="0" max="9999999" step="1" autocomplete="off"/, f);
  assert.match(src('main-treasury-count.js'), /step="1" autocomplete="off" inputm/);
  console.log('PASS count repeat UI: same-as-last warning (no amounts), recount keeps the form, confirm continues with a note, not-same/unreachable pass, autocomplete off on all count forms');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
