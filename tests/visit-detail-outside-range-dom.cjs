// Owner bug 2026-11-27 (via main chat 7, P-2026-001986): «إنهاء الزيارة» / «تفاصيل الزيارة» on a visit that is NOT in the loaded reception
// snapshot (opened on an earlier day, a package visit) crashed with «Cannot read properties of undefined (reading 'visit_no')».
// Proves on the REAL reception-services.js (+ the real shared modal of reception-workspace.js): the OLD code throws exactly that;
// the fixed code fetches the visit from the server (snapshot, 90 days back) into a COPY of the data and opens «تفاصيل الزيارة»
// (✕ closes it; the loaded data is not changed); a visit the server does not return shows a clear Arabic message, no crash.
const {JSDOM}=require('jsdom'),fs=require('node:fs'),assert=require('node:assert/strict'),{execSync}=require('node:child_process');
const WS=fs.readFileSync('assets/js/reception-workspace.js','utf8').split('\n');const i=WS.findIndex(l=>l.startsWith('function modal(title,body,save,onSaved,opts)'));
assert(i>=0,'shared modal moved');const MODAL=WS.slice(i,i+3).join('\n');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function boot(src,snapAnswer){
 const dom=new JSDOM('<main id="host"></main>',{url:'https://rx.test/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,toasts=[],calls=[];
 w.SSMPDToast={show:(m,k)=>toasts.push([m,k])};w.alert=m=>toasts.push([m,'alert']);
 w.SSMPDDb={receptionSnapshot:async(ws,from,to)=>{calls.push([ws,from,to]);return snapAnswer;}};
 w.eval(src);
 w.eval('var esc=function(v){return String(v==null?"":v).replace(/[&<>"\']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","\'":"&#39;"}[c];});};var friendly=function(e){return e;};var host=null;var load=function(){};'+MODAL+';window.__modal=modal;');
 const data={workspace:{id:'ws1',mode:'live'},visits:[{id:'v-today',visit_no:12,patient_id:'p1',status:'open'}],orders:[],invoices:[],patients:[{id:'p1',name:'مريض النهارده',file_no:'P-1'}],appointments:[],payments:[],allocations:[],packages:[],providers:[],services:[]};
 const e=v=>String(v==null?'':v);
 const c={data,workspace:'ws1',esc:e,money:n=>String(n),btn:(a,id,t)=>'<button type="button" data-rx-action="'+a+'" data-id="'+id+'">'+t+'</button>',field:()=>'',select:()=>'',modal:w.__modal,command:async()=>({}),load:()=>{},
  lookup:(t,id,f)=>{const r=(data[t]||[]).find(x=>x.id===id);return r?(f?r[f]:r.name):'—';},stamp:x=>String(x)};
 return {w,c,data,toasts,calls};
}
(async()=>{
 const NOW=fs.readFileSync('assets/js/reception-services.js','utf8');
 // 1) the OLD code (main before the fix) reproduces the crash
 let OLD=null;try{OLD=execSync('git show origin/main:assets/js/reception-services.js',{encoding:'utf8',stdio:['ignore','pipe','ignore']});}catch(_){}
 if(OLD&&!OLD.includes('function visitOutside(')){const o=boot(OLD,{});
  assert.throws(()=>o.w.SSMPDReceptionModules.act('visit-detail','v-old',o.c),/Cannot read properties of undefined \(reading 'visit_no'\)/,'old code: the reported crash');}
 // 2) fixed: the visit is fetched from the server and its window opens
 const snap={visits:[{id:'v-old',visit_no:7,patient_id:'p2',status:'open',opened_at:'2026-11-26T09:00:00Z'}],orders:[{id:'o1',visit_id:'v-old',status:'ordered',price:1800,quantity:1,snapshot:{name:'جلسة ليزر إزالة الشعر كانديلا (1000 نبضة)'}}],patients:[{id:'p2',name:'منى تجريبي',file_no:'P-2'}]};
 let r=boot(NOW,snap);
 assert.doesNotThrow(()=>assert.equal(r.w.SSMPDReceptionModules.act('visit-detail','v-old',r.c),true));await sleep(30);
 assert.equal(r.calls.length,1,'one server read');assert.equal(r.calls[0][0],'ws1');assert.match(r.calls[0][1],/^\d{4}-\d{2}-\d{2}$/);
 const m=r.w.document.querySelector('.rx-modal');assert(m,'the visit window opened');assert.match(m.textContent,/زيارة 7/);assert.match(m.textContent,/كانديلا/);
 assert.equal(r.data.visits.length,1,'the loaded data is not changed (a copy is used)');
 m.querySelector('.modal-close').click();assert(!r.w.document.querySelector('.rx-modal'),'✕ closes');
 assert.deepEqual(r.toasts,[]);
 // 3) a visit that is loaded still opens directly (no server read)
 r=boot(NOW,snap);r.w.SSMPDReceptionModules.act('visit-detail','v-today',r.c);await sleep(10);assert.equal(r.calls.length,0);assert.match(r.w.document.querySelector('.rx-modal').textContent,/زيارة 12/);
 // 4) not found even on the server → a clear Arabic message, no crash, no window
 r=boot(NOW,{visits:[]});assert.doesNotThrow(()=>r.w.SSMPDReceptionModules.act('visit-detail','v-gone',r.c));await sleep(30);
 assert(!r.w.document.querySelector('.rx-modal'));assert.equal(r.toasts.length,1);assert.match(r.toasts[0][0],/مش لاقيينها في آخر 90 يوم/);assert.doesNotMatch(r.toasts[0][0],/visit_no|undefined/);
 // 5) «تنفيذ الكل» on such a visit goes through the same fetch (no silent nothing)
 r=boot(NOW,snap);r.w.SSMPDExecuteAll={open:(c,id)=>{r.opened=[id,c.data.visits.some(v=>v.id===id)];return true;}};
 r.w.SSMPDReceptionModules.act('execute_all','v-old',r.c);await sleep(30);assert.deepEqual(r.opened,['v-old',true],'execute-all gets the fetched visit');
 // 6) the workspace fallback never reads visit_no of undefined
 assert(/if\(!v\)\{alert\('الزيارة دي مش في الفترة اللي محمّلة/.test(fs.readFileSync('assets/js/reception-workspace.js','utf8')),'workspace fallback guarded');
 console.log('PASS visit outside the loaded range: old code crashed «reading visit_no»; now fetched from the server (copy, ✕ closes), loaded visits unchanged, missing → Arabic message, «تنفيذ الكل» too.');process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
