// «جرد الوردية» UI (count-check.js, 20261125110000): review step, blind mismatch alert (recount / hand over with reason), alert off,
// server unreachable never blocks, settings toggle (super/FM), attempts line on «فروق الخزينة», wired into the 3 handover screens.
const { JSDOM } = require('jsdom'), fs = require('fs'), assert = require('node:assert/strict');
const tick = (ms = 10) => new Promise(r => setTimeout(r, ms));
(async () => {
  const dom = new JSDOM('<!doctype html><html dir="rtl"><body><div id="b"></div></body></html>', { runScripts: 'outside-only' });
  const w = dom.window, d = w.document; const calls = []; let reply = {};
  w.SSMPDDb = { client: { rpc: (n, a) => { calls.push([n, JSON.parse(JSON.stringify(a))]); const r = reply[a.p_action]; return r instanceof Error ? Promise.resolve({ error: r }) : Promise.resolve({ data: r }); } } };
  w.SSMPDFinanceControls = { panel: (t) => '<p>' + t + '</p>', act: () => false };
  w.eval(fs.readFileSync('assets/js/count-check.js', 'utf8')); const CC = w.SSMPDCountCheck;
  const click = sel => { const b = d.querySelector(sel); assert.ok(b, sel); b.click(); };
  const counts = { '200': 4, '100': 3, '50': 1 };
  // 1) review: lines + total; «رجوع أعدّل» keeps the form (rejects), nothing sent
  let p = CC.gate('S1', counts, 'ملاحظة'); await tick();
  const m = d.querySelector('.cc-modal'); assert.match(m.textContent, /راجع اللي كتبته/); assert.match(m.textContent, /200 × 4/); assert.match(m.querySelector('[data-cc-total]').textContent, /1,150\.00/);
  click('[data-cc-back]'); await assert.rejects(p, /رجعت تعدّل العد/); assert.equal(calls.length, 0);
  // 2) match → the note goes through unchanged
  reply.check = { enabled: true, match: true }; p = CC.gate('S1', counts, 'ملاحظة'); await tick(); click('[data-cc-ok]'); assert.equal(await p, 'ملاحظة');
  assert.deepEqual(calls.pop()[1], { p_action: 'check', p_payload: { shift_id: 'S1', counts } });
  // 3) mismatch → blind alert (no amount); «أعدّ تاني» rejects; «متأكد» resolves with the reason appended
  reply.check = { enabled: true, match: false, left: 1 }; p = CC.gate('S1', counts, ''); await tick(); click('[data-cc-ok]'); await tick();
  const a = d.querySelector('.cc-modal'); assert.match(a.textContent, /العد ده مش مطابق/); assert.ok(!/1,150|1,000|زيادة|عجز/.test(a.querySelector('.cc-alert').textContent), 'no amounts in the alert');
  click('[data-cc-recount]'); await assert.rejects(p, /عدّ الفلوس تاني/);
  p = CC.gate('S1', counts, 'ن'); await tick(); click('[data-cc-ok]'); await tick(); d.querySelector('[data-cc-reason]').value = 'مريض دفع ولسه ما اتسجّلش'; click('[data-cc-anyway]');
  assert.equal(await p, 'ن — سلّم رغم تنبيه عدم المطابقة: مريض دفع ولسه ما اتسجّلش');
  // 4) alert off / limit / server unreachable → never blocks
  for (const r of [{ enabled: false }, { enabled: true, limit: true }, new Error('x')]) { reply.check = r; p = CC.gate('S1', counts, 'n'); await tick(); click('[data-cc-ok]'); assert.equal(await p, 'n'); }
  assert.equal(d.querySelectorAll('.cc-modal').length, 0, 'dialogs cleaned up');
  // 5) settings box: FM sees «إيقاف التنبيه», click → set {enabled:false}; reception sees the state only
  reply.settings = { enabled: true, can_change: true, updated_by: 'المدير المالي' }; const host = d.createElement('div'); d.body.appendChild(host);
  await CC.settingsBox(host); assert.match(host.textContent, /شغّال/); calls.length = 0; reply.set = { enabled: false }; reply.settings = { enabled: false, can_change: true };
  host.querySelector('[data-cc-toggle]').click(); await tick(); assert.deepEqual(calls[0][1], { p_action: 'set', p_payload: { enabled: false } }); await tick(); assert.match(host.textContent, /مقفول/);
  reply.settings = { enabled: true, can_change: false }; await CC.settingsBox(host); assert.equal(host.querySelector('[data-cc-toggle]'), null);
  // settings section only on the settings tab for reviewers
  assert.match(w.SSMPDFinanceControls.panel('settings', { can_review: true }, {}), /data-cc-setting/); assert.ok(!/data-cc-setting/.test(w.SSMPDFinanceControls.panel('settings', { can_review: false }, {})));
  // 6) attempts line under the case row (reviewers)
  d.getElementById('b').innerHTML = '<table><tr><td>مريم</td><td data-cs-bal="C1">…</td><td>صدر قرار</td></tr></table>';
  reply.attempts = [{ case_id: 'C1', attempts: [{ counted: 1150, matched: false, at: '2026-11-24T19:40:00Z' }, { counted: 1000, matched: true, at: '2026-11-24T19:43:00Z' }] }];
  await CC.fillAttempts(d.getElementById('b')); const line = d.querySelector('.cc-att'); assert.ok(line); assert.match(line.textContent, /1\) 1,150\.00 21:40 — مش مطابق ← 2\) 1,000\.00 21:43 — مطابق/);
  // 7) wired into the 3 handover screens
  assert.ok(fs.readFileSync('assets/js/accountant-workspace.js', 'utf8').includes("w.SSMPDCountCheck.gate(id,counts,v.note)"));
  assert.ok(fs.readFileSync('assets/js/finance-cash.js', 'utf8').includes("window.SSMPDCountCheck.gate(id,out,v.note)"));
  assert.ok(fs.readFileSync('assets/js/peer-handover.js', 'utf8').includes("w.SSMPDCountCheck.gate(o.shift.id, p.counts, p.note)"));
  console.log('PASS shift count check UI: review lines + total, back keeps the form, match passes, blind mismatch alert (no amounts) with recount / hand over + reason, off / limit / unreachable never block, FM toggle (reception read-only), attempts line on cases, wired into accountant / finance / peer handover.');
})().catch(e => { console.error(e); process.exit(1); });
