// Owner 2026-11-19: «تحصيل ماسا» finance tab — totals, by cashier/doctor, receipts, voided toggle, filters, naming, escaping, wiring.
const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
(async()=>{const dom=new JSDOM('<!doctype html><body><main id="m"></main></body>',{runScripts:'outside-only'});const w=dom.window,d=w.document,calls=[];
 const data={synced_at:new Date(Date.now()-3*60000).toISOString(),totals:{all:850,by_method:{cash:500,card:350}},
  by_cashier:[{cashier_user_id:4,name:'دينا',safe_id:1,safe:'خزنة ١',receipts:2,amount:900},{cashier_user_id:12,name:null,safe_id:3,safe:null,receipts:1,amount:350}],
  by_doctor:[{doctor:'أخصائي جلدية',receipts:1,insured:1,amount:500},{doctor:'بدون حجز مربوط',receipts:1,insured:0,amount:350}],
  receipts:[{id:'9',receipt_no:'R-9',paid_at:'2026-11-19T08:42:00Z',patient:'<img src=x onerror=1>',phone:'010',booking:'5001',doctor:'أخصائي جلدية',methods:'نقدي',cashier:'دينا',amount:500,insured:true,insurance:'شركة تأمين'},
   {id:'11',receipt_no:'R-11',paid_at:'2026-11-19T10:31:00Z',patient:'مريض رابع',doctor:'أخصائي أسنان',methods:'نقدي',cashier:'دينا',amount:400,deleted:true}],
  admins:[{id:'a1',name:'دينا'},{id:'a2',name:'سارة'}]};
 w.SSMPDToast={show:()=>{}};
 w.SSMPDDb={client:{rpc:async(n,a)=>{calls.push([n,JSON.parse(JSON.stringify(a))]);return {data:a.p_action==='list'?data:{ok:true},error:null};}}};
 w.SSMPDFinanceControls={panel:(t)=>'prior:'+t,act:()=>false,due:1};
 w.eval(fs.readFileSync('assets/js/finance-masa-payments.js','utf8'));
 assert.equal(w.SSMPDFinanceControls.panel('reports',{},{}),'prior:reports','other tabs pass through');assert.equal(w.SSMPDFinanceControls.due,1);
 d.getElementById('m').innerHTML=w.SSMPDFinanceControls.panel('masa-payments',{},{});await new Promise(r=>setTimeout(r,20));
 const box=d.querySelector('[data-masa-payments]');assert.equal(calls[0][0],'clinic_finance_masa_payments');assert.equal(calls[0][1].p_action,'list');
 assert.match(box.textContent,/مش بيدخل ورديات الخزنة ولا بيغيّر أي رصيد/);assert.match(box.textContent,/من 3 دقيقة/);
 assert.match(box.querySelector('.mp-k.hero').textContent,/850/);assert.match(box.textContent,/مستخدم ماسا #12/);
 assert.ok(!box.querySelector('img'),'escaped');assert.ok(box.querySelector('.mp-void'));assert.match(box.textContent,/ملغي على ماسا/);assert.match(box.textContent,/شركة تأمين/);
 // default range: this month so far (Cairo)
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo'}).format(new Date());assert.equal(calls[0][1].p.to,today);assert.equal(calls[0][1].p.from,today.slice(0,8)+'01');
 // filters
 box.querySelector('[data-mp="method"]').value='card';box.querySelector('[data-mp="method"]').dispatchEvent(new w.Event('change'));await new Promise(r=>setTimeout(r,10));
 assert.equal(calls.at(-1)[1].p.method,'card');
 const del=d.querySelector('[data-mp="deleted"]');del.checked=true;del.dispatchEvent(new w.Event('change'));await new Promise(r=>setTimeout(r,10));assert.equal(calls.at(-1)[1].p.include_deleted,true);
 // naming: pick an admin by number, or a free label
 w.prompt=()=>'2';d.querySelector('[data-mp-name="12"]').click();await new Promise(r=>setTimeout(r,10));
 assert.deepEqual(calls.find(c=>c[1].p_action==='name_cashier')[1].p,{cashier_user_id:12,admin_id:'a2'});
 w.prompt=()=>'خزنة الاستقبال ٢';d.querySelector('[data-mp-safe="3"]').click();await new Promise(r=>setTimeout(r,10));
 assert.deepEqual(calls.find(c=>c[1].p_action==='name_safe')[1].p,{safe_id:3,label:'خزنة الاستقبال ٢'});
 // an error is shown inside the panel with a retry, an empty period says so
 let fail=true;w.SSMPDDb.client.rpc=async(n,a)=>{calls.push([n,JSON.parse(JSON.stringify(a))]);return fail?{data:null,error:{message:'Could not find the function'}}:{data:{totals:{all:0,by_method:{}},receipts:[]},error:null};};
 await w.SSMPDMasaPayments.load(box);assert.match(box.querySelector('.mp-err').textContent,/ما اتحمّلش/);assert.match(box.textContent,/Could not find the function/);
 fail=false;box.querySelector('[data-mp-retry]').click();await new Promise(r=>setTimeout(r,10));assert.ok(!box.querySelector('.mp-err'));assert.match(box.querySelector('.mp-empty').textContent,/مفيش إيصالات من ماسا/);
 // tab wired into the finance screen + loaded before it
 const fc=fs.readFileSync('assets/js/finance-cash.js','utf8');assert.match(fc,/\['masa-payments','تحصيل ماسا'\]/);assert.match(fc,/items:\['reports','masa-payments','masa-net','audit'\]/);
 const html=fs.readFileSync('index.html','utf8');assert.ok(html.indexOf('finance-masa-payments.js')<html.indexOf('finance-cash.js?v='));
 console.log('PASS finance «تحصيل ماسا» screen.');
})().catch(e=>{console.error(e);process.exit(1);});
