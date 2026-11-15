// «أجازات المركز» tab: add (pending), only another reviewer sees «اعتماد», creator sees the wait note, bookings warning,
// reject needs a reason, approved can be cancelled by a reviewer, rejected/cancelled folded away. Fake server in memory.
const fs=require('fs'),{JSDOM}=require('jsdom'),assert=require('node:assert/strict');const tick=()=>new Promise(r=>setTimeout(r,20));
(async()=>{const dom=new JSDOM('<main></main>',{url:'https://test.invalid',runScripts:'outside-only'}),w=dom.window,d=w.document;
const st={me:'hr',closures:[],calls:[]};let seq=0;
const view=()=>({me:st.me,can_add:true,can_review:st.me!=='hr',closures:st.closures.map(c=>Object.assign({},c,{mine:c.created_by===st.me}))});
w.SSMPDAuth={currentAdmin:{id:'u1',role:'super_admin'}};w.SSMPDToast={show:()=>{}};w.confirm=()=>true;w.alert=m=>{st.alert=m;};
w.SSMPDDb={client:{rpc:async(fn,args)=>{st.calls.push([fn,args]);
 if(fn==='center_closures')return {data:view()};
 if(fn==='center_closure_bookings')return {data:args.p_id==='c1'?[{day:'2027-05-17',bookings:3}]:[]};
 if(fn==='center_closure_command'){const p=args.p_payload,a=args.p_action;
  if(a==='add'){const c={id:'c'+(++seq),name:p.name,from_date:p.from_date,to_date:p.to_date,note:p.note,status:'pending',created_by:st.me,created_by_name:'موارد بشرية'};st.closures.unshift(c);return {data:{id:c.id,status:'pending'}};}
  const c=st.closures.find(x=>x.id===p.id);
  if(a==='review'){if(!p.approve&&!(p.note||'').trim())return {error:{message:'اكتب سبب الرفض'}};c.status=p.approve?'approved':'rejected';c.reviewed_by_name='مدير عام';c.review_note=p.note||null;return {data:{id:c.id,status:c.status}};}
  if(a==='cancel'){c.status='cancelled';c.review_note=p.note||null;return {data:{id:c.id,status:'cancelled'}};}}
 return {error:{message:'unexpected '+fn}};}}};
for(const f of ['assets/js/roles.js','assets/js/workforce-prices.js','assets/js/hr-attendance-core.js','assets/js/hr-closures.js'])w.eval(fs.readFileSync(f,'utf8'));
const mount=async()=>{d.querySelector('main').innerHTML='';w.SSMPDHRClosures.mount(d.querySelector('main'),true,{});await tick();await tick();};
const submitModal=async v=>{const f=d.querySelector('.wp-overlay form');for(const [k,x] of Object.entries(v))f.elements[k].value=x;f.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();await tick();return f;};
// HR adds a 4-day holiday.
await mount();assert(d.querySelector('[data-closures-empty]'));d.querySelector('[data-closures="add"]').click();
await submitModal({name:'عيد الأضحى',from_date:'2027-05-16',to_date:'2027-05-19',note:'المركز كله مقفول'});
let call=st.calls.find(c=>c[0]==='center_closure_command');assert.deepEqual(JSON.parse(JSON.stringify(call[1])),{p_action:'add',p_payload:{name:'عيد الأضحى',from_date:'2027-05-16',to_date:'2027-05-19',note:'المركز كله مقفول'}});
let card=d.querySelector('[data-closure="c1"]');assert.match(card.textContent,/بانتظار الاعتماد/);assert.match(card.textContent,/4 أيام/);
assert.equal(card.querySelector('[data-closures="approve"]'),null,'HR cannot approve');assert(card.querySelector('[data-closures="withdraw"]'),'creator can withdraw');
assert.match(card.querySelector('[data-closures-bookings]').textContent,/3 حجز/);
// Single-day: «إلى» left empty → same day.
d.querySelector('[data-closures="add"]').click();await submitModal({name:'شم النسيم',from_date:'2027-05-03'});assert.equal(st.closures[0].to_date,'2027-05-03');assert.match(d.querySelector('[data-closure="c2"]').textContent,/يوم واحد/);
// Another reviewer: approve c1, reject c2 needs a reason.
st.me='gm';await mount();card=d.querySelector('[data-closure="c1"]');assert(card.querySelector('[data-closures="approve"]'));card.querySelector('[data-closures="approve"]').click();await tick();await tick();
assert.match(d.querySelector('[data-closure="c1"]').textContent,/معتمدة/);assert(d.querySelector('[data-closure="c1"] [data-closures="cancel"]'),'reviewer can cancel an approved holiday');
d.querySelector('[data-closure="c2"] [data-closures="reject"]').click();const rf=d.querySelector('.wp-overlay form');assert(rf.elements.note.required);await submitModal({note:'مش أجازة عندنا'});
assert.match(d.querySelector('.cl-old summary').textContent,/المرفوضة والملغية \(1\)/);
// Creator who is also a reviewer sees the wait note, not «اعتماد».
d.querySelector('[data-closures="add"]').click();await submitModal({name:'رأس السنة',from_date:'2027-01-01'});card=d.querySelector('[data-closure="c3"]');assert.equal(card.querySelector('[data-closures="approve"]'),null);assert.match(card.querySelector('.cl-wait').textContent,/شخص تاني/);
// Cancel approved with a reason.
d.querySelector('[data-closure="c1"] [data-closures="cancel"]').click();await submitModal({note:'اتأجلت'});assert.match(d.querySelector('.cl-old summary').textContent,/\(2\)/);
dom.window.close();console.log('PASS HR closures DOM: add pending (range and single day), HR cannot approve, creator waits for another reviewer, bookings warning, approve, reject needs reason, cancel approved with reason, old ones folded.');
})().catch(e=>{console.error(e);process.exitCode=1;});
