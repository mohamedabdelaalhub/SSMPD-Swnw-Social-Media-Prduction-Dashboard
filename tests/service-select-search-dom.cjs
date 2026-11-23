// Searchable service lists (owner 2026-11-23): the «طلب خدمة أثناء الزيارة» list (and every other service <select>) gets a search box;
// name / code / department / Arabic letter variants; one match chosen by itself; the form still submits the chosen service; the
// booking form's own combobox is untouched. Sample data only.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
const dom=new JSDOM('<!doctype html><body></body>',{runScripts:'outside-only'}),w=dom.window,d=w.document,tick=()=>new Promise(r=>setTimeout(r,20));
w.eval(fs.readFileSync('assets/js/service-select-search.js','utf8'));
(async()=>{
 const svc=[];for(let i=0;i<300;i++)svc.push({id:'s'+i,name:'خدمة تجريبية '+i,code:'C'+String(i).padStart(4,'0'),department:i%2?'المعامل':'الأشعة'});
 svc.push({id:'x1',name:'تحليل صورة دم كاملة',code:'0001001',department:'المعامل'},{id:'x2',name:'أشعة إكس على الصدر',code:'0002002',department:'الأشعة'},{id:'x3',name:'جلسة علاج طبيعي',code:'0003003',department:'العلاج الطبيعي'});
 const opt=s=>'<option value="'+s.id+'" data-code="'+s.code+'">'+s.name+' — '+s.department+'</option>';
 // the request-service modal markup (today-operations-service-request-v3.js options(): grouped, with data-code)
 const form=d.createElement('form');form.innerHTML='<label>الخدمة المطلوبة<select name="service_id" required><option value="">اختر الخدمة</option><optgroup label="تحاليل">'+svc.filter(s=>s.department==='المعامل').map(opt).join('')+'</optgroup><optgroup label="أشعة">'+svc.filter(s=>s.department!=='المعامل').map(opt).join('')+'</optgroup></select></label>';
 d.body.appendChild(form);await tick();
 const sel=form.elements.service_id,q=form.querySelector('[data-sss-q]');assert(q,'search box added above the list');assert.equal(q.nextElementSibling.tagName,'SMALL');
 const type=v=>{q.value=v;q.dispatchEvent(new w.Event('input'));};
 const vals=()=>Array.from(sel.options).map(o=>o.value).filter(Boolean);
 type('صوره دم');assert.deepEqual(vals(),['x1'],'name, ة/ه normalised');assert.equal(sel.value,'x1','one match chosen');
 assert.equal(new w.FormData(form).get('service_id'),'x1','form submits the chosen service');
 type('0002002');assert.deepEqual(vals(),['x2'],'by code');
 type('اشعه الصدر');assert.deepEqual(vals(),['x2'],'أ/ا + two words');
 type('العلاج الطبيعي');assert.deepEqual(vals(),['x3'],'by department');
 type('تجريبية 12');assert.equal(vals().length,13,'12, 112, 120..129, 212');assert.equal(+sel.size,8,'shown as an open list');
 type('zzz');assert.equal(vals().length,0);assert.match(form.querySelector('[data-sss-n]').textContent,/مفيش خدمة/);
 type('');assert.equal(vals().length,303,'cleared → full list back');assert.equal(sel.querySelectorAll('optgroup').length,2,'groups kept');
 // Enter picks the first match
 type('تجريبية 25');q.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter'}));assert.equal(sel.value,'s25');
 // small lists and the booking form are left alone
 const f2=d.createElement('form');f2.innerHTML='<select name="service_id"><option value="a">a</option><option value="b">b</option></select>';d.body.appendChild(f2);
 const f3=d.createElement('form');f3.innerHTML='<input id="rx-svc-q"><select name="service_id">'+svc.map(opt).join('')+'</select>';d.body.appendChild(f3);await tick();
 assert(!f2.querySelector('[data-sss-q]'),'short list untouched');assert(!f3.querySelector('[data-sss-q]'),'booking combobox untouched');
 // options filled after the modal opens (lazy catalog) are picked up too
 const f4=d.createElement('form');f4.innerHTML='<select name="service_id"></select>';d.body.appendChild(f4);await tick();
 f4.elements.service_id.innerHTML=svc.map(opt).join('');await tick();assert(f4.querySelector('[data-sss-q]'),'filled later → enhanced');
 console.log('PASS service select search: search box on the request-service list, name / code / department / Arabic variants, one match chosen, Enter, groups kept, form value, short lists + booking combobox untouched, late-filled lists');
 process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
