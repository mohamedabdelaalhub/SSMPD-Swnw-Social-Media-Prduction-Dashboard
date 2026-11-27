// Reception home tiles (help 313): the three hero cards (shift expenses / drawer requests / month-end transfers) become three tiles under the hero.
// Real modules, reception cashier in LIVE mode, fake server. Covers: tile numbers, «اتصرف» navy at 0 and ORANGE above 0, each action button pressing the card's own button,
// each popup showing the real card with a ✕ that closes it (and Esc), nothing removed, and the tile refreshing after a spend.
const fs = require('fs'), assert = require('node:assert/strict'), { JSDOM } = require(require.resolve('jsdom', { paths: [process.env.SSMPD_TEST_MODULES || process.cwd()] }));
(async () => {
  const dom = new JSDOM('<!doctype html><body><div id="host"><header class="rx-header"><div><h2>الاستقبال والخدمات</h2></div><div class="rx-actions"><button class="btn">شرح الاستخدام</button><button class="btn">تحديث</button></div></header><section id="rest">باقي الصفحة</section></div></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, d = w.document, calls = [], tick = (ms = 40) => new Promise(r => setTimeout(r, ms));
  let spent = 0, items = [{ party: 'tahera', ref: 'R1', description: 'أشعة', amount: 100 }, { party: 'dental_lab', ref: 'L1', description: 'زيركون', amount: 900 }, { party: 'dental_lab', ref: 'L2', description: 'ملغي', amount: 50, voided: true }];
  const reqs = [{ id: 'q1', kind: 'advance', subject_name: 'منار', amount: 400, status: 'pending', mine: true }, { id: 'q2', kind: 'supplier', supplier: 'صيدلية', amount: 150, status: 'approved', mine: true }];
  w.SSMPDToast = { show: () => {} }; w.confirm = () => true; w.prompt = () => 'x';
  w.SSMPDDb = { client: { rpc: async (fn, a) => {
    calls.push([fn, a.p_action]);
    if (fn === 'clinic_finance_shift_expense' && a.p_action === 'status') return { data: { open: true, shift_id: 'sh1', allowance: 500, max: 200, cash: 900, spent, register: 'خزينة مازن', expenses: spent ? [{ at: '2026-11-27T10:00:00Z', item: 'مياه', amount: spent }] : [], items: [] } };
    if (fn === 'clinic_finance_drawer_request' && a.p_action === 'status') return { data: { shift_id: 'sh1', cash: 900, can_request: true, employees: [], suppliers: [], mine: reqs, inbox: [] } };
    if (fn === 'clinic_finance_month_end' && a.p_action === 'my_items') return { data: { tahera_percent: 30, items } };
    return { data: {} }; }, auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) } } };
  w.SSMPDFinanceControls = { panel: t => 'prior:' + t, act: () => false, due: 1 };
  for (const f of ['reception-shift-expenses', 'drawer-requests', 'month-end-accounts', 'reception-home-tiles']) w.eval(fs.readFileSync('assets/js/' + f + '.js', 'utf8'));
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const opened = [];
  const ctx = { host: d.getElementById('host'), data: { workspace: { mode: 'live' } }, field: (n, t) => '<label>' + t + '<input name="' + n + '"></label>', select: (n, t, rows) => '<label>' + t + '<select name="' + n + '"><option value="">اختر</option></select></label>',
    modal: (t, body, save) => { opened.push(t); const r = d.createElement('div'); r.className = 'rx-modal'; r.dataset.t = t; r.innerHTML = '<h3>' + esc(t) + '</h3><button type="button" data-x>×</button><form class="rx-form">' + body + '</form>'; d.body.appendChild(r); r.querySelector('[data-x]').onclick = () => r.remove(); return r; } };
  w.SSMPDShiftExpenses.decorate(ctx, 'operations'); await tick(120);
  const host = ctx.host, row = host.querySelector('[data-rht]'); assert(row, 'tiles row exists'); assert.equal(row.previousElementSibling.className, 'rx-header', 'row sits right UNDER the hero');
  assert(!host.querySelector('.rx-header [data-rse],.rx-header [data-rdr],.rx-header [data-mea-card]'), 'the cards left the hero'); assert([...host.querySelectorAll('[data-rse],[data-rdr],[data-mea-card]')].every(c => c.hidden), 'and are hidden, not removed');
  assert.equal(host.querySelectorAll('[data-rse],[data-rdr],[data-mea-card]').length, 3, 'all three original cards are still in the page (rule 11)');
  const tiles = [...row.querySelectorAll('[data-rht-tile]')]; assert.deepEqual(tiles.map(t => t.dataset.rhtTile), ['rse', 'rdr', 'mea'], 'three tiles in order');
  assert.equal(host.querySelector('.rx-header').textContent.replace(/\s+/g, ' ').trim(), 'الاستقبال والخدماتشرح الاستخدامتحديث', 'hero is clean: title + the two buttons');
  const t1 = () => row.querySelector('[data-rht-tile=rse]'), big = t => t.querySelector('.rht-num');
  assert(t1().textContent.includes('مصروفات الوردية') && t1().textContent.includes('خزينة مازن') && t1().textContent.includes('هامش 500') && t1().textContent.includes('باقي 500'), t1().textContent);
  assert.equal(big(t1()).querySelector('bdi').textContent, '0'); assert(!big(t1()).classList.contains('rht-hot'), '«اتصرف» is navy while nothing is spent');
  const t2 = row.querySelector('[data-rht-tile=rdr]'), t3 = row.querySelector('[data-rht-tile=mea]');
  assert.equal(big(t2).querySelector('bdi').textContent, '1', 'one pending request'); assert(t2.textContent.includes('منتظر اعتماد') && t2.textContent.includes('جاهز للصرف 1'));
  assert.equal(big(t3).querySelector('bdi').textContent, '2', 'voided items not counted'); assert(t3.textContent.includes('الطاهرة 1') && t3.textContent.includes('معمل الأسنان 1'));
  assert(!/[٠-٩]/.test(row.textContent), 'English digits');
  assert.deepEqual([...row.querySelectorAll('.rht-go')].map(b => b.textContent), ['سجّل مصروف', 'اطلب صرف', 'سجّل تحويل'], 'short action labels');
  // ---- action buttons press the real card buttons
  t1().querySelector('.rht-go').click(); await tick(); assert(opened.includes('صرف من مصروفات الوردية'), 'سجّل مصروف opens the spend form: ' + opened);
  t2.querySelector('.rht-go').click(); await tick(); assert(opened.includes('طلب صرف من الدرج'), 'اطلب صرف opens the request form: ' + opened);
  d.querySelectorAll('.rx-modal').forEach(m => m.remove());
  // ---- popups: real card inside, ✕ closes, card goes back hidden
  for (const [key, sel, title] of [['rse', '[data-rse-spend]', 'مصروفات الوردية'], ['rdr', '[data-rdr-new]', 'طلب صرف من الدرج'], ['mea', '[data-mea-tahera]', 'تحويلات ومعمل الأسنان']]) {
    row.querySelector('[data-rht-tile=' + key + ']').click(); await tick(10);
    const pop = d.querySelector('[data-rht-pop=' + key + ']'); assert(pop, key + ' popup opens'); assert(pop.querySelector('[data-rht-x]'), 'rule 10: ✕ in ' + key + ' popup'); assert(pop.querySelector('.modal-head h3').textContent === title);
    const card = pop.querySelector(sel); assert(card && !card.closest('[hidden]'), key + ': the real card + its action button are inside the popup and visible'); assert(pop.querySelectorAll('.rht-sum > div').length === 3, '3 summary chips');
    pop.querySelector('[data-rht-x]').click(); assert(!d.querySelector('[data-rht-pop]'), key + ' ✕ closes'); assert.equal(host.querySelectorAll('[data-rht-src=' + key + ']').length, 1, 'card back in the page'); assert(host.querySelector('[data-rht-src=' + key + ']').hidden, 'and hidden again');
  }
  row.querySelector('[data-rht-tile=mea]').click(); await tick(10); d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); assert(!d.querySelector('[data-rht-pop]'), 'Esc closes too');
  // «سجّل تحويل» opens the popup that holds both transfer buttons
  t3.querySelector('.rht-go').click(); await tick(10); const mp = d.querySelector('[data-rht-pop=mea]'); assert(mp.querySelector('[data-mea-tahera]') && mp.querySelector('[data-mea-dental]'), 'both transfer actions reachable'); mp.querySelector('[data-rht-x]').click();
  // ---- after a spend the tile turns ORANGE (the card re-renders itself)
  spent = 60; const card = host.querySelector('[data-rse]'); card.remove(); w.SSMPDShiftExpenses.decorate(ctx, 'operations'); await tick(150);
  assert.equal(host.querySelectorAll('[data-rse]').length, 1, 'one expenses card after the refresh'); assert.equal(big(t1()).querySelector('bdi').textContent, '60'); assert(big(t1()).classList.contains('rht-hot'), '«اتصرف» turns orange once > 0');
  t1().querySelector('.rht-num') ; row.querySelector('[data-rht-tile=rse]').click(); await tick(10); assert(d.querySelector('[data-rht-pop=rse] .rht-sum .hot'), 'the «اتصرف» chip in the popup is orange too'); d.querySelector('[data-rht-x]').click();
  assert.equal(host.querySelectorAll('[data-rht-tile]').length, 3, 'still three tiles (no duplicates)');
  // no mutation loop while idle
  let n = 0; new w.MutationObserver(l => { n += l.length; }).observe(host, { childList: true, subtree: true }); await tick(250); assert.equal(n, 0, 'idle page stays quiet');
  // ---- «على حساب الموظف» card (employee-debt.js) arrives inside the blue hero: it must be moved under the tiles, with its button and note intact
  const hero = host.querySelector('.rx-header'), emd = d.createElement('section'); emd.className = 'rse-card emd-card'; emd.setAttribute('data-emd', ''); emd.innerHTML = '<h4>على حساب الموظف <small>— يتخصم من المرتب</small></h4><button type="button" class="btn" data-emd-convert>تحويل تحصيل لمديونية على الموظف</button><p class="rse-note">للإيصال النقدي اللي اتسجل بالغلط</p>';
  hero.appendChild(emd); await tick(120);
  assert(!hero.querySelector('[data-emd]'), 'employee-debt card left the hero'); assert(host.querySelector('[data-emd] [data-emd-convert]') && host.querySelector('[data-emd] .rse-note'), 'its button and note are still there (rule 11)');
  assert(host.querySelector('[data-rht]').compareDocumentPosition(host.querySelector('[data-emd]')) & 4, 'it sits after (under) the tiles row'); assert(!host.querySelector('[data-rht-stash] [data-emd]'), 'and it is visible, not in the hidden stash');
  console.log('reception-home-tiles-dom OK');
})().catch(e => { console.error(e); process.exit(1); });
