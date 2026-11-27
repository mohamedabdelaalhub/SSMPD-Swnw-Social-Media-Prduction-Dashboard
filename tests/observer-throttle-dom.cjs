// observer-throttle.js: page-wide MutationObservers get ONE coalesced delivery per animation frame (all records, in order); small-element observers are untouched;
// takeRecords / disconnect / opt-out keep working. Real Chromium (real rAF).
const fs = require('fs'), assert = require('node:assert/strict'), { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] }), p = await b.newPage();
  await p.setContent('<!doctype html><html><body><div id="app-root"><div id="small"></div></div></body></html>');
  await p.addScriptTag({ content: fs.readFileSync('assets/js/observer-throttle.js', 'utf8') });
  const r = await p.evaluate(() => new Promise(async (done) => {
    const out = {}, wait = (ms) => new Promise(r => setTimeout(r, ms));
    out.instance = new MutationObserver(() => {}) instanceof MutationObserver;
    // page-wide: 50 separate batches inside one frame → ONE callback with all 50 records
    let calls = 0, recs = 0, self = null; const wide = new MutationObserver(function (m, o) { calls++; recs += m.length; self = (this === wide) && (o === wide); }); wide.observe(document.body, { childList: true, subtree: true });
    for (let i = 0; i < 50; i++) { document.body.appendChild(document.createElement('i')); await Promise.resolve(); await Promise.resolve(); }
    out.syncCalls = calls; await wait(80); out.wideCalls = calls; out.wideRecs = recs; out.thisIsObserver = self;
    // element-scoped observer: delivered per batch as before (immediately, microtask)
    let sc = 0; const small = new MutationObserver(() => { sc++; }); small.observe(document.getElementById('small'), { childList: true });
    document.getElementById('small').appendChild(document.createElement('b')); await Promise.resolve(); await Promise.resolve(); out.smallImmediate = sc;
    // opt-out
    let oc = 0; const opt = new MutationObserver(() => { oc++; }); opt.__noThrottle = true; opt.observe(document.body, { childList: true, subtree: true }); document.body.appendChild(document.createElement('u')); await Promise.resolve(); await Promise.resolve(); out.optOut = oc;
    // takeRecords returns the pending (not yet delivered) records, and they are not delivered twice
    let tc = 0, tr = 0; const tk = new MutationObserver((m) => { tc++; tr += m.length; }); tk.observe(document.body, { childList: true, subtree: true }); document.body.appendChild(document.createElement('s')); await Promise.resolve(); await Promise.resolve();
    out.taken = tk.takeRecords().length; await wait(80); out.takenDelivered = tc;
    // disconnect cancels a pending delivery
    let dc = 0; const dd = new MutationObserver(() => { dc++; }); dd.observe(document.body, { childList: true, subtree: true }); document.body.appendChild(document.createElement('q')); await Promise.resolve(); await Promise.resolve(); dd.disconnect(); await wait(80); out.afterDisconnect = dc;
    done(out);
  }));
  assert.equal(r.instance, true, 'still an instance of MutationObserver'); assert.equal(r.syncCalls, 0, 'nothing delivered inside the frame'); assert.equal(r.wideCalls, 1, 'one coalesced delivery'); assert.equal(r.wideRecs, 50, 'with every record');
  assert.equal(r.thisIsObserver, true, 'callback this / 2nd arg are the observer'); assert.equal(r.smallImmediate, 1, 'small-element observers unchanged'); assert.equal(r.optOut, 1, '__noThrottle respected');
  assert(r.taken >= 1, 'takeRecords returns pending records'); assert.equal(r.takenDelivered, 0, 'and they are not delivered again'); assert.equal(r.afterDisconnect, 0, 'disconnect cancels pending delivery');
  await b.close(); console.log('observer-throttle-dom OK');
})().catch(e => { console.error(e); process.exit(1); });
