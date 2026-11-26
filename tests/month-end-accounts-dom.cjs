// «حسابات آخر الشهر» screens (20261126110000), every button by its role: FM sets a rate; accountant opens details, voids a line,
// asks for a settlement; GM approves / rejects; reception records a Tahera referral and a dental-lab invoice. Fake server per role.
const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
(async()=>{const dom=new JSDOM('<!doctype html><body><div id="host"><div class="rx-actions"></div></div><main id="fin"></main></body>',{runScripts:'outside-only'});
 const w=dom.window,d=w.document,calls=[],tick=()=>new Promise(r=>setTimeout(r,5));let role='fm';
 const parties=[{key:'vezeeta',name:'فيزيتا',direction:'payable',percent:null,count:0,accrued:0,settled:0,pending:0,remaining:0},{key:'lab',name:'المعمل',direction:'payable',percent:null,count:2,accrued:110,settled:0,pending:0,remaining:110},
  {key:'tahera',name:'مركز <الطاهرة>',direction:'receivable',percent:30,count:1,accrued:1350,settled:0,pending:0,remaining:1350}];
 const sets=[],items=[{id:'i1',party:'dental_lab',day:'2030-01-05',ref:'زيارة 13',description:'زيركون',amount:1350,voided:false,by:'منار'}];
 const server=(a,p)=>{if(a==='statement')return {month:'2030-01-01',can_rate:role==='fm',can_request:['acc','fm'].includes(role),can_review:['fm','gm'].includes(role),main_shift:'msh',parties,settlements:sets.map(z=>Object.assign({},z,{mine:z.role===role}))};
  if(a==='set_rate'){parties.find(x=>x.key===p.party).percent=+p.percent;return {};}
  if(a==='lines')return {lines:[{day:'2030-01-05',ref:'زيارة 9',description:'صورة دم',base:2,amount:110}],items:p.party==='lab'?null:items};
  if(a==='void_item'){items.find(x=>x.id===p.id).voided=true;return {};}
  if(a==='settle_request'){const z={id:'z'+(sets.length+1),party:p.party,amount:p.amount,method:p.method,reference:p.reference,status:'pending',by:role,role};sets.push(z);return z;}
  if(a==='settle_review'){const z=sets.find(x=>x.id===p.id);z.status=p.ok?'approved':'rejected';z.review_note=p.note;return z;}
  if(a==='my_items')return {tahera_percent:30,items:items.filter(x=>x.by==='rec')};
  if(a==='add_item'){items.push({id:'n'+items.length,party:p.party,ref:p.ref,description:p.description,amount:p.amount,by:'rec'});return {};}};
 w.SSMPDToast={show:()=>{}};let promptVal='اتسجلت مرتين';w.prompt=()=>promptVal;w.crypto.randomUUID=()=>'tok-'+calls.length;
 w.SSMPDDb={client:{rpc:async(n,a)=>{calls.push([role,a.p_action,JSON.parse(JSON.stringify(a.p))]);assert.equal(n,'clinic_finance_month_end');return {data:server(a.p_action,a.p)};}}};
 w.SSMPDFinanceControls={panel:t=>'prior:'+t};const se={decorate:()=>{}};w.SSMPDShiftExpenses=se;
 w.eval(fs.readFileSync('assets/js/month-end-accounts.js','utf8'));
 assert.equal(w.SSMPDFinanceControls.panel('reports'),'prior:reports');assert.ok(se._mea);
 const open=async()=>{d.getElementById('fin').innerHTML=w.SSMPDFinanceControls.panel('month-end',{},{});await tick();await tick();return d.querySelector('[data-month-end]');};
 const submit=async(vals)=>{const m=d.querySelector('.mea-modal');for(const [k,v] of Object.entries(vals||{}))m.querySelector('[name='+k+']').value=v;m.querySelector('form').onsubmit({preventDefault(){}});await tick();await tick();};
 // FM: rate for vezeeta (no button for the lab)
 let box=await open();assert.match(box.innerHTML,/مركز &lt;الطاهرة&gt;/,'escaped');assert.match(box.textContent,/مش متحددة/);
 assert.ok(!box.querySelector('[data-mea-rate="lab"]'),'lab has no rate');box.querySelector('[data-mea-rate="vezeeta"]').click();await submit({percent:'20'});
 assert.deepEqual(calls.find(c=>c[1]==='set_rate')[2],{party:'vezeeta',percent:'20'});
 // accountant: no rate button; details + void; settlement request for the lab by bank
 role='acc';box=await open();assert.ok(!box.querySelector('[data-mea-rate]'));assert.ok(!box.querySelector('[data-mea-settle="vezeeta"]'),'nothing left → no request');
 box.querySelector('[data-mea-lines="tahera"]').click();await tick();await tick();let m=d.querySelector('.mea-modal');assert.match(m.textContent,/زيركون/);
 m.querySelector('[data-mea-void="i1"]').click();await tick();await tick();assert.deepEqual(calls.find(c=>c[1]==='void_item')[2],{id:'i1',reason:'اتسجلت مرتين'});
 box=await open();box.querySelector('[data-mea-settle="lab"]').click();m=d.querySelector('.mea-modal');assert.equal(m.querySelector('[name=amount]').value,'110');
 await submit({amount:'200'});assert.ok(!calls.some(c=>c[1]==='settle_request'),'over the remaining is blocked before the server');
 await submit({amount:'110',method:'bank',reference:'تحويل معمل دريم'});
 let sr=calls.find(c=>c[1]==='settle_request')[2];assert.equal(sr.party,'lab');assert.equal(sr.amount,110);assert.equal(sr.method,'bank');assert.equal(sr.month,'2030-01-01');
 box=await open();assert.ok(!box.querySelector('[data-mea-ok]'),'accountant cannot approve');
 // receivable defaults to the wallet
 box.querySelector('[data-mea-settle="tahera"]').click();m=d.querySelector('.mea-modal');assert.equal(m.querySelector('[name=method]').value,'wallet');await submit({reference:'فودافون كاش'});
 // GM approves the lab, rejects Tahera with a reason
 role='gm';box=await open();assert.equal(box.querySelectorAll('[data-mea-ok]').length,2);
 box.querySelector('[data-mea-ok="z1"]').click();await tick();await tick();assert.equal(sets[0].status,'approved');
 promptVal='المرجع غلط';box=d.querySelector('[data-month-end]');box.querySelector('[data-mea-no="z2"]').click();await tick();await tick();assert.equal(sets[1].status,'rejected');
 assert.deepEqual(calls.filter(c=>c[1]==='settle_review').map(c=>c[2]),[{id:'z1',ok:true},{id:'z2',ok:false,note:'المرجع غلط'}]);
 // reception card
 role='rec';const esc=v=>String(v);const ctx={host:d.getElementById('host'),data:{workspace:{mode:'live'}}};
 se.decorate(ctx,'operations');await tick();const card=d.querySelector('[data-mea-card]');assert.ok(card);
 card.querySelector('[data-mea-tahera]').click();m=d.querySelector('.mea-modal');assert.match(m.textContent,/30%/);await submit({ref:'زيارة 12',description:'رنين ركبة',amount:'4500'});
 let ai=calls.find(c=>c[1]==='add_item')[2];assert.equal(ai.party,'tahera');assert.equal(ai.amount,4500);
 d.querySelector('[data-mea-card]').querySelector('[data-mea-dental]').click();await submit({ref:'زيارة 13',description:'زيركون',amount:'1350'});
 assert.equal(calls.filter(c=>c[1]==='add_item')[1][2].party,'dental_lab');assert.match(d.querySelector('[data-mea-card]').textContent,/رنين ركبة/);
 const fc=fs.readFileSync('assets/js/finance-cash.js','utf8');assert.match(fc,/\['month-end','حسابات آخر الشهر'\]/);assert.match(fc,/items:\['requests',(?:'drawer-requests',)?'month-end',/);
 assert.match(fs.readFileSync('assets/js/accounting-shell.js','utf8'),/\['month-end','حسابات آخر الشهر'\]/);
 const html=fs.readFileSync('index.html','utf8');assert.ok(html.indexOf('reception-shift-expenses.js')<html.indexOf('month-end-accounts.js')&&html.indexOf('month-end-accounts.js')<html.indexOf('finance-cash.js?v='));
 console.log('PASS month-end accounts screens: FM rate, accountant details/void/settle (bank, wallet default for receivable), GM approve/reject, reception Tahera + dental entries, wiring.');
})().catch(e=>{console.error(e);process.exitCode=1;});
