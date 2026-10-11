// Review additions to the medical-sources system:
//  - links the model invents are removed (content-ai opens each link once)
//  - older items that store the whole agent reply ({ideas:[…]}) still show their source
//  - the vertical label sits beside the title block (≈60% height), higher on Dina quote layouts 1–2
const assert = require('assert/strict'), fs = require('fs'), path = require('path'), vm = require('vm');
const { stripTypeScriptTypes } = require('node:module');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

(async () => {
  // 1. content-ai link check (mocked network — no live requests).
  const ctx = { URL, AbortSignal, Promise, Set, console };
  vm.runInNewContext(stripTypeScriptTypes(read('supabase/functions/content-ai/sources.ts').replace(/^export /gm, '')), ctx);
  const fake = async url => ({ status: url.includes('/headaches/') ? 200 : 404, body: { cancel: async () => {} } });
  const idea = { sources: [
    { name: 'NHS', title: 'Made up', url: 'https://www.nhs.uk/conditions/not-a-real-page/', type: 'medical_authority', is_primary: true },
    { name: 'NHS', title: 'Headaches', url: 'https://www.nhs.uk/symptoms/headaches/', type: 'medical_authority', is_primary: false },
  ] };
  ctx.applySources(idea);
  await ctx.verifySources(idea, fake);
  assert.equal(idea.sources.length, 1, 'dead link removed');
  assert.equal(idea.sources[0].url, 'https://www.nhs.uk/symptoms/headaches/');
  assert.equal(idea.sources[0].is_primary, true, 'remaining source becomes primary');
  assert.equal(idea.cover_source_text, 'المصدر الطبي للمحتوى: NHS');
  const none = { sources: [{ name: 'WHO', title: 'x', url: 'https://www.who.int/made-up', type: 'medical_authority', is_primary: true }] };
  ctx.applySources(none); await ctx.verifySources(none, fake);
  assert.equal(none.sources.length, 0); assert.equal(none.cover_source_text, '', 'no verified source → nothing on the design');
  const offline = { sources: [{ name: 'NHS', title: 'Headaches', url: 'https://www.nhs.uk/symptoms/headaches/', type: 'medical_authority', is_primary: true }] };
  ctx.applySources(offline); await ctx.verifySources(offline, async () => { throw new Error('timeout'); });
  assert.equal(offline.sources.length, 0, 'unreachable link is not kept');

  // 2. Older storage shape {ideas:[…]}.
  const dom = new JSDOM('<body></body>', { runScripts: 'outside-only' }), w = dom.window;
  w.eval(read('assets/js/content-sources.js'));
  const S = w.SSMPDSources;
  const raw = JSON.stringify({ ideas: [{ title: 'أخرى', sources: [] }, { title: 'صداع', sources: [{ name: 'NHS', url: 'https://www.nhs.uk/symptoms/headaches/', is_primary: true }], cover_source_text: 'المصدر الطبي للمحتوى: NHS' }] });
  assert.equal(S.fromItem({ title: 'صداع', agent_raw_output: raw }).cover_source_text, 'المصدر الطبي للمحتوى: NHS');
  assert.equal(S.fromItem({ title: 'صداع', agent_raw_output: '{"title":"قديم"}' }).cover_source_text, '');

  // 3. Label position per template (recording canvas).
  const calls = [];
  const recorder = { save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, rotate() {},
    measureText: t => ({ width: String(t).length * 10 }), getImageData: () => ({ data: new Uint8ClampedArray(64) }),
    translate(x, y) { calls.push({ x, y }); }, fillText() {} };
  const canvas = { width: 1080, height: 1350, getContext: () => recorder };
  w.eval(read('assets/js/design-source.js'));
  const D = w.SSMPDDesignSource;
  D.draw(canvas, { coverSourceText: 'المصدر الطبي للمحتوى: NHS', brand: 'sono' });
  assert.equal(Math.round(calls.at(-1).y), 810, 'Sono/default: beside the title block (60%)');
  D.draw(canvas, { coverSourceText: 'المصدر الطبي للمحتوى: NHS', brand: 'dr_dina', layoutTemplate: 'dina', dinaVariant: '1' });
  assert.equal(Math.round(calls.at(-1).y), 567, 'Dina quote layout: higher, away from the body text');
  assert.ok(calls.every(c => c.x < 60), 'always on the left edge');

  // 4. Claude's HTML templates carry the label on covers/posts only.
  for (const f of ['sono-carousel-photo/01-cover.html', 'sono-post-photo/post.html', 'dina-carousel/photo-01-cover.html', 'dina-carousel/01-cover-dark.html', 'dina-post-photo/post.html'])
    assert.ok(read('docs/templates/' + f).includes('class=src'), f + ' has the source label');
  for (const f of ['sono-carousel-photo/02-point.html', 'sono-carousel-photo/99-contact.html', 'dina-carousel/02-point.html', 'dina-carousel/99-contact-dark.html', 'dina-carousel/photo-02-point.html'])
    assert.ok(!read('docs/templates/' + f).includes('class=src'), f + ' must not show the source');
  console.log('PASS: invented/dead links removed, old {ideas} storage, label position per template, cover-only HTML templates.');
})().catch(e => { console.error(e); process.exitCode = 1; });
