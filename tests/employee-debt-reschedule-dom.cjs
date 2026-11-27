// «تأجيل / تغيير الأقساط» screens (20261127090000), live finance panel, every new button by its role:
// accountant: «تأجيل / تغيير الأقساط» → postpone → «ابعت للموافقة»; resplit → «ابعت للموافقة»; ✕ / «رجوع» / Esc; «الغي».
// FM / owner: «موافقة» / «رفض» (reason). Reception and GM: no buttons. A small fake server keeps the state.
const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
(async()=>{const dom=new JSDOM('<!doctype html><body><main id="fin"></main></body>',{runScripts:'outside-only'});
 const w=dom.window,d=w.document,calls=[],tick=()=>new Promise(r=>setTimeout(r,8));let role='acc',seq=0;const ch=[];
 const SCHED=[{month:'2026-11-01',amount:120,claimed:true,recovered:false},{month:'2026-12-01',amount:120,claimed:false},{month:'2027-01-01',amount:120,claimed:false}];
 const row=x=>Object.assign({},x,{mine:x.by===role});
 const server=(n,a,p)=>{
  if(n==='clinic_finance_employee_debt'){if(a==='list'){const fin=['acc','fm','sa'].includes(role);return {can_review:['fm','sa'].includes(role),inbox:[],items:[],balances:fin?[{person_id:'p-huda',name:'هدى',total:360,recovered:0,this_month:120,last_month:'2027-01-01'}]:[]};}throw new Error('?');}
  const maker=['acc','fm','sa'].includes(role),rev=['fm','sa'].includes(role);
  if(a==='list')return {can_review:rev,can_request:maker,inbox:rev?ch.filter(x=>x.status==='pending'&&x.by!==role).map(row):[],items:maker?ch.map(row):[]};
  if(a==='schedule'){if(!maker)throw new Error('مش مسموح');return {can_request:true,this_month:'2026-11-01',debts:[{id:'debt1',amount:360,person_name:'هدى',visit_no:195,schedule:SCHED}]};}
  if(a==='request'){if(!maker)throw new Error('للحسابات بس');if(!p.reason)throw new Error('اكتب السبب');const before=SCHED.filter(x=>!x.claimed);
   const after=p.kind==='postpone'?before.map(x=>x.month===p.from_month?{month:p.to_month,amount:x.amount}:x):Array.from({length:p.months},(_,j)=>({month:'2026-12-01',amount:240/p.months}));
   const x={id:'c'+(++seq),kind:p.kind,before,after,reason:p.reason,status:'pending',by:role,person_name:'هدى',visit_no:195,payload:p};ch.push(x);return row(x);}
  const x=ch.find(y=>y.id===p.id);
  if(a==='review'){if(!rev)throw new Error('الموافقة للمدير المالي أو المالك بس');if(x.by===role)throw new Error('غير اللي طلب');x.status=p.ok?'approved':'rejected';if(!p.ok)x.note=p.note;return row(x);}
  if(a==='cancel'){x.status='cancelled';return row(x);}};
 w.SSMPDToast={show:()=>{}};w.prompt=()=>'الموظفة تدفع كاش';w.confirm=()=>true;
 w.SSMPDDb={client:{rpc:async(n,a)=>{calls.push([role,n,a.p_action,JSON.parse(JSON.stringify(a.p))]);try{return {data:server(n,a.p_action,a.p)};}catch(e){return {error:e};}}}};
 w.SSMPDFinanceControls={panel:t=>'<p>prior:'+t+'</p>'};w.SSMPDShiftExpenses={decorate:()=>{}};
 w.eval(fs.readFileSync('assets/js/employee-debt.js','utf8'));
 const fin=async r=>{role=r;d.getElementById('fin').innerHTML=w.SSMPDFinanceControls.panel('drawer-requests',{},{});await tick();await tick();await tick();return d.querySelector('[data-employee-debts]');};
 const last=a=>calls.filter(x=>x[1]==='clinic_finance_employee_debt_change'&&x[2]===a).pop();
 // reception / GM: no reschedule button
 let box=await fin('gm');assert.ok(!box.querySelector('[data-emd-resched]'),'GM: no button');
 // accountant: open → postpone
 box=await fin('acc');const btn=box.querySelector('[data-emd-resched]');assert.ok(btn,'accountant sees «تأجيل / تغيير الأقساط»');assert.equal(btn.textContent,'تأجيل / تغيير الأقساط');
 btn.click();await tick();await tick();let m=d.querySelector('.emd-modal');assert.ok(m);assert.match(m.querySelector('#emd-rt').textContent,/هدى/);
 assert.ok(m.querySelector('[data-emd-x]'),'✕ (rule 10)');assert.equal(m.querySelector('[data-emd-back]').textContent,'رجوع');
 const f=m.querySelector('form');assert.deepEqual([...f.elements.from_month.options].map(o=>o.value),['2026-12-01','2027-01-01'],'only unclaimed installments');
 assert.equal(f.elements.to_month.options[0].value,'2027-02-01','after the last installment');assert.equal(f.elements.to_month.options.length,6,'up to 6 months');
 assert.match(m.querySelector('[data-emd-before]').textContent,/✓/,'claimed shown as done');
 f.elements.to_month.value='2027-03-01';f.elements.to_month.dispatchEvent(new w.Event('change'));assert.match(m.querySelector('[data-emd-after]').textContent,/مارس 2027/);
 f.elements.reason.value='ظروف عائلية';m.querySelector('footer [type=submit]').click();await tick();await tick();await tick();
 let c=last('request');assert.deepEqual([c[0],c[3].kind,c[3].debt_id,c[3].from_month,c[3].to_month],['acc','postpone','debt1','2026-12-01','2027-03-01']);assert.ok(!d.querySelector('.emd-modal'),'closed after send');
 box=d.querySelector('[data-employee-debts]');assert.match(box.textContent,/تأجيل قسط/);assert.ok(box.querySelector('[data-emd-ccancel]'),'«الغي» on my pending');
 box.querySelector('[data-emd-ccancel]').click();await tick();await tick();await tick();assert.equal(last('cancel')[0],'acc');
 // resplit
 box=d.querySelector('[data-employee-debts]');box.querySelector('[data-emd-resched]').click();await tick();await tick();m=d.querySelector('.emd-modal');const g=m.querySelector('form');
 g.querySelector('[name=kind][value=resplit]').checked=true;g.querySelector('[name=kind][value=resplit]').dispatchEvent(new w.Event('change'));
 assert.ok(!m.querySelector('[data-emd-rs]').hidden&&m.querySelector('[data-emd-pp]').hidden);assert.ok(![...g.elements.first_month.options].some(o=>o.value==='2026-11-01'),'claimed month not offered');
 g.elements.months.value='4';g.elements.months.dispatchEvent(new w.Event('input'));assert.equal((m.querySelector('[data-emd-after]').textContent.match(/60\.00/g)||[]).length,4,'4 × 60 preview');
 // ✕, رجوع, Esc
 m.querySelector('[data-emd-back]').click();assert.ok(!d.querySelector('.emd-modal'),'«رجوع» closes');
 box.querySelector('[data-emd-resched]').click();await tick();await tick();d.querySelector('.emd-modal [data-emd-x]').click();assert.ok(!d.querySelector('.emd-modal'),'✕ closes');
 box.querySelector('[data-emd-resched]').click();await tick();await tick();m=d.querySelector('.emd-modal');m.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape'}));assert.ok(!d.querySelector('.emd-modal'),'Esc closes');
 box.querySelector('[data-emd-resched]').click();await tick();await tick();m=d.querySelector('.emd-modal');const h=m.querySelector('form');
 h.querySelector('[name=kind][value=resplit]').checked=true;h.querySelector('[name=kind][value=resplit]').dispatchEvent(new w.Event('change'));h.elements.months.value='4';h.elements.reason.value='طلب الموظفة';
 m.querySelector('footer [type=submit]').click();await tick();await tick();await tick();c=last('request');assert.deepEqual([c[3].kind,c[3].months,c[3].first_month],['resplit',4,'2026-12-01']);
 // accountant can't approve
 box=d.querySelector('[data-employee-debts]');assert.ok(!box.querySelector('[data-emd-cok]'));
 // FM approves, owner rejects
 box=await fin('fm');let ok=box.querySelectorAll('[data-emd-cok]');assert.equal(ok.length,1);assert.match(box.querySelector('[data-emd-chinbox]').textContent,/4 × 60\.00/);
 ok[0].click();await tick();await tick();await tick();c=last('review');assert.deepEqual([c[0],c[3].ok],['fm',true]);
 role='acc';await fin('acc');d.querySelector('[data-emd-resched]').click();await tick();await tick();m=d.querySelector('.emd-modal');m.querySelector('form').elements.reason.value='تأجيل تاني';m.querySelector('footer [type=submit]').click();await tick();await tick();await tick();
 box=await fin('sa');box.querySelector('[data-emd-cno]').click();await tick();await tick();await tick();c=last('review');assert.deepEqual([c[0],c[3].ok,c[3].note],['sa',false,'الموظفة تدفع كاش']);
 assert.match(d.querySelector('[data-employee-debts]').textContent,/اترفض/);
 console.log('PASS employee debt reschedule screens: accountant postpone/resplit/cancel, ✕/رجوع/Esc, FM approve, owner reject (reason); GM/reception no buttons.');
})().catch(e=>{console.error(e);process.exit(1);});
