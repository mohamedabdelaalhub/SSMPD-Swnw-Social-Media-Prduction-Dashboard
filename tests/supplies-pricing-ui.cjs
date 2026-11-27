// Supplies PR1 (rule 9) — inventory manager in «تسعير الأصناف»: «يتحاسب على المريض؟» saves at once
// (inventory_set_patient_billable), «استثناءات حسب الخدمة» lists services with their BOM lines and saves one line
// (clinic_reception_service_billing set; '' = back to the item). Browser (Playwright) at 1280 and 390.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),path=require('path');
const root=path.resolve(__dirname,'..'),out=process.env.SHOTS||'';
const items=[{id:'m1',name:'كريم مهدئ بعد الليزر',unit:'أنبوبة',pricing_kind:'supply',markup_percent:35,sale_price:85,purchase_price:63,patient_billable:false},{id:'g1',name:'جلافز',unit:'قطعة',pricing_kind:'supply',markup_percent:35,sale_price:2.43,purchase_price:1.8,patient_billable:false}];
const services={workspace_id:'ws',services:[{id:'s1',code:'LSR',name:'ليزر نص اليدين',lines:[{item_id:'r1',item:'كريم مهدئ بعد الليزر',quantity:1,item_billable:true,override:null,billable:true},{item_id:'r2',item:'جل تبريد',quantity:1,item_billable:false,override:null,billable:false}]}]};
(async()=>{const b=await chromium.launch({args:['--no-sandbox']});
for(const width of [1280,390]){const p=await b.newPage({viewport:{width,height:900}});
 await p.setContent('<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"></head><body></body></html>');
 for(const f of ['assets/css/styles.css','assets/css/reception-minicards.css','assets/css/medicines-pricing.css','assets/css/inventory-look.css'])await p.addStyleTag({path:path.join(root,f)});
 await p.evaluate(([items,services])=>{window.__c=[];window.SSMPDToast={show:(m,k)=>window.__c.push(['toast',m,k])};
  window.SSMPDFinanceControls={panel:()=>'',act:()=>false,due:()=>0};
  window.SSMPDDb={client:{rpc:(n,a)=>{window.__c.push([n,JSON.parse(JSON.stringify(a||{}))]);let d=null;
   if(n==='inventory_pricing_list')d=items;if(n==='inventory_set_patient_billable')d={id:a.p_item,patient_billable:a.p_billable};
   if(n==='clinic_reception_service_billing')d=a.p_action==='list'?services:{service_id:a.p_payload.service_id,item_id:a.p_payload.item_id,billable:a.p_payload.billable===''?true:a.p_payload.billable==='true'};
   return Promise.resolve({data:d});}}};},[items,services]);
 for(const f of ['assets/js/reception-minicards.js','assets/js/inventory-look.js','assets/js/medicines-pricing.js'])await p.addScriptTag({path:path.join(root,f)});
 await p.evaluate(()=>window.SSMPDMedicines.pricing());await p.waitForSelector('[data-mdp-row="m1"] [data-mdp-b]');
 await p.selectOption('[data-mdp-row="m1"] [data-mdp-b]','true');await p.waitForTimeout(100);
 let c=(await p.evaluate(()=>window.__c)).find(x=>x[0]==='inventory_set_patient_billable');assert.deepEqual(c[1],{p_item:'m1',p_billable:true});
 assert(!(await p.evaluate(()=>window.__c)).some(x=>x[0]==='inventory_set_pricing_kind'),'billable change does not touch the pricing kind');
 if(out)await p.screenshot({path:path.join(out,'supplies-pricing-'+width+'.png'),fullPage:true});
 await p.click('[data-mdp-svc]');await p.waitForSelector('[data-mdsb-row="s1|r2"] [data-mdsb-b]');
 assert.match(await p.textContent('[data-mdsb]'),/ليزر نص اليدين[\s\S]*كريم مهدئ بعد الليزر[\s\S]*بيتحاسب[\s\S]*جل تبريد[\s\S]*في سعر الخدمة/);
 await p.selectOption('[data-mdsb-row="s1|r2"] [data-mdsb-b]','true');await p.waitForTimeout(100);
 c=(await p.evaluate(()=>window.__c)).filter(x=>x[0]==='clinic_reception_service_billing'&&x[1].p_action==='set').pop();assert.deepEqual(c[1],{p_workspace:null,p_action:'set',p_payload:{service_id:'s1',item_id:'r2',billable:'true'}});
 await p.selectOption('[data-mdsb-row="s1|r2"] [data-mdsb-b]','');await p.waitForTimeout(100);
 c=(await p.evaluate(()=>window.__c)).filter(x=>x[0]==='clinic_reception_service_billing'&&x[1].p_action==='set').pop();assert.equal(c[1].p_payload.billable,'');
 if(out)await p.screenshot({path:path.join(out,'supplies-services-'+width+'.png'),fullPage:true});
 const over=await p.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);assert(over<=1,'no horizontal page overflow at '+width+' ('+over+')');
 await p.close();}
await b.close();console.log('PASS supplies pricing UI (inventory manager): «يتحاسب على المريض؟» → inventory_set_patient_billable; «استثناءات حسب الخدمة» lists BOM lines and saves / clears one line; 1280 and 390.');})().catch(e=>{console.error(e);process.exit(1);});
