// DOM test of the «التقارير» tab (render-reports.js) with a mocked rpc client:
// catalog grouped cards + locks, cash-closing rows/totals, CSV export (BOM, header, totals), owner-only access matrix.
const { JSDOM } = require('jsdom'), fs = require('fs'), assert = require('node:assert/strict');
const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));
(async () => {
  const mk = (rpcImpl) => {
    const dom = new JSDOM('<body><div id="v"></div></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
    const w = dom.window; w.SSMPDDb = { client: { rpc: (n, a) => Promise.resolve(rpcImpl(n, a)) } };
    w.SSMPDRoles = { label: r => 'دور-' + r };
    w.eval(fs.readFileSync('assets/js/render-reports.js', 'utf8')); return w;
  };
  const catalog = { reports: [
    { code: 'daily_flash', title: 'التقرير الصباحي', area: 'operations', sensitive: false, allowed: true },
    { code: 'cash_closing', title: 'الإقفال اليومي للخزنة', area: 'cash', sensitive: false, allowed: true },
    { code: 'doctor_dues', title: 'مستحقات الدكاترة', area: 'doctors', sensitive: true, allowed: false }],
    branches: [{ id: 'b1', name: 'حدائق الأهرام' }], is_owner: false };
  const cash = { rows: [{ branch: 'حدائق الأهرام', register: 'خزنة 1', cashier: 'سارة', opened_at: '2026-11-18T08:00:00', closed_at: '2026-11-18T16:00:00', status: 'closed', cash: 1500, pos: 300, instapay: 0, bank: 0, expected: 1800, counted: 1750, difference: -50, reviewer: 'منى' }],
    totals: { shifts: 1, cash: 1500, pos: 300, instapay: 0, bank: 0, expected: 1800, counted: 1750, difference: -50, short_shifts: 1 } };
  const calls = [];
  const w = mk((n, a) => { calls.push([n, a]); if (n === 'report_catalog') return { data: catalog }; if (n === 'report_cash_closing') return { data: cash }; if (n === 'report_access_admin') return { error: { message: 'صلاحيات التقارير للمالك فقط' } }; return { data: {} }; });
  const v = w.document.getElementById('v'); w.SSMPDRenderReports.render(v); await tick();
  assert.equal(v.querySelectorAll('.rc-open').length, 2, 'two openable cards');
  assert.equal(v.querySelectorAll('.rc-locked').length, 1, 'one locked card');
  assert.match(v.querySelector('.rc-locked').textContent, /مقفول عليك/);
  assert.deepEqual([...v.querySelectorAll('.rc-gh h2')].map(h => h.textContent), ['التشغيل', 'الخزنة والإيرادات', 'الدكاترة']);
  v.querySelector('[data-code="cash_closing"]').click(); await tick();
  assert.equal(calls.filter(c => c[0] === 'report_cash_closing').pop()[1].p_branch, 'b1', 'defaults to first branch');
  assert.equal(v.querySelectorAll('.rc-hero').length, 1, 'exactly one hero tile');
  assert.equal(v.querySelectorAll('tbody tr').length, 1); assert.match(v.querySelector('tbody').textContent, /سارة/);
  assert.match(v.querySelector('tfoot').textContent, /الإجمالي[\s\S]*1,800/);
  assert.ok(v.querySelector('td.rc-negc'), 'negative difference is red');
  // CSV
  let saved = ''; w.Blob = function (parts) { saved = parts.join(''); }; w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => {};
  v.querySelector('[data-act="csv"]').click(); await tick(5);
  assert.ok(saved.startsWith('﻿'), 'BOM'); const lines = saved.slice(1).split('\r\n');
  assert.match(lines[0], /^الفرع,الخزنة,الكاشير/); assert.match(lines[lines.length - 1], /^الإجمالي,.*1800/);
  assert.equal(lines.length, 3);
  // empty + error states
  const w2 = mk((n) => n === 'report_catalog' ? { data: catalog } : n === 'report_cash_closing' ? { data: { rows: [], totals: {} } } : { data: {} });
  const v2 = w2.document.getElementById('v'); w2.SSMPDRenderReports.render(v2); await tick(); v2.querySelector('[data-code="cash_closing"]').click(); await tick();
  assert.match(v2.textContent, /لسه مفيش بيانات في الفترة دي/);
  const w3 = mk((n) => n === 'report_catalog' ? { data: catalog } : { error: { message: 'راجع الفترة' } });
  const v3 = w3.document.getElementById('v'); w3.SSMPDRenderReports.render(v3); await tick(); v3.querySelector('[data-code="cash_closing"]').click(); await tick();
  assert.match(v3.querySelector('.rc-error').textContent, /راجع الفترة/);
  // access matrix: non-owner gets nothing, owner gets rows + save
  const host = w.document.createElement('div'); await w.SSMPDRenderReports.mountAccess(host); assert.equal(host.innerHTML, '', 'non-owner: no section');
  const list = { reports: [{ code: 'doctor_dues', title: 'مستحقات الدكاترة', area: 'doctors', sensitive: true, roles: ['general_manager'], admins: [{ id: 'a1', name: 'أحمد' }] }], people: [{ id: 'a1', name: 'أحمد', role: 'accountant' }, { id: 'a2', name: 'هبة', role: 'reception' }] };
  const sets = []; const w4 = mk((n, a) => { if (n === 'report_access_admin') { if (a.p_action === 'set') sets.push(a.p_payload); return { data: list }; } return { data: {} }; });
  const h4 = w4.document.createElement('div'); await w4.SSMPDRenderReports.mountAccess(h4); await tick();
  assert.equal(h4.querySelectorAll('input[type=checkbox]').length, 9); assert.match(h4.textContent, /مستحقات الدكاترة بتفتح للمدير العام والمدير المالي بس/);
  const pick = h4.querySelector('[data-pick]'); pick.value = 'a2'; pick.dispatchEvent(new w4.Event('change', { bubbles: true }));
  h4.querySelector('[data-role="accountant"]').checked = true; h4.querySelector('[data-save]').click(); await tick();
  assert.equal(sets[0].code, 'doctor_dues'); assert.equal(JSON.stringify(sets[0].admin_ids), '["a1","a2"]');
  assert.ok(sets[0].roles.includes('accountant') && sets[0].roles.includes('general_manager'));
  // wiring
  const app = fs.readFileSync('assets/js/app.js', 'utf8'), html = fs.readFileSync('index.html', 'utf8');
  assert.match(app, /reports: window\.SSMPDRenderReports/); assert.match(html, /render-reports\.js\?v=reports-wave1-20261119-1/); assert.match(html, /reports-center\.css\?v=reports-wave1-20261119-1/);
  console.log('PASS reports center DOM: grouped cards + locks, cash closing rows/totals/red difference, CSV (BOM/header/totals), empty/error states, owner-only access matrix + save payload, wiring.');
})().catch(e => { console.error(e); process.exit(1); });
