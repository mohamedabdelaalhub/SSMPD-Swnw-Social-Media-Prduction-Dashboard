// 20261128140000 (owner 2026-11-28 «سعر التكلفة يظهر فقط للمحاسب والمدير المالي، المالك، السوبر ادمن»): the «استهلاك أمس» sheet in a
// real browser for a NURSING user (view only), a RECEPTION user (collect) and an ACCOUNTANT, with the reply shape the server now sends.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),path=require('path'),fs=require('fs');
const root=path.resolve(__dirname,'..'),out=process.env.SHOTS||'';
const L={central:'00000000-0000-4000-8000-000000000001',dental:'d0000000-0000-4000-8000-000000000002',sub:'s0000000-0000-4000-8000-000000000003',meds:'m0000000-0000-4000-8000-000000000004'};
const list={day:'2026-11-21',can_save:true,counts:{all:2,done:1,missing:1,cost:32.85},
 locations:[{id:L.dental,name:'رئيسي أسنان',main:true},{id:L.meds,name:'رئيسي أدوية',main:true},{id:L.central,name:'رئيسي مستلزمات',main:true},{id:L.sub,name:'فرعي مستلزمات تمريض',main:false}],
 items:[{id:'i1',name:'جلافز M',unit:'قطعة',cost:1.8,stock:{[L.sub]:400,[L.central]:1000}},{id:'i2',name:'meta paste',unit:'سرينجة',cost:120,stock:{[L.dental]:5}}],
 rows:[{visit_id:'v1',visit_no:1043,time:'10:30',patient:'مريضة تجريبية',file_no:'P-2026-000101',done:false,orders:[{order_id:'o1',service:'تنضيف بشرة',department:'جلدية وتجميل',usage_status:null,lines:[],bom_cost:0},{order_id:'o2',service:'حشو عصب',department:'أسنان',usage_status:null,lines:[],bom_cost:0}]},
  {visit_id:'v2',visit_no:1044,time:'11:15',patient:'مريض تجريبي',file_no:'P-2026-000102',done:true,orders:[{order_id:'o3',service:'كشف باطنة',department:'باطنة',usage_status:'recorded',usage_by:'موظف استقبال',usage_time:'09:12',total_cost:3.6,lines:[{item:'جلافز M',unit:'قطعة',location:'فرعي مستلزمات تمريض',quantity:2,cost:3.6}]}]}]};
