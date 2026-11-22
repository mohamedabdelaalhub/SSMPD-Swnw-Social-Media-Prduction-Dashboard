// Browser check (mock data): «استهلاك أمس» sheet and «فاتورة مورد مباشرة» at 1280 and 390, payloads sent to the RPCs.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),path=require('path'),fs=require('fs');
const root=path.resolve(__dirname,'..'),out=process.env.SHOTS||'';
const L={central:'00000000-0000-4000-8000-000000000001',dental:'d0000000-0000-4000-8000-000000000002',sub:'s0000000-0000-4000-8000-000000000003',meds:'m0000000-0000-4000-8000-000000000004'};
const list={day:'2026-11-21',counts:{all:2,done:1,missing:1,cost:32.85},
 locations:[{id:L.dental,name:'رئيسي أسنان',main:true},{id:L.meds,name:'رئيسي أدوية',main:true},{id:L.central,name:'رئيسي مستلزمات',main:true},{id:L.sub,name:'فرعي مستلزمات تمريض',main:false}],
 items:[{id:'i1',name:'جلافز M',unit:'قطعة',cost:1.8,stock:{[L.sub]:400,[L.central]:1000}},{id:'i2',name:'meta paste',unit:'سرينجة',cost:120,stock:{[L.dental]:5}}],
 rows:[{visit_id:'v1',visit_no:1043,time:'10:30',patient:'مريضة تجريبية',file_no:'P-2026-000101',done:false,orders:[{order_id:'o1',service:'تنضيف بشرة',department:'جلدية وتجميل',usage_status:null,lines:[],bom_cost:0},{order_id:'o2',service:'حشو عصب',department:'أسنان',usage_status:null,lines:[],bom_cost:0}]},
  {visit_id:'v2',visit_no:1044,time:'11:15',patient:'مريض تجريبي',file_no:'P-2026-000102',done:true,orders:[{order_id:'o3',service:'كشف باطنة',department:'باطنة',usage_status:'recorded',usage_by:'موظف استقبال',usage_time:'09:12',total_cost:3.6,lines:[{item:'جلافز M',unit:'قطعة',location:'فرعي مستلزمات تمريض',quantity:2,cost:3.6}]}]}]};
