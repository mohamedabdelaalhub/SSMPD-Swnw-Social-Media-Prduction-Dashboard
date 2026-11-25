// Owner 2026-11-25 («طبقه» on docs/ui-references/mockups/package-fixed-price.html): price editor package modal —
// «سعر الباكج»: محسوب من الخدمات / سعر ثابت (pricing_packages.booking_fixed_price, mig 20261125120000), day presets,
// warning when the fixed price is above the standalone total, «طريقة السعر» column in the table and the export rows.
const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');const read=n=>fs.readFileSync(__dirname+'/../assets/js/'+n+'.js','utf8'),tick=()=>new Promise(r=>setTimeout(r,15));
(async()=>{const d=new JSDOM('<main id="view"></main>',{runScripts:'outside-only'}),w=d.window,doc=w.document,errors=[];w.addEventListener('error',e=>errors.push(e.message));
 w.eval(read('roles'));const saved=[],toasts=[];w.SSMPDToast={error:m=>toasts.push(m),show:m=>toasts.push(m)};
 w.SSMPDAuth={currentAdmin:{id:'acc1',role:'super_admin'}};
 const face={id:'svc1',name:'جلسة ليزر إزالة الشعر لمنطقة الوجه كانديلا',base_price:150,supplies_used:[],profit_margin_percent:0,active:true};
 let pkgs=[{id:'c1',name:'عروض المناطق لليزر — كانديلا 3 جلسات — الوجه',services_included:[1,2,3].map(v=>({service_id:'svc1',quantity:1,visit_no:v})),profit_margin_percent:0,booking_enabled:true,booking_visits:3,booking_validity_days:90,booking_min_first_percent:25,booking_fixed_price:380},
           {id:'m1',name:'باكج محسوب',services_included:[{service_id:'svc1',quantity:1,visit_no:1}],profit_margin_percent:10,booking_enabled:true,booking_visits:1,booking_validity_days:30,booking_min_first_percent:null,booking_fixed_price:null}];
 w.SSMPDDb={listPricingSupplies:async()=>[],listPricingServices:async()=>[face],listPricingPackages:async()=>pkgs,savePricingPackage:async(p)=>{saved.push(p);return p;}};
 w.eval(read('render-accounting'));w.SSMPDRenderAccounting.render(doc.querySelector('#view'));await tick();
 doc.querySelector('[data-acc-section="packages"]').click();await tick();
 // table: price mode column + the fixed price as the final total
 const rows=[...doc.querySelectorAll('.acc-table tbody tr')].map(r=>r.textContent);
 assert(doc.querySelector('.acc-table thead').textContent.includes('طريقة السعر'));
 assert(rows[0].includes('ثابت')&&rows[0].includes('380')&&!rows[0].includes('-70')&&rows[0].includes('—'),'fixed row shows ثابت, 380 and — for margin/profit');assert(rows[1].includes('محسوب')&&rows[1].includes('165'),'calc row shows محسوب and 165');
 // edit the fixed package: fixed mode on, margin disabled, saving shown (450 standalone → 380)
 doc.querySelector('[data-edit-package="c1"]').click();await tick();
 assert.equal(doc.querySelector('#pk-mode-fixed').className,'on');assert.equal(doc.querySelector('#pk-fixed').value,'380');assert.equal(doc.querySelector('#pk-margin').disabled,true);
 let tot=doc.querySelector('#pk-totals').textContent;assert(tot.includes('سعر الباكج في الاستقبال')&&tot.includes('380')&&tot.includes('450')&&tot.includes('بيوفّر')&&tot.includes('70'),tot);
 // above standalone → warning
 doc.querySelector('#pk-fixed').value='500';doc.querySelector('#pk-fixed').dispatchEvent(new w.Event('input'));
 assert(doc.querySelector('#pk-fixed-warn')&&doc.querySelector('#pk-fixed-warn').textContent.includes('50'),'warning above standalone');
 // presets
 [['30','30'],['90','90'],['120','120'],['150','150']].forEach(([b,v])=>{doc.querySelector('[data-pk-days="'+b+'"]').click();assert.equal(doc.querySelector('#pk-validity').value,v);});
 doc.querySelector('[data-pk-days="90"]').click();
 // empty fixed price refused
 doc.querySelector('#pk-fixed').value='';doc.querySelector('#pk-save').click();await tick();assert.equal(saved.length,0);assert.match(toasts.pop(),/السعر الثابت|سعر الباكج الثابت/);
 doc.querySelector('#pk-fixed').value='380';doc.querySelector('#pk-save').click();await tick();
 assert.equal(saved.length,1);assert.deepEqual([saved[0].id,saved[0].booking_fixed_price,saved[0].booking_validity_days,saved[0].booking_min_first_percent],['c1',380,90,25]);
 // switch a fixed package back to calculated → booking_fixed_price null
 doc.querySelector('[data-acc-section="packages"]')&&doc.querySelector('[data-acc-section="packages"]').click();await tick();
 doc.querySelector('[data-edit-package="c1"]').click();await tick();doc.querySelector('#pk-mode-calc').click();
 assert.equal(doc.querySelector('#pk-margin').disabled,false);assert.equal(doc.querySelector('#pk-fixed-wrap').style.display,'none');
 doc.querySelector('#pk-save').click();await tick();assert.equal(saved[1].booking_fixed_price,null);
 // calculated package → switch to fixed and save 150
 doc.querySelector('[data-acc-section="packages"]')&&doc.querySelector('[data-acc-section="packages"]').click();await tick();
 doc.querySelector('[data-edit-package="m1"]').click();await tick();assert.equal(doc.querySelector('#pk-mode-calc').className,'on');assert.equal(doc.querySelector('#pk-fixed-wrap').style.display,'none');
 doc.querySelector('#pk-mode-fixed').click();doc.querySelector('#pk-fixed').value='150';doc.querySelector('#pk-fixed').dispatchEvent(new w.Event('input'));doc.querySelector('#pk-save').click();await tick();
 assert.equal(saved[2].id,'m1');assert.equal(saved[2].booking_fixed_price,150);
 assert.deepEqual(errors,[]);
 console.log('PASS package fixed price editor: table «طريقة السعر», fixed mode loads/saves, margin disabled, saving + above-standalone warning, 30/90/120/150 presets, empty refused, switch fixed↔calc saves null/number.');
})().catch(e=>{console.error(e);process.exit(1);});
