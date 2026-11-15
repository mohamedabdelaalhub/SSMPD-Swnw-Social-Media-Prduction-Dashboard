// Reception panel: mounts in the reception workspace for reception roles, lists pending requests,
// confirm calls staff_confirm only after the confirm dialog.
const {JSDOM}=require('jsdom'),fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const dom=new JSDOM('<div class="rx-shell"><div class="rx-header">h</div></div>',{runScripts:'outside-only'}),w=dom.window,calls=[];
let role='reception',confirmAnswer=false;
w.confirm=()=>confirmAnswer;w.alert=()=>{};w.prompt=()=>'مش متاح';
w.SSMPDAuth={currentAdmin:{id:'a'}};w.SSMPDRoles={hasAnyRole:(a,rs)=>rs.includes(role)};
const reqs=[{id:'r1',status:'pending',requested_date:'2099-01-05',requested_time:'10:00',doctor_name:'X',specialty_name:'Y',patients:{full_name:'مريض تجريبي',patient_code:'T1'}},
            {id:'r2',status:'confirmed',official_booking_id:'777',requested_date:'2099-01-04',requested_time:'09:00',patients:{full_name:'Z'}}];
w.SSMPDDb={client:{functions:{invoke:(n,o)=>{calls.push(o.body.op+':'+(o.body.request_id||''));return Promise.resolve({data:o.body.op==='staff_list'?{requests:reqs}:{ok:true}});}}}};
w.eval(fs.readFileSync(path.join(__dirname,'../assets/js/portal-booking-requests.js'),'utf8'));
const tick=()=>new Promise(r=>setTimeout(r,30));
(async()=>{
  await tick();await tick();
  const box=w.document.getElementById('portal-booking-requests-rx');assert.ok(box,'mounted under the reception header');
  assert.equal(box.previousElementSibling.className,'rx-header');
  assert.equal(box.querySelectorAll('[data-ppbr-confirm]').length,1,'only pending rows get actions');
  assert.match(box.textContent,/1 محتاج تأكيد/);
  box.querySelector('[data-ppbr-confirm]').click();await tick();
  assert.ok(!calls.includes('staff_confirm:r1'),'nothing happens without confirming the dialog');
  confirmAnswer=true;box.querySelector('[data-ppbr-confirm]').click();await tick();
  assert.ok(calls.includes('staff_confirm:r1'));
  await tick();w.document.getElementById('portal-booking-requests-rx').querySelector('[data-ppbr-cancel]').click();await tick();
  assert.ok(calls.includes('staff_cancel:r1'));
  // other roles: not mounted
  const d2=new JSDOM('<div class="rx-shell"><div class="rx-header">h</div></div>',{runScripts:'outside-only'}).window;
  d2.SSMPDAuth={currentAdmin:{id:'b'}};d2.SSMPDRoles={hasAnyRole:()=>false};d2.SSMPDDb=w.SSMPDDb;
  d2.eval(fs.readFileSync(path.join(__dirname,'../assets/js/portal-booking-requests.js'),'utf8'));await tick();
  assert.equal(d2.document.getElementById('portal-booking-requests-rx'),null,'nursing etc. do not see it');
  console.log('portal booking requests UI: OK');
})().catch(e=>{console.error(e);process.exit(1);});
