// «مصروفات الوردية» screens (owner 2026-11-20): reception card + spend (upload then RPC), finance review tab, wiring.
const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
(async()=>{const dom=new JSDOM('<!doctype html><body><div id="host"><div class="rx-actions"></div></div><main id="fin"></main></body>',{runScripts:'outside-only'});
 const w=dom.window,d=w.document,calls=[],ups=[],tick=()=>new Promise(r=>setTimeout(r,5));
 const status={open:true,shift_id:'sh1',register:'خزينة الاستقبال',allowance:500,max:300,spent:220,cash:900,items:[{key:'cleaning',label:'مناديل ومستلزمات نظافة'},{key:'electricity',label:'شحن كارت الكهرباء'}],
  expenses:[{at:'2030-01-01T08:15:00Z',item:'شحن كارت الكهرباء',amount:100,post_review:'ok'},{at:'2030-01-01T11:40:00Z',item:'<b>x</b>',amount:120,post_review:'pending'}]};
 const list={from:'2030-01-01',to:'2030-01-31',can_review:true,registers:[{id:'r0',name:'الرئيسية',kind:'main',allowance:0,max:0},{id:'r1',name:'خزينة الاستقبال',kind:'collection',allowance:500,max:300}],
  expenses:[{id:'e1',at:'2030-01-01T11:40:00Z',amount:120,item:'مناديل',reason:'مناديل — كرتونتين',vendor:'سوبر ماركت',receipt:'u/1.jpg',by:'دينا',register:'خزينة الاستقبال',post_review:'pending',own:false},
   {id:'e2',at:'2030-01-01T08:15:00Z',amount:100,item:'كهرباء',reason:'كهرباء',receipt:'u/2.jpg',by:'محاسب',register:'خزينة الاستقبال',post_review:'pending',own:true}]};
 w.SSMPDToast={show:()=>{}};w.prompt=()=>'مفيش فاتورة واضحة';
 w.SSMPDDb={client:{rpc:async(n,a)=>{calls.push([n,JSON.parse(JSON.stringify(a))]);return {data:a.p_action==='status'?status:a.p_action==='list'?list:{id:'q1',amount:a.p.amount,left:200}};},
  auth:{getUser:async()=>({data:{user:{id:'uid-1'}}})},storage:{from:b=>({upload:async(p,f)=>{ups.push([b,p,f.name]);return {data:{path:p}};},createSignedUrl:async(p)=>({data:{signedUrl:'https://x/'+p}})})}}};
 w.SSMPDFinanceControls={panel:t=>'prior:'+t,act:()=>false,due:1};
 w.eval(fs.readFileSync('assets/js/reception-shift-expenses.js','utf8'));const S=w.SSMPDShiftExpenses;
 assert.equal(w.SSMPDFinanceControls.panel('reports',{},{}),'prior:reports');
 // reception card
 let saveFn=null,onSaved=null;const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const ctx={host:d.getElementById('host'),data:{workspace:{mode:'live'}},field:(n,t,type,v,extra)=>'<label>'+t+'<input name="'+n+'" type="'+(type||'text')+'" '+(extra||'')+'></label>',
  modal:(t,body,save,after)=>{const r=d.createElement('div');r.className='rx-modal';r.innerHTML='<h3>'+esc(t)+'</h3><form class="rx-form">'+body+'</form>';d.body.appendChild(r);saveFn=save;onSaved=after;return r;}};
 S.decorate(ctx,'operations');await tick();const card=d.querySelector('[data-rse]');assert.ok(card);assert.match(card.textContent,/هامش الوردية/);assert.match(card.textContent,/280/);assert.ok(!card.querySelector('.rse-list b b'),'escaped');
 S.decorate(ctx,'operations');await tick();assert.equal(d.querySelectorAll('[data-rse]').length,1,'one card');
 S.decorate({...ctx,data:{workspace:{mode:'trial'}}},'operations');
 card.querySelector('[data-rse-spend]').click();const m=d.querySelector('.rx-modal');assert.equal(m.querySelectorAll('[name=item]').length,2);assert.equal(m.querySelector('[name=amount]').getAttribute('max'),'280');
 assert.ok(m.querySelector('[name=receipt]').required);
 await assert.rejects(()=>saveFn({item:'cleaning',amount:'281',reason:'مناديل',receipt:{name:'r.jpg',size:10}},'k1'),/أكبر من المسموح \(280/);
 await assert.rejects(()=>saveFn({item:'cleaning',amount:'50',reason:'مناديل',receipt:{name:'r.jpg',size:0}},'k1'),/صوّر الإيصال/);
 const r=await saveFn({item:'cleaning',amount:'120',vendor:'سوبر',reason:'مناديل',receipt:{name:'r.JPG',size:100,type:'image/jpeg'}},'k1');
 assert.equal(ups[0][0],'shift-expense-receipts');assert.match(ups[0][1],/^uid-1\/\d+-[a-z0-9]+\.jpg$/);
 const sp=calls.find(c=>c[1].p_action==='spend')[1].p;assert.equal(sp.shift_id,'sh1');assert.equal(sp.item,'cleaning');assert.equal(sp.amount,120);assert.equal(sp.token,'k1');assert.equal(sp.receipt_path,ups[0][1]);
 // finance tab
 d.getElementById('fin').innerHTML=w.SSMPDFinanceControls.panel('shift-expenses',{},{});await tick();await tick();const box=d.querySelector('[data-shift-expenses]');
 assert.match(box.textContent,/مصروفات صغيرة صرفها الاستقبال/);assert.equal(box.querySelectorAll('[data-rse-ok]').length,1,'own expense cannot be reviewed');
 assert.equal(box.querySelectorAll('[data-rse-lim]').length,1,'main treasury not listed for limits');
 box.querySelector('[data-rse-no]').click();await tick();assert.deepEqual(calls.find(c=>c[1].p_action==='review')[1].p,{id:'e1',ok:false,note:'مفيش فاتورة واضحة'});
 // wiring
 const ws=fs.readFileSync('assets/js/reception-workspace.js','utf8');assert.match(ws,/SSMPDShiftExpenses\.decorate\(context\(\),section\)/);
 const fc=fs.readFileSync('assets/js/finance-cash.js','utf8');assert.match(fc,/\['shift-expenses','مصروفات الورديات'\]/);assert.match(fc,/'cases','shift-expenses'\]/);
 assert.match(fs.readFileSync('assets/js/accounting-shell.js','utf8'),/\['shift-expenses','مصروفات الورديات'\]/);
 const html=fs.readFileSync('index.html','utf8');assert.ok(html.indexOf('reception-shift-expenses.js')<html.indexOf('finance-cash.js?v='));
 console.log('PASS reception shift expenses screens.');
})().catch(e=>{console.error(e);process.exit(1);});
