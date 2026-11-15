// Dashboard control: one select per record, shows stored status, writes via RPC, reverts on refusal.
const {JSDOM}=require('jsdom'),fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const V='11111111-1111-4111-8111-111111111111',R='22222222-2222-4222-8222-222222222222',F='33333333-3333-4333-8333-333333333333';
const dom=new JSDOM(`<div id="row1"><button data-edit-visit="${V}">تعديل</button><button data-view-visit="${V}">عرض</button></div>
<div id="row2"><button data-print-medical-report="${R}">طباعة</button></div><div id="row3"><button data-del-file="${F}">حذف</button></div>`,{runScripts:'outside-only'});
const w=dom.window,calls=[];let refuse=false,alerts=[];
w.alert=m=>alerts.push(m);
w.requestAnimationFrame=f=>setTimeout(f,0);
w.SSMPDDb={client:{
  from:()=>({select:()=>({in:(k,ids)=>Promise.resolve({data:[{entity_type:'medical_report',entity_id:R,portal_status:'hidden'}].filter(r=>ids.includes(r.entity_id))})})}),
  rpc:(n,a)=>{calls.push([n,a]);return Promise.resolve(refuse?{error:{message:'NOT_ALLOWED'}}:{data:{},error:null});}
}};
w.eval(fs.readFileSync(path.join(__dirname,'../assets/js/portal-visibility-controls.js'),'utf8'));
const tick=()=>new Promise(r=>setTimeout(r,20));
(async()=>{
  await tick();
  const q=s=>w.document.querySelectorAll(s);
  assert.equal(q(`#row1 [data-portal-vis="visit:${V}"]`).length,1,'one control per record even with two buttons');
  assert.equal(q('[data-portal-vis]').length,3);
  assert.equal(w.document.querySelector(`[data-portal-vis="medical_report:${R}"]`).value,'hidden','stored status shown');
  const sel=w.document.querySelector(`[data-portal-vis="visit:${V}"]`);
  assert.equal(sel.value,'auto','default is automatic after 24h');
  sel.value='approved';sel.dispatchEvent(new w.Event('change'));await tick();
  assert.equal(JSON.stringify(calls[0]),JSON.stringify(['set_patient_portal_visibility',{p_entity_type:'visit',p_entity_id:V,p_status:'approved'}]));
  assert.equal(sel.getAttribute('data-current'),'approved');
  refuse=true;sel.value='hidden';sel.dispatchEvent(new w.Event('change'));await tick();
  assert.equal(sel.value,'approved','refused change reverts');assert.match(alerts[0],/مش مسموح/);
  // re-render adds controls for new rows only
  w.document.body.insertAdjacentHTML('beforeend',`<div id="row4"><button data-print-prescription="${R}">طباعة</button></div>`);await tick();await tick();
  assert.equal(q('[data-portal-vis]').length,4);
  console.log('portal visibility controls UI: OK');
})().catch(e=>{console.error(e);process.exit(1);});
