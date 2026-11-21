// Owner 2026-11-21 «طبقه» (mockup proof-photo.html): receipt photo by camera («صوّر الإيصال»), picker, Ctrl+V paste or
// drag & drop; thumbnail «✓ الصورة جاهزة» + «تغيير»; the named file input still carries the file; hidden for cash.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
const dom=new JSDOM('<form><select name="method"><option value="cash">نقدي</option><option value="pos">فيزا</option></select></form>',{runScripts:'outside-only'}),w=dom.window,d=w.document;
w.eval(fs.readFileSync('assets/js/payment-proof.js','utf8'));const P=w.SSMPDPaymentProof,form=d.querySelector('form');
form.insertAdjacentHTML('beforeend',P.field());assert.ok(d.getElementById('pp-css'),'styles injected once');
const input=form.elements.proof_file,cam=form.querySelector('[data-pp-cam]'),box=form.querySelector('[data-pay-proof="proof_file"]');
assert.equal(cam.getAttribute('capture'),'environment');assert.equal(cam.getAttribute('accept'),'image/*');assert.equal(cam.name,'','camera input not submitted itself');
// make jsdom accept programmatic file lists
let store=[];Object.defineProperty(input,'files',{get:()=>store,set:v=>{store=v;},configurable:true});Object.defineProperty(input,'value',{get:()=>store.length?'C:\\fakepath\\x':'',set:v=>{if(v==='')store=[];},configurable:true});
w.DataTransfer=function(){const list=[];this.items={add:f=>list.push(f)};this.files=list;};
w.URL.createObjectURL=()=>'blob:x';w.URL.revokeObjectURL=()=>{};
P.bind(form);assert.equal(box.hidden,true,'cash → hidden');assert.equal(input.required,false);
form.elements.method.value='pos';form.elements.method.dispatchEvent(new w.Event('change'));assert.equal(box.hidden,false);assert.equal(input.required,true);
let clicked=[];input.click=()=>clicked.push('pick');cam.click=()=>clicked.push('cam');
form.querySelector('[data-pp-take]').click();form.querySelector('[data-pp-pick]').click();assert.deepEqual(clicked,['cam','pick']);
const F=(name,type,size)=>{const f=new w.File(['x'],name,{type});Object.defineProperty(f,'size',{value:size||2048});return f;};
// paste a screenshot
const ev=new w.Event('paste',{bubbles:true,cancelable:true});ev.clipboardData={items:[{kind:'file',getAsFile:()=>F('','image/png')}]};form.dispatchEvent(ev);
assert.equal(store.length,1);assert.equal(store[0].name,'screenshot.png','unnamed clipboard image gets a name');assert.equal(ev.defaultPrevented,true);
const done=form.querySelector('[data-pp-done]');assert.equal(done.hidden,false);assert.match(done.textContent,/الصورة جاهزة/);assert.ok(done.querySelector('img'));assert.equal(form.querySelector('[data-pp-drop]').hidden,true);
// «تغيير» clears and reopens the picker
done.querySelector('[data-pp-change]').click();assert.equal(form.querySelector('[data-pp-drop]').hidden,false);assert.equal(clicked.pop(),'pick');
// drop a PDF; refuse a wrong type and a too-big file
const drop=form.querySelector('[data-pp-drop]'),dr=t=>{const e=new w.Event('drop',{bubbles:true,cancelable:true});e.dataTransfer={files:[t]};drop.dispatchEvent(e);};
dr(F('slip.pdf','application/pdf'));assert.equal(store[0].name,'slip.pdf');assert.match(done.textContent,/PDF/);
dr(F('a.heic','image/heic'));assert.match(form.querySelector('[data-pp-err]').textContent,/JPG/);assert.equal(store[0].name,'slip.pdf','wrong type ignored');
dr(F('big.jpg','image/jpeg',11*1024*1024));assert.match(form.querySelector('[data-pp-err]').textContent,/١٠ ميجا/);
// camera picture → goes into the named input
Object.defineProperty(cam,'files',{value:[F('cam.jpg','image/jpeg')],configurable:true});cam.dispatchEvent(new w.Event('change'));assert.equal(store[0].name,'cam.jpg');
// paste ignored while cash
form.elements.method.value='cash';form.elements.method.dispatchEvent(new w.Event('change'));const e2=new w.Event('paste',{bubbles:true,cancelable:true});e2.clipboardData={items:[{kind:'file',getAsFile:()=>F('p.png','image/png')}]};form.dispatchEvent(e2);assert.equal(e2.defaultPrevented,false);
console.log('PASS receipt photo: camera, picker, paste, drop, preview, change, type/size checks, hidden for cash');
