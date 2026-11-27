// «الملاحظة جنب الدفعة اللي غطّت أكتر من زيارة» UI (20261122390000, owner «طبقه»): one badge + note look everywhere, a «why» line under
// receipts counts that opens the list, receipts table / receipt detail / shared records / invoice print / shift movements. Sample data only.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
const read=f=>fs.readFileSync('assets/js/'+f,'utf8');
(async()=>{
 const dom=new JSDOM('<main id="h"><p id="cnt">14 إيصال</p></main>',{runScripts:'outside-only'}),w=dom.window,d=w.document,calls=[];
 const sum={receipts:14,multi:2,multi_visits:4,rows:[{id:'p1',receipt_no:'RC-2026-000412',amount:1000,visits:2,cross_patient:true,note:'يحيى دفع التحويل كله عن نفسه وعن صاحبه محمود',by:'منار',lines:[{patient:'يحيى تجريبي',no:'118',applied:500},{patient:'محمود تجريبي',no:'121',applied:500}]},{id:'p2',receipt_no:'RC-2026-000411',amount:700,visits:2,cross_patient:false,note:'تحويل واحد — منار وابنها',by:'منار',lines:[]}]};
 w.SSMPDDb={client:{rpc:async(n,a)=>{calls.push([n,a]);return {data:JSON.parse(JSON.stringify(sum)),error:null};}}};
 w.eval(read('multi-payment-note.js'));const MP=w.SSMPDMultiPay;
 // badge + note
 assert.equal(MP.block(1,'x',false),'','single-visit payment: nothing');
 const b=MP.block(2,'يحيى دفع عن محمود',true);assert.match(b,/دفعة واحدة لـ2 زيارات — لأكتر من مريض/);assert.match(b,/mpn-note x/);assert.match(b,/يحيى دفع عن محمود/);
 assert.match(MP.block(2,'<b>',false),/&lt;b&gt;/,'note escaped');assert(!/لأكتر من مريض/.test(MP.block(3,'',false)));
 assert.equal(MP.countVisits([{visit_no:1},{visit_no:1},{visit_no:2}]),2);
 // «why» under a count + list
 await MP.explain(d.getElementById('cnt'),{finance_shift:'s1'});
 assert.equal(JSON.stringify(calls[0]),JSON.stringify(['clinic_reception_multi_payments',{p:{finance_shift:'s1'}}]));
 const why=d.querySelector('[data-mpn-why]');assert(why&&why.previousElementSibling.id==='cnt','line right after the count');
 assert.match(why.textContent,/14 إيصال — منهم 2 دفعات غطّت أكتر من زيارة \(4 زيارة\)/);assert(!/[٠-٩]/.test(why.textContent));
 await MP.explain(d.getElementById('cnt'),{finance_shift:'s1'});assert.equal(d.querySelectorAll('[data-mpn-why]').length,1,'idempotent');assert.equal(calls.length,1,'cached');
 why.querySelector('[data-mpn-open]').click();const box=d.querySelector('.mpn-box');assert(box);assert.match(box.textContent,/RC-2026-000412/);assert.match(box.textContent,/يحيى تجريبي — 118 \(500\) \+ محمود تجريبي — 121 \(500\)/);
 box.querySelector('[data-mpn-close]').click();assert(!d.querySelector('.mpn-modal'));
 assert.equal(MP.why({receipts:5,multi:0}),'','no line when nothing is multi');
 // reception receipts list (reception-services.js)
 const rs=read('reception-services.js');w.eval(rs.slice(rs.indexOf('function payVisits('),rs.indexOf('function multiCandidates('))+';window.RS={payVisits,payNote};');
 const snap={invoices:[{id:'i1',visit_id:'v1'},{id:'i2',visit_id:'v2'},{id:'i3',visit_id:'v1'}],allocations:[{payment_id:'p1',invoice_id:'i1'},{payment_id:'p1',invoice_id:'i2'},{payment_id:'p3',invoice_id:'i1'},{payment_id:'p3',invoice_id:'i3'}]};
 assert.equal(w.RS.payVisits(snap,'p1'),2);assert.equal(w.RS.payVisits(snap,'p3'),1,'two invoices of the same visit = one visit');
 assert.match(w.RS.payNote(snap,{id:'p1',note:'يحيى دفع عن محمود',cross_patient:true}),/دفعة واحدة لـ2 زيارات — لأكتر من مريض/);assert.equal(w.RS.payNote(snap,{id:'p3',note:'x'}),'');
 assert(rs.includes(":e(p.reference))+payNote(d,p),e(method(p.method))"),'badge + note in the receipts table');
 // receipt detail (reception-bridge.js)
 const br=read('reception-bridge.js');w.eval(br.slice(br.indexOf('function coveredVisits('),br.indexOf('function pairs(c,list){'))+';window.BR={coveredVisits};');
 const c={esc:v=>String(v),money:v=>Number(v).toFixed(2),lookup:(l,id)=>({a:'يحيى تجريبي',b:'محمود تجريبي'})[id]};
 const html=w.BR.coveredVisits({invoices:[{id:'i1',patient_id:'a',visit_id:'v1',description:'كشف'},{id:'i2',patient_id:'b',visit_id:'v2',description:'كشف تغذية'}],visits:[{id:'v1',visit_no:118},{id:'v2',visit_no:121}],allocations:[{payment_id:'p1',invoice_id:'i1',amount:500},{payment_id:'p1',invoice_id:'i2',amount:500}]},c,{id:'p1',cross_patient:true});
 assert.match(html,/الدفعة دي غطّت 2 زيارات/);assert.match(html,/محمود تجريبي — زيارة 121 — كشف تغذية — 500.00/);assert.match(html,/لأكتر من مريض/);
 assert(br.includes("+(!isInvoice?coveredVisits(d,c,record):'');"),'shown in the receipt detail');
 // shared records (reception-shared.js)
 const sh=read('reception-shared.js');w.eval(sh.slice(sh.indexOf('function payNote(p){'),sh.indexOf("</small>';}",sh.indexOf('function payFor(p){'))+11)+';window.SH={payNote,payFor};');
 const sp={note:'يحيى دفع عن محمود',cross_patient:true,allocations:[{invoice_id:'i1',visit_no:118,amount:500,patient:'يحيى تجريبي'},{invoice_id:'i2',visit_no:121,amount:500,patient:'محمود تجريبي'}]};
 assert.match(w.SH.payNote(sp),/لـ2 زيارات/);assert.match(w.SH.payFor(sp),/يحيى تجريبي زيارة 118 \(500\) \+ محمود تجريبي زيارة 121 \(500\)/);
 assert.equal(w.SH.payNote({allocations:[{visit_no:1}]}),'');
 // visit invoice print
 for(const f of ['patient-invoice-print.js','service-invoice-print.js'])assert(read(f).includes("جزء من دفعة '+money(p.total)+' غطّت '+Number(p.visits)+' زيارات'"),f+': part of a bigger payment');
 // shift movements: rows decorated by payment id, export columns
 const mv=read('finance-shift-movements.js');assert(mv.includes("'ملاحظة الدفعة','عدد الزيارات']"));assert(mv.includes('window.SSMPDMultiPay.block(r.mp_visits,r.mp_note,r.mp_cross)'));
 assert(mv.includes("MP.load({ids:ids.slice(0,3000)})"));
 // counts wired
 assert(read('finance-cash.js').includes("window.SSMPDMultiPay.explain(el,{finance_shift:el.getAttribute('data-fc-mp')})"));
 assert(read('reception-controls.js').includes("window.SSMPDMultiPay.explain(w,{from:c.from,to:c.to})"));
 assert(read('render-reports.js').includes('code === "staff_productivity" && state.data && window.SSMPDMultiPay'));
 assert(read('accounting-overview.js').includes("لأكتر من زيارة"));
 const idx=fs.readFileSync('index.html','utf8');assert(idx.indexOf('multi-payment-note.js?v=')>0&&idx.indexOf('multi-payment-note.js?v=')<idx.indexOf('reception-services.js?v='),'helper loaded');
 console.log('PASS multi payment note UI: badge + note look, why line + list, receipts table, receipt detail, shared records, invoice print, shift movements, counts wired.');
})().catch(e=>{console.error(e);process.exit(1);});
