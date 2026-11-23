// «تشغيل اليوم» reviewer inbox (today-review-inbox.js): renders the treasury / shifts / requests cards for a reviewer, decisions go to the
// EXISTING RPCs with a mandatory note, a decided item disappears, own items show without «اعتماد», badge on the tab, empty state, and
// nothing at all for a reception employee. Sample data only.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');const {JSDOM}=require('jsdom');
const src=fs.readFileSync(path.join(__dirname,'..','assets','js','today-review-inbox.js'),'utf8');
const WS='11111111-1111-4111-8111-111111111111';
const now=()=>new Date().toISOString();
function fixture(){return {visible:true,can_review:true,
 treasury:{configured:true,balance:48250,shift:{custodian:'محمود'},count:{last_count:{at:now(),difference:0}}},
 shifts:[{id:'f1',register:'خزنة الاستقبال',cashier:'منار',closed_at:now(),counted:6400,expected:6450,difference:-50,mine:false,rpc:'clinic_reception_command',action:'shift_review',target_id:'r1',workspace_id:WS}],
 open_shifts:[{id:'f2',register:'خزنة الاستقبال',cashier:'مازن',opened_at:now(),expected:3120,mine:false}],
 handovers:[],
 requests:[
  {source:'rx_request',id:'q1',kind:'service_void',amount:7000,reason:'الخدمة اتسجلت غلط',by:'منار',at:now(),mine:false,visit_no:49,patient:'سارة تجريبية',rpc:'clinic_reception_command',action:'request_review',workspace_id:WS},
  {source:'fin_request',id:'q2',kind:'expense',amount:75,reason:'مصروف اختبار',by:'أحمد',mine:false,rpc:'clinic_finance_review_request'},
  {source:'desk_payout',id:'q3',kind:'desk_payout',amount:2300,doctor:'د. جلدية تجريبية',by:'أحمد',mine:false,rpc:'clinic_reception_doctor_payout'},
  {source:'rx_request',id:'q4',kind:'refund',amount:50,reason:'طلبي',by:'أنا',mine:true,rpc:'clinic_reception_command',action:'request_review',workspace_id:WS}],
 counts:{total:4}};}
