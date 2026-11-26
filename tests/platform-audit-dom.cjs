// Booking platforms screens (20261126180000, help 306), every new button by its real role (live data shape from the server):
// accountant «مراجعة الفترة» from «حسابات آخر الشهر» (preview, 1 / 2 months, agreed amount → deduction destination 4122) and from
// «مستحقات الموردين»; FM sees the «حساب تاني من الشجرة» choices and agrees by %; GM approves / rejects (with a reason) another
// person's audit; nobody sees approve on their own; the platform settle request; ✕ closes every new window (rule 10).
const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
(async()=>{const dom=new JSDOM('<!doctype html><body><div id="host"></div><main id="fin"></main></body>',{runScripts:'outside-only'});
 const w=dom.window,d=w.document,calls=[],tick=()=>new Promise(r=>setTimeout(r,5));let role='acc';
 const fin=()=>['acc','fm','gm'].includes(role),reqr=()=>['acc','fm'].includes(role),mgr=()=>['fm','gm'].includes(role);
 const parties=()=>[{key:'vezeeta',name:'فيزيتا',direction:'payable',percent:25,count:2,accrued:212.5,settled:0,pending:0,remaining:180,balance:180,platform:true,audited_through:'2030-01-01',sort:1},
  {key:'kafaret',name:'كفارة <وسلامتك>',direction:'payable',percent:25,count:1,accrued:100,settled:0,pending:0,remaining:0,balance:0,platform:true,sort:4},
  {key:'lab',name:'المعمل',direction:'payable',percent:null,count:0,accrued:0,settled:0,pending:0,remaining:0,sort:5}];
 const audits=[{id:'a1',party:'vezeeta',party_name:'فيزيتا',from:'2030-01-01',to:'2030-01-01',ours:212.5,theirs:300,theirs_ref:'فاتورة 1',agreed_mode:'amount',agreed_value:180,agreed:180,deduction:32.5,extra:0,reason:'حجزين اتلغوا',dest_kind:'income',dest_account:'4122',dest_name:'إيراد تسويات منصات الحجز',status:'pending',by:'المحاسب',who:'acc'}];
 const server=(a,p)=>{if(!fin()&&a!=='my_items')throw Object.assign(new Error('للحسابات والإدارة'));
  if(a==='statement')return {month:'2030-01-01',can_rate:role==='fm',can_request:reqr(),can_review:mgr(),can_audit:reqr(),can_account_dest:role==='fm',main_shift:'msh',parties:parties(),settlements:[]};
  if(a==='audits')return {can_audit:reqr(),can_review:mgr(),can_account_dest:role==='fm',income_account:{code:'4122',name:'إيراد تسويات منصات الحجز'},payable_accounts:[{code:'2111',name:'مستحقات الموردين'}],
   other_accounts:role==='fm'?[{code:'5233',name:'عمولات منصات الحجز'}]:[],audits:audits.map(x=>Object.assign({},x,{mine:x.who===role}))};
  if(a==='audit_preview')return {party:p.party,ours:p.from.slice(0,7)===p.to.slice(0,7)?212.5:300,cases:2,percent:25,overlap:false};
  if(a==='audit_request'){if(!reqr())throw new Error('مراجعة الفترة للمحاسب أو المدير المالي');const x=Object.assign({id:'a'+(audits.length+1),status:'pending',who:role,party_name:p.party},p);audits.push(x);return x;}
  if(a==='audit_review'){if(!mgr())throw new Error('اعتماد المراجعة');const x=audits.find(y=>y.id===p.id);if(x.who===role)throw new Error('انت عاملها');x.status=p.ok?'approved':'rejected';x.review_note=p.note;return x;}
  if(a==='platforms')return {can_audit:reqr(),platforms:[{party:'vezeeta',name:'فيزيتا',audited:212.5,extra:0,deducted:32.5,settled:0,pending:0,balance:180},{party:'kafaret',name:'كفارة وسلامتك',audited:100,extra:10,deducted:0,settled:0,pending:0,balance:110}]};
  if(a==='settle_request')return {id:'z1',status:'pending'};
  if(a==='lines')return {lines:[]};return {};};
 w.SSMPDToast={show:()=>{}};w.crypto.randomUUID=()=>'tok-'+calls.length;
 w.SSMPDDb={client:{rpc:async(n,a)=>{calls.push([role,a.p_action,JSON.parse(JSON.stringify(a.p))]);assert.equal(n,'clinic_finance_month_end');try{return {data:server(a.p_action,a.p)};}catch(e){return {error:e};}}}};
 w.SSMPDFinanceControls={panel:t=>'<p data-prior>prior:'+t+'</p>'};
 w.eval(fs.readFileSync('assets/js/month-end-accounts.js','utf8'));
 const open=async()=>{d.getElementById('fin').innerHTML=w.SSMPDFinanceControls.panel('month-end',{},{});for(let i=0;i<5;i++)await tick();return d.querySelector('[data-month-end]');};
 const modalEl=()=>d.querySelector('.mea-modal');
 const set=(m,vals)=>{for(const [k,v] of Object.entries(vals)){const el=m.querySelector('[name='+k+']');el.value=v;if(el.onchange)el.onchange();if(el.oninput)el.oninput();}};
 const submit=async()=>{modalEl().querySelector('form').onsubmit({preventDefault(){}});for(let i=0;i<4;i++)await tick();};
 const last=a=>calls.filter(c=>c[1]===a).at(-1);
 // ---- accountant: audit from «حسابات آخر الشهر»
 let box=await open();assert.match(box.innerHTML,/كفارة &lt;وسلامتك&gt;/,'escaped');assert.match(box.textContent,/منصة حجز/);
 assert.ok(box.querySelector('[data-mea-audit="vezeeta"]')&&box.querySelector('[data-mea-audit="kafaret"]'));assert.ok(!box.querySelector('[data-mea-audit="lab"]'),'lab is not a platform');
 assert.ok(!box.querySelector('[data-mea-aok]'),'accountant cannot approve');assert.match(box.querySelector('[data-mea-audits]').textContent,/حجزين اتلغوا/);
 box.querySelector('[data-mea-audit="vezeeta"]').click();for(let i=0;i<4;i++)await tick();let m=modalEl();assert.ok(m,'audit window open');
 assert.deepEqual(last('audit_preview')[2],{party:'vezeeta',from:'2030-01-01',to:'2030-01-01'});assert.equal(m.querySelector('[data-mea-ours]').textContent,'212.50');
 assert.ok(m.querySelector('[data-mea-destwrap]').hidden,'no destination before the agreed figure');
 assert.ok(![...m.querySelectorAll('[name=dest] option')].some(o=>o.value.startsWith('account:')),'no chart accounts for the accountant');
 set(m,{span:'2'});for(let i=0;i<3;i++)await tick();assert.deepEqual(last('audit_preview')[2],{party:'vezeeta',from:'2029-12-01',to:'2030-01-01'},'2 months = this + previous');
 assert.equal(m.querySelector('[data-mea-ours]').textContent,'300.00');set(m,{span:'1'});for(let i=0;i<3;i++)await tick();
 set(m,{theirs:'300',theirs_ref:'فاتورة فيزيتا 1125',agreed_mode:'amount',agreed_value:'180',reason:'كشفين اتلغوا'});
 assert.equal(m.querySelector('[data-mea-destwrap]').hidden,false,'deduction → destination shown');assert.match(m.querySelector('[data-mea-sum]').textContent,/خصم المراجعة 32.50/);
 set(m,{dest:'income:4122'});await submit();assert.ok(!modalEl(),'closed after send');
 assert.deepEqual(last('audit_request')[2],{party:'vezeeta',from:'2030-01-01',to:'2030-01-01',theirs:'300',theirs_ref:'فاتورة فيزيتا 1125',agreed_mode:'amount',agreed_value:'180',reason:'كشفين اتلغوا',dest_kind:'income',dest_account:'4122',token:last('audit_request')[2].token});
 // ✕ closes the audit window (rule 10)
 box=await open();box.querySelector('[data-mea-audit="kafaret"]').click();for(let i=0;i<4;i++)await tick();modalEl().querySelector('.modal-close').click();assert.ok(!modalEl(),'✕ closes');
 // platform settle request (accountant) from the audited balance
 box.querySelector('[data-mea-settle="vezeeta"]').click();await tick();m=modalEl();set(m,{amount:'180',method:'bank',reference:'تحويل فيزيتا'});await submit();
 assert.equal(last('settle_request')[2].party,'vezeeta');assert.equal(last('settle_request')[2].amount,180);
 // ---- FM: agreed by % (above ours → no destination); sees chart accounts
 role='fm';box=await open();box.querySelector('[data-mea-audit="kafaret"]').click();for(let i=0;i<4;i++)await tick();m=modalEl();
 assert.ok([...m.querySelectorAll('[name=dest] option')].some(o=>o.value==='account:5233'),'FM may pick a chart account');
 set(m,{theirs:'110',theirs_ref:'مطالبة كفارة',agreed_mode:'percent',agreed_value:'110',reason:'اتفاق'});assert.ok(m.querySelector('[data-mea-destwrap]').hidden);assert.match(m.querySelector('[data-mea-sum]').textContent,/زيادة/);
 await submit();assert.equal(last('audit_request')[2].dest_kind,null);assert.equal(last('audit_request')[2].agreed_mode,'percent');
 // FM sees approve on the accountant's audit but not on his own
 box=await open();assert.ok(box.querySelector('[data-mea-aok="a1"]'));assert.ok(!box.querySelector('[data-mea-aok="a3"]'),'own audit: no approve');
 // ---- GM: approve one, reject the other with a reason (✕-able window)
 role='gm';box=await open();assert.ok(!box.querySelector('[data-mea-audit]'),'GM does not request audits');
 box.querySelector('[data-mea-aok="a1"]').click();for(let i=0;i<4;i++)await tick();assert.deepEqual(last('audit_review')[2],{id:'a1',ok:true});
 box=await open();box.querySelector('[data-mea-ano="a2"]').click();await tick();m=modalEl();assert.ok(m.querySelector('.modal-close'));set(m,{note:'النسبة غلط'});await submit();
 assert.deepEqual(last('audit_review')[2],{id:'a2',ok:false,note:'النسبة غلط'});assert.equal(audits[1].status,'rejected');
 // ---- «مستحقات الموردين»: platforms next to the suppliers
 role='acc';d.getElementById('fin').innerHTML=w.SSMPDFinanceControls.panel('suppliers',{},{});for(let i=0;i<4;i++)await tick();
 const sup=d.querySelector('[data-platform-payables]');assert.ok(d.querySelector('[data-prior]'),'suppliers screen kept');assert.match(sup.textContent,/منصة حجز/);assert.match(sup.textContent,/−32.50/);assert.match(sup.textContent,/110.00/);
 sup.querySelector('[data-mea-paudit="kafaret"]').click();for(let i=0;i<5;i++)await tick();m=modalEl();assert.ok(m,'audit from suppliers');assert.equal(last('audit_preview')[2].party,'kafaret');
 m.querySelector('[data-mea-cancel]').click();assert.ok(!modalEl());
 role='gm';d.getElementById('fin').innerHTML=w.SSMPDFinanceControls.panel('suppliers',{},{});for(let i=0;i<4;i++)await tick();assert.ok(!d.querySelector('[data-mea-paudit]'),'GM: no audit request');
 assert.equal(w.SSMPDFinanceControls.panel('reports',{},{}),'<p data-prior>prior:reports</p>');
 const html=fs.readFileSync('index.html','utf8');assert.ok(html.indexOf('finance-suppliers.js')<html.indexOf('month-end-accounts.js'),'wraps the suppliers layer');
 console.log('PASS platform audit screens: accountant period audit (1/2 months, preview, deduction → 4122) from month-end and suppliers, platform settle, FM % agreement + chart accounts, GM approve / reject with reason, no self-approve, ✕ closes.');
})().catch(e=>{console.error(e);process.exitCode=1;});
