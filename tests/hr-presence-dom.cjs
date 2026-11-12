// DOM test (live presence): the real HR page gets an «الحضور الآن» section for HR managers only; it loads lazily, shows who is in / left / not mapped,
// flags a stale device feed and a very long open shift, refreshes by itself every 15s while open, maps/unmaps a device number with the exact payload,
// escapes names, keeps the last good picture when a refresh fails, stops polling when closed, and degrades clearly when the migration is not applied.
const fs = require('fs'), assert = require('node:assert/strict'), { JSDOM } = require('jsdom');
const tick = () => new Promise(r => setTimeout(r, 25));
(async () => {
  const dom = new JSDOM('<main></main>', { url: 'https://test.invalid', runScripts: 'outside-only', pretendToBeVisual: true }), w = dom.window, d = w.document;
  const people = [{ id: 'p1', admin_id: 'hr', full_name: 'موظف أول', code: 'EMP-1', kind: 'employee', department: 'الاستقبال', branch: 'الفرع', status: 'active', revision: 2, leave_balance: 5 }];
  const hrData = { can_manage: true, people, requests: [], attendance: [], documents: [], accounts: [], doctor_keys: [], employee_keys: [] };
  const NOW = '2026-11-12T10:00:00+00:00';
  const iso = min => new Date(new Date(NOW).getTime() - min * 60000).toISOString();
  const row = (o) => Object.assign({ device_id: 'k14', device_user_id: 1, person_id: null, mapped: false, full_name: null, code: null, department: null, job_title: null, state: 'in', last_punch: 0, last_punch_at: iso(10), last_in_at: iso(10), last_out_at: null, punches: 1, minutes_since: 10 }, o);
  const fresh = () => ({ can_manage: true, now: NOW, lookback_hours: 16, last_received_at: iso(1), last_punch_at: iso(10),
    ignored: [{ device_id: 'k14', device_user_id: 55, last_punch_at: iso(120) }],
    people: [{ id: 'p1', code: 'EMP-1', full_name: 'موظف أول', department: 'الاستقبال' }, { id: 'p2', code: 'EMP-2', full_name: 'موظف ثان', department: '' }],
    rows: [
      row({ device_user_id: 3, person_id: 'p1', mapped: true, full_name: 'موظف أول', code: 'EMP-1', department: 'الاستقبال', last_in_at: iso(185), last_punch_at: iso(185), minutes_since: 185 }),
      row({ device_user_id: 9, person_id: 'p2', mapped: true, full_name: 'ثان <img src=x onerror=window.__xss=1>', code: 'EMP-2', department: 'استقبال ', state: 'break', last_punch: 2, last_punch_at: iso(5), minutes_since: 5, last_in_at: iso(300) }),
      row({ device_user_id: 6, person_id: 'p3', mapped: true, full_name: 'منصرف', code: 'EMP-3', state: 'out', last_punch: 1, last_punch_at: iso(40), last_out_at: iso(40), last_in_at: iso(500), minutes_since: 40 }),
      row({ device_user_id: 24, state: 'in', last_in_at: iso(15 * 60), last_punch_at: iso(15 * 60), minutes_since: 15 * 60 }),
      row({ device_user_id: 40, person_id: 'p4', mapped: true, full_name: 'لم يبصم', code: 'EMP-4', state: 'none', last_punch: null, last_punch_at: null, last_in_at: null, minutes_since: null, punches: 0 })] });
  let snap = fresh(), calls = [], snapCalls = 0, mode = 'ok';
  w.confirm = () => true; w.SSMPDAuth = { currentAdmin: { id: 'hr', role: 'reception', has_hr_access: true } }; w.SSMPDToast = { show: () => {} };
  w.eval(fs.readFileSync('assets/js/roles.js', 'utf8'));
  w.SSMPDDb = { client: { rpc: async (fn, args) => {
    if (fn === 'hr_workspace') return { data: hrData };
    if (fn === 'hr_presence_snapshot') { snapCalls++; if (mode === 'missing') return { error: { message: 'Could not find the function public.hr_presence_snapshot in the schema cache' } }; if (mode === 'down') return { error: { message: 'network down' } }; return { data: snap }; }
    if (fn === 'hr_presence_map') { calls.push(args); return { data: null }; }
    if (fn === 'hr_presence_ignore') { calls.push(args); return { data: null }; }
    return { data: { rules: [], adjustments: [], devices: [], imports: [], services: [] } }; } } };
  // run the 15s refresh quickly without waiting
  let intervals = [];
  w.setInterval = (fn) => { intervals.push(fn); return intervals.length; }; w.clearInterval = (id) => { intervals[id - 1] = null; };
  for (const f of ['workforce-prices', 'hr-payroll-workspace', 'hr-presence', 'hr-navigation']) w.eval(fs.readFileSync('assets/js/' + f + '.js', 'utf8'));
  const host = d.querySelector('main');
  w.SSMPDHumanResources.render(host); await tick();

  // ---- section exists for managers and is lazy
  const tab = d.querySelector('[data-hr-open=presence]'); assert(tab, 'presence tab for HR managers'); assert.equal(tab.textContent, 'الحضور الآن');
  assert.equal(snapCalls, 0, 'nothing loads until the section is opened');
  tab.click(); await tick();
  const root = () => d.querySelector('[data-hr-presence]'); assert(root(), 'presence mounted'); assert.equal(snapCalls, 1);
  const cards = [...root().querySelectorAll('[data-presence-cards] .wp-card')].map(x => x.textContent);
  assert(cards[0].includes('موجودون الآن') && cards[0].includes('3'), 'in-center count includes break + in'); assert(cards[1].includes('1'), 'one left'); assert(cards[2].includes('1'), 'one unmapped');
  const txt = root().textContent;
  for (const s of ['موظف أول', 'EMP-1', 'الاستقبال', 'حاضر', 'في استراحة', 'منصرف', 'رقم الجهاز 24', 'غير مربوط بموظف', 'لم يبصم']) assert(txt.includes(s), 'shows ' + s);
  assert(txt.includes('3 س 5 د') || txt.includes('3 س'), 'duration since check-in'); assert(txt.includes('08:55'), 'check-in time is shown in Cairo time (06:55 UTC = 08:55)');
  assert(root().querySelector('[data-presence-warn]'), 'very long open shift is flagged'); assert(root().querySelector('[data-presence-warn]').textContent.includes('تحقق من بصمة الخروج'));
  assert.equal(w.__xss, undefined); assert(!root().querySelector('img'), 'names are escaped'); assert(root().textContent.includes('<img src=x'), 'escaped markup shown as text');
  assert(!root().querySelector('[data-stale]'), 'fresh feed is not flagged'); assert(root().querySelector('[data-presence-feed]').textContent.includes('منذ'));

  // ---- «موجودون الآن» is split into one card per department (typing variants grouped), unmapped numbers in their own card
  const depts = [...root().querySelectorAll('[data-presence-dept]')]; assert.equal(depts.length, 2, 'reception (two spellings grouped) + unmapped numbers');
  const rec = depts.find(c => c.dataset.dept === 'الاستقبال'); assert(rec, 'one clean department name'); assert.equal(rec.querySelectorAll('[data-presence-person]').length, 2, 'both spellings land in the same card');
  assert(rec.textContent.includes('موظف أول') && rec.textContent.includes('في استراحة') && rec.textContent.includes('(2)'), 'names, break state and count in the card');
  const unm = depts.find(c => c.dataset.dept === 'أرقام غير مربوطة بموظف'); assert(unm && unm.textContent.includes('رقم الجهاز 24') && unm.querySelector('[data-presence=map]'), 'unmapped numbers get their own card with the map button');
  assert.equal(depts[depts.length - 1], unm, 'the unmapped card is last');

  // ---- map an unmapped device number
  const mapBtn = [...root().querySelectorAll('[data-presence=map]')].find(b => b.dataset.id.startsWith('24|')); assert(mapBtn, 'map button on the unmapped number');
  mapBtn.click(); let f = d.querySelector('.wp-modal form'); assert(f, 'modal opened');
  assert.deepEqual([...f.elements.person.options].map(o => o.value), ['', 'p1', 'p2'], 'people offered plus remove');
  f.elements.person.value = 'p2'; f.dispatchEvent(new w.Event('submit', { cancelable: true })); await tick(); await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), { p_device_id: 'k14', p_device_user_id: 24, p_person_id: 'p2' }); assert(!d.querySelector('.wp-modal'), 'modal closed'); assert.equal(snapCalls, 2, 'reloaded after mapping');

  // ---- remove a mapping
  const chg = [...root().querySelectorAll('[data-presence=map]')].find(b => b.dataset.id.startsWith('3|')); chg.click(); f = d.querySelector('.wp-modal form');
  assert.equal(f.elements.person.value, 'p1', 'current person preselected'); f.elements.person.value = '';
  f.dispatchEvent(new w.Event('submit', { cancelable: true })); await tick(); await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1])), { p_device_id: 'k14', p_device_user_id: 3, p_person_id: null });

  // ---- ignore a non-administrative number, and bring an ignored one back
  assert(root().textContent.includes('أرقام متجاهلة') && root().textContent.includes('رقم الجهاز 55'), 'ignored section lists the ignored numbers');
  const ig = [...root().querySelectorAll('[data-presence=ignore]')].find(b => b.dataset.id.startsWith('24|')); assert(ig, 'unmapped rows can be ignored');
  assert(![...root().querySelectorAll('[data-presence=ignore]')].some(b => b.dataset.id.startsWith('6|')), 'mapped rows have no ignore button');
  const nBefore = calls.length, sBefore = snapCalls; ig.click(); await tick(); await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(calls[nBefore])), { p_device_id: 'k14', p_device_user_id: 24, p_ignore: true }); assert.equal(snapCalls, sBefore + 1, 'reloaded after ignoring');
  const un = root().querySelector('[data-presence=unignore]'); assert(un && un.dataset.id.startsWith('55|'));
  un.click(); await tick(); await tick(); assert.deepEqual(JSON.parse(JSON.stringify(calls[nBefore + 1])), { p_device_id: 'k14', p_device_user_id: 55, p_ignore: false });
  w.confirm = () => false; const nn = calls.length; [...root().querySelectorAll('[data-presence=ignore]')][0].click(); await tick(); assert.equal(calls.length, nn, 'declining the confirmation sends nothing'); w.confirm = () => true;

  // ---- auto refresh picks up a new punch and a stale feed; a failed refresh keeps the last good picture
  snap = fresh(); snap.last_received_at = iso(9); snap.rows[0].state = 'out'; snap.rows[0].last_punch = 1; snap.rows[0].last_punch_at = iso(1); snap.rows[0].last_out_at = iso(1); snap.rows[0].minutes_since = 1;
  const refresh = intervals.filter(Boolean).pop(); assert(refresh, 'auto refresh is scheduled'); await refresh(); await tick();
  assert(root().querySelector('[data-stale]'), 'stale feed flagged after 5 minutes'); assert(root().textContent.includes('الربط متوقف'));
  assert(root().querySelector('[data-presence-cards]').textContent.includes('2') , 'cards updated by the refresh');
  mode = 'down'; const before = root().innerHTML; await refresh(); await tick(); assert.equal(root().innerHTML, before, 'failed refresh keeps the last picture'); mode = 'ok';

  // ---- heartbeat: no punches for an hour is NOT a dead link when the agent still pings
  snap = fresh(); snap.last_received_at = iso(60); snap.last_seen_at = iso(1); snap.rows = snap.rows.slice(0, 2);
  await refresh(); await tick();
  assert(!root().querySelector('[data-stale]'), 'a live heartbeat clears the stale warning even with an old last punch');
  assert(root().querySelector('[data-presence-feed]').textContent.includes('آخر اتصال من لاب المركز'), 'feed card is about the link');
  assert(root().querySelector('[data-presence-lastpunch]').textContent.includes('آخر بصمة وصلت'), 'last punch is shown separately');
  snap.last_seen_at = iso(9); await refresh(); await tick();
  assert(root().querySelector('[data-stale]') && root().textContent.includes('الربط متوقف'), 'a silent heartbeat (9 min) is flagged');

  // ---- manual refresh button
  const n0 = snapCalls; root().querySelector('[data-presence=refresh]').click(); await tick(); assert.equal(snapCalls, n0 + 1);

  // ---- leaving the section stops the polling
  host.innerHTML = ''; const live = intervals.filter(Boolean).pop(); const n1 = snapCalls; await live(); await tick(); assert.equal(snapCalls, n1, 'no requests after the section is gone');

  // ---- migration not applied yet
  mode = 'missing'; snap = fresh(); intervals = []; w.SSMPDHumanResources.render(host); await tick(); d.querySelector('[data-hr-open=presence]').click(); await tick();
  assert(root().textContent.includes('غير مفعّل بعد'), 'clear message when the migration is missing'); assert(root().querySelector('[data-presence=retry]'));

  // ---- not for non-managers
  mode = 'ok'; hrData.can_manage = false; w.SSMPDHumanResources.render(host); await tick();
  assert(!d.querySelector('[data-hr-open=presence]'), 'no presence tab for non-managers');
  console.log('PASS hr presence DOM: lazy section, in/left/unmapped lists, long-shift + stale-feed warnings, map/unmap payloads, auto refresh, failure keeps picture, stops when closed, missing-migration message, managers only');
})().catch(e => { console.error(e); process.exit(1); });
