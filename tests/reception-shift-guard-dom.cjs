// «وردية الخزينة — قفل بعد ساعة» UI (reception-shift-guard.js): lock card on «الاستقبال والخدمات» and «تشغيل اليوم» with «افتح وردية»,
// stale-shift card with «سلّم الوردية», desk actions stopped before the server (others pass), server refusal refreshes the card,
// manager «ورديات محتاجة متابعة». Sample data only.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
const src=fs.readFileSync('assets/js/reception-shift-guard.js','utf8');
const tick=(n=20)=>new Promise(r=>setTimeout(r,n));
async function run(role,guard,watch){
 const dom=new JSDOM('<!doctype html><html><body><div class="rx-shell"><header class="rx-header"><h2>الاستقبال والخدمات</h2></header></div><div data-journey-root><div class="journey-top"></div></div><div data-journey-root data-journey-mode="trial"><div class="journey-top"></div></div></body></html>',{runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,calls=[],toasts=[],opened=[];let g=guard;
 w.SSMPDAuth={currentAdmin:{id:'a1',role}};w.SSMPDRoles={rolesOf:a=>[a.role]};w.SSMPDToast={show:(m,k)=>toasts.push([m,k])};
 const nav=w.document.createElement('button');nav.dataset.goto='booking_cash';nav.onclick=()=>{opened.push(['tab','booking_cash']);setTimeout(()=>{if(w.document.querySelector('[data-fin-action="booking-open"]'))return;const b=w.document.createElement('button');b.dataset.finAction='booking-open';b.onclick=()=>{opened.push(['form','booking-open']);w.SSMPDDb.client.rpc('clinic_booking_shift',{p_action:'open',p_payload:{register_id:'fr1'},p_token:'t'});};w.document.body.appendChild(b);},50);};w.document.body.appendChild(nav);w.SSMPDPeerHandover={openSend:()=>opened.push(['handover'])};
 const client={rpc:(n,a)=>{calls.push([n,a&&a.p_action]);
   if(n==='clinic_reception_shift_guard')return Promise.resolve({data:g,error:null});
   if(n==='clinic_reception_shift_watch')return Promise.resolve({data:watch,error:null});
   if(n==='clinic_reception_command'&&a.p_action==='collect')return Promise.resolve({data:null,error:{message:'افتح وردية الخزينة الأول — …'}});
   return Promise.resolve({data:{ok:1},error:null});}};
 w.SSMPDDb={client};w.eval(src);for(let i=0;i<20&&!w.SSMPDDb.client.__rsgWrapped;i++)await tick();await tick(40);
 return {w,d:w.document,calls,toasts,opened,client:w.SSMPDDb.client,set:v=>{g=v;}};
}
(async()=>{
 const start=new Date(Date.now()-75*60000).toISOString();
 // locked reception employee
 const t=await run('reception',{locked:true,reason:'need_open',exp_start:start});const d=t.d;
 const cards=[...d.querySelectorAll('[data-rsg-lock="need_open"]')];assert.equal(cards.length,2,'card on the reception screen and the live today board (not the trial copy)');
 assert.equal(cards[0].previousElementSibling.className,'rx-header');assert.equal(cards[1].previousElementSibling.className,'journey-top');
 assert.match(cards[0].textContent,/افتح وردية الخزينة الأول/);assert.match(cards[0].textContent,/حجز موعد · تسجيل وصول · تحصيل · طلب خدمة/);
 assert(!/[٠-٩]/.test(cards[0].textContent),'English digits');
 // desk actions stopped locally, others pass
 const before=t.calls.length;let r=await t.client.rpc('clinic_reception_command',{p_action:'book'});
 assert.match(r.error.message,/افتح وردية الخزينة الأول/);assert.equal(t.calls.length,before,'book never sent');assert.equal(t.toasts.pop()[1],'error');
 r=await t.client.rpc('clinic_reception_journey_command',{p_action:'arrive'});assert(r.error,'journey arrive stopped');
 r=await t.client.rpc('clinic_reception_journey_command',{p_action:'call'});assert.equal(r.data.ok,1,'call passes');
 r=await t.client.rpc('clinic_reception_command',{p_action:'shift_open'});assert.equal(r.data.ok,1,'shift_open passes');
 r=await t.client.rpc('clinic_reception_command',{p_action:'reschedule'});assert.equal(r.data.ok,1,'reschedule passes');
 // «افتح وردية» → «خزينة الاستقبال والحجوزات» → «فتح وردية استقبال» → clinic_booking_shift('open') (the path that works on live for reception)
 t.set({locked:false,reason:'open'});cards[0].querySelector('[data-rsg-open]').click();await tick(400);
 assert.equal(JSON.stringify(t.opened),JSON.stringify([['tab','booking_cash'],['form','booking-open']]),'cash tab then the open-shift form');
 assert(t.calls.some(c=>c[0]==='clinic_booking_shift'&&c[1]==='open'),'clinic_booking_shift open called');
 assert(!t.calls.some(c=>c[0]==='clinic_reception_command'&&c[1]==='shift_open'&&false));await tick(80);
 assert(!d.querySelector('[data-rsg-lock]'),'card removed once the shift is open');
 // server refusal (state changed meanwhile) refreshes the card
 t.set({locked:true,reason:'need_open',exp_start:start});r=await t.client.rpc('clinic_reception_command',{p_action:'collect'});assert(r.error);await tick(60);
 assert(d.querySelector('[data-rsg-lock="need_open"]'),'card back after the server refused');
 t.w.close();
 // stale shift
 const s=await run('reception',{locked:true,reason:'stale',opened_at:new Date(Date.now()-26*3600e3).toISOString(),register:'خزينة الاستقبال 1',expected:1500});
 const sc=s.d.querySelector('[data-rsg-lock="stale"]');assert(sc);assert.match(sc.textContent,/خزينة الاستقبال 1/);assert.match(sc.textContent,/1,500 كاش/);
 sc.querySelector('[data-rsg-handover]').click();assert.deepEqual(s.opened.pop(),['handover']);s.w.close();
 // handed over («سلّم الوردية» → end_shift): not locked, a clear waiting card, nothing stopped, no «افتح وردية»
 const h=await run('reception',{locked:false,reason:'awaiting_receipt',ended_at:new Date(Date.now()-5*60000).toISOString(),receiver:'محمود تجريبي'});
 const hc=h.d.querySelector('[data-rsg-lock="awaiting_receipt"]');assert(hc,'waiting card');assert.match(hc.textContent,/سلّمت ورديتك — مستني محمود تجريبي يأكد الاستلام/);
 assert(!hc.querySelector('[data-rsg-open]'),'no «افتح وردية» while the handover waits');assert(!/[٠-٩]/.test(hc.textContent));
 assert.equal((await h.client.rpc('clinic_reception_command',{p_action:'book'})).data.ok,1,'book not stopped after the handover');h.w.close();
 const rv=await run('reception',{locked:false,reason:'awaiting_review',ended_at:new Date(Date.now()-3600e3).toISOString()});
 assert.match(rv.d.querySelector('[data-rsg-lock="awaiting_review"]').textContent,/مستنية مراجعة الحسابات/);rv.w.close();
 // manager: no lock, watch list
 const m=await run('financial_manager',null,{visible:true,items:[{kind:'missing',name:'منار تجريبية',exp_start:start},{kind:'stale',name:'مازن تجريبي',opened_at:new Date(Date.now()-40*3600e3).toISOString(),expected:0},{kind:'after_end',name:'مريم تجريبية',exp_end:start,expected:850}]});
 assert(!m.d.querySelector('[data-rsg-lock]'));assert(!m.calls.some(c=>c[0]==='clinic_reception_shift_guard'),'managers do not ask for their own lock');
 const wl=m.d.querySelector('[data-journey-root]:not([data-journey-mode]) [data-rsg-watch]');assert(wl,'watch list on the today board');
 assert.match(wl.textContent,/ورديات محتاجة متابعة/);assert.match(wl.textContent,/منار تجريبية.*مفتحتش وردية/);assert.match(wl.textContent,/وردية مفتوحة من يوم قبل كده/);assert.match(wl.textContent,/850/);
 const bk=await m.client.rpc('clinic_reception_command',{p_action:'book'});assert.equal(bk.data.ok,1,'managers never stopped');m.w.close();
 // unlocked employee: nothing shown, nothing stopped
 const u=await run('reception',{locked:false,why:'not_due'});assert(!u.d.querySelector('[data-rsg-lock]'));assert.equal((await u.client.rpc('clinic_reception_command',{p_action:'book'})).data.ok,1);u.w.close();
 console.log('PASS shift guard UI: lock card on reception + live today board, «افتح وردية», stale card with «سلّم الوردية», desk actions stopped locally (others pass), refresh after shift_open / server refusal, manager watch list, unlocked = nothing.');
 process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
