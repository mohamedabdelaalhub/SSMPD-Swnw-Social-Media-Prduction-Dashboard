// Browser test for the shared motion & sound foundation (assets/js/ui-motion.js + assets/css/ui-motion.css):
// real (trusted) presses play a quiet tick, switches play the toggle tone, toasts play success / error, the per-user switch
// in «إعداداتي» persists per account, nothing plays when off, programmatic clicks and hover are silent, the pressed ring
// never clips (box-shadow, no overflow change), the opt-in ripple adds and removes its dot, and reduced motion skips motion.
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict'), { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const html = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><style>${fs.readFileSync(root + '/assets/css/ui-motion.css', 'utf8')}</style></head><body>
<button id="b">حفظ</button><button id="sw" role="switch" aria-checked="false">مفتاح</button><button id="dis" disabled>معطّل</button>
<div data-fx-silent><button id="quiet">بدون صوت</button></div><button id="rip" class="fx-ripple">ريبل</button><section id="ctl"></section>
<script>
window.__tones=[];window.AudioContext=class{constructor(){this.state='running';this.currentTime=0;this.sampleRate=8000;this.destination={};}resume(){}
 createOscillator(){const o={type:'',frequency:{setValueAtTime:(f)=>{o.f=f},exponentialRampToValueAtTime(){}},connect(){},start(){window.__tones.push(o.type+':'+o.f)},stop(){}};return o;}
 createGain(){return{gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}
 createBiquadFilter(){return{type:'',frequency:{value:0},Q:{value:0},connect(){},disconnect(){}};}
 createBuffer(c,n){return{getChannelData:()=>new Float32Array(n)};}
 createBufferSource(){return{connect(){},disconnect(){},start(){window.__tones.push('tick')}};}};
window.SSMPDAuth={currentAdmin:{id:'u1'}};
</script>
<script>${fs.readFileSync(root + '/assets/js/toast.js', 'utf8')}</script>
<script>${fs.readFileSync(root + '/assets/js/ui-motion.js', 'utf8')}</script></body></html>`;
(async () => {
  const b = await chromium.launch(), p = await b.newPage();
  await p.route('https://ui-motion.test/', r => r.fulfill({ contentType: 'text/html', body: html })); await p.goto('https://ui-motion.test/');
  const tones = () => p.evaluate(() => window.__tones.splice(0));
  await p.click('#b'); let t = await tones(); assert.deepEqual(t, ['tick'], 'a real press plays one quiet tick');
  assert.equal(await p.evaluate(() => getComputedStyle(document.getElementById('b')).overflow), 'visible', 'pressed ring never changes overflow (no clipping)');
  await p.click('#sw'); t = await tones(); assert.equal(t.length, 1); assert.match(t[0], /^sine:520/, 'a switch plays the rising toggle tone');
  await p.click('#dis', { force: true }).catch(() => {}); t = await tones(); assert.deepEqual(t, [], 'disabled button is silent');
  await p.click('#quiet'); t = await tones(); assert.deepEqual(t, [], 'data-fx-silent area is silent');
  await p.evaluate(() => document.getElementById('b').click()); t = await tones(); assert.deepEqual(t, [], 'programmatic clicks are silent');
  await p.hover('#b'); t = await tones(); assert.deepEqual(t, [], 'hover is silent');
  await p.evaluate(() => SSMPDToast.success('تم')); t = await tones(); assert.deepEqual(t, ['sine:660', 'sine:990'], 'success toast plays two rising notes');
  await p.evaluate(() => SSMPDToast.error('خطأ')); t = await tones(); assert.deepEqual(t, ['triangle:330'], 'error toast plays the low tone');
  await p.evaluate(() => SSMPDToast.show('معلومة')); t = await tones(); assert.deepEqual(t, [], 'a plain info toast is silent');
  await p.evaluate(() => SSMPDToast.show('خطأ', 'error')); t = await tones(); assert.deepEqual(t, ['triangle:330']);
  // ripple: dot added at the press point, removed afterwards
  await p.click('#rip'); assert.equal(await p.locator('#rip .fx-ripple-dot').count(), 1, 'opt-in ripple dot'); await p.waitForTimeout(650); assert.equal(await p.locator('#rip .fx-ripple-dot').count(), 0, 'ripple dot cleaned up'); await tones();
  // settings switch: per account, persisted, silences everything
  await p.evaluate(() => SSMPDMotion.mountControl(document.getElementById('ctl')));
  const sw = p.locator('[data-ui-sound]'); assert.equal(await sw.getAttribute('aria-checked'), 'true', 'on by default');
  await sw.click(); assert.equal(await sw.getAttribute('aria-checked'), 'false'); t = await tones(); assert.deepEqual(t, [], 'turning off is silent (and the row itself never ticks)');
  assert.equal(await p.evaluate(() => localStorage.getItem('ssmpd_ui_sound_u1')), 'off', 'stored per account');
  await p.click('#b'); await p.evaluate(() => SSMPDToast.success('تم')); t = await tones(); assert.deepEqual(t, [], 'nothing plays while off');
  await p.evaluate(() => { SSMPDAuth.currentAdmin = { id: 'u2' }; }); await p.click('#b'); t = await tones(); assert.deepEqual(t, ['tick'], 'another account keeps its own setting');
  await p.evaluate(() => { SSMPDAuth.currentAdmin = { id: 'u1' }; });
  await sw.click(); assert.equal(await sw.getAttribute('aria-checked'), 'true'); t = await tones(); assert.deepEqual(t, ['sine:660', 'sine:990'], 'turning on confirms with the success notes');
  // reduced motion: no ring / ripple, sound still respects the switch
  await p.emulateMedia({ reducedMotion: 'reduce' }); await p.waitForTimeout(450); await p.click('#rip'); assert.equal(await p.locator('#rip .fx-ripple-dot').count(), 0, 'reduced motion: no ripple');
  await p.click('#b'); assert.equal(await p.evaluate(() => document.getElementById('b').classList.contains('fx-pressed')), false, 'reduced motion: no ring');
  await b.close(); console.log('PASS ui motion & sound foundation (browser)');
})().catch(e => { console.error(e); process.exit(1); });
