// DOM test of the partner-lab link review screen (synthetic data, fake RPC server).
const { JSDOM } = require('jsdom'), fs = require('fs'), assert = require('node:assert/strict');
const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));
(async () => {
  const dom = new JSDOM('<main></main>', { url: 'https://test.invalid', runScripts: 'outside-only' }), w = dom.window, d = w.document;
  const services = [
    { id: 's1', name: 'ADA - Serum', base_price: 500, code: 'T-1', category: 'التحاليل' },
    { id: 's2', name: 'ADA - Fluid', base_price: 400, code: 'T-2', category: 'التحاليل' },
    { id: 's3', name: 'TSH', base_price: 20, code: 'T-3', category: 'التحاليل' },
    { id: 's4', name: 'CBC', base_price: 60, code: 'T-4', category: 'التحاليل' }];
  const L = (id, service_id, status, confidence, rank, extra) => Object.assign({ id, service_id, status, confidence, score: 0.9, rank, suggested_by: 'matcher-v2' }, extra || {});
  const state = { versions: [{ id: 'v1', lab_name: 'Lab X', version: 1 }], version: { id: 'v1', lab_name: 'Lab X', source_name: 'قائمة تجريبية', version: 1 }, reviewers: { a1: 'أحمد' }, services,
    items: [
      { id: 'i1', source_row: 1, test_name: 'ADA', sample: 'Serum', turnaround: '1 day', cost: 100, links: [L('l1', 's1', 'suggested', 'high', 1), L('l2', 's2', 'suggested', 'low', 2, { match_note: 'تعارض نوع العينة' })] },
      { id: 'i2', source_row: 2, test_name: 'TSH', sample: 'Serum', turnaround: '1 day', cost: 25, links: [L('l3', 's3', 'suggested', 'high', 1)] },
      { id: 'i3', source_row: 3, test_name: 'CBC', sample: 'EDTA', turnaround: '1 day', cost: 30, links: [L('l4', 's4', 'suggested', 'medium', 1)] },
      { id: 'i4', source_row: 4, test_name: 'Strange', sample: null, turnaround: null, cost: null, import_flag: 'price_missing', links: [] },
      { id: 'i5', source_row: 5, test_name: 'Done test', sample: 'Urine', turnaround: '2 days', cost: 10, links: [L('l5', 's4', 'confirmed', 'high', 1, { reviewed_by: 'a1', reviewed_at: '2026-11-08T10:00:00Z', review_note: 'تم' })] }] };
  const calls = [];
  w.SSMPDAuth = { currentAdmin: { id: 'me' } };
  w.SSMPDRoles = { ALL: {}, hasRole: () => false, canModuleAction: () => true };
  const toasts = []; w.SSMPDToast = { show: (m) => toasts.push(m) };
  w.SSMPDDb = { client: { rpc: async (fn, args) => {
    calls.push({ fn, args });
    if (fn === 'lab_links_workspace') return { data: JSON.parse(JSON.stringify(state)) };
    if (fn === 'lab_links_command') {
      const p = args.p_payload, it = state.items.find(i => i.id === p.item_id);
      if (args.p_action === 'confirm') it.links.find(l => l.service_id === p.service_id).status = 'confirmed';
      if (args.p_action === 'bulk_confirm') { p.item_ids.forEach(id => { const x = state.items.find(i => i.id === id); x.links[0].status = 'confirmed'; }); return { data: { confirmed: p.item_ids.length, skipped: [] } }; }
      if (args.p_action === 'choose') it.links.push(L('lx', p.service_id, 'confirmed', 'none', null));
      if (args.p_action === 'remove_row') { it.removed_at = '2026-11-09T10:00:00Z'; it.removed_by = 'a1'; it.removed_note = p.note; }
      if (args.p_action === 'restore_row') { it.removed_at = null; }
      if (args.p_action === 'no_match') it.links.push({ id: 'nm', service_id: null, status: 'no_match', confidence: 'none', reviewed_by: 'a1', review_note: p.note });
      return { data: { ok: true } };
    }
    return { error: { message: 'unexpected ' + fn } };
  } } };
  w.eval(fs.readFileSync('assets/js/workforce-prices.js', 'utf8'));
  w.SSMPDContractPrices = { render: (el) => { el.innerHTML = '<p data-lists>قوائم الأسعار الحالية</p>'; } };
  w.eval(fs.readFileSync('assets/js/lab-link-review.js', 'utf8'));
  const host = d.querySelector('main');
  w.SSMPDPriceLists.render(host);
  assert(host.querySelector('[data-lists]'), 'existing price lists remain the first tab');
  host.querySelector('[data-ll-tab=labs]').click(); await tick();

  // default view = needs review only, with counts on the chips
  assert.equal(host.querySelectorAll('.ll-row').length, 4, 'needs review: 4 of 5');
  assert(!host.textContent.includes('Done test'));
  const chips = [...host.querySelectorAll('.ll-chip')].map(c => c.textContent.replace(/\s+/g, ' ').trim());
  assert.deepEqual(chips, ['تحتاج مراجعة 4', 'مؤكدة 1', 'بلا مقابل 0', 'الكل 5']);
  assert.equal(calls.filter(c => c.fn === 'lab_links_workspace').length, 1);

  // side by side: lab cost vs center price, margin, loss warning, sample-conflict note
  const ada = host.querySelector('[data-item-row=i1]').textContent;
  assert(ada.includes('100.00') && ada.includes('ADA - Serum') && ada.includes('500.00') && ada.includes('400.00') && ada.includes('تعارض نوع العينة'));
  const tsh = host.querySelector('[data-item-row=i2]').textContent;           // price 20 < cost 25
  assert(tsh.includes('السعر أقل من تكلفة المعمل'));
  assert(!ada.includes('السعر أقل من تكلفة المعمل'));
  assert(host.querySelector('[data-item-row=i4]').textContent.includes('لا يوجد اقتراح تلقائي'));
  assert(host.querySelector('[data-item-row=i4]').textContent.includes('تكلفة المعمل غير مسجلة'));

  // filters
  host.querySelector('[data-ll-below]').click(); await tick();
  assert.deepEqual([...host.querySelectorAll('.ll-row')].map(r => r.dataset.itemRow), ['i2']);
  host.querySelector('[data-ll-below]').click(); await tick();
  const conf = host.querySelector('[data-ll-conf]'); conf.value = 'medium'; conf.dispatchEvent(new w.Event('change')); await tick();
  assert.deepEqual([...host.querySelectorAll('.ll-row')].map(r => r.dataset.itemRow), ['i3']);
  conf.value = ''; conf.dispatchEvent(new w.Event('change'));
  const smp = host.querySelector('[data-ll-sample]'); smp.value = 'EDTA'; smp.dispatchEvent(new w.Event('change'));
  assert.deepEqual([...host.querySelectorAll('.ll-row')].map(r => r.dataset.itemRow), ['i3']);
  smp.value = ''; smp.dispatchEvent(new w.Event('change'));
  const q = host.querySelector('[data-ll-q]'); q.value = 'fluid'; q.dispatchEvent(new w.Event('input')); await tick(260);
  assert.deepEqual([...host.querySelectorAll('.ll-row')].map(r => r.dataset.itemRow), ['i1'], 'search also looks at candidate service names');
  host.querySelector('[data-ll-q]').value = ''; host.querySelector('[data-ll-q]').dispatchEvent(new w.Event('input')); await tick(260);

  // confirming one candidate sends exactly that pair and moves the test out of "needs review"
  host.querySelector('[data-ll=confirm][data-item=i3]').click(); await tick();
  const cmd = calls.filter(c => c.fn === 'lab_links_command').pop();
  assert.equal(JSON.stringify([cmd.args.p_action, cmd.args.p_payload]), JSON.stringify(['confirm', { item_id: 'i3', service_id: 's4' }]));
  assert(!host.querySelector('[data-item-row=i3]'));

  // bulk: only the high-confidence rows of the page, behind an explicit acknowledgement; medium/low untouched
  const bulkBtn = host.querySelector('[data-ll=bulk]');
  assert(bulkBtn && bulkBtn.textContent.includes('(2)'), 'ADA and TSH are the high ones');
  bulkBtn.click();
  const ok = d.querySelector('.wp-modal [name=ok]'); assert(ok && ok.required, 'needs a tick before saving');
  ok.checked = true; d.querySelector('.wp-modal form').dispatchEvent(new w.Event('submit', { cancelable: true })); await tick(80);
  const bulk = calls.filter(c => c.fn === 'lab_links_command').pop();
  assert.equal(bulk.args.p_action, 'bulk_confirm'); assert.equal(JSON.stringify([...bulk.args.p_payload.item_ids].sort()), JSON.stringify(['i1', 'i2']));

  // no bulk button when the page has no high-confidence rows; choose-another and no-match need a reason
  assert(!host.querySelector('[data-ll=bulk]'));
  host.querySelector('[data-ll=choose][data-item=i4]').click();
  const sel = d.querySelector('.wp-modal [name=service_id]'); assert(sel.options.length === 4);
  const sq = d.querySelector('.wp-modal [name=q]'); sq.value = 'cbc'; sq.dispatchEvent(new w.Event('input')); assert.equal(sel.options.length, 1);
  assert(d.querySelector('.wp-modal [name=note]').required);
  d.querySelector('.wp-modal [data-close]').click();

  // remove row: only on unmatched rows, needs a reason, hides the row but the chip appears and the cost stays visible in the removed tab
  assert(!host.querySelector('[data-ll=state][data-value=removed]'), 'no removed chip while nothing is removed');
  assert(host.querySelector('[data-ll=remove_row][data-item=i4]'), 'button on a row that needs review');
  host.querySelector('[data-ll=remove_row][data-item=i4]').click();
  assert(d.querySelector('.wp-modal [name=note]').required, 'reason required');
  d.querySelector('.wp-modal [name=note]').value = 'غير موجود في المركز';
  d.querySelector('.wp-modal form').dispatchEvent(new w.Event('submit', { cancelable: true })); await tick(80);
  const rm = calls.filter(c => c.fn === 'lab_links_command').pop();
  assert.equal(JSON.stringify([rm.args.p_action, rm.args.p_payload]), JSON.stringify(['remove_row', { item_id: 'i4', note: 'غير موجود في المركز' }]));
  assert(!host.querySelector('[data-item-row=i4]'), 'removed row leaves the review list');
  host.querySelector('[data-ll=state][data-value=removed]').click();
  const rrow = host.querySelector('[data-item-row=i4]');
  assert(rrow && rrow.textContent.includes('غير موجود في المركز') && rrow.textContent.includes('أحمد') && rrow.textContent.includes('التكلفة محفوظة'));
  assert(!rrow.querySelector('[data-ll=choose]') && !rrow.querySelector('[data-ll=confirm]'), 'no other action on a removed row');
  host.querySelector('[data-ll=restore_row][data-item=i4]').click(); await tick(60);
  assert.equal(calls.filter(c => c.fn === 'lab_links_command').pop().args.p_action, 'restore_row');
  assert(!host.querySelector('[data-ll=state][data-value=removed]'), 'chip disappears after restore');

  // confirmed tab shows who confirmed it
  host.querySelector('[data-ll=state][data-value=confirmed]').click();
  assert(host.textContent.includes('أحمد'));
  assert(host.querySelector('[data-ll=reopen]'));

  // people without the price-list permission get the original screen only
  w.SSMPDRoles.canModuleAction = () => false;
  const host2 = d.createElement('div'); d.body.append(host2); w.SSMPDPriceLists.render(host2);
  assert(host2.querySelector('[data-lists]') && !host2.querySelector('[data-ll-tab]'));
  console.log('PASS lab link remove DOM (extends lab-link-dom): tabs, filters, side-by-side margin/loss, confirm, high-only bulk with acknowledgement, permission fallback');
})().catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
