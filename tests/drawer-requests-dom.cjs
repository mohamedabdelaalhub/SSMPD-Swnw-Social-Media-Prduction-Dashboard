// «طلب صرف من الدرج» screens (20261126100000): every button clicked by the role that uses it —
// cashier: new request (advance, supplier with invoice photo), «الغي», «اتصرف»; GM: first approval; FM: second approval;
// accountant: supplier approval and reject (with reason). A small fake server keeps the state per role.
const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
(async()=>{const dom=new JSDOM('<!doctype html><body><div id="host"><div class="rx-actions"></div></div><main id="fin"></main></body>',{runScripts:'outside-only'});
 const w=dom.window,d=w.document,calls=[],ups=[],tick=()=>new Promise(r=>setTimeout(r,5));let role='cashier',seq=0;const reqs=[];
 const row=x=>Object.assign({},x,{mine:x.by_role===role,by:x.by_role});
 const server=(a,p)=>{
  if(a==='status'){const cash=role==='cashier';return {shift_id:cash?'sh1':null,cash:900,can_request:cash,can_first:['gm','sa'].includes(role),can_final:role==='fm',can_supplier:['acc','fm'].includes(role),
    employees:cash?[{subject:'EMP-7',name:'منار موسى'}]:[],suppliers:cash?[{id:'sup1',name:'صيدلية <العزبي>'}]:[],mine:reqs.filter(x=>x.by_role===role).map(row),
    inbox:reqs.filter(x=>x.by_role!==role&&((x.kind!=='supplier'&&x.status==='pending'&&['gm','sa'].includes(role))||(x.kind!=='supplier'&&x.status==='first_ok'&&role==='fm')||(x.kind==='supplier'&&x.status==='pending'&&['acc','fm'].includes(role)))).map(x=>Object.assign(row(x),{step:x.kind==='supplier'?'supplier':x.status==='pending'?'first':'final',supplier_balance:150,employee_advance:0}))};}
  if(a==='request'){const x={id:'q'+(++seq),kind:p.kind,subject:p.subject,subject_name:p.subject?'منار موسى':null,supplier_id:p.supplier_id,supplier:p.supplier_id?'صيدلية <العزبي>':null,amount:p.amount,reason:p.reason,evidence:p.evidence,status:'pending',by_role:role,at:'2030-01-01T09:00:00Z'};reqs.push(x);return row(x);}
  const x=reqs.find(y=>y.id===p.id);
  if(a==='review'){if(!p.ok){x.status='rejected';x.note=p.note;}else x.status=(x.kind!=='supplier'&&x.status==='pending')?'first_ok':'approved';if(x.status==='first_ok')x.first_by='gm';return row(x);}
  if(a==='cancel'){x.status='cancelled';return row(x);}
  if(a==='pay'){if(x.status!=='approved')throw new Error('الطلب لسه مستني الموافقة');x.status='paid';return row(x);}
  if(a==='list')return {items:reqs.map(row)};};
 w.SSMPDToast={show:()=>{}};w.prompt=()=>'الفاتورة مش واضحة';w.confirm=()=>true;
 w.SSMPDDb={client:{rpc:async(n,a)=>{calls.push([role,n,a.p_action,JSON.parse(JSON.stringify(a.p))]);assert.equal(n,'clinic_finance_drawer_request');try{return {data:server(a.p_action,a.p)};}catch(e){return {error:e};}},
  auth:{getUser:async()=>({data:{user:{id:'uid-1'}}})},storage:{from:b=>({upload:async(p,f)=>{ups.push([b,p,f.name]);return {data:{path:p}};},createSignedUrl:async(p)=>({data:{signedUrl:'https://x/'+p}})})}}};
 w.SSMPDFinanceControls={panel:t=>'prior:'+t,act:()=>false,due:1};
 let opened=[];w.open=u=>opened.push(u);
 const se={decorate:()=>{}};w.SSMPDShiftExpenses=se;
 w.eval(fs.readFileSync('assets/js/drawer-requests.js','utf8'));const D=w.SSMPDDrawerRequests;
 assert.equal(w.SSMPDFinanceControls.panel('reports',{},{}),'prior:reports','other tabs untouched');
 assert.ok(se._rdr,'hooked into the reception decorate chain');
 const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let saveFn=null,onSaved=null;
 const ctx={host:d.getElementById('host'),data:{workspace:{mode:'live'}},
  field:(n,t,type,v,extra)=>'<label>'+t+'<input name="'+n+'" type="'+(type||'text')+'" '+(extra||'')+'></label>',
  select:(n,t,rows)=>'<label>'+t+'<select name="'+n+'" required><option value="">اختر</option>'+rows.map(r=>'<option value="'+esc(r[0])+'">'+esc(r[1])+'</option>').join('')+'</select></label>',
  modal:(t,body,save,after)=>{d.querySelectorAll('.rx-modal').forEach(x=>x.remove());const r=d.createElement('div');r.className='rx-modal';r.innerHTML='<h3>'+esc(t)+'</h3><form class="rx-form">'+body+'</form>';d.body.appendChild(r);saveFn=save;onSaved=after;return r;}};
 const card=()=>d.querySelector('[data-rdr]');
 // ---- cashier: card + new advance
 se.decorate(ctx,'operations');await tick();assert.ok(card(),'card shown on the live operations screen');assert.match(card().textContent,/طلب صرف من الدرج/);
 D.decorate({...ctx,data:{workspace:{mode:'trial'}}},'operations');
 card().querySelector('[data-rdr-new]').click();await tick();let m=d.querySelector('.rx-modal');
 assert.equal(m.querySelectorAll('[name=kind]').length,3);assert.ok(!m.querySelector('[data-rdr-emp]').hidden);assert.ok(m.querySelector('[data-rdr-sup]').hidden);assert.ok(m.querySelector('[name=invoice]').disabled,'invoice hidden + disabled for an advance');
 m.querySelector('[name=kind][value=supplier]').checked=true;m.querySelector('[name=kind][value=supplier]').onchange();
 assert.ok(m.querySelector('[data-rdr-emp]').hidden);assert.ok(!m.querySelector('[name=invoice]').disabled);assert.match(m.innerHTML,/صيدلية &lt;العزبي&gt;/,'escaped');
 m.querySelector('[name=kind][value=advance]').checked=true;m.querySelector('[name=kind][value=advance]').onchange();
 let r=await saveFn({kind:'advance',subject:'EMP-7',amount:'400',reason:'سلفة شخصية'},'k1');await onSaved(r);await tick();
 let c=calls.find(x=>x[2]==='request');assert.deepEqual(c[3],{kind:'advance',amount:400,reason:'سلفة شخصية',token:'k1',subject:'EMP-7'});
 assert.match(card().textContent,/مستني الموافقة الأولى/);assert.ok(card().querySelector('[data-rdr-cancel]'),'pending can be cancelled');assert.ok(!card().querySelector('[data-rdr-pay]'),'no pay before approval');
 // ---- cashier: supplier request uploads the invoice first
 card().querySelector('[data-rdr-new]').click();await tick();m=d.querySelector('.rx-modal');m.querySelector('[name=kind][value=supplier]').checked=true;m.querySelector('[name=kind][value=supplier]').onchange();
 const inp=m.querySelector('[name=invoice]');Object.defineProperty(inp,'files',{value:[{name:'inv.JPG',size:200,type:'image/jpeg'}]});
 r=await saveFn({kind:'supplier',supplier_id:'sup1',amount:'150',reason:'أدوية'},'k2');await onSaved(r);await tick();
 assert.equal(ups[0][0],'shift-expense-receipts');assert.match(ups[0][1],/^uid-1\/drw-\d+-[a-z0-9]+\.jpg$/);
 c=calls.filter(x=>x[2]==='request')[1];assert.equal(c[3].supplier_id,'sup1');assert.equal(c[3].evidence,ups[0][1]);assert.equal(c[3].subject,undefined);
 // ---- cashier cancels a third one
 card().querySelector('[data-rdr-new]').click();await tick();r=await saveFn({kind:'incentive',subject:'EMP-7',amount:'50',reason:'حافز'},'k3');await onSaved(r);await tick();
 card().querySelector('[data-rdr-cancel="q3"]').click();await tick();await tick();assert.equal(reqs[2].status,'cancelled');assert.match(card().textContent,/اتلغى/);
 // ---- GM: first approval from the finance tab
 role='gm';d.getElementById('fin').innerHTML=w.SSMPDFinanceControls.panel('drawer-requests',{},{});await tick();await tick();let box=d.querySelector('[data-drawer-requests]');
 assert.equal(box.querySelectorAll('[data-rdr-ok]').length,1,'GM sees the advance only (supplier is the accountant\'s)');assert.match(box.textContent,/الموافقة الأولى/);
 box.querySelector('[data-rdr-ok]').click();await tick();await tick();assert.equal(reqs[0].status,'first_ok');
 // ---- FM: second approval
 role='fm';d.getElementById('fin').innerHTML=w.SSMPDFinanceControls.panel('drawer-requests',{},{});await tick();await tick();box=d.querySelector('[data-drawer-requests]');
 assert.match(box.textContent,/الموافقة التانية/);box.querySelector('[data-rdr-ok="q1"]').click();await tick();await tick();assert.equal(reqs[0].status,'approved');
 // ---- accountant: rejects the supplier invoice with a reason, opens the photo
 role='acc';d.getElementById('fin').innerHTML=w.SSMPDFinanceControls.panel('drawer-requests',{},{});await tick();await tick();box=d.querySelector('[data-drawer-requests]');
 box.querySelector('[data-rdr-file]').click();await tick();assert.equal(opened[0],'https://x/'+ups[0][1]);
 box.querySelector('[data-rdr-no="q2"]').click();await tick();await tick();assert.equal(reqs[1].status,'rejected');
 assert.deepEqual(calls.filter(x=>x[2]==='review').pop()[3],{id:'q2',ok:false,note:'الفاتورة مش واضحة'});assert.match(box.textContent,/اترفض/);
 // ---- cashier: «اتصرف» on the approved advance
 role='cashier';card().remove();se.decorate(ctx,'operations');await tick();const pay=card().querySelector('[data-rdr-pay="q1"]');assert.ok(pay,'approved → «اتصرف»');
 pay.click();await tick();await tick();assert.equal(reqs[0].status,'paid');assert.match(card().textContent,/اتصرف/);assert.ok(!card().querySelector('[data-rdr-pay]'));
 // ---- one-tap opener for UX #881
 assert.equal(typeof w.SSMPDDrawerPayout.open,'function');d.querySelectorAll('.rx-modal').forEach(x=>x.remove());assert.equal(w.SSMPDDrawerPayout.open(),true);await tick();assert.ok(d.querySelector('.rx-modal'),'opens the form');
 // ---- wiring
 const fc=fs.readFileSync('assets/js/finance-cash.js','utf8');assert.match(fc,/\['drawer-requests','طلبات صرف من الدرج'\]/);assert.match(fc,/items:\['requests','drawer-requests',/);
 assert.match(fs.readFileSync('assets/js/accounting-shell.js','utf8'),/\['drawer-requests','طلبات صرف من الدرج'\]/);
 const html=fs.readFileSync('index.html','utf8');const i1=html.indexOf('reception-shift-expenses.js'),i2=html.indexOf('drawer-requests.js'),i3=html.indexOf('finance-cash.js?v=');
 assert.ok(i1<i2&&i2<i3,'loads after shift expenses and before finance-cash');
 console.log('PASS drawer payout request screens: cashier new/cancel/pay, GM first, FM second, accountant reject + invoice, wiring.');
})().catch(e=>{console.error(e);process.exitCode=1;});
