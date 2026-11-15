// «تبديل وردية» screen: employee sees his swaps and answers; HR approves only what it did not file or accept; request form.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');const tick=()=>new Promise(r=>setTimeout(r,20));
(async()=>{
async function boot(me,hr){const dom=new JSDOM('<main></main>',{url:'https://test.invalid',runScripts:'outside-only'}),w=dom.window,d=w.document,calls=[];
  w.SSMPDAuth={currentAdmin:{id:me}};w.SSMPDRoles={ALL:{}};w.SSMPDToast={show:()=>{}};
  const swaps=[
    {id:'s1',kind:'same_day',status:'pending_partner',requester_id:'pA',partner_id:'pB',requester_name:'أ',partner_name:'ب',partner_admin:'aB',requester_admin:'aA',created_by:'aA',day_a:'2026-11-23',plan:[]},
    {id:'s2',kind:'cross_day',status:'pending_manager',requester_id:'pA',partner_id:'pB',requester_name:'أ',partner_name:'ب',partner_admin:'aB',requester_admin:'aA',created_by:'aA',partner_by:'aB',day_a:'2026-11-28',day_b:'2026-11-27',plan:[]},
    {id:'s3',kind:'same_day',status:'approved',requester_id:'pA',partner_id:'pB',requester_name:'أ',partner_name:'ب',partner_admin:'aB',requester_admin:'aA',created_by:'aA',partner_by:'aB',day_a:'2026-11-30',plan:[{person_id:'pA',day:'2026-11-30',off:false,shift:'مسائي 16:00–00:00'},{person_id:'pB',day:'2026-11-30',off:true}]}];
  w.SSMPDDb={client:{rpc:async(fn,args)=>{calls.push({fn,args});if(fn==='hr_shift_swaps_list')return {data:{can_manage:hr,me,my_person_id:me==='aB'?'pB':me==='aA'?'pA':null,people:[{id:'pA',full_name:'أ',code:'E1'},{id:'pB',full_name:'ب',code:'E2'}],swaps}};return {data:'x'};}}};
  w.eval(fs.readFileSync('assets/js/workforce-prices.js','utf8'));w.eval(fs.readFileSync('assets/js/hr-shift-swaps.js','utf8'));
  const host=d.createElement('div');d.body.append(host);w.SSMPDHRShiftSwaps.mount(host);await tick();return {w,d,host,calls,dom};}
const btns=(host,id)=>Array.from(host.querySelectorAll('[data-id="'+id+'"]')).map(b=>b.dataset.swap).join(',');
// The colleague (aB): accept/decline his pending request, no approve; the banner says a request waits for him.
let t=await boot('aB',false);assert(t.host.textContent.includes('في انتظار ردك'));assert.equal(btns(t.host,'s1'),'accept,decline');assert.equal(btns(t.host,'s2'),'');assert.equal(btns(t.host,'s3'),'');
t.host.querySelector('[data-swap=accept][data-id=s1]').click();await tick();await tick();
assert.equal(JSON.stringify(t.calls.find(c=>c.fn==='hr_shift_swap_command').args),JSON.stringify({p_action:'respond',p_payload:{id:'s1',accept:true}}));t.dom.window.close();
// The requester (aA): can withdraw pending requests, cannot answer or approve.
t=await boot('aA',false);assert.equal(btns(t.host,'s1'),'cancel');assert.equal(btns(t.host,'s2'),'cancel');assert.equal(btns(t.host,'s3'),'');
// He files a cross-day request for himself only.
t.host.querySelector('[data-swap=new]').click();await tick();let f=t.d.querySelector('.wp-modal form');
assert.equal(Array.from(f.elements.requester_id.options).map(o=>o.value).join(','),'pA');
f.elements.kind.value='cross_day';f.elements.partner_id.value='pB';f.elements.day_a.value='2026-12-05';f.dispatchEvent(new t.w.Event('submit',{bubbles:true,cancelable:true}));await tick();
assert(f.querySelector('[role=alert]').textContent.includes('يوم الزميل'),'cross-day needs the colleague day');
f.elements.day_b.value='2026-12-04';f.dispatchEvent(new t.w.Event('submit',{bubbles:true,cancelable:true}));await tick();await tick();
const req=t.calls.find(c=>c.fn==='hr_shift_swap_command').args;assert.equal(req.p_action,'request');assert.equal(req.p_payload.requester_id,'pA');assert.equal(req.p_payload.day_b,'2026-12-04');t.dom.window.close();
// Another HR manager (aH): approve/reject the accepted one (with a reason), reverse the approved one; the plan is shown.
t=await boot('aH',true);assert.equal(btns(t.host,'s2'),'approve,reject,cancel');assert.equal(btns(t.host,'s3'),'reverse');assert(t.host.textContent.includes('إجازة بتبديل'));
t.host.querySelector('[data-swap=approve][data-id=s2]').click();await tick();f=t.d.querySelector('.wp-modal form');f.elements.note.value='موافق';f.dispatchEvent(new t.w.Event('submit',{bubbles:true,cancelable:true}));await tick();await tick();
assert.equal(JSON.stringify(t.calls.find(c=>c.fn==='hr_shift_swap_command').args),JSON.stringify({p_action:'approve',p_payload:{id:'s2',note:'موافق'}}));t.dom.window.close();
// HR who filed / accepted it gets no approve button (four eyes).
t=await boot('aA',true);assert(!btns(t.host,'s2').includes('approve'));t.dom.window.close();
console.log('PASS shift swaps DOM: colleague answers, requester withdraws and files for himself, HR approves/reverses only what it did not file or accept, plan shown.');
})().catch(e=>{console.error(e);process.exit(1)});