const ctx={suppliers:[{id:'s1',name:'مورد تجريبي'}],locations:[{id:L.central,name:'رئيسي مستلزمات',central:true},{id:L.dental,name:'رئيسي أسنان',central:false}],items:[{id:'i1',name:'جلافز M',unit:'قطعة',units_per_pack:100,track_lots:false},{id:'i2',name:'meta paste',unit:'سرينجة',units_per_pack:1,track_lots:true}]};
// the server (20261128140000) strips every cost key for nursing / reception and says can_see_cost:false
const strip=j=>Array.isArray(j)?j.map(strip):j&&typeof j==='object'?Object.fromEntries(Object.entries(j).filter(([k])=>!['cost','total_cost','bom_cost','unit_cost','avg_cost'].includes(k)).map(([k,v])=>[k,strip(v)]).concat('bom_cost' in j?[['bom',+j.bom_cost>0]]:[])):j;
const nurse=Object.assign(strip(list),{can_save:false,can_see_cost:false}),recep=Object.assign(strip(list),{can_save:true,can_see_cost:false}),acct=Object.assign({},list,{can_see_cost:true});
(async()=>{const b=await chromium.launch({args:['--no-sandbox']});
for(const [who,data] of [['nursing',nurse],['reception',recep],['accountant',acct]])for(const width of [1280,390]){const p=await b.newPage({viewport:{width,height:900}});
 await p.setContent('<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"></head><body><main id="host"><section class="rx-section">الاستقبال</section></main></body></html>');
 for(const f of ['assets/css/styles.css','assets/css/reception-minicards.css','assets/css/reception-visit-usage.css','assets/css/inventory-look.css'])await p.addStyleTag({path:path.join(root,f)});
 await p.evaluate(data=>{window.__calls=[];window.SSMPDToast={show:(m,k)=>window.__calls.push(['toast',m,k])};window.SSMPDAuth={currentAdmin:{id:'a1'}};
  window.SSMPDDb={client:{rpc:(n,a)=>{window.__calls.push([n,a.p_action]);if(n==='clinic_reception_visit_usage')return Promise.resolve({data:a.p_action==='list'?data:(data.can_see_cost?{status:'recorded',total_cost:3.6,can_see_cost:true}:{status:'recorded',can_see_cost:false})});return Promise.resolve({data:null});}}};},data);
 for(const f of ['assets/js/reception-minicards.js','assets/js/inventory-look.js','assets/js/reception-visit-usage.js'])await p.addScriptTag({path:path.join(root,f)});
 await p.evaluate(()=>window.SSMPDVisitUsage.decorate({host:document.getElementById('host'),data:{workspace:{id:'w1',mode:'live'}}},'operations'));
 await p.waitForSelector('[data-mini="rvu"] .nums');await p.click('[data-mini="rvu"]');await p.waitForSelector('[data-rvu-sheet]');
 assert.equal(await p.locator('[data-rx-sheet-close]').count()>0,true,'✕ on the sheet');
 const sheet=async()=>p.textContent('[data-rvu-sheet]');
 if(who==='accountant'){assert.match(await sheet(),/تكلفة المستلزمات \(سعر الشراء\)/);assert.match(await sheet(),/32\.85/);
  await p.click('[data-rvu-tab="all"]');await p.click('[data-rvu-visit="v2"]');assert.match(await sheet(),/تكلفة الخدمة/);}
 else{const t=await sheet();assert.doesNotMatch(t,/سعر الشراء|تكلفة|32\.85/,who+' sees no cost');assert.equal(await p.locator('.rvu-kpi').count(),3);
  await p.click('[data-rvu-tab="all"]');await p.click('[data-rvu-visit="v2"]');const t2=await sheet();assert.doesNotMatch(t2,/تكلفة|3\.6|3\.60/,who+': recorded service without cost');assert.match(t2,/جلافز M/);
  if(who==='reception'){await p.click('[data-rvu-visit="v1"]');const o=p.locator('[data-rvu-order="o1"]');await o.locator('[data-rvu-item]').selectOption('i1');assert.doesNotMatch(await o.locator('[data-rvu-avail]').textContent(),/سعر الشراء/);assert.match(await o.locator('[data-rvu-avail]').textContent(),/المتاح/);
   await o.locator('[data-rvu-newq]').fill('2');await o.locator('[data-rvu-addline]').click();const o1=p.locator('[data-rvu-order="o1"]');assert.doesNotMatch(await o1.textContent(),/سعر الشراء|تكلفة تقريبية|التكلفة/);
   await o1.locator('[data-rvu-save]').click();await p.waitForTimeout(100);const toast=(await p.evaluate(()=>window.__calls)).find(c=>c[0]==='toast');assert(toast&&!/ج$/.test(toast[1])&&/اتسجل الاستهلاك/.test(toast[1]),'toast without cost: '+(toast&&toast[1]));}}
 const overflow=await p.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);assert(overflow<=0,'no horizontal overflow '+who+' '+width);
 if(out)await p.screenshot({path:path.join(out,'cost-'+who+'-'+width+'.png'),fullPage:true});
 await p.click('[data-rx-sheet-close]');await p.close();}
await b.close();console.log('PASS «استهلاك أمس» cost visibility: nursing / reception (server reply without cost) see no purchase price, cost column, estimate, KPI or toast amount; accountant still sees them; ✕ closes; 1280 + 390.');})().catch(e=>{console.error(e);process.exit(1);});
