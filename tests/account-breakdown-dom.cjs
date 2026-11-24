// «الحساب الرئيسي + التفصيل» UI (20261125030000): chart «تفصيل» on 1115/2120/5111, wallet-kind propose/review, «أنهي محفظة؟»
// injected into collection forms (required when method = wallet), kind stripped from every RPC payload and saved after a reception
// collect, movements label «محفظة — فودافون كاش».
const { JSDOM } = require('jsdom'), fs = require('fs'), assert = require('node:assert/strict');
const tick = (ms = 15) => new Promise(r => setTimeout(r, ms));
(async () => {
  const dom = new JSDOM('<!doctype html><html dir="rtl"><body><div id="b"></div></body></html>', { runScripts: 'outside-only', url: 'https://example.test/' });
  const w = dom.window, d = w.document; w.crypto = { randomUUID: () => 'tok-' + Math.random().toString(16).slice(2) };
  const calls = []; let answer = {};
  const client = { rpc: (name, args) => { calls.push([name, JSON.parse(JSON.stringify(args))]); return Promise.resolve({ data: typeof answer[name] === 'function' ? answer[name](args) : (answer[name] || {}) }); } };
  w.SSMPDDb = { client };
  let priorActs = []; w.SSMPDFinanceControls = { panel: () => '', act: (a) => { priorActs.push(a); return false; }, due: () => 0 };
  w.eval(fs.readFileSync('assets/js/account-breakdown.js', 'utf8')); await tick();
  const AB = w.SSMPDAccountBreakdown; assert.ok(AB);
  // chain: other actions go to the prior layer
  w.SSMPDFinanceControls.act('something-else', 'x', {}, {}); assert.deepEqual(priorActs, ['something-else']);
  // 1115 breakdown modal: rows + other add up; unset receipt → propose (maker) ; pending by someone else → review (checker)
  answer.clinic_finance_account_breakdown = { code: '1115', total: 1100, rows: [{ key: 'vodafone', label: 'فودافون كاش', amount: 70, count: 1 }, { key: 'unset', label: 'لسه ما اتحددتش', amount: 1000, count: 1 }], other: 30,
    unset: [{ id: 'P1', receipt_no: 'RC-2026-000010', amount: 1000, at: '2026-11-24T10:25:00Z', by: 'منار' }, { id: 'P2', receipt_no: 'RC-2026-000011', amount: 5, at: '2026-11-24T11:00:00Z', by: 'مريم', pending: 'valu', pending_by: 'المحاسب', pending_mine: false }], can_propose: true, can_review: true };
  assert.equal(w.SSMPDFinanceControls.act('account-breakdown', '1115', {}, {}), true); await tick();
  const m = d.querySelector('.ab-modal'); assert.ok(m); assert.match(m.textContent, /المحافظ والتحويلات — حسب المحفظة/);
  assert.match(m.textContent, /1,100\.00/); assert.match(m.querySelector('[data-ab-row="vodafone"]').textContent, /70\.00/); assert.match(m.querySelector('[data-ab-row="other"]').textContent, /حركات تانية/);
  assert.match(m.textContent, /RC-2026-000010/); assert.match(m.textContent, /24\/11\/2026/, 'Latin digits date');
  assert.equal(calls.pop()[1].p_code, '1115');
  const sel = m.querySelector('[data-ab-kind="P1"]'); sel.value = 'vodafone'; m.querySelector('[data-ab-propose="P1"]').click(); await tick();
  let c = calls.find(x => x[0] === 'clinic_finance_wallet_kind'); assert.deepEqual([c[1].p_action, c[1].p_payload], ['propose', { id: 'P1', kind: 'vodafone' }]);
  calls.length = 0; d.querySelector('.ab-modal [data-ab-review="P2"][data-ok="true"]').click(); await tick();
  c = calls.find(x => x[0] === 'clinic_finance_wallet_kind'); assert.deepEqual([c[1].p_action, c[1].p_payload], ['review', { id: 'P2', approve: true }]);
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' })); assert.equal(d.querySelector('.ab-modal'), null, 'Esc closes');
  // no rights → no buttons; my own pending → no review
  const html = AB.body({ code: '1115', total: 5, rows: [], other: 0, unset: [{ id: 'P3', amount: 5, pending: 'valu', pending_mine: true }, { id: 'P4', amount: 1 }], can_propose: false, can_review: true });
  assert.ok(!/data-ab-review|data-ab-propose/.test(html), 'own pending not reviewable, no propose without create');
  // 2120 by doctor
  const dh = AB.body({ code: '2120', total: 775, rows: [{ key: 'EMP-24', label: 'د. أحمد سمير', amount: 775 }], other: 0, unset: [] }); assert.match(dh, /د\. أحمد سمير/); assert.match(dh, /كشف حساب الطبيب/); assert.match(AB.body({ code: '2120', total: 1905, rows: [], other: 180, unset: [] }), /قيود قديمة من غير طبيب محدد/);
  // collection form: «أنهي محفظة؟» appears only for wallet and is required then
  d.getElementById('b').innerHTML = '<form><label>طريقة السداد<select name="method"><option value="cash">نقدي</option><option value="wallet">محفظة إلكترونية</option></select></label><input name="amount" value="70"></form>';
  await tick(); const f = d.querySelector('form'), k = f.querySelector('[name="wallet_kind"]'); assert.ok(k, 'injected');
  assert.equal(k.closest('label').hidden, true); assert.equal(k.disabled, true);
  f.elements.method.value = 'wallet'; f.elements.method.dispatchEvent(new w.Event('change')); assert.equal(k.closest('label').hidden, false); assert.equal(k.required, true);
  assert.equal(f.checkValidity(), false, 'wallet without a kind blocks submit');
  // the RPC wrapper: kind stripped, collect sent unchanged, then saved by reference + amount
  calls.length = 0; answer.clinic_reception_command = { id: 'X' };
  await client.rpc('clinic_reception_command', { p_workspace: 'ws', p_action: 'collect', p_payload: { method: 'wallet', amount: '70', reference: ' W-1 ', wallet_kind: 'vodafone' }, p_token: 't' });
  assert.equal(calls[0][0], 'clinic_reception_command'); assert.ok(!('wallet_kind' in calls[0][1].p_payload), 'not sent to collect');
  assert.deepEqual([calls[1][0], calls[1][1].p_action, calls[1][1].p_payload], ['clinic_finance_wallet_kind', 'set', { reference: 'W-1', amount: 70, kind: 'vodafone' }]);
  calls.length = 0; await client.rpc('clinic_finance_payment_command', { p_payload: { method: 'wallet', wallet_kind: 'valu', amount: 1 } });
  assert.equal(calls.length, 1); assert.ok(!('wallet_kind' in calls[0][1].p_payload), 'stripped for any RPC');
  calls.length = 0; await client.rpc('clinic_reception_command', { p_action: 'collect', p_payload: { method: 'cash', amount: 5, reference: 'C' } }); assert.equal(calls.length, 1, 'cash: no extra call');
  // chart button only on the 3 control accounts
  const aw = fs.readFileSync('assets/js/accountant-workspace.js', 'utf8'); assert.ok(aw.includes("['1115','2120','5111'].indexOf(a.code)!==-1&&!a.archived?b('account-breakdown',a.code,'تفصيل')"));
  // movements label
  const mv = fs.readFileSync('assets/js/finance-shift-movements.js', 'utf8'); const wk = new Function(mv.match(/var WK=[^;]*;/)[0] + mv.match(/function wk\(r\)\{[^}]*\}/)[0] + 'return wk;')();
  assert.equal(wk({ method: 'wallet', wallet_kind: 'vodafone' }), ' — فودافون كاش'); assert.equal(wk({ method: 'wallet' }), ''); assert.equal(wk({ method: 'cash', wallet_kind: 'valu' }), '');
  console.log('PASS account breakdown UI: chart «تفصيل» (1115 rows + other, unset receipts propose/review with maker≠checker, doctors), Esc closes, «أنهي محفظة؟» only for wallet and required, kind stripped from every RPC and saved after a reception collect, movements «محفظة — فودافون كاش».');
})().catch(e => { console.error(e); process.exit(1); });
