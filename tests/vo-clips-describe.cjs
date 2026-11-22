// claude-automation describeClips(): Instinct's suggested shot links -> {url, source, kind?, id?} (Pixabay ids for op=stock {id}).
const ts = require('typescript'), fs = require('fs'), assert = require('assert/strict');
const src = fs.readFileSync('supabase/functions/claude-automation/index.ts', 'utf8');
const fn = src.match(/export function describeClips[\s\S]*?\n}\n/)[0];
const ex = {}; new Function('exports', ts.transpileModule(fn, { compilerOptions: { target: 99, module: 1 } }).outputText)(ex);
const d = ex.describeClips;
assert.deepEqual(d(null), []); assert.deepEqual(d('x'), []);
assert.deepEqual(d(['https://pixabay.com/videos/doctor-patient-egypt-123456/', 'https://pixabay.com/ar/photos/woman-smile-98765/',
  'https://www.pexels.com/video/abc-1/', 'https://pixabay.com/users/someone/', 7]), [
  { url: 'https://pixabay.com/videos/doctor-patient-egypt-123456/', source: 'pixabay', kind: 'video', id: '123456' },
  { url: 'https://pixabay.com/ar/photos/woman-smile-98765/', source: 'pixabay', kind: 'photo', id: '98765' },
  { url: 'https://www.pexels.com/video/abc-1/', source: 'pexels.com' },
  { url: 'https://pixabay.com/users/someone/', source: 'pixabay' }]);
assert.equal(d(Array.from({ length: 30 }, (_, i) => 'https://a.com/' + i)).length, 20);
assert.match(src, /u\.searchParams\.set\(hitId \? "id" : "q", hitId \|\| query\)/, 'op=stock accepts a Pixabay id');
console.log('PASS describeClips + op=stock by id');
