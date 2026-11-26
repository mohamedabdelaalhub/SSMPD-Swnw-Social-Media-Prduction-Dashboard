// «حساب الشريك» screen (20261126120000), every button by its role: accountant asks a deposit / withdrawal and opens the statement;
// FM cannot approve his own but approves the accountant's; GM rejects with a reason; super admin adds a partner. Fake server per role.
const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
(async()=>{const dom=new JSDOM('<!doctype html><body><main id="fin"></main></body>',{runScripts:'outside-only'});
 const w=dom.window,d=w.document,calls=[],tick=()=>new Promise(r=>setTimeout(r,5));let role='acc';
 const partners=[{id:'p1',name:'د. دينا <حسني>',account:'3311',active:true,balance:22475,pending:0},{id:'p2',name:'م. محمد',account:'3312',active:true,balance:-160000,pending:0}],moves=[];
 const server=(a,p)=>{if(a==='status')return {can_request:['acc','fm'].includes(role),can_review:['fm','gm','sa'].includes(role),can_add:role==='sa',main_shift:'msh',main_cash:30000,partners,pending:moves.filter(m=>m.status==='pending').map(m=>Object.assign({},m,{mine:m.role===role}))};
  if(a==='request'){const m=Object.assign({id:'m'+(moves.length+1),status:'pending',role,partner:partners.find(x=>x.id===p.partner_id).name},p);moves.push(m);return m;}
  if(a==='review'){const m=moves.find(x=>x.id===p.id);m.status=p.ok?'approved':'rejected';return m;}
  if(a==='statement')return {partner:'د. دينا <حسني>',balance:22475,lines:[{at:'2030-08-01T10:00:00Z',description:'توريد',in:27000,out:0,balance:27000},{at:'2030-08-08T10:00:00Z',description:'صرف',in:0,out:4525,balance:22475}],moves:[]};
  if(a==='add_partner'){partners.push({id:'p3',name:p.name,account:'3313',active:true,balance:0,pending:0});return {};}};
 w.SSMPDToast={show:()=>{}};w.prompt=()=>'المبلغ غلط';w.crypto.randomUUID=()=>'tok-'+calls.length;
 w.SSMPDDb={client:{rpc:async(n,a)=>{calls.push([role,a.p_action,JSON.parse(JSON.stringify(a.p))]);assert.equal(n,'clinic_finance_partner');return {data:server(a.p_action,a.p)};}}};
 w.SSMPDFinanceControls={panel:t=>'prior:'+t};w.eval(fs.readFileSync('assets/js/partner-accounts.js','utf8'));
 assert.equal(w.SSMPDFinanceControls.panel('reports'),'prior:reports');
 const open=async()=>{d.getElementById('fin').innerHTML=w.SSMPDFinanceControls.panel('partners',{},{});await tick();await tick();return d.querySelector('[data-partners]');};
 const submit=async(vals)=>{const m=d.querySelector('.pa-modal');for(const [k,v] of Object.entries(vals||{}))m.querySelector('[name='+k+']').value=v;m.querySelector('form').onsubmit({preventDefault(){}});await tick();await tick();};
 let box=await open();assert.match(box.innerHTML,/د\. دينا &lt;حسني&gt;/,'escaped');assert.match(box.textContent,/المركز عليه للشريك/);assert.match(box.textContent,/الشريك عليه للمركز/);
 assert.ok(!box.querySelector('[data-pa-add]'),'only super admin adds');
 box.querySelector('[data-pa-req="p1"][data-kind="deposit"]').click();await submit({amount:'27000',method:'cash',reason:'توريد لدفع الإيجار'});
 let r=calls.find(c=>c[1]==='request')[2];assert.deepEqual([r.partner_id,r.kind,r.amount,r.method],['p1','deposit',27000,'cash']);
 box=await open();assert.ok(!box.querySelector('[data-pa-ok]'),'accountant cannot approve');
 box.querySelector('[data-pa-st="p1"]').click();await tick();await tick();assert.match(d.querySelector('.pa-modal').textContent,/22,475\.00/);d.querySelector('.pa-modal [data-pa-cancel]').click();
 role='fm';box=await open();box.querySelector('[data-pa-req="p2"][data-kind="withdrawal"]').click();await submit({amount:'5000',method:'bank',reason:'صرف للشريك'});
 box=await open();assert.ok(box.querySelector('[data-pa-ok="m1"]'));assert.ok(!box.querySelector('[data-pa-ok="m2"]'),'not his own');
 box.querySelector('[data-pa-ok="m1"]').click();await tick();await tick();assert.equal(moves[0].status,'approved');
 role='gm';box=await open();box.querySelector('[data-pa-no="m2"]').click();await tick();await tick();assert.equal(moves[1].status,'rejected');
 assert.deepEqual(calls.filter(c=>c[1]==='review').map(c=>c[2]),[{id:'m1',ok:true},{id:'m2',ok:false,note:'المبلغ غلط'}]);
 role='sa';box=await open();box.querySelector('[data-pa-add]').click();await submit({name:'شريك جديد'});assert.deepEqual(calls.find(c=>c[1]==='add_partner')[2],{name:'شريك جديد'});
 const fc=fs.readFileSync('assets/js/finance-cash.js','utf8');assert.match(fc,/\['partners','حساب الشريك'\]/);assert.match(fc,/'assets','partners','taxes'/);
 assert.match(fs.readFileSync('assets/js/accounting-shell.js','utf8'),/\['partners','حساب الشريك'\]/);
 const html=fs.readFileSync('index.html','utf8');assert.ok(html.indexOf('partner-accounts.js')<html.indexOf('finance-cash.js?v='));
 console.log('PASS partner accounts screen: accountant request + statement, FM approve (not own), GM reject, SA add partner, wiring.');
})().catch(e=>{console.error(e);process.exitCode=1;});
