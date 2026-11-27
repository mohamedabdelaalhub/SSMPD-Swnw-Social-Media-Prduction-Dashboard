// «سعر بيع ثابت» screens (20261127280000), every new button by the inventory manager: item window («تعديل صنف», the REAL
// render-inventory modal() markup) — «سعر بيع ثابت» → «حفظ» calls inventory_set_fixed_price then the normal save; a fixed item
// back to «نسبة ربح %» → inventory_set_pricing_kind('supply') then the normal save; effective margin + below-cost warning; ✕ /
// «إلغاء». «تسعير الأصناف»: kind «سعر بيع ثابت» → «حفظ» → inventory_set_fixed_price; reception gets the server refusal.
const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
(async()=>{const dom=new JSDOM('<!doctype html><body></body>',{runScripts:'outside-only'});const w=dom.window,d=w.document,calls=[],toasts=[],tick=()=>new Promise(r=>setTimeout(r,8));let role='mgr';
 const rows=[{id:'sp',name:'سكين بروتيكتور',unit:'قطعة',pricing_kind:'supply',markup_percent:0,sale_price:50,purchase_price:10,patient_billable:false},{id:'gz',name:'شاش',unit:'قطعة',pricing_kind:'supply',markup_percent:35,sale_price:5.4,purchase_price:4,patient_billable:false}];
 const server=(n,a)=>{if(n!=='inventory_pricing_list'&&role!=='mgr')throw new Error('تسعير الأصناف لمسؤول المخزن');
  if(n==='inventory_pricing_list')return rows;
  if(n==='inventory_set_fixed_price'){const r=rows.find(x=>x.id===a.p_item);return {id:a.p_item,pricing_kind:'fixed',sale_price:a.p_price,markup_percent:r?r.markup_percent:0,below_cost:a.p_price<10};}
  if(n==='inventory_set_pricing_kind')return {id:a.p_item,pricing_kind:a.p_kind,markup_percent:a.p_markup,sale_price:13.5};};
 w.SSMPDDb={client:{rpc:async(n,a)=>{calls.push([role,n,JSON.parse(JSON.stringify(a))]);try{return {data:server(n,a)};}catch(e){return {error:e};}}}};
 w.SSMPDToast={show:(m,k)=>toasts.push([m,k])};
 // the REAL modal() from render-inventory.js
 const ri=fs.readFileSync('assets/js/render-inventory.js','utf8'),m0=ri.indexOf('function modal(title,body,save,saveLabel)'),m1=ri.indexOf('return back;}',m0)+13;
 w.eval('function esc(v){return String(v==null?"":v);}'+ri.slice(m0,m1)+';window.__modal=modal;');
 w.SSMPDInventoryCatalog={augmentEditor:()=>{}};w.eval(fs.readFileSync('assets/js/inventory-fixed-price.js','utf8'));
 const form=(x)=>'<div class="inv-form"><label>هامش الربح %<input name="markup" type="number" value="'+x.markup_percent+'"></label><label>سعر بيع الوحدة للجمهور بعد هامش الربح<input name="price" type="number" value="'+x.current_sale_price+'" readonly></label></div>';
 let normal=0;const open=x=>{const b=w.__modal('تعديل صنف',form(x),()=>{normal++;b.remove();});w.SSMPDInventoryCatalog.augmentEditor(b,x);return b;};
 // 1) supply item → «سعر بيع ثابت»
 let b=open({id:'sp',pricing_kind:'supply',markup_percent:0,current_sale_price:50,highest_purchase_cost:10});
 assert.ok(b.querySelector('.modal-close'),'✕ (rule 10)');const radios=b.querySelectorAll('[name=ifp_mode]');assert.equal(radios.length,2);assert.ok(radios[0].checked,'starts on «نسبة ربح %»');
 radios[1].checked=true;radios[1].dispatchEvent(new w.Event('change'));
 assert.ok(b.querySelector('[name=markup]').closest('label').hidden,'markup hidden');assert.equal(b.querySelector('[name=price]').readOnly,false,'price typed by hand');
 assert.match(b.querySelector('[data-ifp-info]').textContent,/400% \(الربح 40\.00/);
 const pr=b.querySelector('[name=price]');pr.value='8';pr.dispatchEvent(new w.Event('input'));assert.ok(!b.querySelector('[data-ifp-warn]').hidden,'below-cost warning');assert.match(b.querySelector('[data-ifp-warn]').textContent,/أقل من التكلفة 10\.00/);
 pr.value='50';pr.dispatchEvent(new w.Event('input'));assert.ok(b.querySelector('[data-ifp-warn]').hidden);
 b.querySelector('[data-save]').click();await tick();await tick();
 let c=calls.filter(x=>x[1]==='inventory_set_fixed_price').pop();assert.deepEqual([c[0],c[2].p_item,c[2].p_price],['mgr','sp',50]);assert.equal(normal,1,'then the normal save ran');
 // 2) fixed item → back to «نسبة ربح %»
 b=open({id:'sp',pricing_kind:'fixed',fixed_sale_price:50,markup_percent:0,current_sale_price:50,highest_purchase_cost:10});
 assert.ok(b.querySelectorAll('[name=ifp_mode]')[1].checked,'fixed item opens on «سعر بيع ثابت»');
 const r0=b.querySelectorAll('[name=ifp_mode]')[0];r0.checked=true;r0.dispatchEvent(new w.Event('change'));b.querySelector('[name=markup]').value='35';
 b.querySelector('[data-save]').click();await tick();await tick();c=calls.filter(x=>x[1]==='inventory_set_pricing_kind').pop();assert.deepEqual([c[2].p_item,c[2].p_kind,c[2].p_markup],['sp','supply',35]);assert.equal(normal,2);
 // 3) plain percent item stays untouched (no extra RPC); new item: no control; «إلغاء» and ✕ close
 const n0=calls.length;b=open({id:'gz',pricing_kind:'supply',markup_percent:35,current_sale_price:5.4,highest_purchase_cost:4});b.querySelector('[data-save]').click();await tick();assert.equal(calls.length,n0,'no RPC for a normal percent save');assert.equal(normal,3);
 b=open({pricing_kind:'supply',markup_percent:35,current_sale_price:0});assert.ok(!b.querySelector('[data-ifp]'),'new item: save first');b.querySelector('[data-cancel]').click();assert.ok(!b.isConnected,'«إلغاء» closes');
 b=open({id:'gz',pricing_kind:'supply',markup_percent:35,current_sale_price:5.4});b.querySelector('.modal-close').click();assert.ok(!b.isConnected,'✕ closes');
 // reception: server refuses → stays open with the message
 role='rec';b=open({id:'sp',pricing_kind:'supply',markup_percent:0,current_sale_price:50,highest_purchase_cost:10});const rr=b.querySelectorAll('[name=ifp_mode]')[1];rr.checked=true;rr.dispatchEvent(new w.Event('change'));
 b.querySelector('[data-save]').click();await tick();await tick();assert.ok(b.isConnected);assert.match(toasts.pop()[0],/لمسؤول المخزن/);b.remove();role='mgr';
 // 4) «تسعير الأصناف»: kind «سعر بيع ثابت»
 let sheetEl=null;w.SSMPDMiniCards={sheet:(k,t,el)=>{d.querySelectorAll('[data-sheet]').forEach(x=>x.remove());if(el){const h=d.createElement('div');h.setAttribute('data-sheet',k);h.appendChild(el);d.body.appendChild(h);sheetEl=el;}}};
 w.SSMPDFinanceControls={panel:()=>''};w.eval(fs.readFileSync('assets/js/medicines-pricing.js','utf8'));
 w.SSMPDMedicines.pricing();await tick();await tick();
 const tr=sheetEl.querySelector('[data-mdp-row="sp"]'),k=tr.querySelector('[data-mdp-k]');assert.ok([...k.options].some(o=>o.value==='fixed'&&/سعر بيع ثابت/.test(o.textContent)));
 k.value='fixed';k.dispatchEvent(new w.Event('change',{bubbles:true}));const mi=tr.querySelector('[data-mdp-m]');assert.equal(mi.value,'50','price box gets the current sale price');
 assert.match(tr.querySelector('[data-mdp-p]').textContent,/50\.00 · هامش فعلي 400%/);
 tr.querySelector('[data-mdp-save]').click();await tick();await tick();c=calls.filter(x=>x[1]==='inventory_set_fixed_price').pop();assert.deepEqual([c[2].p_item,c[2].p_price],['sp',50]);
 const tr2=sheetEl.querySelector('[data-mdp-row="sp"]')||d.querySelector('[data-mdp-row="sp"]');assert.equal(tr2.querySelector('[data-mdp-k]').value,'fixed','list shows «سعر بيع ثابت» after save');
 console.log('PASS inventory fixed sale price screens: item window fixed / back to percent / no-op / new item, margin + below-cost warning, ✕ + «إلغاء», reception refused; «تسعير الأصناف» fixed kind saves.');
})().catch(e=>{console.error(e);process.exit(1);});
