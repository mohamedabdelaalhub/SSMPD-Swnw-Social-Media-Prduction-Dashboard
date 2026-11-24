// Price editor (render-accounting.js) package modal — offer fields (20261123170000): «يتباع من / لحد», «أقل دفعة أولى %»
// (25 by default for a NEW package, empty = no rule for an existing one), «4 شهور (120 يوم)» validity, saved to pricing_packages.
const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');const read=n=>fs.readFileSync(__dirname+'/../assets/js/'+n+'.js','utf8'),tick=()=>new Promise(r=>setTimeout(r,15));
(async()=>{const d=new JSDOM('<main id="view"></main>',{runScripts:'outside-only'}),w=d.window,doc=w.document,errors=[];w.addEventListener('error',e=>errors.push(e.message));
 w.eval(read('roles'));const saved=[],toasts=[];w.SSMPDToast={error:m=>toasts.push(m),show:m=>toasts.push(m)};
 w.SSMPDAuth={currentAdmin:{id:'super',role:'super_admin'}};
 w.SSMPDDb={listPricingSupplies:async()=>[],listPricingServices:async()=>[{id:'svc1',name:'جلسة ليزر',base_price:500,supplies_used:[],profit_margin_percent:0,active:true}],
  listPricingPackages:async()=>[{id:'old1',name:'باكج قديم',services_included:[{service_id:'svc1',quantity:1,visit_no:1}],profit_margin_percent:0,booking_enabled:true,booking_visits:1,booking_validity_days:30,booking_min_first_percent:null}],
  savePricingPackage:async(p)=>{saved.push(p);return p;}};
 w.eval(read('render-accounting'));w.SSMPDRenderAccounting.render(doc.querySelector('#view'));await tick();
 doc.querySelector('[data-acc-section="packages"]').click();await tick();
 // new package: 120 days, 25 %
 doc.querySelector('#acc-add-package').click();await tick();
 assert.equal(doc.querySelector('#pk-validity').value,'120');assert.equal(doc.querySelector('#pk-min-first').value,'25');assert(doc.querySelector('[data-pk-offer] legend').textContent.includes('العرض'));
 doc.querySelector('#pk-name').value='عرض الشتا';doc.querySelector('#pk-validity').value='30';doc.querySelector('#pk-4m').click();assert.equal(doc.querySelector('#pk-validity').value,'120');
 doc.querySelector('#pk-sell-from').value='2026-12-10';doc.querySelector('#pk-sell-until').value='2026-12-01';doc.querySelector('#pk-save').click();await tick();
 assert.equal(saved.length,0,'range checked');assert.match(toasts.pop(),/لازم يكون بعد/);
 doc.querySelector('#pk-sell-until').value='2027-01-31';doc.querySelector('#pk-save').click();await tick();
 assert.equal(saved.length,1);const p=saved[0];
 assert.deepEqual([p.booking_sell_from,p.booking_sell_until,p.booking_min_first_percent,p.booking_validity_days],['2026-12-10','2027-01-31',25,120]);
 // existing package without a rule: empty field → stays null
 await tick();doc.querySelector('[data-acc-section="packages"]')&&doc.querySelector('[data-acc-section="packages"]').click();await tick();
 doc.querySelector('[data-edit-package="old1"]').click();await tick();assert.equal(doc.querySelector('#pk-min-first').value,'','no rule shown as empty');assert.equal(doc.querySelector('#pk-validity').value,'30');
 doc.querySelector('#pk-save').click();await tick();const q=saved[1];assert.deepEqual([q.id,q.booking_min_first_percent,q.booking_sell_from,q.booking_sell_until],['old1',null,null,null]);
 assert.deepEqual(errors,[]);
 console.log('PASS package offers price editor: new package defaults 120 days + 25 %, «4 شهور» preset, sell window saved (range checked), existing package keeps no rule (null).');
})().catch(e=>{console.error(e);process.exit(1);});
