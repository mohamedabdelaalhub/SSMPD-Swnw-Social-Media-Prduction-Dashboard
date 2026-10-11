// اختبار نظام المصادر الطبية (sources + cover_source_text) — A..G من المطلوب.
// node test/content-sources.cjs   (محتاج jsdom و @napi-rs/canvas)
const assert = require('assert/strict'), fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { JSDOM } = require('jsdom');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const dom = new JSDOM('<body></body>', { runScripts: 'outside-only', url: 'https://test.invalid' }), w = dom.window;
for (const [file, family] of [['BigVesta-Bold', 'SonoDesign'], ['BigVesta-Regular', 'SonoDesign'], ['Hiragino-W6', 'SonoLatin']]) GlobalFonts.registerFromPath(root + '/assets/fonts/' + file + '.woff2', family);
Object.defineProperty(w.document, 'currentScript', { value: { src: 'file://' + root + '/assets/js/design-composer.js' } });
w.document.fonts = { add() {} }; w.FontFace = class { load() { return Promise.resolve(this); } };
w.Image = class { set src(url) { loadImage(new URL(url).pathname).then(img => { this.img = img; this.width = img.width; this.height = img.height; this.onload(); }).catch(e => this.onerror(e)); } };
const native = new WeakMap(); let texts = [];
w.HTMLCanvasElement.prototype.getContext = function () {
  if (!native.has(this)) {
    const c = createCanvas(1080, 1350), ctx = c.getContext('2d'), draw = ctx.drawImage.bind(ctx), fill = ctx.fillText.bind(ctx);
    ctx.drawImage = (img, ...a) => draw(native.get(img) || img.img || img, ...a);
    ctx.fillText = (t, x, y) => { texts.push({ t, x, y, m: ctx.getTransform ? ctx.getTransform().toString() : '' }); fill(t, x, y); };
    native.set(this, c);
  }
  return native.get(this).getContext('2d');
};
w.SSMPDDb = { client: { from() { const q = { select() { return q; }, eq() { return q; }, order() { return q; }, limit() { return Promise.resolve({ data: [] }); } }; return q; } } };
const load = f => w.eval(read('assets/js/' + f));
['latin-digits.js', 'content-sources.js', 'design-panel-color.js', 'design-source.js', 'design-composer.js', 'carousel-content.js'].forEach(f => { try { load(f); } catch (e) { console.log('skip', f, e.message); } });
const S = w.SSMPDSources;

const NHS = [{ name: 'NHS', title: 'Headaches', url: 'https://www.nhs.uk/symptoms/headaches/', type: 'medical_authority', is_primary: true }];
const COVER = 'المصدر الطبي للمحتوى: NHS';
const idea = (extra = {}) => Object.assign({ number: 1, title: 'صداع', idea: 'شرح', hook: 'هوك', angle: 'زاوية', format: 'image_post', caption: 'كابشن', cta_type: 'book', cta_text: 'احجز', hypothesis_reason: 'سبب', design_headline: 'عنوان', design_subtitle: 'سطر', design_cta: 'احجز الآن' }, extra);
const itemOf = (format, raw) => ({ id: 'i1', brand: 'sono', title: 't', content_format: format, agent_raw_output: raw == null ? null : (typeof raw === 'string' ? raw : JSON.stringify(raw)) });

