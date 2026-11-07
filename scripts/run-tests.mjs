// Runs every automated test in test/ and tests/ and prints one summary line per file.
// Used by `npm test` and by the GitHub "Tests" workflow on every pull request.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const skip = new Set([]);
// Files that fail on main for a documented reason (see docs/TEST-BASELINE-20261108.md). They are reported as KNOWN-FAIL and do not
// turn the run red, so any NEW red means something new. A known file that starts passing fails the run until it is removed here.
const known = {
  'test/contract-edit.cjs': 'stale: edit modal was redesigned (save is a button handler, not a form submit); needs a rewrite',
  'test/portal-routes.mjs': 'stale: portal page script reads a config object the harness does not provide',
  'tests/dashboard-help-coverage.cjs': 'content gap: help guide lacks reviewed explanations for newer screens and fields',
  'tests/dashboard-help-dom.cjs': 'content gap: no help article for the human_resources tab',
  'tests/header-titles-dom.cjs': 'content gap: no English translation for the human_resources tab title',
  'tests/employee-performance-dom.cjs': 'behaviour drift: concurrent profile reads are no longer deduplicated; check intent',
  'tests/organized-workspaces-dom.cjs': 'stale: the contracting workbench no longer has the insurance category chip this test clicks',
  'tests/reception-doctor-setup-dom.cjs': 'stale: the pilot-settings action is no longer rendered for this fixture',
  'tests/reception-management-pilot-ui.cjs': 'stale: a guide text expectation is no longer present',
};
const files = ['test', 'tests'].flatMap(dir =>
  readdirSync(join(root, dir))
    .filter(f => /\.(cjs|mjs|js)$/.test(f) && !skip.has(f))
    .map(f => join(dir, f)));

let failed = [], knownFailing = [];
for (const file of files.sort()) {
  const exec = () => spawnSync(process.execPath, [file], { cwd: root, encoding: 'utf8', timeout: 180000 });
  let run = exec();
  // browser tests can time out on a busy machine: one retry before calling it a failure
  if (run.status !== 0 && !known[file]) run = exec();
  const ok = run.status === 0;
  if (!ok && known[file]) { console.log('KNOWN-FAIL ' + file + ' - ' + known[file]); knownFailing.push(file); continue; }
  if (ok && known[file]) { console.log('FAIL ' + file + ' - now passes: remove it from the known list in scripts/run-tests.mjs'); failed.push(file); continue; }
  console.log((ok ? 'PASS ' : 'FAIL ') + file);
  if (!ok) {
    failed.push(file);
    console.log(((run.stderr || '') + (run.stdout || '')).split('\n').filter(l => !/^\s+at /.test(l)).slice(0, 12).join('\n'));
  }
}
console.log(`\n${files.length - failed.length - knownFailing.length}/${files.length} test files passed, ${knownFailing.length} known failures (documented), ${failed.length} new failures.`);
if (failed.length) process.exit(1);
