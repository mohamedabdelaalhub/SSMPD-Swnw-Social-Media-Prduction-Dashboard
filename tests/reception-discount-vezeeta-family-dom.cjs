// Owner 2026-11-22: «فيزيتا شامل» (fixed 40%, card fields relabelled, org fields off) and «كارت العيلة» (percent from the
// family RPC, steps, members, link a relative with relation + proof) in «خصم على الحجز ده».
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
const dom=new JSDOM('<form><select name="patient_id"><option value="p1" selected>مريض</option></select><div class="rx-combo-field"></div><select name="service_id"><option value="s1" selected>كشف</option></select><input name="day" value="2026-11-22"></form>',{runScripts:'outside-only'}),w=dom.window,d=w.document;
const calls=[];let famData={used:2,next_percent:30,visit_no:3,linked:false,members:[{patient_id:'p3',name:'قريب بنفس الرقم',via:'phone'}],visits:[{day:'2026-11-01',name:'مريض',percent:10},{day:'2026-11-10',name:'قريب بنفس الرقم',percent:20}]};
w.SSMPDDb={client:{auth:{getUser:()=>Promise.resolve({data:{user:{id:'u1'}}})},storage:{from:()=>({upload:()=>Promise.resolve({data:{}})})},
 rpc:(n,a)=>{calls.push([n,a]);if(a.p_action==='link'){famData={...famData,linked:true,members:famData.members.concat([{patient_id:'p2',name:'زوجة',via:'link',relation:'spouse'}])};return Promise.resolve({data:{id:'L1'}});}return Promise.resolve({data:famData});}}};
w.eval(fs.readFileSync('assets/js/reception-booking-discount.js','utf8'));
const form=d.querySelector('form');w.SSMPDReceptionBookingDiscount.enhance(form,{data:{services:[{id:'s1',price:600}],patients:[{id:'p1',name:'مريض'},{id:'p2',name:'زوجة',file_no:'F2'}]},workspace:'ws1'});
const fire=(el,t)=>el.dispatchEvent(new w.Event(t||'change',{bubbles:true})),fd=()=>{const o={};new w.FormData(form).forEach((v,k)=>o[k]=v);return o;},tick=()=>new Promise(r=>setTimeout(r,20));
const on=form.querySelector('[data-rbd-on]');on.checked=true;fire(on);
(async()=>{const vz=form.querySelector('input[name="discount_kind"][value="vezeeta"]');vz.checked=true;fire(vz);
 let v=fd();assert.equal(v.discount_kind,'vezeeta');assert.equal(v.discount_percent,'40');assert.equal(form.elements.discount_percent.readOnly,true);
 assert(!('discount_org_name' in v)&&!('discount_org_type' in v),'org fields off for Vezeeta');assert('discount_card_no' in v&&'discount_card_expiry' in v&&'discount_card_path' in v);
 assert.equal(form.querySelector('[data-rbd-cardl]').textContent,'رقم كارت فيزيتا شامل');assert.match(form.querySelector('[data-rbd-sum]').textContent,/360/);
 const fm=form.querySelector('input[name="discount_kind"][value="family"]');fm.checked=true;fire(fm);await tick();
 assert.deepEqual(JSON.parse(JSON.stringify(calls[0])),['clinic_reception_family',{p_workspace:'ws1',p_action:'list',p_payload:{patient_id:'p1'}}]);
 v=fd();assert.equal(v.discount_kind,'family');assert.equal(v.discount_percent,'30','percent from the family RPC');assert(!('discount_card_no' in v),'no card fields');
 const fam=form.querySelector('[data-rbd-fam]');assert.equal(fam.hidden,false);assert.equal(fam.querySelector('.rbd-st.now').textContent,'30٪');assert.equal(fam.querySelectorAll('.rbd-st.done').length,2);
 assert.match(fam.textContent,/نفس رقم التليفون/);assert.match(form.querySelector('[data-rbd-sum]').textContent,/420/);
 // link a relative: needs a proof first
 fam.querySelector('[data-rbd-link]').click();const lb=fam.querySelector('[data-rbd-linkbox]');lb.querySelector('[data-rbd-rel-p]').value='p2';
 lb.querySelector('[data-rbd-rel-go]').click();assert.match(lb.querySelector('[data-rbd-rel-up]').textContent,/مستند/);assert(!calls.some(c=>c[1].p_action==='link'));
 const f=lb.querySelector('[data-rbd-rel-f]');Object.defineProperty(f,'files',{value:[{name:'proof.jpg',size:1000,type:'image/jpeg'}]});fire(f);await tick();
 lb.querySelector('[data-rbd-rel-go]').click();await tick();await tick();
 const link=calls.find(c=>c[1].p_action==='link');assert(link);assert.equal(link[1].p_payload.relative_id,'p2');assert.equal(link[1].p_payload.relation,'spouse');assert.match(link[1].p_payload.proof_path,/^u1\/ws1\//);
 assert.match(form.querySelector('[data-rbd-fam]').textContent,/زوج \/ زوجة — مستند ✓/);assert.match(form.querySelector('[data-rbd-fam]').textContent,/مربوط بالعيلة/);
 const sp=form.querySelector('input[name="discount_kind"][value="special"]');sp.checked=true;fire(sp);assert.equal(form.elements.discount_percent.readOnly,false);assert.equal(form.elements.discount_percent.max,'30');
 const src=fs.readFileSync('assets/js/reception-workspace.js','utf8');assert(/discount_kind==='vezeeta'\?' · فيزيتا شامل'/.test(src)&&/' · كارت العيلة'/.test(src),'card tag');
 w.close();console.log('PASS discount Vezeeta / family UI: Vezeeta fixed 40% + card fields, family percent + steps + members, link relative with proof, card tag');})().catch(e=>{console.error(e);process.exit(1);});
