// «على حساب الموظف — يتخصم من المرتب» screens (20261126210000), live mode, every new button clicked by the role that uses it:
// reception (Mazen): the new method in «تسجيل تحصيل» → «ابعت للموافقة»; card «تحويل تحصيل لمديونية على الموظف» → «ابعت للموافقة»
// (once / installments), «الغي», ✕ / «رجوع»; financial manager / super admin: «موافقة», «رفض» (with reason); accountant /
// reception: no approve buttons. The real reception modal() is used (×, Esc). A small fake server keeps the state.
const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
(async()=>{const dom=new JSDOM('<!doctype html><body><div id="host"><div class="rx-actions"></div></div><main id="fin"></main></body>',{runScripts:'outside-only'});
 const w=dom.window,d=w.document,calls=[],tick=()=>new Promise(r=>setTimeout(r,8));let role='mazen',seq=0;const reqs=[];
 const STAFF=[{id:'p-huda',name:'هدى',code:'E-12',relation:'self'}];
 const row=x=>Object.assign({},x,{mine:x.by_role===role,by:x.by_role,installment:Math.round(x.amount/x.months*100)/100});
 const server=(a,p)=>{
  if(a==='options'){if(!['mazen','nada'].includes(role))throw new Error('مش مسموح');const open=reqs.find(x=>x.invoice_id===p.invoice_id&&['pending','approved'].includes(x.status));
   return {live:true,due:p.invoice_id==='inv-paid'?0:360,package:false,staff:p.invoice_id==='inv-other'?[]:STAFF,default_person:'p-huda',next_month:'2026-12-01',open:open?row(open):null};}
  if(a==='convertible')return {next_month:'2026-12-01',items:[{payment_id:'pay-195',amount:360,visit_no:195,patient:'هدى',cashier:'مازن',shift_open:true,staff:STAFF,open:reqs.find(x=>x.payment_id==='pay-195'&&x.status!=='cancelled')||null}]};
  if(a==='request'){if(!p.reason||p.reason.length<3)throw new Error('اكتب السبب');const x={id:'d'+(++seq),kind:p.kind,invoice_id:p.invoice_id||'inv-195',payment_id:p.payment_id||null,person_id:p.person_id,person_name:'هدى',relation:'self',
    amount:360,months:p.months,first_month:p.first_month,reason:p.reason,status:'pending',by_role:role,at:'2026-11-26T20:00:00Z',visit_no:195};reqs.push(x);return row(x);}
  const x=reqs.find(y=>y.id===p.id);
  if(a==='cancel'){x.status='cancelled';return row(x);}
  if(a==='review'){if(!['fm','sa'].includes(role))throw new Error('الموافقة للمدير المالي أو المالك بس');if(x.by_role===role)throw new Error('الموافقة لازم من شخص غير اللي طلب');
   x.status=p.ok?'approved':'rejected';if(!p.ok)x.note=p.note;return row(x);}
  if(a==='list'){const rev=['fm','sa'].includes(role),fin=rev||role==='acc';return {can_review:rev,inbox:rev?reqs.filter(x=>x.status==='pending'&&x.by_role!==role).map(row):[],
    items:reqs.filter(x=>fin||x.by_role===role).map(row),balances:fin?[{person_id:'p-huda',name:'هدى',total:720,recovered:0,this_month:0,last_month:'2027-02-01'}]:[]};}};
 w.SSMPDToast={show:()=>{}};w.prompt=()=>'يدفع كاش';w.confirm=()=>true;
 w.SSMPDDb={client:{rpc:async(n,a)=>{calls.push([role,n,a.p_action,JSON.parse(JSON.stringify(a.p))]);assert.equal(n,'clinic_finance_employee_debt');try{return {data:server(a.p_action,a.p)};}catch(e){return {error:e};}}}};
 w.SSMPDFinanceControls={panel:t=>'<p>prior:'+t+'</p>',act:()=>false};
 const se={decorate:()=>{}};w.SSMPDShiftExpenses=se;
 // the REAL reception modal() (header ×, Esc, footer cancel)
 const rw=fs.readFileSync('assets/js/reception-workspace.js','utf8'),m0=rw.indexOf('function modal(title,body,save,onSaved,opts)'),m1=rw.indexOf('function guideKey()');
 w.eval('var host=null;function esc(v){return String(v==null?"":v).replace(/[&<>"\']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",\'"\':"&quot;","\'":"&#39;"}[c];});}function friendly(e){return e;}async function load(){}'+rw.slice(m0,m1)+';window.__modal=modal;');
 w.crypto.randomUUID=w.crypto.randomUUID||(()=>'k'+Math.random());
 w.eval(fs.readFileSync('assets/js/employee-debt.js','utf8'));const E=w.SSMPDEmployeeDebt;
 assert.ok(se._emd,'hooked into the reception decorate chain');
 assert.equal(w.SSMPDFinanceControls.panel('reports',{},{}),'<p>prior:reports</p>','other finance tabs untouched');
 let loads=0;const ctx={host:d.getElementById('host'),workspace:'ws-live',data:{workspace:{mode:'live'}},modal:w.__modal,load:()=>{loads++;}};
 se.decorate(ctx,'operations');await tick();await tick();
 const card=()=>d.querySelector('[data-emd]');assert.ok(card(),'card on the live operations screen');assert.match(card().textContent,/على حساب الموظف/);

 // ---- 1) «تسجيل تحصيل» (real modal markup) → the new method
 const collect=inv=>{w.__modal('تسجيل تحصيل','<label>المبلغ بالجنيه<input name="amount" type="number" required value="360"></label><label>طريقة السداد<select name="method" required><option value="cash">نقدي</option><option value="pos">فيزا</option></select></label><label>رقم الإيصال<input name="reference" required value="R-1"></label><label>وردية<select name="shift_id"><option value="s1">s1</option></select></label><input type="hidden" name="patient_id" value="pt"><input type="hidden" name="invoice_id" value="'+inv+'">',
   async()=>{calls.push([role,'collect-normal']);return {};});return d.querySelector('.rx-modal');};
 let m=collect('inv-200');await tick();await tick();
 const method=m.querySelector('[name=method]');assert.ok([...method.options].some(o=>o.value==='employee'&&/على حساب الموظف \(يتخصم من المرتب\)/.test(o.textContent)),'method added');
 assert.ok(m.querySelector('[data-emd-collect]').hidden,'hidden until chosen');
 assert.ok(m.querySelector('.modal-close'),'✕ there (rule 10)');
 method.value='employee';method.dispatchEvent(new w.Event('change'));
 assert.ok(!m.querySelector('[data-emd-collect]').hidden);assert.ok(m.querySelector('[name=amount]').disabled&&m.querySelector('[name=amount]').closest('label').hidden,'cash fields off');
 assert.match(m.querySelector('[data-emd-entry]').textContent,/1142/);assert.match(m.querySelector('[data-emd-entry]').textContent,/مفيش فلوس دخلت/);
 assert.equal(m.querySelector('footer [type=submit]').textContent,'ابعت للموافقة');
 m.querySelector('[name=emd_mode][value=split]').checked=true;m.querySelector('[name=emd_mode][value=split]').dispatchEvent(new w.Event('change'));
 assert.ok(!m.querySelector('[data-emd-months]').hidden);assert.match(m.querySelector('[data-emd-sum]').textContent,/3 شهور × 120\.00 — من ديسمبر 2026 لحد فبراير 2027/);
 m.querySelector('[name=emd_reason]').value='كشف هدى — يتخصم من المرتب';
 m.querySelector('footer [type=submit]').click();await tick();await tick();
 let c=calls.filter(x=>x[2]==='request').pop();assert.equal(c[0],'mazen');assert.deepEqual([c[3].kind,c[3].invoice_id,c[3].person_id,c[3].months,c[3].first_month],['service','inv-200','p-huda',3,'2026-12-01']);
 assert.ok(!calls.some(x=>x[1]==='collect-normal'),'the cash collect command was NOT sent');assert.ok(!d.querySelector('.rx-modal'),'modal closed');assert.equal(loads,1,'screen reloaded');
 // the same invoice now shows «مستنية اعتماد الخصم من المرتب» and no method
 m=collect('inv-200');await tick();await tick();assert.match(m.textContent,/مستنية اعتماد الخصم من المرتب/);assert.ok(![...m.querySelector('[name=method]').options].some(o=>o.value==='employee'));
 m.querySelector('.modal-close').click();assert.ok(!d.querySelector('.rx-modal'),'✕ closes');
 // not eligible / already paid → no method; normal cash collect still works
 m=collect('inv-other');await tick();await tick();assert.ok(![...m.querySelector('[name=method]').options].some(o=>o.value==='employee'),'patient not staff → no method');
 m.querySelector('footer [type=submit]').click();await tick();assert.ok(calls.some(x=>x[1]==='collect-normal'),'cash path untouched');
 m=collect('inv-paid');await tick();await tick();assert.ok(![...m.querySelector('[name=method]').options].some(o=>o.value==='employee'));
 m.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape'}));assert.ok(!d.querySelector('.rx-modal'),'Esc closes');
 // trial workspace: nothing
 se.decorate({...ctx,data:{workspace:{mode:'trial'}}},'operations');m=collect('inv-300');await tick();await tick();assert.ok(![...m.querySelector('[name=method]').options].some(o=>o.value==='employee'),'trial → no method');m.querySelector('.modal-close').click();
 se.decorate(ctx,'operations');

 // ---- 2) card: convert visit 195 (cash by mistake)
 card().querySelector('[data-emd-convert]').click();await tick();await tick();m=d.querySelector('.rx-modal');
 assert.equal(m.querySelector('#rx-title').textContent,'تحويل التحصيل لمديونية على الموظف');assert.match(m.querySelector('[name=payment_id]').textContent,/زيارة 195 — هدى — 360\.00 — مازن \(مفتوحة\)/);
 assert.match(m.textContent,/الكاش المتوقع في الدرج يقل −360\.00/);assert.ok(m.querySelector('.modal-close'));assert.equal(m.querySelector('[data-rx-cancel]').textContent,'رجوع');
 assert.match(m.querySelector('[data-emd-sum]').textContent,/مرة واحدة من مرتب ديسمبر 2026/);
 assert.ok(m.querySelector('.emd-adv')&&!m.querySelector('.emd-adv').open,'accounting entry under «خيارات متقدمة», closed by default');assert.match(m.querySelector('.emd-plain').textContent,/هيتسجلوا على الموظف/);
 const qbox=m.querySelector('[data-emd-q]');qbox.value='195';qbox.dispatchEvent(new w.Event('input'));assert.ok(!m.querySelector('[name=payment_id]').options[0].hidden,'search keeps the match');
 qbox.value='zzz';qbox.dispatchEvent(new w.Event('input'));assert.ok(m.querySelector('[name=payment_id]').options[0].hidden,'search hides non-matches');qbox.value='';qbox.dispatchEvent(new w.Event('input'));
 m.querySelector('[data-rx-cancel]').click();assert.ok(!d.querySelector('.rx-modal'),'«رجوع» closes');
 card().querySelector('[data-emd-convert]').click();await tick();await tick();m=d.querySelector('.rx-modal');
 m.querySelector('footer [type=submit]').click();await tick();await tick();await tick();
 c=calls.filter(x=>x[2]==='request').pop();assert.deepEqual([c[0],c[3].kind,c[3].payment_id,c[3].months,c[3].first_month],['mazen','convert','pay-195',1,'2026-12-01']);assert.match(c[3].reason,/بالغلط/);
 await tick();await tick();assert.equal(card().querySelectorAll('li').length,2,'my two requests listed');assert.match(card().textContent,/مستني موافقة/);
 // «الغي» on my pending request
 card().querySelector('[data-emd-cancel="d2"]').click();await tick();await tick();await tick();assert.equal(calls.filter(x=>x[2]==='cancel').pop()[0],'mazen');assert.match(card().textContent,/اتلغى/);
 card().querySelector('[data-emd-convert]').click();await tick();await tick();m=d.querySelector('.rx-modal');m.querySelector('footer [type=submit]').click();await tick();await tick();await tick();

 // ---- 3) finance: approvals inside «طلبات صرف من الدرج»
 const fin=async r=>{role=r;d.getElementById('fin').innerHTML=w.SSMPDFinanceControls.panel('drawer-requests',{},{});await tick();await tick();return d.querySelector('[data-employee-debts]');};
 let box=await fin('acc');assert.match(d.getElementById('fin').innerHTML,/prior:drawer-requests/,'drawer requests kept above');assert.ok(!box.querySelector('[data-emd-ok]'),'accountant: no approve buttons');assert.ok(box.querySelector('[data-emd-bal]'),'accountant sees balances');
 box=await fin('nada');assert.ok(!box.querySelector('[data-emd-ok]'));
 box=await fin('fm');let oks=box.querySelectorAll('[data-emd-ok]');
 const ff=box.querySelector('[data-emd-filter]');ff.value='لا يوجد';ff.dispatchEvent(new w.Event('input'));assert.ok([...box.querySelectorAll('[data-emd-items] tbody tr')].every(r=>r.hidden),'filter hides');ff.value='هدى';ff.dispatchEvent(new w.Event('input'));assert.ok([...box.querySelectorAll('[data-emd-items] tbody tr')].some(r=>!r.hidden),'filter shows matches');assert.equal(oks.length,2,'FM inbox: 2 pending');assert.match(box.textContent,/3 × 120\.00/);assert.match(box.textContent,/مديونيات الموظفين/);
 oks[0].click();await tick();await tick();assert.deepEqual(calls.filter(x=>x[2]==='review').pop().slice(0,3),['fm','clinic_finance_employee_debt','review']);assert.equal(calls.filter(x=>x[2]==='review').pop()[3].ok,true);
 box=d.querySelector('[data-employee-debts]');assert.equal(box.querySelectorAll('[data-emd-ok]').length,1);
 box=await fin('sa');box.querySelector('[data-emd-no]').click();await tick();await tick();c=calls.filter(x=>x[2]==='review').pop();assert.deepEqual([c[0],c[3].ok,c[3].note],['sa',false,'يدفع كاش']);
 assert.match(d.querySelector('[data-employee-debts]').textContent,/اترفض/);
 assert.ok(reqs.some(x=>x.status==='approved'&&x.kind==='service'),'FM approved the service debt');
 // help + cache tokens
 const html=fs.readFileSync('index.html','utf8');assert.ok(html.indexOf('drawer-requests.js')<html.indexOf('employee-debt.js')&&html.indexOf('employee-debt.js')<html.indexOf('finance-cash.js'),'load order');
 assert.match(html,/employee-debt\.js\?v=employee-debt-20261127-3/);assert.match(html,/employee-debt\.css\?v=employee-debt-20261127-3/);
 const help=fs.readFileSync('assets/js/dashboard-help-data.js','utf8');assert.match(help,/"id": "employee-debt"/);
 console.log('employee-debt-dom: OK');
})().catch(e=>{console.error(e);process.exit(1);});
