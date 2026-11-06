const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../assets/js/personal-home.js'), 'utf8');

async function flush() { for (let i = 0; i < 24; i++) await Promise.resolve(); }
function fixture(code = source) {
  let now = 0, sequence = 0, account = null;
  const timers = new Map(), listeners = new Map(), calls = [], deferred = [];
  const mark = {}, refreshNow = {};
  const panel = {hidden: true, dataset: {}, classList: {add() {}}, contains() {return false;}, querySelectorAll() {return [];}, querySelector(key) {return key === '[data-home-mark-all]' ? mark : key === '[data-home-refresh-now]' ? refreshNow : null;}};
  const bell = {hidden: true, contains() {return false;}, setAttribute() {}};
  const badge = {};
  const document = {hidden: false, documentElement: {lang: 'ar'},
    getElementById(id) {return {'notif-bell-btn': bell, 'notif-panel': panel, 'notif-badge': badge}[id] || null;},
    addEventListener(kind, fn) {if (!listeners.has(kind)) listeners.set(kind, new Set()); listeners.get(kind).add(fn);},
    removeEventListener(kind, fn) {listeners.get(kind)?.delete(fn);}};
  const handlers = {};
  const channel = {on(kind, cfg, fn) {handlers[cfg.table] = fn; return this;}, subscribe() {return this;}};
  const state = {delay: false, fail: false, data: {notices: [], unread: 0}};
  const window = {SSMPDDb: {unsubscribe() {}, client: {channel() {return channel;}, rpc(name) {
    calls.push({name, now, account});
    if (name === 'personal_home_read') {state.data = {notices: state.data.notices.map(n => ({...n, read: true})), unread: 0}; return Promise.resolve({data: null});}
    if (state.delay) return new Promise(resolve => deferred.push(resolve));
    if (state.fail) {state.fail = false; return Promise.resolve({error: {code: 'PGRST202'}});}
    return Promise.resolve({data: state.data});
  }}}};
  class ClockDate extends Date {constructor(...args) {super(...(args.length ? args : [now]));} static now() {return now;}}
  vm.runInNewContext(code, {window, document, Date: ClockDate, console,
    localStorage: {getItem() {return null;}, setItem() {}},
    setTimeout(fn, delay) {const id = ++sequence; timers.set(id, {fn, at: now + delay}); return id;},
    clearTimeout(id) {timers.delete(id);}});
  const api = window.SSMPDPersonalHome;
  return {api, panel, refreshNow, handlers, calls, state, deferred, document, bell, badge, mark, timers, listeners,
    async mount(id = 'account-a') {account = id; api.mountNotifications({id}, {}); await flush();},
    visibility(hidden, dispatch = true) {document.hidden = hidden; if (dispatch) for (const fn of listeners.get('visibilitychange') || []) fn();},
    async tick(ms) {const end = now + ms; for (;;) {
      const next = [...timers].filter(([, item]) => item.at <= end).sort((a,b) => a[1].at - b[1].at)[0];
      if (!next) break; now = next[1].at; timers.delete(next[0]); next[1].fn(); await flush();
    } now = end; await flush();}};
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
test('background events coalesce and share one trailing promise', async () => {
  const f = fixture(); await f.mount(); const pending = f.api.refreshNotifications();
  for (let i=0; i<20; i++) assert.equal(f.api.refreshNotifications(), pending);
  await f.tick(3599999); assert.equal(f.calls.length, 1);
  await f.tick(1); await pending; assert.equal(f.calls.length, 2); assert.equal(f.timers.size, 0);
});
test('hidden refreshes make no RPC and visibility catches up once', async () => {
  const f = fixture(); await f.mount(); f.visibility(true);
  for (let i=0; i<10; i++) await f.api.refreshNotifications();
  await f.tick(600000); assert.equal(f.calls.length, 1);
  f.visibility(false); await flush(); assert.equal(f.calls.length, 2);
});
test('hiding cancels and settles queued work', async () => {
  const f = fixture(); await f.mount(); let settled = false;
  f.api.refreshNotifications().then(() => {settled = true;}); f.visibility(true);
  await f.tick(60000); assert(settled); assert.equal(f.calls.length, 1); assert.equal(f.timers.size, 0);
});
test('trailing callback rechecks visibility even without its event', async () => {
  const f = fixture(); await f.mount(); const pending = f.api.refreshNotifications();
  f.visibility(true, false); await f.tick(3600000); await pending; assert.equal(f.calls.length, 1);
});
test('stop cancels timers, removes visibility listener and settles callers', async () => {
  const f = fixture(); await f.mount(); const pending = f.api.refreshNotifications(); f.api.stop();
  await f.tick(60000); await pending; await f.api.refreshNotifications();
  assert.equal(f.calls.length, 1); assert.equal(f.listeners.get('visibilitychange').size, 0);
});
test('account remount cannot run the old queued callback', async () => {
  const f = fixture(); await f.mount(); const pending = f.api.refreshNotifications(); await f.mount('account-b');
  await f.tick(60000); await pending;
  assert.deepEqual(f.calls.map(c => c.account), ['account-a', 'account-b']);
  assert.equal(f.listeners.get('visibilitychange').size, 1);
});
test('active requests retain single-flight promise semantics', async () => {
  const f = fixture(); await f.mount(); f.state.delay = true;
  const a = f.api.refreshNotifications(true), b = f.api.refreshNotifications(true), c = f.api.refreshNotifications();
  assert.equal(a,b); assert.equal(a,c); await flush(); assert.equal(f.calls.length, 2);
  f.deferred.shift()({data: {notices: [], unread: 0}}); await a; assert.equal(f.timers.size, 0);
});
test('manual refresh cancels the background timer without duplicate RPC', async () => {
  const f = fixture(); await f.mount(); const pending = f.api.refreshNotifications();
  await f.api.refreshNotifications(true); await pending; await f.tick(3600000);
  assert.equal(f.calls.length, 2); assert.equal(f.timers.size, 0);
});
test('opening the bell requests fresh data immediately', async () => {
  const f = fixture(); await f.mount(); f.bell.onclick({stopPropagation(){}}); await flush();
  assert.equal(f.calls.length, 2);
});
test('refresh-now button bypasses the hourly hold and shows the last refresh time', async () => {
  const f = fixture(); await f.mount(); f.bell.onclick({stopPropagation(){}}); await flush(); await flush();
  assert.equal(f.calls.length, 2); assert.match(f.panel.innerHTML, /تحديث الآن/); assert.match(f.panel.innerHTML, /آخر تحديث: الآن/);
  await f.tick(5000); f.refreshNow.onclick({stopPropagation(){}}); f.refreshNow.onclick({stopPropagation(){}}); await flush(); await flush();
  assert.equal(f.calls.length, 3); assert.equal(f.timers.size, 0); assert.match(f.panel.innerHTML, /تحديث الآن/);
});
test('marking displayed notices read refreshes immediately after the write', async () => {
  const f = fixture(); f.state.data = {notices: [{key: 'task:test', type: 'task', id: 'test', message: 'Synthetic notice', at: '2026-11-05T00:00:00Z', read: false}], unread: 1};
  await f.mount(); f.bell.onclick({stopPropagation(){}}); await flush();
  f.mark.onclick(); await flush();
  assert.deepEqual(f.calls.slice(-2).map(c => c.name), ['personal_home_read', 'personal_home_inbox']);
  assert.equal(f.badge.textContent, '0');
});
test('realtime event objects cannot bypass the cooldown', async () => {
  const f = fixture(); await f.mount(); const pending = f.api.refreshNotifications({eventType: 'INSERT'});
  await flush(); assert.equal(f.calls.length, 1); await f.tick(3600000); await pending; assert.equal(f.calls.length, 2);
});
test('RPC failure releases flight and allows a later retry', async () => {
  const f = fixture(); await f.mount(); f.state.fail = true; await f.api.refreshNotifications(true);
  await f.tick(3600000); await f.api.refreshNotifications(); assert.equal(f.calls.length, 3);
});
test('45-second app poll is held to one background refresh per hour', async () => {
  const f = fixture(); await f.mount();
  for (let i=0; i<79; i++) {await f.tick(45000); f.api.refreshNotifications(); await flush();}
  assert.equal(f.calls.length, 1); await f.tick(45000); await flush(); assert.equal(f.calls.length, 2);
});
test('personal task notice refreshes immediately while visible', async () => {
  const f = fixture(); await f.mount(); f.handlers.task_notifications({eventType: 'INSERT'}); await flush();
  assert.equal(f.calls.length, 2);
});
test('personal notice while hidden is caught up once on return', async () => {
  const f = fixture(); await f.mount(); f.visibility(true); f.handlers.task_notifications({eventType: 'INSERT'}); await flush();
  assert.equal(f.calls.length, 1); await f.tick(1000); f.visibility(false); await flush(); assert.equal(f.calls.length, 2);
  f.visibility(true); f.visibility(false); await flush(); assert.equal(f.calls.length, 2);
});
test('return within ten minutes without missed notices makes no RPC', async () => {
  const f = fixture(); await f.mount(); f.visibility(true); await f.tick(599999); f.visibility(false); await flush();
  assert.equal(f.calls.length, 1);
});
test('inventory bursts refresh at most once per ten minutes', async () => {
  const f = fixture(); await f.mount();
  for (let i=0; i<30; i++) {f.handlers.inventory_requests({eventType: 'UPDATE'}); await f.tick(10000);}
  assert.equal(f.calls.length, 1); await f.tick(300000); assert.equal(f.calls.length, 2);
  for (let i=0; i<30; i++) {f.handlers.inventory_requests({eventType: 'UPDATE'}); await f.tick(10000);}
  assert.equal(f.calls.length, 2); await f.tick(300000); assert.equal(f.calls.length, 3);
  await f.tick(3600000); assert.equal(f.calls.length, 3);
});
test('inventory events while hidden make no RPC and stop clears the inventory timer', async () => {
  const f = fixture(); await f.mount(); f.visibility(true); f.handlers.inventory_requests({}); await f.tick(600000);
  assert.equal(f.calls.length, 1); f.visibility(false); await flush(); assert.equal(f.calls.length, 2);
  f.handlers.inventory_requests({}); f.api.stop(); await f.tick(600000); assert.equal(f.calls.length, 2); assert.equal(f.timers.size, 0);
});
test('late response from old account cannot overwrite the new badge', async () => {
  const f = fixture(); f.state.delay = true; await f.mount(); const old = f.deferred.shift();
  await f.mount('account-b'); const current = f.deferred.shift();
  current({data: {notices: [], unread: 1}}); await flush(); assert.equal(f.badge.textContent, '1');
  old({data: {notices: [], unread: 9}}); await flush(); assert.equal(f.badge.textContent, '1');
});

(async () => {
  for (const [name, run] of tests) {await run(); console.log('PASS '+name);}
  const baselinePath = process.env.INBOX_BASELINE_SOURCE;
  if (baselinePath) {
    const counts = [];
    for (const code of [fs.readFileSync(baselinePath,'utf8'),source]) {
      const f = fixture(code); await f.mount();
      for (let i=0; i<20; i++) {await f.tick(1000); f.api.refreshNotifications(); await flush();}
      await f.tick(10000); counts.push(f.calls.length); f.api.stop();
    }
    assert(counts[1] <= counts[0], 'candidate must not add calls');
    console.log('SYNTHETIC burst comparison (20 events/30s, includes mount): '+JSON.stringify({baseline:counts[0],candidate:counts[1],networkCalls:0}));
  }
  console.log('PASS '+tests.length+' deterministic notification refresh tests; fake DOM/RPC/clock only');
})().catch(error => {console.error(error); process.exitCode=1;});
