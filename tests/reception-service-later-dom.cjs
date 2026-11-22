// Owner 2026-11-22: «الخدمة تتحدد عند الحضور» — switch in «حجز موعد» selects the department placeholder (doctor list / times
// keep working), turns discount / extras off, payload service_later:true; reschedule of such a booking starts checked;
// «تسجيل حضور» requires the real service of the doctor's department; card tag; placeholders out of service lists.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
const dom=new JSDOM('<form><label>القسم<select data-rx-dept><option value=""></option><option value="الليزر">الليزر</option><option value="جلدية">جلدية</option></select></label><div class="rx-combo-field"><select name="service_id" required><option value="">اختر</option><option value="s1">جلسة</option></select></div><select name="provider_id"><option value=""></option><option value="d1">د. ليزر</option></select><section data-rbd><input type="checkbox" data-rbd-on></section><div data-rx-extras><div data-rx-extra></div></div></form>',{runScripts:'outside-only'}),w=dom.window,d=w.document;
w.eval(fs.readFileSync('assets/js/reception-service-later.js','utf8'));
const data={services:[{id:'s1',name:'جلسة ليزر',department:'الليزر',price:500,code:'L1'},{id:'s2',name:'كشف جلدية',department:'جلدية',price:300,code:'D1'},{id:'s3',name:'تحليل',department:'التحاليل',price:50,code:'T1'}],
 providers:[{id:'d1',name:'د. ليزر',department:'الليزر'}],provider_departments:{},provider_service_scopes:{d1:['D1']},
 service_later:[{id:'ph-laser',code:'LATER-x',department:'الليزر',minutes:30}]};
const form=d.querySelector('form'),sel=form.elements.service_id,dept=form.querySelector('[data-rx-dept]'),fire=(el,t)=>el.dispatchEvent(new w.Event(t||'change',{bubbles:true}));
let changes=0;sel.addEventListener('change',()=>changes++);
w.SSMPDServiceLater.enhance(form,{data});
const cb=form.querySelector('[data-sl-on]');assert(cb,'switch shown');assert.equal(form.querySelector('.rx-sl-sw b').textContent,'الخدمة تتحدد عند الحضور');
const fd=()=>{const o={};new w.FormData(form).forEach((v,k)=>o[k]=v);return o;};
assert(!('service_later' in fd()),'off → nothing sent');
cb.checked=true;fire(cb);assert.match(form.querySelector('[data-sl-note]').textContent,/اختار القسم/);
dept.value='الليزر';fire(dept);
assert.equal(sel.value,'ph-laser','department placeholder selected');assert(changes>0,'doctor list / times refreshed');
assert.equal(form.querySelector('.rx-combo-field').hidden,true);assert.equal(form.querySelector('[data-rbd]').hidden,true);assert.equal(form.querySelectorAll('[data-rx-extra]').length,0,'extras removed');
assert(data.services.some(s=>s.id==='ph-laser'&&s.minutes===30),'placeholder usable for times (30 min)');
let p=w.SSMPDServiceLater.take({...fd(),discount_kind:'special'});assert.equal(p.service_later,true);assert.equal(p.service_id,'ph-laser');assert(!('discount_kind' in p));
// a department without a placeholder yet → server creates it; the fake id is not sent
dept.value='جلدية';fire(dept);assert.match(sel.value,/^__later__:/);p=w.SSMPDServiceLater.take(fd());assert(!('service_id' in p));assert.equal(p.service_later,true);
cb.checked=false;fire(cb);assert.equal(sel.value,'');assert(!data.services.some(s=>s._sl),'placeholder removed from the list');assert.equal(form.querySelector('[data-rbd]').hidden,false);
p=w.SSMPDServiceLater.take(fd());assert(!('service_later' in p));
// reschedule of a later booking starts checked (department from its doctor)
const f2=d.createElement('form');f2.innerHTML='<select data-rx-dept><option value=""></option></select><label><select name="service_id"></select></label><select name="provider_id"><option value="d1" selected>د. ليزر</option></select>';d.body.appendChild(f2);
w.SSMPDServiceLater.enhance(f2,{data,appointment:{id:'a1',service_later:true,provider_id:'d1'}});assert.equal(f2.querySelector('[data-sl-on]').checked,true);assert.equal(f2.elements.service_id.value,'ph-laser');
w.SSMPDServiceLater.purge(data);
// arrival: required service of the doctor's department or scope
const m=d.createElement('div');m.innerHTML='<form><p>بدء زيارة</p><label>نوع الزيارة<select name="encounter_type"><option value="session">جلسة</option></select></label><button type="submit">سجّل</button></form>';d.body.appendChild(m);
w.SSMPDServiceLater.arrival(m,{id:'a1',service_later:true,provider_id:'d1'},{data});
const as=m.querySelector('select[name=service_id]');assert(as&&as.required);const vals=[...as.options].map(o=>o.value);
assert.deepEqual(vals.sort(),['','s1','s2'].sort(),'department + scoped services, not other departments');
assert.equal(m.querySelector('[type=submit]').disabled,true,'blocked until chosen');as.value='s1';fire(as);assert.equal(m.querySelector('[type=submit]').disabled,false);
const m2=d.createElement('div');m2.innerHTML='<form><button type="submit">x</button></form>';w.SSMPDServiceLater.arrival(m2,{id:'a2',service_later:false},{data});assert(!m2.querySelector('select'),'normal booking unchanged');
assert.match(w.SSMPDServiceLater.tag({service_later:true}),/rx-later-tag">الخدمة تتحدد عند الحضور/);assert.equal(w.SSMPDServiceLater.tag({}),'');
const src=fs.readFileSync('assets/js/reception-workspace.js','utf8');
for(const re of [/SSMPDServiceLater\.enhance\(form,\{data:data,appointment:appointment\}\)/,/SSMPDServiceLater\.take\(payload\)/,/SSMPDServiceLater\.arrival\(arRoot/,/SSMPDServiceLater\.tag\(a\)/,/s\._sl\|\|s\.placeholder\?false/])assert(re.test(src),'hooked: '+re);
const html=fs.readFileSync('index.html','utf8');assert(/reception-service-later\.js\?v=/.test(html)&&/reception-service-later\.css\?v=/.test(html));
assert(html.indexOf('reception-service-later.js')<html.indexOf('reception-workspace.js'),'loaded before the workspace');
w.close();console.log('PASS service later UI: switch → department placeholder, discount/extras off, payload, reschedule pre-checked, arrival requires a department service, card tag');
