// «اسأل المساعد»: real staff-assistant.js, mocked rpc/functions. Covers per role (rule 9): button hidden when server refuses list_my_requests,
// panel ✕ + Esc, steps + «ودّيني هناك», redaction of phones, request card, shipped notification, owner screen only for super_admin with موافق/لأ/محتاج توضيح.
const {JSDOM}=require(require.resolve('jsdom',{paths:[process.env.SSMPD_TEST_MODULES||process.cwd()]})),fs=require('fs'),assert=require('node:assert/strict');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function mk(o){const d=new JSDOM('<body><div id="view-container"><h2>شغل اليوم</h2><button>صرف داخلي من مخزني</button></div><button data-tab="reception_services"></button></body>',{url:'https://x.test/',runScripts:'outside-only',pretendToBeVisual:true}),w=d.window,calls=[];
 w.SSMPDAuth={currentAdmin:{id:'u1',roles:o.roles}};w.SSMPDRoles={canSeeTab:(a,t)=>t!=='accounting'};w.SSMPDToast={show(){}};w.SSMPDUITitles={tabs:{reception_services:'الاستقبال'}};w.sessionStorage.setItem('ssmpd_active_tab','reception_services');
 const rows=o.rows||[];
 const rpc=async(n,a)=>{calls.push([n,a]);if(o.refuse)return{data:null,error:{message:'مش مسموح'}};
  if(n==='staff_assistant_my_requests')return{data:rows,error:null};
  if(n==='staff_assistant_request_create')return{data:{id:'r9',number:41,status:'new'},error:null};
  if(n==='staff_assistant_all_requests')return o.roles.includes('super_admin')?{data:{summary:{new_today:1,waiting:1,in_progress:0,shipped:0},requests:rows},error:null}:{data:null,error:{message:'للمالك بس'}};
  return{data:{ok:true},error:null};};
 w.SSMPDDb={client:{rpc,functions:{invoke:async(f,x)=>{calls.push([f,x.body]);return{data:{ok:true,steps:['دوس «صرف داخلي من مخزني»','اكتب الكمية'],help_article_id:'nursing-home',help_title:'شغل اليوم',open:{tab:'reception_services'},suggest_request:true},error:null};}}}};
 w.eval(fs.readFileSync('assets/js/staff-assistant.js','utf8'));return {w,calls};}
(async()=>{
 // refused → no button at all
 let {w}=mk({roles:['reception'],refuse:true});await sleep(50);await w.SSMPDStaffAssistant.mount();assert.equal(w.document.querySelector('[data-sa-fab]'),null,'button hidden when server refuses');
 // employee flow
 ({w,calls:c}=mk({roles:['reception'],rows:[{id:'r1',number:38,status:'shipped',unseen:true,text:'x',how_to:'دوس «فتحت عبوة جديدة»'}]}));var c;
 await w.SSMPDStaffAssistant.mount();const D=w.document,fab=D.querySelector('[data-sa-fab]');assert.ok(fab,'fab for employee');assert.ok(fab.classList.contains('sa-dot'),'shipped dot');assert.ok(c.some(x=>x[0]==='staff_assistant_request_seen'&&x[1].p_id==='r1'),'marks seen');
 fab.click();let p=D.querySelector('.sa-panel');assert.ok(p&&p.querySelector('[data-sa-close]'),'✕ present');assert.match(p.textContent,/اتعملت — دوس «فتحت عبوة جديدة»/);assert.equal(p.querySelector('[data-sa-owner]'),null,'no owner button for employee');
 p.querySelector('[data-sa-input]').value='إزاي أسجّل صرف؟ تليفون 01012345678';p.querySelector('[data-sa-send]').click();await sleep(30);
 assert.ok(c.some(x=>x[0]==='assistant-answer'),'asked fn');const ctxSent=JSON.stringify(c.find(x=>x[0]==='assistant-answer')[1]);assert.ok(!/01012345678/.test(ctxSent),'question+context redacted');
 assert.match(p.textContent,/ودّيني هناك/);assert.match(p.textContent,/مش بعدّل بيانات ومش بحرّك فلوس/);
 p.querySelector('[data-sa-newreq]').click();await sleep(30);const cr=c.find(x=>x[0]==='staff_assistant_request_create');assert.ok(cr&&!/01012345678/.test(JSON.stringify(cr[1])),'phone redacted in request');assert.match(p.textContent,/طلب رقم 41/);assert.match(p.textContent,/مستني المالك/);
 let opened=null;D.querySelector('[data-tab="reception_services"]').onclick=()=>{opened=1};p.querySelector('[data-sa-open]').click();assert.ok(opened,'ودّيني هناك opens screen');assert.equal(D.querySelector('.sa-panel'),null,'panel closed after go');
 fab.click();D.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape'}));assert.equal(D.querySelector('.sa-panel'),null,'Esc closes');
 // owner
 const rows=[{id:'o1',number:41,status:'new',text:'الكرومو',screen:'التمريض',proposal:'تعليم الصنف',impact:'التمريض',staff_name:'هدى'}];
 ({w,calls:c}=mk({roles:['super_admin'],rows}));await w.SSMPDStaffAssistant.mount();const E=w.document;E.querySelector('[data-sa-fab]').click();E.querySelector('[data-sa-owner]').click();await sleep(30);
 const op=E.querySelector('.sa-owner-pop');assert.ok(op.querySelector('[data-sa-oclose]')&&op.querySelector('[data-sa-oback]'),'✕ + back');
 assert.ok(op.querySelector('[data-sa-dec="approve"]'));for(const b of ['reject','need_info'])assert.ok(op.querySelector('[data-sa-ask="'+b+'"]'),b);
 op.querySelector('[data-sa-dec="approve"]').click();await sleep(30);assert.ok(c.some(x=>x[0]==='staff_assistant_decide'&&x[1].p_decision==='approve'&&x[1].p_id==='o1'));
 op.querySelector('[data-sa-ask="reject"]').click();op.querySelector('[data-sa-send-dec]').click();await sleep(10);assert.ok(!c.some(x=>x[0]==='staff_assistant_decide'&&x[1].p_decision==='reject'),'reject needs a note');
 op.querySelector('[data-sa-note]').value='مش مناسب';op.querySelector('[data-sa-send-dec]').click();await sleep(30);assert.ok(c.some(x=>x[0]==='staff_assistant_decide'&&x[1].p_decision==='reject'&&x[1].p_note==='مش مناسب'));
 op.querySelector('[data-sa-oback]').click();assert.equal(E.querySelector('.sa-owner-pop'),null);
 console.log('PASS staff-assistant dom');})().catch(e=>{console.error(e);process.exit(1);});
