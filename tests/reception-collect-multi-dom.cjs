// «دفعة واحدة لأكتر من زيارة» UI (20261122160000): the invoice collect form offers the other open visits of the same patient / same phone
// (not package, not paid), ticking them sums the amount, submit sends collect_multi with [this invoice, ...picked]; «ملاحظة» on every
// collect; the receipt prints every visit covered and the note.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
const src=fs.readFileSync('assets/js/reception-services.js','utf8');
const fn=src.slice(src.indexOf('function phoneKey('),src.indexOf('function splitReceipt(c,pkg){'));
const dom=new JSDOM('<div class="rx-modal"><form><label>المبلغ<input name="amount"></label></form></div>',{runScripts:'outside-only'}),w=dom.window,doc=w.document;
w.eval(fn+';window.T={multiCandidates,multiBlock,bindMulti,multiPicked,multiCross,phoneKey};');const T=w.T;
const data={patients:[{id:'A',name:'منار',phone:'+20 101 111 2222'},{id:'B',name:'ابن منار',phone:'01011112222'},{id:'C',name:'غريب',phone:'01099990000'},{id:'D',name:'قريب',phone:''}],
 family_links:[{patient_id:'A',relative_id:'D'}],
 invoices:[{id:'i1',patient_id:'A',due:500,description:'كشف'},{id:'i2',patient_id:'B',due:500,description:'كشف أطفال'},{id:'i3',patient_id:'C',due:300,description:'كشف'},
  {id:'i4',patient_id:'A',due:0,description:'مدفوع'},{id:'i5',patient_id:'B',due:100,package_id:'p',description:'قسط'},{id:'i6',patient_id:'D',due:200,description:'جلسة'}]};
const c={esc:v=>String(v).replace(/</g,'&lt;'),money:v=>Number(v).toFixed(2),lookup:(l,id)=>(data.patients.find(p=>p.id===id)||{}).name};
const fixed=data.invoices[0];
assert.equal(T.phoneKey('+20 101 111 2222'),T.phoneKey('01011112222'),'same phone in any format');
const list=T.multiCandidates(data,fixed);assert.deepEqual(JSON.stringify(list.family.map(x=>x.id)),JSON.stringify(['i2','i6']),'same phone + linked family; not paid or package');
assert.deepEqual(JSON.stringify(list.others.map(x=>x.id)),JSON.stringify(['i3']),'other patients only under «مريض تاني»');
const form=doc.querySelector('form');form.insertAdjacentHTML('beforeend','<label>ملاحظة<input name="note"></label>'+T.multiBlock(c,list));T.bindMulti(c,form,fixed);
const on=form.querySelector('[data-rx-multi-on]'),boxes=form.querySelectorAll('[data-rx-multi-inv]');
assert.equal(form.querySelector('[data-rx-multi-list]').hidden,true,'hidden until ticked');assert.deepEqual(JSON.stringify(T.multiPicked(doc.querySelector('.rx-modal'))),'[]');
on.checked=true;on.dispatchEvent(new w.Event('change'));assert.equal(form.querySelector('[data-rx-multi-list]').hidden,false);
boxes[0].checked=true;boxes[0].dispatchEvent(new w.Event('change'));assert.equal(form.elements.amount.value,'1000','amount = 500 + 500');
assert.match(form.querySelector('[data-rx-multi-total]').textContent,/2 زيارات: 1000.00/);
assert.deepEqual(JSON.stringify(T.multiPicked(doc.querySelector('.rx-modal'))),'["i2"]');
// 20261122380000: a visit of another (non-family) patient — hidden until «دفع كمان عن زيارة مريض تاني», then the note is required
const x3=form.querySelector('[data-rx-multi-x]');assert.equal(x3.value,'i3');assert.equal(form.querySelector('[data-rx-multi-other]').hidden,true);
x3.checked=true;x3.dispatchEvent(new w.Event('change'));assert.equal(form.elements.amount.value,'1000','not counted while the other-patient part is closed');assert.equal(T.multiCross(doc.querySelector('.rx-modal')),false);
const oOn=form.querySelector('[data-rx-multi-other-on]');oOn.checked=true;oOn.dispatchEvent(new w.Event('change'));
assert.equal(form.elements.amount.value,'1300');assert.deepEqual(JSON.stringify(T.multiPicked(doc.querySelector('.rx-modal'))),'["i2","i3"]');assert.equal(T.multiCross(doc.querySelector('.rx-modal')),true);
assert.equal(form.elements.note.required,true);assert.equal(form.elements.note.minLength,5);assert.match(form.elements.note.placeholder,/مين دفع عن مين/);
const q=form.querySelector('[data-rx-multi-q]');q.value='zzz';q.dispatchEvent(new w.Event('input'));assert.equal(x3.closest('[data-rx-multi-row]').hidden,true,'search filters');q.value='غري';q.dispatchEvent(new w.Event('input'));assert.equal(x3.closest('[data-rx-multi-row]').hidden,false);
oOn.checked=false;oOn.dispatchEvent(new w.Event('change'));assert.equal(form.elements.note.required,false);assert.equal(form.elements.amount.value,'1000');
on.checked=false;on.dispatchEvent(new w.Event('change'));assert.deepEqual(JSON.stringify(T.multiPicked(doc.querySelector('.rx-modal'))),'[]','unticked → single collect');assert.equal(form.elements.amount.value,'500');
// wiring in the collect modal
assert(src.includes("if(picked.length){var inv=x.invoice_id;delete x.invoice_id;x.invoice_ids=[inv].concat(picked);if(cross)x.one_payer=true;return c.command('collect_multi',x,k);}return c.command('collect',x,k);"),'submit → collect_multi (+ one_payer for another patient)');
assert(src.includes("if(cross&&String(v.note||'').trim().length<5)return Promise.reject("),'note required for another patient');
assert(src.includes('<input name=\\"note\\" maxlength=\\"300\\"')||src.includes('<input name="note" maxlength="300"'),'note field on every collect');
assert(/if\(a==='collect-invoice'&&fixed&&!fixed\.package_id\)\{var others=multiCandidates\(d,fixed\)/.test(src),'offered only on a visit invoice');
// printed receipt
const pw=new JSDOM('',{runScripts:'outside-only',url:'https://x.test/'}).window;pw.eval(fs.readFileSync('assets/js/swnw-print.js','utf8'));
const html=pw.SSMPDPrint.receiptHtml({receipt_no:'RC-2026-000010',reference:'W-7788',method:'wallet',amount:1000,note:'تحويل واحد لزيارتين',lines:[{patient:'منار',no:'RX-11',applied:500,due:0},{patient:'ابن منار',no:'RX-12',applied:500,due:100}]});
const text=html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
assert.match(text,/الدفعة دي غطّت 2 زيارات/);assert.match(text,/منار — RX-11 500.00 مسدّدة/);assert.match(text,/ابن منار — RX-12 500.00 · الباقي 100.00/);assert.match(text,/ملاحظة تحويل واحد لزيارتين/);
assert(!/حساب الفاتورة بعد الدفعة/.test(text),'no single-invoice box on a multi receipt');
const br=fs.readFileSync('assets/js/reception-bridge.js','utf8');assert(br.includes("note:record.note||'',lines:alloc.length>1?"),'receipt passes the lines and the note');
console.log('PASS collect multi UI: same phone / linked family open visits offered (no paid / package), other patients only behind «مريض تاني» with a required note + search, sum, collect_multi payload, note field, receipt lists every visit + note.');
