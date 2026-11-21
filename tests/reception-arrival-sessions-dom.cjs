// «تسجيل حضور المريض»: sessions / areas field — shown for «جلسة» (or a booking quantity > 1), stepper 1–99, summary price × n,
// fields disabled (not sent) for other visit types; wired into the arrival modal.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
const src=fs.readFileSync('assets/js/reception-workspace.js','utf8');
const fn=src.slice(src.indexOf('function arrivalSessions('),src.indexOf('\nfunction fillServices('));
const dom=new JSDOM('<body></body>',{runScripts:'outside-only'}),w=dom.window,d=w.document;
w.eval("function esc(v){return String(v==null?'':v).replace(/[&<>\"]/g,'');}function money(n){return Number(n).toLocaleString('en-US');}var data={appointments:[{id:'a1',service_id:'s1',quantity:1},{id:'a2',service_id:'s1',quantity:3,session_areas:'الظهر'}],services:[{id:'s1',name:'جلسة ليزر — منطقة',price:600}]};"+fn+";window.AS=arrivalSessions;");
function open(id){d.body.innerHTML='<div><form><label>نوع الزيارة<select name="encounter_type"><option value="checkup">كشف</option><option value="session">جلسة</option></select></label></form></div>';const r=d.body.firstChild;w.AS(r,id);return r.querySelector('form');}
const vals=f=>{const o={};new w.FormData(f).forEach((v,k)=>o[k]=v);return o;};
let f=open('a1');const box=f.querySelector('.rx-arrival-qty');
assert.equal(box.hidden,true,'hidden for «كشف»');assert.deepEqual(vals(f),{encounter_type:'checkup'},'nothing extra sent');
f.elements.encounter_type.value='session';f.elements.encounter_type.dispatchEvent(new w.Event('change'));
assert.equal(box.hidden,false);box.querySelector('[data-aq="1"]').click();
assert.equal(f.elements.quantity.value,'2');assert.match(box.querySelector('[data-aq-sum]').textContent,/× 2 = 1,200 ج/);
box.querySelector('[data-aq="-1"]').click();box.querySelector('[data-aq="-1"]').click();assert.equal(f.elements.quantity.value,'1','min 1');
f.elements.quantity.value='2';f.elements.session_areas.value='الوش + الإبط';
assert.deepEqual(vals(f),{encounter_type:'session',quantity:'2',session_areas:'الوش + الإبط'});
f=open('a2');assert.equal(f.elements.encounter_type.value,'session','booking quantity 3 → session');assert.equal(f.elements.quantity.value,'3');assert.equal(f.elements.session_areas.value,'الظهر');
assert(/var arRoot=modal\(/.test(src)&&/if\(action==='arrive'&&arRoot\)arrivalSessions\(arRoot,id\);/.test(src),'wired');
console.log('PASS arrival sessions / areas field');
