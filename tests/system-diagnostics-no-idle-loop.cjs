// Regression: the diagnostics indicator used to rewrite its own text on every refresh. That is a childList mutation, which its own MutationObserver (and ~40 other
// observers on the page) answered by refreshing again — an endless idle loop that froze big screens (e.g. 3000-row doctor accounts). Idle DOM must stay quiet.
const assert = require('node:assert/strict'), fs = require('fs'), { JSDOM } = require(require.resolve('jsdom', { paths: [process.env.SSMPD_TEST_MODULES || process.cwd()] }));
(async () => {
  const dom = new JSDOM('<!doctype html><body><div id="app-root"><button id="dashboard-help-toggle">?</button><span data-system-diagnostics-admin-status></span></div></body>', { url: 'https://t.test/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; w.SSMPDAuth = { currentAdmin: { id: 'a', role: 'super_admin' } };
  w.eval(fs.readFileSync('assets/js/system-diagnostics-launcher.js', 'utf8'));
  await new Promise(r => setTimeout(r, 100));
  let n = 0; new w.MutationObserver(l => { n += l.filter(m => m.type === 'childList').length; }).observe(w.document.getElementById('app-root'), { childList: true, subtree: true });
  await new Promise(r => setTimeout(r, 600));
  assert.equal(n, 0, 'no childList churn while idle (got ' + n + ')');
  w.document.getElementById('app-root').append(w.document.createElement('p')); // an unrelated change must not make it loop either
  await new Promise(r => setTimeout(r, 600));
  assert(n <= 2, 'unrelated change causes at most the change itself (got ' + n + ')');
  console.log('system-diagnostics-no-idle-loop OK');
})().catch(e => { console.error(e); process.exit(1); });