const tick=(ms)=>new Promise(r=>setTimeout(r,ms||30));
async function run(role,data){
 const dom=new JSDOM('<!doctype html><html><body><div id="tabs-bar"><button class="tab-btn" data-tab="reception_services">الاستقبال والخدمات</button></div><section><div data-journey-root><div class="journey-top"><h2>تشغيل اليوم</h2></div><div data-journey-staff-host></div></div></section></body></html>',{runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,calls=[];let current=data;
 w.SSMPDAuth={currentAdmin:{id:'a1',role}};w.SSMPDRoles={rolesOf:a=>[a.role]};w.SSMPDToast={show:()=>{},error:()=>{}};
 w.SSMPDDb={client:{rpc:(n,a)=>{calls.push([n,JSON.parse(JSON.stringify(a||{}))]);if(n==='clinic_review_inbox')return Promise.resolve({data:current,error:null});return Promise.resolve({data:'ok',error:null});}}};
 w.eval(src);await tick();
 return {w,d:w.document,calls,set:v=>{current=v;}};
}
async function submit(t,note){const f=t.d.querySelector('.tri-modal form');f.elements.note.value=note;f.dispatchEvent(new t.w.Event('submit',{cancelable:true}));await tick();return f;}
(async()=>{
 const t=await run('financial_manager',fixture());const d=t.d;
 const box=d.querySelector('[data-review-inbox]');assert(box,'inbox mounted');
 assert.equal(box.previousElementSibling.className,'journey-top','placed right after the top bar');
 assert(d.querySelector('[data-tri-treasury]').textContent.includes('48,250'),'treasury balance in English digits');
 assert(d.querySelector('[data-tri-shifts]').textContent.includes('عجز 50'),'shift shows the shortage');
 const reqs=d.querySelector('[data-tri-requests]');assert(reqs.textContent.includes('طلبات مستنية موافقة'));
 assert.equal(reqs.querySelector('.tri-cnt').textContent,'3','count excludes own request');
 const mine=reqs.querySelector('[data-tri-item="rx_request:q4"]');assert(!mine.querySelector('[data-tri-do="approve"]')&&mine.textContent.includes('لازم حد تاني'),'own item has no approve');
 assert.equal(d.querySelector('[data-tri-badge]').textContent,'4','badge = 3 requests + 1 shift');
 assert(!/[٠-٩]/.test(box.textContent),'English digits only');
 // owner 2026-11-22: opening the tab while something waits jumps to the inbox (scroll + one flash)
 {let scrolled=null;t.w.scrollTo=o=>{scrolled=o;};d.querySelector('#tabs-bar [data-tab="reception_services"]').click();for(let i=0;i<40&&!scrolled;i++)await tick(20);
  assert(scrolled&&typeof scrolled.top==='number','scrolled to «اللي مستنيك»');assert(box.classList.contains('tri-flash'),'inbox flashes once');}
 // approve the reception request: the note is mandatory, then the existing RPC is called and the item disappears
 d.querySelector('[data-tri-key="rx_request:q1"][data-tri-do="approve"]').click();
 assert(d.querySelector('.tri-modal').textContent.includes('اللي هيحصل'),'dialog explains the effect');
 await submit(t,'ok');
 assert(!d.querySelector('[data-tri-err]').hidden,'short note refused');assert(!t.calls.some(c=>c[0]==='clinic_reception_command'));
 const fresh=fixture();fresh.requests=fresh.requests.filter(x=>x.id!=='q1');t.set(fresh);
 await submit(t,'راجعت الفاتورة');
 const call=t.calls.find(c=>c[0]==='clinic_reception_command');
 assert.deepEqual([call[1].p_workspace,call[1].p_action,call[1].p_payload],[WS,'request_review',{id:'q1',approve:true,note:'راجعت الفاتورة'}]);
 assert(!d.querySelector('[data-tri-item="rx_request:q1"]'),'decided item gone');
 // reject the desk payout → the existing desk RPC with action reject
 d.querySelector('[data-tri-key="desk_payout:q3"][data-tri-do="reject"]').click();
 await submit(t,'المبلغ مش مظبوط');
 const dc=t.calls.find(c=>c[0]==='clinic_reception_doctor_payout');assert.deepEqual([dc[1].p_action,dc[1].p_payload],['reject',{id:'q3',note:'المبلغ مش مظبوط'}]);
 // finance request → clinic_finance_review_request
 d.querySelector('[data-tri-key="fin_request:q2"][data-tri-do="approve"]').click();
 await submit(t,'مستند سليم');
 const fc=t.calls.find(c=>c[0]==='clinic_finance_review_request');assert.deepEqual(fc[1],{p_id:'q2',p_approve:true,p_note:'مستند سليم'});
 // receive the reception shift → clinic_finance_review_shift on the finance shift id (live reception refuses shift_review)
 d.querySelector('[data-tri-key="shift:f1"][data-tri-do="approve"]').click();
 await submit(t,'استلمت الكاش');
  const sc=t.calls.filter(c=>c[0]==='clinic_finance_review_shift').pop();assert.deepEqual(sc[1],{p_shift:'f1',p_note:'استلمت الكاش'});assert(!t.calls.some(c=>c[0]==='clinic_reception_command'&&c[1].p_action==='shift_review'));
 // 20261122380000: «دفعة لأكتر من مريض» → «اطّلعت» / «عليها ملاحظة» through cross_payment_review
 {const v=fixture();v.requests=[{source:'rx_cross_payment',id:'cp1',kind:'cross_payment',amount:1000,reason:'يحيى دفع عن صاحبه محمود',by:'منار',at:now(),mine:false,patient:'يحيى تجريبي',patients:['يحيى تجريبي','محمود تجريبي'],workspace_id:WS},
   {source:'rx_cross_payment',id:'cp2',kind:'cross_payment',amount:300,by:'أنا',mine:true,patients:['أ','ب'],workspace_id:WS}];t.set(v);t.w.SSMPDReviewInbox.load(true);
  for(let i=0;i<40&&!d.querySelector('[data-tri-item="rx_cross_payment:cp1"]');i++)await tick(20);
  const it=d.querySelector('[data-tri-item="rx_cross_payment:cp1"]');assert(it,'cross payment listed');
  assert.match(it.textContent,/دفعة لأكتر من مريض/);assert.match(it.textContent,/يحيى تجريبي \+ محمود تجريبي/);
  assert.equal(it.querySelector('[data-tri-do="approve"]').textContent,'اطّلعت');assert.equal(it.querySelector('[data-tri-do="reject"]').textContent,'عليها ملاحظة');
  assert.match(d.querySelector('[data-tri-item="rx_cross_payment:cp2"]').textContent,/تحصيلك — لازم حد تاني يراجعه/);
  it.querySelector('[data-tri-do="reject"]').click();assert.match(d.querySelector('.tri-modal').textContent,/الملاحظة \(إجباري\)/);
  await submit(t,'الإيصال مش واضح');
  const cc=t.calls.filter(c=>c[0]==='clinic_reception_command').pop();assert.deepEqual([cc[1].p_action,cc[1].p_payload],['cross_payment_review',{id:'cp1',approve:false,note:'الإيصال مش واضح'}]);}
 t.set(fixture());
 // the board repaints its root → the inbox comes back
 d.querySelector('[data-journey-root]').innerHTML='<div class="journey-top"></div>';await tick();
 assert(d.querySelector('[data-review-inbox]'),'remounted after the board re-render');
 t.w.SSMPDReviewInbox.stop();t.w.close();
 // empty state
 const e=await run('accountant',{visible:true,can_review:true,treasury:null,shifts:[],open_shifts:[],handovers:[],requests:[],counts:{total:0}});
 assert(e.d.querySelector('[data-tri-empty]').textContent.includes('مفيش حاجة مستنياك'));assert(!e.d.querySelector('[data-tri-badge]'));e.w.SSMPDReviewInbox.stop();e.w.close();
 // reception: no inbox and no RPC call
 const rc=await run('reception',fixture());assert(!rc.d.querySelector('[data-review-inbox]'));assert(!rc.calls.length,'no RPC for reception');rc.w.SSMPDReviewInbox.stop();rc.w.close();
 console.log('PASS today review inbox DOM: treasury/shifts/requests for reviewers, mandatory note, existing RPCs (reception request, desk payout, finance request, reception shift), decided item disappears, own item without approve, badge, empty state, remount, nothing for reception.');
 process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
