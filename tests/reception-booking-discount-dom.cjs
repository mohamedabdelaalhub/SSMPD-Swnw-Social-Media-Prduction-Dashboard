// Owner 2026-11-21: «خصم على الحجز ده» in «حجز موعد» — off by default (nothing sent), نقابة/نادي/أخرى fields required,
// «خصم خاص» needs a reason, price preview, 30% maximum, hidden for package bookings, card photo uploaded first.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
const dom=new JSDOM('<form><div class="rx-combo-field"></div><select name="service_id"><option value="s1" selected>كشف</option></select><input name="day" value="2026-11-22"><select name="package_id"><option value="" selected></option><option value="p1">باكج</option></select></form>',{runScripts:'outside-only'}),w=dom.window,d=w.document;
let uploaded=null;w.SSMPDDb={client:{auth:{getUser:()=>Promise.resolve({data:{user:{id:'u1'}}})},storage:{from:b=>({upload:(p,f)=>{uploaded=[b,p];return Promise.resolve({data:{}});}})}}};
w.eval(fs.readFileSync('assets/js/reception-booking-discount.js','utf8'));
const form=d.querySelector('form');w.SSMPDReceptionBookingDiscount.enhance(form,{data:{services:[{id:'s1',price:400}]},workspace:'ws1'});
const fd=()=>{const o={};new w.FormData(form).forEach((v,k)=>o[k]=v);return o;};
const on=form.querySelector('[data-rbd-on]'),fire=(el,t)=>el.dispatchEvent(new w.Event(t||'change',{bubbles:true}));
assert.equal(on.checked,false);assert.equal(Object.keys(fd()).filter(k=>k.startsWith('discount_')).length,0,'off → nothing sent');
on.checked=true;fire(on);
let v=fd();assert.equal(v.discount_kind,'syndicate');assert.equal(v.discount_org_type,'syndicate');assert('discount_card_no' in v&&'discount_card_expiry' in v&&'discount_card_path' in v);assert(!('discount_reason' in v),'reason only for خاص');
assert.equal(form.elements.discount_card_no.required,true);assert.equal(form.elements.discount_org_name.required,true);assert.equal(form.elements.discount_card_expiry.min,'2026-11-22','card valid at least until the visit day');
form.querySelector('input[name="discount_org_type"][value="club"]').checked=true;fire(form.querySelector('input[name="discount_org_type"][value="club"]'));
assert.equal(form.querySelector('[data-rbd-orgl]').textContent,'اسم النادي');
form.elements.discount_org_name.value='نادي الصيد';form.elements.discount_percent.value='10';fire(form.elements.discount_percent,'input');
const sum=form.querySelector('[data-rbd-sum]');assert.equal(sum.hidden,false);assert.match(sum.textContent,/360/);assert.match(sum.textContent,/نادي الصيد/);
assert.equal(form.querySelector('[data-rbd-warn]').hidden,true);
form.elements.discount_percent.value='40';fire(form.elements.discount_percent,'input');assert.equal(form.querySelector('[data-rbd-warn]').hidden,false,'> 30% → max warning');assert.match(form.querySelector('[data-rbd-warn]').textContent,/أقصى خصم/);assert.equal(form.elements.discount_percent.max,'30');
// special
const sp=form.querySelector('input[name="discount_kind"][value="special"]');sp.checked=true;fire(sp);v=fd();
assert(!('discount_card_no' in v),'card fields not sent for خاص');assert('discount_reason' in v);assert.equal(form.elements.discount_reason.required,true);
// card photo → uploaded to the private bucket under <uid>/<workspace>/
(async()=>{const syn=form.querySelector('input[name="discount_kind"][value="syndicate"]');syn.checked=true;fire(syn);
 const file=form.querySelector('[data-rbd-file]');Object.defineProperty(file,'files',{value:[{name:'card.JPG',size:1000,type:'image/jpeg'}]});fire(file);
 await new Promise(r=>setTimeout(r,20));assert.equal(uploaded[0],'booking-discount-cards');assert.match(uploaded[1],/^u1\/ws1\/[^/]+\.jpg$/);assert.equal(form.elements.discount_card_path.value,uploaded[1]);
 // off again → nothing sent; package → hidden and off
 on.checked=false;fire(on);assert.equal(Object.keys(fd()).filter(k=>k.startsWith('discount_')).length,0);
 on.checked=true;fire(on);form.elements.package_id.value='p1';fire(form.elements.package_id);assert.equal(form.querySelector('[data-rbd]').hidden,true);assert.equal(on.checked,false);
 assert.equal(Object.keys(fd()).filter(k=>k.startsWith('discount_')).length,0,'package → no discount');
 const src=fs.readFileSync('assets/js/reception-workspace.js','utf8');assert(src.includes('if(window.SSMPDReceptionBookingDiscount&&!(appointment&&appointment.package_id))window.SSMPDReceptionBookingDiscount.enhance(form,{data:data,workspace:workspace,appointment:appointment});'),'hooked for new bookings and for «تعديل الحجز» (owner 2026-11-23), not for package bookings');
 assert(/rx-disc-tag/.test(src),'badge on the timeline');
 console.log('PASS booking discount UI');})().catch(e=>{console.error(e);process.exit(1);});
