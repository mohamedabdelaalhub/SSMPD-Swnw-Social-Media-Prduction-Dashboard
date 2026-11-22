// Owner 2026-11-22: «حجز بميعاد يدوي (متفق عليه مع الدكتور)» — switch in step «امتى؟», highlighted when there is no free
// time; on → uses the existing «وقت تاني» box (starts_at='__custom__'), reason chips, «أخرى» needs a note; off → nothing sent.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
const dom=new JSDOM('<form><label>الوقت المتاح<select name="starts_at"><option value="">لا توجد مواعيد متاحة في هذا اليوم</option></select></label><label data-rx-custom-time hidden>الوقت<input name="custom_time" type="time"></label></form>',{runScripts:'outside-only'}),w=dom.window,d=w.document;
w.eval(fs.readFileSync('assets/js/reception-manual-time.js','utf8'));
const form=d.querySelector('form'),sel=form.elements.starts_at,fire=(el,t)=>el.dispatchEvent(new w.Event(t||'change',{bubbles:true}));
let changes=0;sel.addEventListener('change',()=>changes++);
w.SSMPDManualTime.enhance(form,{});
const box=form.querySelector('[data-mt]'),cb=box.querySelector('[data-mt-on]');
const fd=()=>{const o={};new w.FormData(form).forEach((v,k)=>o[k]=v);return o;};
assert(box.classList.contains('is-suggest'),'highlighted when no free time');assert(!('manual_time' in fd())&&!('manual_reason_kind' in fd()),'off → nothing sent');
assert(box.previousElementSibling.hasAttribute('data-rx-custom-time'),'placed after the time box');
cb.checked=true;fire(cb);
assert.equal(sel.value,'__custom__');assert(changes>0,'custom time box opened');assert.equal(sel.closest('label').hidden,true);
let v=fd();assert.equal(v.manual_time,'true');assert.equal(v.manual_reason_kind,'doctor_agreement');assert('manual_reason' in v);
const other=box.querySelector('input[value="other"]');other.checked=true;fire(other);assert.equal(form.elements.manual_reason.required,true,'أخرى needs a note');
// times redrawn (doctor / day changed) while on → still custom
sel.innerHTML='<option value="">اختر</option><option value="2026-11-22T08:00:00.000Z">10:00</option>';await0();
function await0(){}
setTimeout(()=>{assert.equal(sel.value,'__custom__','kept after redraw');assert.equal(box.classList.contains('is-suggest'),false);
 cb.checked=false;fire(cb);assert.equal(sel.value,'');assert(!sel.querySelector('option[data-mt]'),'own option removed');assert(!('manual_time' in fd()));assert.equal(sel.closest('label').hidden,false);
 // reschedule of a manual booking starts on
 const f2=d.createElement('form');f2.innerHTML='<label><select name="starts_at"><option value="x">10:00</option></select></label>';d.body.appendChild(f2);
 w.SSMPDManualTime.enhance(f2,{appointment:{manual_time:true}});assert.equal(f2.querySelector('[data-mt-on]').checked,true);assert.equal(f2.elements.starts_at.value,'__custom__');
 assert.match(w.SSMPDManualTime.tag({manual_time:true,manual_reason:'اتفاق مع الدكتور'}),/rx-manual-tag.*ميعاد يدوي/);assert.equal(w.SSMPDManualTime.tag({}),'');
 const src=fs.readFileSync('assets/js/reception-workspace.js','utf8');assert(/SSMPDManualTime\.enhance\(form,\{appointment:appointment\}\)/.test(src)&&/SSMPDManualTime\.tag\(a\)/.test(src),'hooked');
 const html=fs.readFileSync('index.html','utf8');assert(/reception-manual-time\.js\?v=/.test(html)&&/reception-manual-time\.css\?v=/.test(html)&&html.indexOf('reception-manual-time.js')<html.indexOf('reception-workspace.js'));
 w.close();console.log('PASS manual time UI: switch, highlight when no time, custom box reused, reasons, kept on redraw, off sends nothing, reschedule, card tag');},10);
