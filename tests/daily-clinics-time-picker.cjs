// «مواعيد العيادات» time picker (owner 2026-11-23, Shrouk's Windows/Arabic Chrome screenshots): hour + minutes + صباحًا/مساءً selects
// write HH:MM (24h) into the hidden data-daily-key input; validator names the empty side or the equal time.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
const dom=new JSDOM('<!doctype html><body><div id="r"></div></body>',{runScripts:'outside-only'}),w=dom.window;
w.eval(fs.readFileSync('assets/js/daily-clinics.js','utf8'));const D=w.SSMPDDailyClinics;
const root=w.document.getElementById('r');root.innerHTML='<select id="cf-content-kind"></select><select id="cf-brand"><option value="sono">sono</option></select><select id="ci-format"><option value="image_post">image</option></select><input id="cf-title"><input id="cf-specialty">'+D.html();D.wire(root);
const q=s=>root.querySelector(s),box=k=>q('[data-daily-time="'+k+'"]');
assert(box('from')&&box('to'),'two pickers');assert.equal(root.querySelectorAll('input[type=time]').length,0,'no native time input');
assert.equal(box('from').querySelector('[data-daily-key="from"]').type,'hidden');
assert.equal(box('from').querySelector('[data-daily-key="from"]').value,'10:00','default start 10:00');assert.equal(box('to').querySelector('[data-daily-key="to"]').value,'12:00','default end 12:00');
assert.deepEqual([...box('from').querySelectorAll('[data-daily-part="p"] option')].map(o=>o.textContent),['صباحًا','مساءً']);
// wire the form the way the screen does and pick 8:30 مساءً
const set=(k,h,m,p)=>{const b=box(k);b.querySelector('[data-daily-part="h"]').value=String(h);b.querySelector('[data-daily-part="m"]').value=String(m);const sel=b.querySelector('[data-daily-part="p"]');sel.value=p;sel.dispatchEvent(new w.Event('change',{bubbles:true}));};
set('from',8,30,'pm');assert.equal(box('from').querySelector('[data-daily-key]').value,'20:30');
set('to',12,0,'am');assert.equal(box('to').querySelector('[data-daily-key]').value,'00:00','12 صباحًا is midnight');
set('to',12,15,'pm');assert.equal(box('to').querySelector('[data-daily-key]').value,'12:15','12 مساءً is noon');
// validator messages
const base={day:'السبت',rows:[{name:'د. أ',specialty:'باطنة',from:'10:00',to:'12:00'}]};
assert.doesNotThrow(()=>D.validate(JSON.parse(JSON.stringify(base))));
assert.throws(()=>D.validate({...base,rows:[{...base.rows[0],from:''}]}),/اختار بداية موعد العيادة .* في السطر 1/);
assert.throws(()=>D.validate({...base,rows:[{...base.rows[0],to:''}]}),/اختار نهاية موعد العيادة .* في السطر 1/);
assert.throws(()=>D.validate({...base,rows:[{...base.rows[0],from:'21:00',to:'21:00'}]}),/السطر 1 نفس الوقت \(09:00 مساءً\)/);
// existing non-5-minute value survives
const src=fs.readFileSync('assets/js/daily-clinics.js','utf8');assert(/mins\.push\(t\.m\)/.test(src),'odd minutes kept');
console.log('PASS daily clinics time picker: no native time input, hidden HH:MM, defaults 10:00/12:00, 12 صباحًا=00 / 12 مساءً=12, clear empty-start / empty-end / equal-time messages.');