(async () => {
  // ---- A: استيراد من Plugin وبه NHS
  const prod = (() => {
    const d = new JSDOM('<body></body>', { runScripts: 'outside-only', url: 'https://test.invalid' }).window;
    d.SSMPDSources = null;
    d.eval(read('assets/js/content-sources.js')); d.eval(read('assets/js/latin-digits.js'));
    ['SSMPDToast', 'SSMPDDb', 'SSMPDAuth', 'SSMPDRoles', 'SSMPDWorkflow', 'SSMPDI18n'].forEach(k => d[k] = {});
    d.SSMPDI18n = { t: x => x, textHtml: x => x };
    try { d.eval(read('assets/js/render-production.js')); } catch (e) { throw new Error('render-production load: ' + e.message); }
    return d;
  })();
  const parse = prod.SSMPDRenderProduction.parseAgentHypotheses;
  const reply = 'الفكرة 1: صداع\n...\nSSMPD_STRUCTURED_JSON\n```json\n' + JSON.stringify({ ideas: [idea({ sources: NHS, cover_source_text: COVER })] }) + '\n```\nSSMPD_STRUCTURED_JSON_END';
  const [h] = parse(reply);
  assert.equal(h.raw.sources[0].name, 'NHS'); assert.equal(h.raw.sources[0].url, 'https://www.nhs.uk/symptoms/headaches/');
  assert.equal(h.raw.cover_source_text, COVER); assert.equal(h.title, 'صداع');
  const saved = JSON.stringify(Object.assign({}, h.raw, { original_agent_output: reply })); // نفس ما يحفظه نموذج الاستيراد
  assert.equal(S.fromItem(itemOf('image_post', saved)).cover_source_text, COVER);
  assert.equal(S.fromItem(itemOf('image_post', saved)).sources[0].is_primary, true);
  // رابط http أو بدون اسم يتشال
  const dirty = parse('SSMPD_STRUCTURED_JSON\n' + JSON.stringify({ ideas: [idea({ sources: [{ name: 'X', url: 'http://bad.example/x' }, { name: '', url: '' }, NHS[0]], cover_source_text: COVER })] }));
  assert.equal(dirty[0].raw.sources.length, 2, 'http link is dropped to empty url but named source stays'); assert.equal(dirty[0].raw.sources[0].url, '');
  console.log('PASS A: plugin import keeps sources + cover_source_text');

  // ---- D: رد قديم / مادة قديمة بدون sources
  const [old] = parse('SSMPD_STRUCTURED_JSON\n' + JSON.stringify({ ideas: [idea()] }));
  assert.equal(old.raw.sources, undefined); assert.equal(old.title, 'صداع');
  const [legacyText] = parse('الفكرة 1: صداع\nالفكرة: شرح\nHook: هوك\nالشكل: صورة\nكابشن: كابشن\nCTA: احجز\nلماذا تصلح للاختبار: سبب');
  assert.ok(legacyText && legacyText.title);
  for (const raw of [null, '', 'نص حر غير JSON', '{"ideas":[]}', {}]) {
    const r = S.fromItem(itemOf('image_post', raw)); assert.equal(r.sources.length, 0); assert.equal(r.cover_source_text, '');
  }
  assert.equal(S.designText(itemOf('image_post', null)), '');
  texts = []; const c0 = w.document.createElement('canvas'); const out0 = await w.SSMPDDesignComposer.render(c0, null, { headline: 'عنوان', layoutTemplate: 'classic', brand: 'sono' });
  assert.ok(out0 && !texts.some(x => x.t.includes('المصدر')));
  const merged = JSON.parse(S.merge('نص حر قديم', NHS, COVER)); assert.equal(merged.original_agent_output, 'نص حر قديم'); assert.equal(merged.cover_source_text, COVER);
  console.log('PASS D: old items/replies work, nothing drawn, free-text raw is preserved');

  // ---- B: content-ai (الخادم) — تنظيف المصادر وعدم اختراع روابط
  const tsOut = execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '-e', `
    import('${path.join(root, 'supabase/functions/content-ai/sources.ts')}').then(m => {
      const a = { sources: [{name:'NHS',title:'Headaches',url:'https://www.nhs.uk/symptoms/headaches/',type:'medical_authority',is_primary:true},{name:'Fake',title:'x',url:'https://made-up-health.example/p',type:'study',is_primary:false},{name:'HTTP',title:'x',url:'http://www.who.int/a',type:'study',is_primary:false}], cover_source_text: 'نص مخترع' };
      m.applySources(a);
      const b = { sources: [], cover_source_text: 'يجب تفريغه' }; m.applySources(b);
      const c = { sources: [{name:'WHO',title:'T',url:'https://www.who.int/news-room/fact-sheets/detail/stroke',type:'guideline',is_primary:false}] }; m.applySources(c);
      console.log(JSON.stringify({a,b,c}));
    });`], { encoding: 'utf8' });
  const ts = JSON.parse(tsOut.trim().split('\n').pop());
  assert.equal(ts.a.sources.length, 1); assert.equal(ts.a.sources[0].name, 'NHS'); assert.equal(ts.a.cover_source_text, COVER);
  assert.deepEqual(ts.b.sources, []); assert.equal(ts.b.cover_source_text, '');
  assert.equal(ts.c.sources[0].is_primary, true); assert.equal(ts.c.cover_source_text, 'المصدر الطبي للمحتوى: WHO');
  const idx = read('supabase/functions/content-ai/index.ts');
  for (const needle of ['"sources","cover_source_text"', '...sourceProperties', 'sourceInstructions', 'applySources(idea)', 'idea.sources=[];idea.cover_source_text=""']) assert.ok(idx.includes(needle), 'content-ai index.ts missing ' + needle);
  console.log('PASS B: content-ai schema + server-side cleaning (no invented/unknown/http URLs, empty for non-medical)');

  // ---- C: Claude Daily Content — نفس الـschema داخل agent_raw_output مع الحفاظ على باقي المفاتيح
  const daily = { content_kind: 'carousel', carousel_brief: { slides_count: 6, style: 'tips', notes: '' }, carousel_copy: [{ role: 'hook', headline: 'a b c', body: 'x', scene: 's' }], sources: NHS, cover_source_text: COVER };
  const d = S.fromItem(itemOf('carousel', daily)); assert.equal(d.cover_source_text, COVER); assert.equal(d.sources[0].name, 'NHS');
  const patched = JSON.parse(S.merge(JSON.stringify(daily), NHS, COVER)); assert.ok(patched.carousel_copy && patched.carousel_brief && patched.content_kind === 'carousel', 'merge keeps other keys');
  const doc = read('docs/claude-content-style.md'); for (const needle of ['cover_source_text', 'carousel', 'slide 1', 'video', 'NEVER invent']) assert.ok(doc.includes(needle), 'docs missing ' + needle);
  console.log('PASS C: daily-run contract (schema + merge-preserve) — NOTE: the scheduler prompt itself lives outside the repo');

  // ---- E: كاروسيل — المصدر على الكفر فقط
  const car = itemOf('carousel', daily); car.title = 'عنوان'; car.caption_text = 'كابشن';
  const note = JSON.parse(w.SSMPDCarouselContent.designNote(car));
  assert.equal(note.cover_source_text, COVER); assert.equal(note.source_slides, 'cover_only');
  assert.equal(S.designText(car), '', 'no studio/inner-slide rendering for carousel');
  console.log('PASS E: carousel note carries cover_source_text with source_slides=cover_only; nothing drawn on inner slides');

  // ---- F: image_post — مرة واحدة
  const scene = createCanvas(1080, 1350); { const g = scene.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 1350); gr.addColorStop(0, '#cfd8ea'); gr.addColorStop(1, '#0F369D'); g.fillStyle = gr; g.fillRect(0, 0, 1080, 1350); }
  const post = itemOf('image_post', { sources: NHS, cover_source_text: COVER });
  texts = []; const c1 = w.document.createElement('canvas');
  await w.SSMPDDesignComposer.render(c1, scene, { brand: 'sono', layoutTemplate: 'full_photo', headline: '6 خطوات بسيطة', subtitle: 'عادات سهلة', cta: 'اسحب وشوف', coverSourceText: S.designText(post) });
  const hits = texts.filter(x => x.t === COVER); assert.equal(hits.length, 1, 'drawn exactly once'); assert.ok(!texts.some(x => /nhs\.uk|Headaches/.test(x.t)), 'no URL/title on the design');
  assert.ok(hits[0].x < 100, 'on the left edge'); fs.writeFileSync(process.env.SRC_PREVIEW || '/tmp/cover-source-preview.png', native.get(c1).toBuffer('image/png'));
  console.log('PASS F: image_post draws cover_source_text once, on the left edge, without URL/title');

  // ---- G: فيديو — محفوظ لكن غير ظاهر
  const vid = itemOf('video', { sources: NHS, cover_source_text: COVER });
  assert.equal(S.fromItem(vid).cover_source_text, COVER); assert.equal(S.designText(vid), '');
  const worker = read('video-worker/worker.py'); assert.ok(!/cover_source_text|sources/.test(worker), 'video worker never renders sources');
  console.log('PASS G: video keeps the source in item data; not drawn (worker has no source rendering)');
  // ---- H: التعديل اليدوي من قسم «المصدر الطبي»
  const host = w.document.createElement('div'); w.document.body.appendChild(host);
  let patch = null; w.SSMPDDb.updateContentItem = (id, p) => { patch = { id, p }; return Promise.resolve({}); };
  const editable = itemOf('image_post', { carousel_copy: [1], sources: NHS, cover_source_text: COVER });
  S.mount(host, editable, { editable: true });
  assert.ok(host.textContent.includes('NHS') && host.textContent.includes('Headaches') && host.querySelector('a[href^="https://www.nhs.uk"]'), 'view shows name, title and an openable link');
  assert.ok(host.textContent.includes('الرابط وعنوان الصفحة لا يظهرون على التصميم'));
  host.querySelector('[data-src-edit]').click();
  host.querySelector('[data-src="name"]').value = 'WHO'; host.querySelector('[data-src="url"]').value = 'https://www.who.int/x'; host.querySelector('[data-src-cover]').value = '';
  host.querySelector('[data-src-save]').click(); await new Promise(r => setTimeout(r, 10));
  const edited = JSON.parse(patch.p.agent_raw_output);
  assert.equal(edited.sources[0].name, 'WHO'); assert.equal(edited.cover_source_text, 'المصدر الطبي للمحتوى: WHO'); assert.deepEqual(edited.carousel_copy, [1]);
  const none = w.document.createElement('div'); S.mount(none, itemOf('image_post', null), { editable: false });
  assert.ok(none.textContent.includes('لا يوجد مصدر طبي') && !none.querySelector('[data-src-edit]'));
  console.log('PASS H: manual edit saves into agent_raw_output, keeps other keys, auto-fills the cover text; empty/read-only state is clean');
  w.close(); console.log('ALL PASS');
})().catch(e => { console.error(e); process.exit(1); });
