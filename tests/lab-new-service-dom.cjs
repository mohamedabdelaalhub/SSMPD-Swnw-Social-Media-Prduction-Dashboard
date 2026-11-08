// DOM test: "add a new center service" from a partner-lab test with no counterpart (synthetic data, fake RPC server).
const { JSDOM } = require('jsdom'), fs = require('fs'), assert = require('node:assert/strict');
const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));
function boot(withFeature) {
  const dom = new JSDOM('<main></main>', { url: 'https://test.invalid', runScripts: 'outside-only' }), w = dom.window, d = w.document;
  const L = (id, service_id, status, extra) => Object.assign({ id, service_id, status, confidence: 'none', score: null, rank: null, suggested_by: 'manual' }, extra || {});
  const state = { versions: [{ id: 'v1', lab_name: 'Lab X', version: 1 }], version: { id: 'v1', lab_name: 'Lab X', source_name: 'قائمة', version: 1 }, reviewers: { a1: 'أحمد' },
    services: [{ id: 's1', name: 'TSH', base_price: 20, code: 'T-1', category: 'التحاليل' }],
    items: [
      { id: 'i1', source_row: 1, test_name: 'HbA1c Special', sample: 'EDTA', turnaround: '1 day', cost: 80, links: [] },
      { id: 'i2', source_row: 2, test_name: 'Blood Film', sample: 'EDTA', turnaround: '1 day', cost: null, links: [] },
      { id: 'i3', source_row: 3, test_name: 'Other lab test', sample: 'Serum', turnaround: '1 day', cost: 15, links: [L('nm', null, 'no_match', { reviewed_by: 'a1', reviewed_at: '2026-11-08T10:00:00Z', review_note: 'مفيش مقابل' })] },
      { id: 'i4', source_row: 4, test_name: 'Waiting one', sample: 'Urine', turnaround: '1 day', cost: 40, links: [] }] };
  const sreq = { me: 'me', requests: [{ id: 'r4', item_id: 'i4', name: 'Waiting service', category: 'التحاليل', sample: 'Urine', selling_price: 100, cost_price: 40, booking_enabled: true, note: 'طلب الأطباء', status: 'pending', service_id: null, created_by: 'other', created_by_name: 'منى', created_at: '2026-11-09T09:00:00Z' }] };
  const calls = [];
  w.SSMPDAuth = { currentAdmin: { id: 'me' } };
  w.SSMPDRoles = { ALL: {}, hasRole: () => false, canModuleAction: () => true };
  const toasts = []; w.SSMPDToast = { show: (m, k) => toasts.push([m, k]) };
  w.SSMPDDb = { client: { rpc: async (fn, args) => {
    calls.push({ fn, args });
    if (fn === 'lab_links_workspace') return { data: JSON.parse(JSON.stringify(state)) };
    if (fn === 'lab_links_service_requests') return withFeature ? { data: JSON.parse(JSON.stringify(sreq)) } : { error: { message: 'function lab_links_service_requests() does not exist' } };
    if (fn === 'lab_links_service_command') {
      const p = args.p_payload;
      if (args.p_action === 'propose') {
        const it = state.items.find(i => i.id === p.item_id);
        if (it.cost == null && p.cost != null) it.cost = p.cost;
        sreq.requests.unshift({ id: 'rn', item_id: p.item_id, name: p.name, category: p.category, sample: p.sample, selling_price: p.selling_price, cost_price: it.cost, booking_enabled: p.booking_enabled, note: p.note, status: 'pending', created_by: 'me', created_by_name: 'أنا' });
      }
      if (args.p_action === 'review') {
        const r = sreq.requests.find(x => x.id === p.request_id), it = state.items.find(i => i.id === r.item_id);
        if (p.decision === 'approved') { r.status = 'approved'; state.services.push({ id: 'snew', name: r.name, base_price: r.selling_price, code: 'SVC-9', category: r.category }); it.links = [L('ln', 'snew', 'confirmed', { reviewed_by: 'a1', reviewed_at: '2026-11-09T10:00:00Z', review_note: p.note })]; }
        else r.status = 'rejected', r.review_note = p.note;
      }
      return { data: { ok: true } };
    }
    if (fn === 'lab_links_command') return { data: { ok: true } };
    return { error: { message: 'unexpected ' + fn } };
  } } };
  w.eval(fs.readFileSync('assets/js/workforce-prices.js', 'utf8'));
  w.SSMPDContractPrices = { render: (el) => { el.innerHTML = '<p data-lists>x</p>'; } };
  w.eval(fs.readFileSync('assets/js/lab-link-review.js', 'utf8'));
  return { w, d, calls, toasts, state, sreq };
}
const submit = (w, d) => d.querySelector('.wp-modal form').dispatchEvent(new w.Event('submit', { cancelable: true }));
(async () => {
  // 1) SQL not installed yet: the screen is exactly the old one (no button, no chip)
  {
    const { w, d } = boot(false), host = d.querySelector('main');
    w.SSMPDPriceLists.render(host); host.querySelector('[data-ll-tab=labs]').click(); await tick();
    assert(host.querySelectorAll('.ll-row').length >= 3);
    assert(!host.querySelector('[data-ll=newsvc]') && !host.textContent.includes('إضافة خدمة جديدة'), 'feature hidden when the RPC is missing');
    assert(!host.textContent.includes('طلبات خدمات جديدة'));
    assert(host.querySelector('[data-ll=cost]'), 'a missing lab cost can still be set manually');
  }
  // 2) feature present
  const { w, d, calls, toasts, state } = boot(true), host = d.querySelector('main');
  w.SSMPDPriceLists.render(host); host.querySelector('[data-ll-tab=labs]').click(); await tick();
  const chips = [...host.querySelectorAll('.ll-chip')].map(c => c.textContent.replace(/\s+/g, ' ').trim());
  assert.deepEqual(chips, ['تحتاج مراجعة 3', 'مؤكدة 0', 'بلا مقابل 1', 'الكل 4', 'طلبات خدمات جديدة 1']);
  assert(host.querySelector('[data-item-row=i1] [data-ll=newsvc]'), 'button on a test with no suggestion');
  assert(host.querySelector('[data-item-row=i2] [data-ll=cost]'), 'cost entry still offered when the lab cost is missing');
  assert(!host.querySelector('[data-item-row=i4] [data-ll=newsvc]'), 'no second request while one is pending');

  // a request from another person: approve / reject offered
  const wait = host.querySelector('[data-item-row=i4]');
  assert(wait.textContent.includes('طلب خدمة جديدة بانتظار الاعتماد') && wait.textContent.includes('Waiting service') && wait.textContent.includes('منى'));
  assert(wait.textContent.includes('60.00'), 'margin = 100 - 40');
  assert(wait.querySelector('[data-ll=svc-approve]') && wait.querySelector('[data-ll=svc-reject]'));

  // open the form: prefilled with the lab test name and sample, cost shown, price + reason required
  host.querySelector('[data-item-row=i1] [data-ll=newsvc]').click();
  const f = d.querySelector('.wp-modal form');
  assert.equal(f.elements.name.value, 'HbA1c Special'); assert.equal(f.elements.sample.value, 'EDTA');
  assert(d.querySelector('.wp-modal').textContent.includes('80.00'), 'lab cost shown as the cost price');
  assert(!f.elements.cost, 'cost input only when the lab cost is missing');
  assert(f.elements.selling_price.required && f.elements.note.required && f.elements.booking_enabled.checked);
  assert.deepEqual([...f.elements.category.options].map(o => o.value), ['التحاليل', 'باقي التحاليل']);
  f.elements.selling_price.value = '60'; f.elements.selling_price.dispatchEvent(new w.Event('input'));
  assert(d.querySelector('.wp-modal [data-margin]').textContent.includes('السعر أقل من تكلفة المعمل'), 'loss warning');
  f.elements.selling_price.value = '150'; f.elements.selling_price.dispatchEvent(new w.Event('input'));
  assert(d.querySelector('.wp-modal [data-margin]').textContent.includes('70.00'));
  f.elements.note.value = 'طلب من الأطباء'; submit(w, d); await tick(80);
  const p = calls.filter(c => c.fn === 'lab_links_service_command').pop();
  assert.equal(p.args.p_action, 'propose');
  assert.equal(JSON.stringify(p.args.p_payload), JSON.stringify({ item_id: 'i1', name: 'HbA1c Special', category: 'التحاليل', sample: 'EDTA', selling_price: 150, booking_enabled: true, note: 'طلب من الأطباء' }));
  assert(toasts.some(t => t[0].includes('للاعتماد')));
  const mine = host.querySelector('[data-item-row=i1]');
  assert(mine.textContent.includes('يلزم مراجع آخر') && !mine.querySelector('[data-ll=svc-approve]'), 'the creator cannot approve');
  assert(host.textContent.includes('طلبات خدمات جديدة 2'));

  // missing lab cost: the form lets staff set it now
  host.querySelector('[data-item-row=i2] [data-ll=newsvc]').click();
  const f2 = d.querySelector('.wp-modal form');
  assert(f2.elements.cost && !f2.elements.cost.required, 'cost entry present for a test without cost');
  f2.elements.cost.value = '22.5'; f2.elements.selling_price.value = '90'; f2.elements.booking_enabled.checked = false; f2.elements.note.value = 'خدمة جديدة'; submit(w, d); await tick(80);
  const p2 = calls.filter(c => c.fn === 'lab_links_service_command').pop().args.p_payload;
  assert.equal(p2.cost, 22.5); assert.equal(p2.booking_enabled, false); assert.equal(p2.selling_price, 90);
  assert.equal(state.items.find(i => i.id === 'i2').cost, 22.5);

  // a test already marked "no counterpart" can get a new service too
  host.querySelector('[data-ll=state][data-value=no_match]').click();
  assert(host.querySelector('[data-item-row=i3] [data-ll=newsvc]'));

  // second person approves: note required, payload exact, test moves to confirmed with the new service and margin
  host.querySelector('[data-ll=state][data-value=new_service]').click();
  assert.deepEqual([...host.querySelectorAll('.ll-row')].map(r => r.dataset.itemRow).sort(), ['i1', 'i2', 'i4']);
  host.querySelector('[data-item-row=i4] [data-ll=svc-approve]').click();
  assert(d.querySelector('.wp-modal [name=note]').required);
  d.querySelector('.wp-modal [name=note]').value = 'موافق على الإضافة'; submit(w, d); await tick(80);
  const a = calls.filter(c => c.fn === 'lab_links_service_command').pop();
  assert.equal(JSON.stringify([a.args.p_action, a.args.p_payload]), JSON.stringify(['review', { request_id: 'r4', decision: 'approved', note: 'موافق على الإضافة' }]));
  host.querySelector('[data-ll=state][data-value=confirmed]').click();
  const done = host.querySelector('[data-item-row=i4]');
  assert(done && done.textContent.includes('Waiting service') && done.textContent.includes('100.00') && done.textContent.includes('60.00'), 'confirmed with price and margin');

  // the creator still sees only the waiting note on the 'all' tab
  host.querySelector('[data-ll=state][data-value=all]').click();
  assert(host.querySelector('[data-item-row=i1]').textContent.includes('يلزم مراجع آخر'));
  console.log('PASS lab new-service DOM: hidden without SQL, button on no-suggestion/no-match rows, prefilled form, margin hint, missing cost entry, creator cannot approve, approve links and shows margin');
})().catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
