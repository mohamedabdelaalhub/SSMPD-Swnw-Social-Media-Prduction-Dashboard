// DOM test (owner 2026-11-17: «كل الداشبورد خلي الارقام انجليزي»): dates, times and numbers formatted with any Arabic locale come out with English digits,
// screen text written with ١٢٣ is shown as 123 (also when added later), while inputs/textareas/editable text keep what the user typed.
const { JSDOM } = require('jsdom'), fs = require('fs'), assert = require('node:assert/strict');
(async () => {
  const dom = new JSDOM('<body><p id="a">الخطوة ١) و٢٣ يوم</p><input id="i" value="٠١٠٠"><textarea id="t">٤٥</textarea><div contenteditable="true" id="c">٦٧</div><button title="١ رسالة" id="b">x</button></body>', { url: 'https://t.invalid', runScripts: 'outside-only', pretendToBeVisual: true }), w = dom.window, d = w.document;
  w.eval(fs.readFileSync('assets/js/latin-digits.js', 'utf8'));
  const dt = new w.Date('2026-11-17T18:05:00Z');
  const out = w.eval(`[ (12345.5).toLocaleString('ar-EG'), new Date('2026-11-17T18:05:00Z').toLocaleTimeString('ar-EG',{timeZone:'Africa/Cairo',hour:'2-digit',minute:'2-digit'}),
    new Date('2026-11-17T18:05:00Z').toLocaleDateString('ar',{day:'numeric',month:'long'}), new Intl.NumberFormat('ar-EG').format(1500), new Intl.DateTimeFormat('ar-EG',{timeZone:'Africa/Cairo'}).format(new Date('2026-11-17T18:05:00Z')),
    new Intl.NumberFormat('ar-EG') instanceof Intl.NumberFormat ]`);
  for (const s of out.slice(0, 5)) assert(!/[٠-٩]/.test(s) && /\d/.test(s), 'latin: ' + s);
  assert.equal(out[5], true, 'instanceof still works');
  assert.equal(d.getElementById('a').textContent, 'الخطوة 1) و23 يوم');
  assert.equal(d.getElementById('b').getAttribute('title'), '1 رسالة');
  assert.equal(d.getElementById('i').value, '٠١٠٠'); assert.equal(d.getElementById('t').value, '٤٥'); assert.equal(d.getElementById('c').textContent, '٦٧', 'typed text untouched');
  const p = d.createElement('div'); p.innerHTML = '<span>عدد ٨٩</span>'; d.body.append(p);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(p.textContent, 'عدد 89', 'text added later');
  console.log('PASS latin digits everywhere: Intl/toLocale* with Arabic locales → 0-9, screen text ١٢٣ → 123 (also added later), inputs/textareas/editable kept.');
})().catch(e => { console.error(e); process.exit(1); });