const ctx={suppliers:[{id:'s1',name:'مورد تجريبي'}],locations:[{id:L.central,name:'رئيسي مستلزمات',central:true},{id:L.dental,name:'رئيسي أسنان',central:false}],items:[{id:'i1',name:'جلافز M',unit:'قطعة',units_per_pack:100,track_lots:false},{id:'i2',name:'meta paste',unit:'سرينجة',units_per_pack:1,track_lots:true}]};
(async()=>{const b=await chromium.launch({args:['--no-sandbox']});
for(const width of [1280,390]){const p=await b.newPage({viewport:{width,height:900}});
 await p.setContent('<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"></head><body><main id="host"><section class="rx-section">الاستقبال</section></main></body></html>');
 for(const f of ['assets/css/styles.css','assets/css/reception-minicards.css','assets/css/reception-visit-usage.css'])await p.addStyleTag({path:path.join(root,f)});
 await p.evaluate(([list,ctx])=>{window.__calls=[];window.SSMPDToast={show:(m,k)=>window.__calls.push(['toast',m,k])};
  window.SSMPDDb={client:{rpc:(n,a)=>{window.__calls.push([n,JSON.parse(JSON.stringify(a))]);
   if(n==='clinic_reception_visit_usage')return Promise.resolve({data:a.p_action==='list'?list:{status:'recorded',total_cost:3.6}});
   if(n==='inventory_direct_invoice')return Promise.resolve({data:a.p_action==='context'?ctx:{id:'r1',total:1800,supplier:'مورد تجريبي',location:'رئيسي مستلزمات'}});
   return Promise.resolve({data:null});}}};},[list,ctx]);
 for(const f of ['assets/js/reception-minicards.js','assets/js/reception-visit-usage.js','assets/js/inventory-direct-invoice.js'])await p.addScriptTag({path:path.join(root,f)});
 await p.evaluate(()=>window.SSMPDVisitUsage.decorate({host:document.getElementById('host'),data:{workspace:{id:'w1',mode:'live'}}},'operations'));
 await p.waitForSelector('[data-mini="rvu"] .nums');assert.match(await p.textContent('[data-mini="rvu"]'),/1 ناقص/);
 await p.click('[data-mini="rvu"]');await p.waitForSelector('[data-rvu-sheet]');
 const first=p.locator('[data-rvu-order="o1"]'),dent=p.locator('[data-rvu-order="o2"]');
 assert.equal(await first.locator('[data-rvu-loc]').inputValue(),L.sub,'skin → nursing sub');
 assert.equal(await dent.locator('[data-rvu-loc]').inputValue(),L.dental,'dental → main dental');
 await first.locator('[data-rvu-item]').selectOption('i1');await first.locator('[data-rvu-newq]').fill('2');await first.locator('[data-rvu-addline]').click();
 await p.locator('[data-rvu-order="o1"] [data-rvu-item]').selectOption('i1');
 assert.match(await p.textContent('[data-rvu-order="o1"] [data-rvu-avail]'),/400/);
 if(out)await p.screenshot({path:path.join(out,'usage-'+width+'.png'),fullPage:true});
 await p.click('[data-rvu-order="o1"] [data-rvu-save]');await p.waitForTimeout(100);
 const save=(await p.evaluate(()=>window.__calls)).find(c=>c[0]==='clinic_reception_visit_usage'&&c[1].p_action==='save');
 assert.deepEqual(save[1].p_payload.lines,[{item_id:'i1',location_id:L.sub,quantity:2}]);assert.equal(save[1].p_payload.order_id,'o1');assert.equal(save[1].p_payload.none,false);assert(save[1].p_payload.token);
 await p.click('[data-rvu-order="o2"] [data-rvu-none]');await p.waitForTimeout(100);
 const none=(await p.evaluate(()=>window.__calls)).filter(c=>c[0]==='clinic_reception_visit_usage'&&c[1].p_action==='save')[1];assert.equal(none[1].p_payload.none,true);assert.deepEqual(none[1].p_payload.lines,[]);
 const overflow=await p.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);assert(overflow<=0,'no horizontal overflow at '+width);
 await p.click('[data-rx-sheet-close]');
 // direct supplier invoice
 await p.evaluate(()=>window.SSMPDInventoryDirectInvoice.open());await p.waitForSelector('[data-idi]');
 await p.selectOption('[data-idi] [name="supplier"]','s1');await p.fill('[data-idi] [name="reference"]','INV-1');
 await p.selectOption('[data-idi-item]','i1');assert.match(await p.textContent('[data-idi-hint]'),/100/);
 await p.fill('[data-idi-packs]','10');await p.fill('[data-idi-cost]','180');await p.fill('[data-idi-lot]','G-1');await p.click('[data-idi-addline]');
 assert.equal((await p.textContent('[data-idi-total]')).trim(),'1,800.00 ج');
 if(out)await p.screenshot({path:path.join(out,'invoice-'+width+'.png'),fullPage:true});
 await p.click('[data-idi-save]');await p.waitForTimeout(100);
 const inv=(await p.evaluate(()=>window.__calls)).find(c=>c[0]==='inventory_direct_invoice'&&c[1].p_action==='save')[1].p_payload;
 assert.equal(inv.location_id,L.central);assert.deepEqual(inv.lines,[{item_id:'i1',quantity:1000,package_cost:180,lot_number:'G-1',expiry_date:null}]);
 assert.match(await p.textContent('[data-idi-save]'),/اتحفظت/);
 await p.close();}
await b.close();console.log('PASS supplies flow UI: mini-card counts, sheet, department → default store (skin→nursing sub, dental→main dental), availability, save/none payloads, direct invoice packs×units and total, 1280/390 no overflow.');})().catch(e=>{console.error(e);process.exit(1);});
