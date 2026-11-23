// Browser check (mock data): «تسعير الأصناف», «خصم آخر الشهر», «تقرير الأدوية» sheets at 1280 and 390, RPC payloads.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),path=require('path');
const root=path.resolve(__dirname,'..'),out=process.env.SHOTS||'';
const items=[{id:'m1',name:'كيتولاك أمبول',unit:'أمبول',pricing_kind:'supply',markup_percent:35,sale_price:32.4,purchase_price:24},{id:'g1',name:'جلافز',unit:'قطعة',pricing_kind:'supply',markup_percent:35,sale_price:2.43,purchase_price:1.8}];
const preview={supplier:'شركة أدوية تجريبية',month:'2026-11-01',basis:14000,existing:null,invoices:[{reference:'PH-1102',invoice_date:'2026-11-03',total:4800,excluded:0,basis:4800},{reference:'PH-1131',invoice_date:'2026-11-14',total:6250,excluded:450,basis:5800}]};
const list=[{id:'d1',supplier:'مورد أدوية تاني',basis:3200,amount:320,percent:10,created_by_name:'محاسب تجريبي',status:'pending'}];
const report={month:'2026-11-01',discounts:1680,sales:{medicine:{revenue:12400,cost:12400},shortage:{revenue:540,cost:450}},suppliers:[{supplier:'شركة أدوية تجريبية',purchases:14450,basis:14000,discount:1680,percent:12,status:'approved'},{supplier:'مورد أدوية تاني',purchases:3200,basis:3200,discount:null,percent:null,status:'missing'}]};
(async()=>{const b=await chromium.launch({args:['--no-sandbox']});
for(const width of [1280,390]){const p=await b.newPage({viewport:{width,height:900}});
 await p.setContent('<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"></head><body></body></html>');
 for(const f of ['assets/css/styles.css','assets/css/reception-minicards.css','assets/css/medicines-pricing.css'])await p.addStyleTag({path:path.join(root,f)});
 await p.evaluate(([items,preview,list,report])=>{window.__c=[];window.SSMPDToast={show:(m,k)=>window.__c.push(['toast',m,k])};window.prompt=()=>'سبب تجريبي';
  window.SSMPDFinanceControls={panel:()=>'<p>base</p>',act:()=>false,due:()=>0};
  window.SSMPDDb={client:{rpc:(n,a)=>{window.__c.push([n,JSON.parse(JSON.stringify(a||{}))]);let d=null;
   if(n==='inventory_pricing_list')d=items;if(n==='inventory_set_pricing_kind')d={pricing_kind:a.p_kind,markup_percent:a.p_kind==='medicine'?0:a.p_markup,sale_price:a.p_kind==='medicine'?24:32.4};
   if(n==='clinic_finance_supplier_discount')d={preview,list,report,create:{amount:1680},review:{status:'approved'}}[a.p_action];return Promise.resolve({data:d});}}};},[items,preview,list,report]);
 for(const f of ['assets/js/reception-minicards.js','assets/js/medicines-pricing.js'])await p.addScriptTag({path:path.join(root,f)});
 // finance layer adds both buttons on «الموردون» only
 const panel=await p.evaluate(()=>window.SSMPDFinanceControls.panel('suppliers',{},{btn:(a,i,t)=>'<button data-fin-action="'+a+'">'+t+'</button>'}));assert.match(panel,/month-discount/);assert.match(panel,/medicines-report/);
 assert.equal(await p.evaluate(()=>window.SSMPDFinanceControls.panel('bank',{},{btn:()=>''})),'<p>base</p>');
 // pricing
 await p.evaluate(()=>window.SSMPDMedicines.pricing());await p.waitForSelector('[data-mdp-row="m1"]');
 await p.selectOption('[data-mdp-row="m1"] [data-mdp-k]','medicine');assert.equal(await p.inputValue('[data-mdp-row="m1"] [data-mdp-m]'),'0');assert.equal(await p.textContent('[data-mdp-row="m1"] [data-mdp-p]'),'24.00');
 if(out)await p.screenshot({path:path.join(out,'pricing-'+width+'.png'),fullPage:true});
 await p.click('[data-mdp-row="m1"] [data-mdp-save]');await p.waitForTimeout(100);
 let c=(await p.evaluate(()=>window.__c)).find(x=>x[0]==='inventory_set_pricing_kind');assert.deepEqual(c[1],{p_item:'m1',p_kind:'medicine',p_markup:null});
 await p.click('[data-rx-sheet-close]');
 // discount
 await p.evaluate(()=>window.SSMPDMedicines.discount([{id:'s1',name:'شركة أدوية تجريبية'}]));await p.waitForSelector('[data-mdd]');
 await p.selectOption('[data-mdd] [name="supplier"]','s1');await p.waitForSelector('[data-mdd-create]');
 await p.fill('[data-mdd] [name="percent"]','12');assert.equal((await p.textContent('[data-mdd-amt]')).trim(),'1,680.00 ج');
 if(out)await p.screenshot({path:path.join(out,'discount-'+width+'.png'),fullPage:true});
 await p.click('[data-mdd-create]');await p.waitForTimeout(150);
 c=(await p.evaluate(()=>window.__c)).find(x=>x[0]==='clinic_finance_supplier_discount'&&x[1].p_action==='create');assert.equal(c[1].p_payload.percent,12);assert.equal(c[1].p_payload.amount,null);assert.equal(c[1].p_payload.supplier_id,'s1');assert(c[1].p_payload.token);
 await p.click('[data-mdd-ok="d1"]');await p.waitForTimeout(100);
 c=(await p.evaluate(()=>window.__c)).find(x=>x[0]==='clinic_finance_supplier_discount'&&x[1].p_action==='review');assert.deepEqual(c[1].p_payload,{id:'d1',approve:true,note:''});
 await p.click('[data-rx-sheet-close]');
 // report
 await p.evaluate(()=>window.SSMPDMedicines.report());await p.waitForSelector('[data-mdr] .mdr-kpi.hero');
 assert.match(await p.textContent('[data-mdr] .mdr-kpi.hero'),/1,770.00/);
 if(out)await p.screenshot({path:path.join(out,'report-'+width+'.png'),fullPage:true});
 const overflow=await p.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);assert(overflow<=0,'overflow at '+width);
 await p.close();}
await b.close();console.log('PASS medicines UI: finance layer buttons, pricing kind (medicine → 0% at public price) payload, month-end discount % preview/create/review payloads, report net (sales−cost+discount+shortage profit), 1280/390.');})().catch(e=>{console.error(e);process.exit(1);});
