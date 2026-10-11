// Runs every automated test in test/ and tests/ and prints one summary line per file.
// Used by `npm test` and by the GitHub "Tests" workflow on every pull request.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const skip = new Set([
  // Full-page smoke test of the whole dashboard; it needs an up-to-date Supabase mock and is run manually.
  'smoke.js',
]);
const files = ['test', 'tests'].flatMap(dir =>
  readdirSync(join(root, dir))
    .filter(f => /\.(cjs|mjs|js)$/.test(f) && !skip.has(f))
    .map(f => join(dir, f)));

let failed = [];
for (const file of files.sort()) {
  const run = spawnSync(process.execPath, [file], { cwd: root, encoding: 'utf8', timeout: 180000 });
  const ok = run.status === 0;
  console.log((ok ? 'PASS ' : 'FAIL ') + file);
  if (!ok) {
    failed.push(file);
    console.log(((run.stderr || '') + (run.stdout || '')).split('\n').filter(l => !/^\s+at /.test(l)).slice(0, 12).join('\n'));
  }
}
console.log(`\n${files.length - failed.length}/${files.length} test files passed.`);
if (failed.length) process.exit(1);
