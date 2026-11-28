// «يوم العمل» client side (owner 2026-11-27, 20261127340000): SSMPDBusinessDay.today()/of() with the 04:00 cutoff (and a changed one);
// «تشغيل اليوم» opens on the WORKING day after midnight; the reception workspace day(), fix-visit, «تحصيلاتي» (finance-shift-movements),
// role landing, nursing and the activity log all use it; «إعدادات تشغيل اليوم» shows «ساعة قفل اليوم» and — for super_admin — the
// button opens the REAL shared modal (✕ / تراجع), requires a reason and calls clinic_reception_business_day('set').
const {JSDOM}=require('jsdom'),fs=require('node:fs'),assert=require('node:assert/strict'),{webcrypto}=require('node:crypto');
const WS=fs.readFileSync('assets/js/reception-workspace.js','utf8').split('\n');const mi=WS.findIndex(l=>l.startsWith('function modal(title,body,save,onSaved,opts)'));const MODAL=WS.slice(mi,mi+3).join('\n');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function win(nowIso,role,answer){const dom=new JSDOM('<main id="host"></main>',{url:'https://b.test/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,calls=[],toasts=[];
 const T=Date.parse(nowIso);w.eval(`(function(){var R=Date,T=${T};function D(){if(this instanceof D){return arguments.length?new (Function.prototype.bind.apply(R,[null].concat([].slice.call(arguments))))():new R(T);}return new R(T).toString();}D.now=function(){return T;};D.parse=R.parse;D.UTC=R.UTC;D.prototype=R.prototype;window.Date=D;})();`);
 Object.defineProperty(w,'crypto',{value:webcrypto});w.SSMPDToast={show:(m,k)=>toasts.push([m,k])};
 w.SSMPDAuth={currentAdmin:{id:'u',role}};w.SSMPDRoles={rolesOf:()=>[role],hasRole:(a,r)=>r===role,hasAnyRole:(a,l)=>l.includes(role)};
 const model={day:null,settings:{max_wait_minutes:20},doctor_sessions:[],help_requests:[],events:[],outbox:[],appointments:[]};
 let cur='04:00';w.SSMPDDb={client:{rpc:async(n,a)=>{calls.push([n,a]);if(n==='clinic_reception_business_day'){if(a.p_action==='get')return {data:answer||{cutoff:cur,can_set:role==='super_admin',history:[]},error:null};cur=a.p_payload.cutoff;return {data:{cutoff:cur,changed:true},error:null};}
  if(/snapshot$/.test(n))return {data:Object.assign({},model,{day:a.p_day||a.p_date||null}),error:null};return {data:{},error:null};}}};
 w.SSMPDReceptionLook={_state:{}};w.SSMPDReceptionModules={sections:()=>[],panel:()=>'',act:()=>false,bookingFields:()=>'',bookingWire:()=>{}};
 w.eval(fs.readFileSync('assets/js/business-day.js','utf8'));
 return {w,calls,toasts};}
(async()=>{
 // 1) helper: 28/11 00:24 Cairo (= 27/11 22:24Z) is still the 27th; 04:00 Cairo is the 28th; a changed cutoff applies
 let r=win('2026-11-27T22:24:00Z','reception');const B=r.w.SSMPDBusinessDay;
 assert.equal(B.cutoff,'04:00');assert.equal(B.today(),'2026-11-27','00:24 Cairo → working day 27');
 assert.equal(B.of('2026-11-28T01:59:00Z'),'2026-11-27');assert.equal(B.of('2026-11-28T02:00:00Z'),'2026-11-28');assert.equal(B.of('2026-11-28T10:00:00Z'),'2026-11-28');
 B._set('00:00');assert.equal(B.today(),'2026-11-28','cutoff 00:00 = calendar day');B._set('04:00');
 await B.load();assert.equal(r.calls.filter(c=>c[0]==='clinic_reception_business_day').length>=1,true,'cutoff read from the server');
 // 2) every phase-1 screen asks the helper for «النهارده»
 for(const [f,pat] of [['today-operations.js',/if\(!value&&window\.SSMPDBusinessDay\)return window\.SSMPDBusinessDay\.today\(\);/],['reception-workspace.js',/function day\(v\)\{if\(!v&&window\.SSMPDBusinessDay\)return window\.SSMPDBusinessDay\.today\(\);/],
   ['fix-visit.js',/function cairoDay\(\)\{if\(window\.SSMPDBusinessDay\)return window\.SSMPDBusinessDay\.today\(\);/],['finance-shift-movements.js',/function cairoDay\(\)\{if\(window\.SSMPDBusinessDay\)return/],
   ['role-landing.js',/function cairoDay\(\)\{if\(window\.SSMPDBusinessDay\)return/],['nursing-day-ops.js',/function cairoDay\(\)\{if\(window\.SSMPDBusinessDay\)return/],['reception-activity-log.js',/if \(!dt && window\.SSMPDBusinessDay\) return window\.SSMPDBusinessDay\.today\(\);/]])
  assert.match(fs.readFileSync('assets/js/'+f,'utf8'),pat,f+' uses the working day');
 {const wf=r.w;wf.eval(fs.readFileSync('assets/js/finance-shift-movements.js','utf8'));}
 // 3) «تشغيل اليوم» after midnight opens on the 27th (journey snapshot asked for the 27th)
 r=win('2026-11-27T22:24:00Z','super_admin');let w=r.w;w.eval(fs.readFileSync('assets/js/today-operations.js','utf8'));
 w.eval('var esc=function(v){return String(v==null?"":v).replace(/[&<>"\']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","\'":"&#39;"}[c];});};var friendly=function(e){return e;};var host=null;var load=function(){};'+MODAL+';window.__modal=modal;');
 await w.SSMPDBusinessDay.load();
 const host=w.document.querySelector('#host'),ctx={host,workspace:'ws1',sandbox:false,data:{},modal:w.__modal,field:(n,l,t,v)=>'<label>'+l+'<input name="'+n+'" value="'+(v==null?'':v)+'"></label>',select:(n,l,o,v)=>'<label>'+l+'<select name="'+n+'">'+o.map(x=>'<option value="'+x[0]+'">'+x[1]+'</option>').join('')+'</select></label>'};
 host.innerHTML=w.SSMPDReceptionModules.panel('journey',ctx);for(let n=0;n<200&&!host.querySelector('.journey-board');n++)await sleep(10);
 const snapCall=r.calls.find(c=>/snapshot$/.test(c[0]));assert(snapCall,'board loaded');assert.equal(JSON.stringify(snapCall[1]).includes('2026-11-27'),true,'board asked for the working day 27, not the calendar 28');
 // 4) settings → «ساعة قفل اليوم» → the editor (real modal: ✕ / تراجع), reason required, set RPC
 const sb=w.document.querySelector('[data-journey-action="settings"]');assert(sb,'settings button');sb.click();await sleep(20);
 let m=w.document.querySelector('.rx-modal');assert(m.querySelector('[data-bd-box]'),'«ساعة قفل اليوم» in the settings');assert.match(m.querySelector('[data-bd-box]').textContent,/04:00/);
 m.querySelector('[data-bd-edit]').click();await sleep(10);m=w.document.querySelector('.rx-modal');assert.equal(m.querySelector('#rx-title').textContent,'ساعة قفل اليوم');
 m.querySelector('.modal-close').click();assert(!w.document.querySelector('.rx-modal'),'✕ closes');
 sb.click();await sleep(20);w.document.querySelector('[data-bd-edit]').click();await sleep(10);m=w.document.querySelector('.rx-modal');
 assert.equal(m.querySelector('[data-rx-cancel]').textContent,'تراجع');
 const before=r.calls.filter(c=>c[1]&&c[1].p_action==='set').length;m.querySelector('[data-bd-cutoff]').value='03:00';m.querySelector('[type=submit]').click();await sleep(20);
 assert.equal(r.calls.filter(c=>c[1]&&c[1].p_action==='set').length,before,'no save without a reason');
 m.querySelector('[data-bd-reason]').value='الشغل بيخلص بدري';m.querySelector('[type=submit]').click();await sleep(40);
 const set=r.calls.filter(c=>c[1]&&c[1].p_action==='set').pop();assert.deepEqual(JSON.parse(JSON.stringify(set[1].p_payload)),{cutoff:'03:00',reason:'الشغل بيخلص بدري'});
 assert.equal(w.SSMPDBusinessDay.cutoff,'03:00');assert(!w.document.querySelector('.rx-modal'),'window closes after save');
 // 5) reception: sees the hour, no change button
 r=win('2026-11-27T22:24:00Z','reception');w=r.w;w.eval(fs.readFileSync('assets/js/today-operations.js','utf8'));w.eval('var esc=function(v){return String(v)};var friendly=function(e){return e;};var host=null;var load=function(){};'+MODAL+';window.__modal=modal;');await w.SSMPDBusinessDay.load();
 const h2=w.document.querySelector('#host');h2.innerHTML=w.SSMPDReceptionModules.panel('journey',Object.assign({},ctx,{host:h2,modal:w.__modal}));for(let n=0;n<200&&!h2.querySelector('.journey-board');n++)await sleep(10);
 const sb2=w.document.querySelector('[data-journey-action="settings"]');if(sb2){sb2.click();await sleep(20);const m2=w.document.querySelector('.rx-modal');assert(m2.querySelector('[data-bd-box]'));assert(!m2.querySelector('[data-bd-edit]'),'reception: no change button');}
 console.log('PASS business day (client): 00:24 → yesterday, 04:00 → today, changed cutoff applies; 7 screens use it; «تشغيل اليوم» opens on the working day; «ساعة قفل اليوم» editor (✕ / تراجع, reason required) for super_admin only → set RPC.');process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
